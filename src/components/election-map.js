import L from "npm:leaflet";
import * as d3 from "npm:d3";
import {turnoutValue, turnoutNorm, fetchTextAsset, fetchJSONAsset, councilSelfgovIdFromMajorId} from "./election-utils.js";

// Module-level cache: survives buildElectionMap re-calls (one fetch per session)
const _precinctRegistryCache = {
  geoManifest: null,
  geoByPath: new Map(),
  csvManifest: null,
  csvByPath: new Map()
};

async function loadPrecinctGeo(path, registryUrl) {
  if (!path || !registryUrl) return null;

  if (!_precinctRegistryCache.geoManifest) {
    _precinctRegistryCache.geoManifest = await fetchJSONAsset(registryUrl);
  }

  const assetPath = _precinctRegistryCache.geoManifest[path];
  if (!assetPath) return null;

  if (!_precinctRegistryCache.geoByPath.has(assetPath)) {
    const promise = fetchJSONAsset(assetPath).catch(error => {
      _precinctRegistryCache.geoByPath.delete(assetPath);
      throw error;
    });
    _precinctRegistryCache.geoByPath.set(assetPath, promise);
  }

  return _precinctRegistryCache.geoByPath.get(assetPath);
}

async function loadPrecinctCsv(path, registryUrl) {
  if (!path || !registryUrl) return [];

  if (!_precinctRegistryCache.csvManifest) {
    _precinctRegistryCache.csvManifest = await fetchJSONAsset(registryUrl);
  }

  const assetPath = _precinctRegistryCache.csvManifest[path];
  if (!assetPath) return [];

  if (!_precinctRegistryCache.csvByPath.has(assetPath)) {
    const promise = fetchTextAsset(assetPath)
      .then(text => d3.csvParse(text, d3.autoType))
      .catch(error => {
        _precinctRegistryCache.csvByPath.delete(assetPath);
        throw error;
      });
    _precinctRegistryCache.csvByPath.set(assetPath, promise);
  }

  return _precinctRegistryCache.csvByPath.get(assetPath);
}

// Builds (or rebuilds) the Leaflet election map.
// Called from elections.md as an awaited async cell.
// ctx must include all reactive state plus mutable handles and renderer functions.
export async function buildElectionMap({
  t, lang, electionVal, voteTypeVal, effectiveVoteType, mapMode, viewMode, isCouncilMode, ballotTypeVal,
  geoData, cartData, results, turnoutData, turnoutByDistrict,
  councilDistrictGeoData, councilDistrictResults,
  selfgovGeoData, selfgovResults,
  precinctGeoPath, precinctCsvPath, precinctTurnout,
  _precinctGeoRegistryUrl, _precinctCsvRegistryUrl,
  seatsData, _districtRows, _allCouncilSMDResults, _invalidMax,
  _mapCtrl, _mapState, _turnoutMetricCtrl, _levelCtrl, _partyCtrl, mapContainer,
  getParty, partyColor, passed,
  renderTurnoutPanel, renderDistrictPanel, updateCouncilSeats,
  shareUrlForCurrentMap,
  invalidation
}) {
  // Restore saved view if we're staying on the same election and ballot.
  const _viewCfg    = (ballotTypeVal === "mayor" && electionVal?.map_view_mayor)
    ? electionVal.map_view_mayor
    : electionVal?.map_view;
  const _sameElec   = _mapState.elecId === electionVal?.id && _mapState.ballotType === ballotTypeVal;
  const _defCenter  = _viewCfg?.center ?? [42.1, 43.0];
  const _defZoom    = _viewCfg?.zoom   ?? 7;
  const _initCenter = _sameElec ? _mapState.center : _defCenter;
  const _initZoom   = _sameElec ? _mapState.zoom   : _defZoom;

  // Clean up previous Leaflet instance; save current view first so we can restore it
  invalidation.then(() => {
    try {
      _mapState.center = map.getCenter();
      _mapState.zoom   = map.getZoom();
      _mapState.elecId = electionVal?.id;
      _mapState.ballotType = ballotTypeVal;
      map.remove();
    } catch(e) {}
  });

  const map = L.map(mapContainer, {zoomControl: true}).setView(_initCenter, _initZoom);
  function closeMapTooltip() {
    map.eachLayer(layer => {
      if (layer.getTooltip?.()) layer.closeTooltip();
    });
  }
  map.on("movestart dragstart zoomstart", closeMapTooltip);
  mapContainer.addEventListener("mouseleave", closeMapTooltip);

  L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
    subdomains: 'abcd', maxZoom: 19
  }).addTo(map);

  const activeGeo = mapMode === "cartogram" ? cartData : geoData;
  if (!activeGeo) {
    setTimeout(() => map.invalidateSize(), 150);
    return;
  }

  // Build district → winner lookup (from district-level results)
  const winnerByDistrict = new Map();
  const shareByDistrict  = new Map();
  d3.group(_districtRows, r => String(r.district_id)).forEach((rows, distId) => {
    const winner = rows.reduce((a, b) => (b.vote_share > a.vote_share ? b : a));
    winnerByDistrict.set(distId, winner);
    shareByDistrict.set(distId, d3.max(rows, r => r.vote_share));
  });

  function districtStyle(feature) {
    const did = String(feature.properties.id);
    if (viewMode === "turnout") {
      const td = turnoutByDistrict.get(did);
      if (!td) return {fillColor: "#e0e0e0", fillOpacity: 0.75, color: "#bbb", weight: 0.5};
      const fillColor = d3.interpolateRgb("#fee2e2", "#b91c1c")(turnoutNorm(td, _turnoutMetricCtrl.value, _invalidMax));
      return {fillColor, fillOpacity: 0.85, color: "#ffffff", weight: 0.5};
    }
    const winner = winnerByDistrict.get(did);
    if (!winner) return {fillColor: "#e0e0e0", fillOpacity: 0.75, color: "#bbb", weight: 0.5};
    const baseColor = partyColor(winner.party_id, electionVal?.id);
    const intensity = shareByDistrict.get(did) ?? 0.5;
    const lightened = d3.color(baseColor) ? d3.interpolateRgb("#f5f5f5", baseColor)(0.4 + intensity * 0.6) : "#ccc";
    return {fillColor: lightened, fillOpacity: 0.85, color: "#ffffff", weight: 0.5};
  }

  // Stringify GeoJSON integer ids once — both winnerByDistrict and turnoutByDistrict
  // are keyed by string (from CSV), but GeoJSON feature.properties.id is an integer.
  function geoId(feature) {
    const p = feature?.properties ?? {};
    return String(p.major_id ?? p.maj_id ?? p.id);
  }
  function councilSelfgovIdFromDistrictId(id) {
    const n = Number(id);
    return String(n >= 1 && n <= 10 ? 1 : n);
  }
  function updateCouncilSeatsForDistrict(did, props) {
    const sgId = councilSelfgovIdFromDistrictId(did);
    const sgFeat = selfgovGeoData?.features?.find(f => String(f.properties.id) === sgId);
    updateCouncilSeats(sgId, sgFeat?.properties ?? props, true);
  }

  // Returns the full human-readable feature name for panels and tooltips.
  // Handles majoritarian GeoJSON (district_name_en + N + major) where name_en/name_ka are absent.
  function getFeatureName(feature, l = "en") {
    const p = feature?.properties ?? {};
    const majorNum = p.major ?? p.majoritarian_district ?? (p.maj_id != null ? Number(p.maj_id) % 100 : null);
    if (l === "ka" && p.name_ka) return p.name_ka;
    if (p.name_en) return p.name_en;
    if (l === "ka" && p.district_name_ka != null && p.major != null) return `${p.district_name_ka} N${p.major}`;
    if (p.district_name_en != null && p.major != null) return `${p.district_name_en} N${p.major}`;
    if (l === "ka" && p.district_name_ka) return p.district_name_ka;
    if (p.district_name_en) return p.district_name_en;
    if (l === "ka" && p.district_ka != null && majorNum != null) return `${p.district_ka} N${majorNum}`;
    if (p.district_en != null && majorNum != null) return `${p.district_en} N${majorNum}`;
    if (l === "ka" && p.district_ka) return p.district_ka;
    if (p.district_en) return p.district_en;
    return null;
  }

  // Returns just the base district name (without N+major) for precinct title building,
  // so precinct titles read "Mtatsminda N{precinct_num}" not "Mtatsminda N1 N{precinct_num}".
  function getDistrictBaseName(feature, l = "en") {
    const p = feature?.properties ?? {};
    if (l === "ka" && p.name_ka) return p.name_ka;
    if (p.name_en) return p.name_en;
    if (l === "ka" && p.district_name_ka) return p.district_name_ka;
    if (p.district_name_en) return p.district_name_en;
    if (l === "ka" && p.district_ka) return p.district_ka;
    if (p.district_en) return p.district_en;
    return null;
  }

  const _tooltipFallbacks = {
    winner: "Leader",
    subject: "Subject",
    votes: "Votes",
    share: "Share",
    turnout: "Turnout",
    count: "Count",
    registered: "Registered",
    noData: "No data"
  };
  function tooltipLabel(key, fallbackKey = key) {
    return t(`elections.map.tooltip.${key}`) || _tooltipFallbacks[fallbackKey] || key;
  }
  const _tooltipLabels = {
    winner: tooltipLabel("winner"),
    subject: tooltipLabel("subject"),
    votes: tooltipLabel("votes"),
    share: tooltipLabel("share"),
    turnout: tooltipLabel("turnout"),
    count: tooltipLabel("count"),
    registered: tooltipLabel("registered"),
    noData: tooltipLabel("no_data", "noData")
  };

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function formatCount(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return "—";
    const formatted = new Intl.NumberFormat("en-US", {maximumFractionDigits: 0}).format(Math.round(n));
    return lang === "ka" ? formatted.replaceAll(",", " ") : formatted;
  }

  function formatPct(value) {
    const n = Number(value);
    return Number.isFinite(n) ? `${(n * 100).toFixed(1)}%` : "—";
  }

  function activePartyId() {
    return _mapCtrl.current?.currentPartyId ?? _partyCtrl?.value ?? null;
  }

  function rowName(row) {
    if (!row) return null;
    const party = getParty?.(row.party_id);
    return (lang === "ka" && (row.name_ka || row.candidate_name_ka))
      || row.name_en
      || row.name_ka
      || row.candidate_name_ka
      || row.candidate_name
      || row.party_label
      || party?.name?.[lang]
      || party?.name?.en
      || row.party_id;
  }

  function turnoutMetricDetails(td, metric) {
    if (!td) return null;
    if (metric === "noon") {
      const pct = td.noon_pct ?? (td.registered > 0 ? td.voted_noon / td.registered : null);
      return {label: t("elections.turnout.metric.noon") || "12:00", count: td.voted_noon, pct};
    }
    if (metric === "5pm") {
      const pct = td.five_pct ?? (td.registered > 0 ? td.voted_5pm / td.registered : null);
      return {label: t("elections.turnout.metric.5pm") || "17:00", count: td.voted_5pm, pct};
    }
    if (metric === "invalid") {
      const pct = td.invalid_pct ?? (td.voted > 0 ? td.invalid_ballots / td.voted : null);
      return {label: t("elections.turnout.metric.invalid") || "Invalid ballots", count: td.invalid_ballots, pct};
    }
    const pct = td.turnout_pct ?? (td.registered > 0 ? td.voted / td.registered : null);
    return {label: t("elections.turnout.metric.final") || _tooltipLabels.turnout, count: td.voted, pct};
  }

  function tooltipFrame(title, rowsHtml) {
    return `<div class="geda-tooltip-frame">
      <div class="geda-tooltip-title">${escapeHtml(title)}</div>
      ${rowsHtml}
    </div>`;
  }

  function tooltipLine(label, value, options = {}) {
    const valueClass = options.wrapValue ? "geda-tooltip-value geda-tooltip-value-wrap" : "geda-tooltip-value";
    return `<div class="geda-tooltip-line">
      <span class="geda-tooltip-label">${escapeHtml(label)}</span>
      <span class="${valueClass}">${escapeHtml(value)}</span>
    </div>`;
  }

  function tooltipSubject(value, color) {
    return `<div class="geda-tooltip-subject" style="color:${escapeHtml(color || "#111111")};">${escapeHtml(value)}</div>`;
  }

  function buildTurnoutTooltip(title, td) {
    const metric = turnoutMetricDetails(td, _turnoutMetricCtrl.value);
    if (!metric) return tooltipFrame(title, `<div style="font-size:0.74rem;color:#666;">${_tooltipLabels.noData}</div>`);
    return tooltipFrame(title, [
      tooltipLine(metric.label, formatPct(metric.pct)),
      tooltipLine(_tooltipLabels.count, formatCount(metric.count)),
      tooltipLine(_tooltipLabels.registered, formatCount(td.registered))
    ].join(""));
  }

  function selectTooltipResultRow(rows) {
    const activeId = activePartyId();
    if (activeId != null) return rows.find(r => String(r.party_id) === String(activeId)) ?? null;
    return rows.reduce((best, row) => !best || (Number(row.vote_share) || 0) > (Number(best.vote_share) || 0) ? row : best, null);
  }

  function buildResultTooltipFromRows(title, rows) {
    const activeId = activePartyId();
    const row = selectTooltipResultRow(rows);
    if (!row && activeId == null) return tooltipFrame(title, `<div style="font-size:0.74rem;color:#666;">${_tooltipLabels.noData}</div>`);

    const fallbackParty = activeId != null ? getParty?.(activeId) : null;
    const subject = rowName(row) || fallbackParty?.name?.[lang] || fallbackParty?.name?.en || activeId || _tooltipLabels.noData;
    const subjectColor = partyColor(row?.party_id ?? activeId, electionVal?.id);
    return tooltipFrame(title, [
      tooltipSubject(subject, subjectColor),
      tooltipLine(_tooltipLabels.votes, formatCount(row?.votes ?? 0)),
      tooltipLine(_tooltipLabels.share, formatPct(row?.vote_share ?? 0))
    ].join(""));
  }

  function buildAreaResultTooltip(title, rows, id) {
    return buildResultTooltipFromRows(
      title,
      rows.filter(r => String(r.district_id) === String(id))
    );
  }

  function withHoverOutline(layer) {
    layer.on("mouseover", () => {
      layer._gedaHoverStyle = {
        color: layer.options?.color,
        weight: layer.options?.weight,
        opacity: layer.options?.opacity
      };
      if (layer.setStyle) layer.setStyle({color: "#111111", weight: 1.2, opacity: 1});
      if (layer.bringToFront) layer.bringToFront();
    });
    layer.on("mouseout", () => {
      const style = layer._gedaHoverStyle;
      if (style && layer.setStyle) layer.setStyle(style);
      layer._gedaHoverStyle = null;
    });
  }

  function bindDynamicTooltip(layer, contentFn) {
    withHoverOutline(layer);
    layer.bindTooltip(() => contentFn(), {
      className: "geda-map-tooltip",
      direction: "top",
      offset: [0, -6],
      opacity: 0.96,
      sticky: false
    });
    layer.on("mousedown", closeMapTooltip);
  }

  const DISTRICT_HOLLOW  = {fillColor: "transparent", fillOpacity: 0, color: "#999", weight: 0.5};
  const SAKREBULO_HOLLOW = {fillColor: "transparent", fillOpacity: 0, color: "#bbb", weight: 0.8};

  if (mapMode === "cartogram" && activeGeo.features[0]?.geometry?.type === "Point") {
    // Cartogram — proportional circles, no precinct overlay
    activeGeo.features.forEach(f => {
      const did  = String(f.properties.id);
      const winner = winnerByDistrict.get(did);
      let fillColor;
      if (viewMode === "turnout") {
        const td = turnoutByDistrict.get(did);
        fillColor = d3.interpolateRgb("#fee2e2", "#b91c1c")(Math.min(1, turnoutValue(td, _turnoutMetricCtrl.value)));
      } else {
        const color = winner ? partyColor(winner.party_id, electionVal?.id) : "#ccc";
        fillColor = d3.interpolateRgb("#f5f5f5", color)(0.4 + (shareByDistrict.get(did) ?? 0.5) * 0.6);
      }
      const circle = L.circle(
        [f.geometry.coordinates[1], f.geometry.coordinates[0]],
        { radius: (f.properties.radius_km ?? 10) * 1000, fillColor, fillOpacity: 0.85, color: "#fff", weight: 0.5 }
      ).addTo(map);
      circle.on("click", () => {
        const panel = document.getElementById("results-panel");
        if (panel) panel.replaceWith(viewMode === "turnout"
          ? renderTurnoutPanel(did, f.properties)
          : renderDistrictPanel(did, f.properties));

        if (isCouncilMode) updateCouncilSeatsForDistrict(did, f.properties);
      });
      bindDynamicTooltip(circle, () => {
        const title = (lang === "ka" ? f.properties.name_ka : f.properties.name_en) ?? did;
        return viewMode === "turnout"
          ? buildTurnoutTooltip(title, turnoutByDistrict.get(did))
          : buildAreaResultTooltip(title, _districtRows, did);
      });
    });

  } else {
    // Choropleth polygons — district layer always present
    const districtLayer = L.geoJSON(activeGeo, {
      style: districtStyle,
      onEachFeature(feature, layer) {
        const did = geoId(feature);
        layer.on("click", () => {
          const panel = document.getElementById("results-panel");
          if (panel) panel.replaceWith(viewMode === "turnout"
            ? renderTurnoutPanel(did, feature.properties)
            : renderDistrictPanel(did, feature.properties));
          if (isCouncilMode) updateCouncilSeatsForDistrict(did, feature.properties);
        });
        bindDynamicTooltip(layer, () => {
          const title = getFeatureName(feature, lang)
            ?? (lang === "ka" ? feature.properties.name_ka : feature.properties.name_en)
            ?? did;
          return viewMode === "turnout"
            ? buildTurnoutTooltip(title, turnoutByDistrict.get(did))
            : buildAreaResultTooltip(title, _districtRows, did);
        });
      }
    }).addTo(map);

    // ── Helper: build winner/share/turnout lookups from a results array ──
    // When turnoutArr is empty, extracts inline turnout from resultsArr if available.
    function buildLookups(resultsArr, turnoutArr) {
      const winnerMap  = new Map();
      const shareMap   = new Map();
      const turnoutMap = new Map();
      d3.group(resultsArr, r => String(r.district_id)).forEach((rows, did) => {
        const winner = rows.reduce((a, b) => (b.vote_share > a.vote_share ? b : a));
        winnerMap.set(did, winner);
        shareMap.set(did, d3.max(rows, r => r.vote_share));
        // If no separate turnout array, extract inline turnout from the first result row
        if (turnoutArr.length === 0 && rows[0]?.registered != null) {
          const td = {...rows[0]};
          if (td.turnout_pct == null && td.registered > 0) td.turnout_pct = td.voted / td.registered;
          if (td.invalid_pct == null && td.voted > 0 && td.invalid_ballots != null) td.invalid_pct = td.invalid_ballots / td.voted;
          if (td.noon_pct    == null && td.registered > 0 && td.voted_noon != null) td.noon_pct    = td.voted_noon / td.registered;
          if (td.five_pct    == null && td.registered > 0 && td.voted_5pm  != null) td.five_pct    = td.voted_5pm  / td.registered;
          turnoutMap.set(did, td);
        }
      });
      d3.group(turnoutArr, r => String(r.district_id)).forEach((rows, did) => {
        turnoutMap.set(did, rows[0]);
      });
      return {winnerMap, shareMap, turnoutMap};
    }

    function makeLayerStyle(winnerMap, shareMap, turnoutMap, weight = 0.5) {
      return function(feature) {
        const did = geoId(feature);
        if (viewMode === "turnout") {
          const td = turnoutMap.get(did);
          if (!td) return {fillColor: "#e0e0e0", fillOpacity: 0.6, color: "#ccc", weight};
          return {fillColor: d3.interpolateRgb("#fee2e2", "#b91c1c")(turnoutNorm(td, _turnoutMetricCtrl.value, _invalidMax)), fillOpacity: 0.9, color: "#ffffff", weight};
        }
        const winner = winnerMap.get(did);
        if (!winner) return {fillColor: "#e0e0e0", fillOpacity: 0.6, color: "#ccc", weight};
        const baseColor = partyColor(winner.party_id, electionVal?.id);
        const intensity = shareMap.get(did) ?? 0.5;
        const lightened = d3.color(baseColor) ? d3.interpolateRgb("#f5f5f5", baseColor)(0.4 + intensity * 0.6) : "#ccc";
        return {fillColor: lightened, fillOpacity: 0.9, color: "#ffffff", weight};
      };
    }

    // ── Council-district layer (zoom-activated, council mode only) ────────
    let councilDistrictLayer = null;
    let _councilDistrictStyleFn = null;

    if (councilDistrictGeoData) {
      const {winnerMap, shareMap, turnoutMap} = buildLookups(councilDistrictResults, []);
      const cdStyle = makeLayerStyle(winnerMap, shareMap, turnoutMap, 0.8);
      _councilDistrictStyleFn = cdStyle;

      councilDistrictLayer = L.geoJSON(councilDistrictGeoData, {
        style: cdStyle,
        onEachFeature(feature, layer) {
          const did = geoId(feature);
          // Augment props with derived names (majoritarian GeoJSON has district_name_en + major, not name_en/name_ka)
          const _props = {...feature.properties,
            name_en: getFeatureName(feature, "en"),
            name_ka: getFeatureName(feature, "ka") ?? getFeatureName(feature, "en")
          };
          layer.on("click", () => {
            const panel = document.getElementById("results-panel");
            if (panel) panel.replaceWith(viewMode === "turnout"
              ? renderTurnoutPanel(did, _props, turnoutMap)
              : renderDistrictPanel(did, _props, councilDistrictResults));
            if (isCouncilMode) {
              // Always show parent selfgov unit composition, not just this one majoritarian district
              const _sgId = councilSelfgovIdFromMajorId(did);
              const _sgFeat = selfgovGeoData?.features?.find(f => String(f.properties.id) === _sgId);
              updateCouncilSeats(_sgId, _sgFeat?.properties ?? _props, true);
            }
          });
          bindDynamicTooltip(layer, () => {
            const title = getFeatureName(feature, lang) ?? did;
            return viewMode === "turnout"
              ? buildTurnoutTooltip(title, turnoutMap.get(did))
              : buildAreaResultTooltip(title, councilDistrictResults, did);
          });
        }
      });
    }

    // ── Self-governing unit layer (local elections with selfgov level) ───────
    let selfgovLayer = null;
    let _selfgovStyleFn = null;
    if (selfgovGeoData) {
      const {winnerMap, shareMap, turnoutMap} = buildLookups(selfgovResults, []);
      const sgStyle = makeLayerStyle(winnerMap, shareMap, turnoutMap, 0.8);
      _selfgovStyleFn = sgStyle;
      selfgovLayer = L.geoJSON(selfgovGeoData, {
        style: sgStyle,
        onEachFeature(feature, layer) {
          const did = geoId(feature);
          layer.on("click", () => {
            const panel = document.getElementById("results-panel");
            if (panel) panel.replaceWith(viewMode === "turnout"
              ? renderTurnoutPanel(did, feature.properties, turnoutMap)
              : renderDistrictPanel(did, feature.properties, selfgovResults));
            if (isCouncilMode) updateCouncilSeats(did, feature.properties, true);
          });
          bindDynamicTooltip(layer, () => {
            const title = (lang === "ka" ? feature.properties.name_ka : feature.properties.name_en) ?? did;
            return viewMode === "turnout"
              ? buildTurnoutTooltip(title, turnoutMap.get(did))
              : buildAreaResultTooltip(title, selfgovResults, did);
          });
        }
      });
    }

    // ── Precinct state (populated lazily on first "Precinct" level click) ───
    let _precinctTurnoutByStation = new Map();
    let _precinctToMajorId        = new Map();
    let winnerByPrecinct          = new Map();
    let shareByPrecinct           = new Map();
    let _shareByPartyByPrecinct   = new Map();
    let precinctLayer             = null;
    let _precinctDataLoaded       = false;
    let _precinctUsesExactKeys    = false;

    function updateCouncilSeatsForPrecinct(parentDid, stationId, props) {
      if (!isCouncilMode) return;
      const sgId = effectiveVoteType === "smd"
        ? councilSelfgovIdFromMajorId(_precinctToMajorId.get(stationId) ?? parentDid)
        : councilSelfgovIdFromDistrictId(parentDid);
      const sgFeat = selfgovGeoData?.features?.find(f => String(f.properties.id) === sgId);
      updateCouncilSeats(sgId, sgFeat?.properties ?? props, true);
    }

    function precinctStationId(feature) {
      const raw = feature?.properties?.id ?? feature?.properties?.precinct_id;
      return raw == null ? null : String(Math.round(Number(raw)));
    }

    function precinctKeyPart(value) {
      if (value == null || value === "") return null;
      const n = Number(value);
      return Number.isFinite(n) ? String(Math.round(n)) : String(value);
    }

    function precinctExactKey(feature) {
      const p = feature?.properties ?? {};
      if (p.precinct_key != null && String(p.precinct_key).trim() !== "") return String(p.precinct_key).trim();
      const smd = precinctKeyPart(p.MID ?? p.M_District ?? p.smd ?? p.major_id ?? p.maj_id);
      const dd  = precinctKeyPart(p.District ?? p.district ?? p.district_id);
      const pp  = precinctKeyPart(p.Precinct ?? p.precinct ?? p.precinct_number);
      if (smd && dd && pp) return `${smd}.${dd}.${pp}`;
      return precinctStationId(feature);
    }

    function precinctResultKey(row) {
      const key = row?.precinct_key;
      if (key != null && String(key).trim() !== "") return String(key).trim();
      return String(Math.round(row.precinct_id));
    }

    function precinctFeatureResultKey(feature) {
      return _precinctUsesExactKeys ? precinctExactKey(feature) : precinctStationId(feature);
    }

    function precinctStationNumber(feature) {
      const p = feature?.properties ?? {};
      const raw = p.precinct ?? p.Precinct ?? p.precinct_number ?? p.id;
      return raw == null ? null : Math.round(Number(raw)) % 1000;
    }

    function precinctRawDistrict(feature) {
      const p = feature?.properties ?? {};
      return p.district ?? p.district_id ?? p.District;
    }

    function precinctMajorDistrict(feature) {
      const p = feature?.properties ?? {};
      return precinctKeyPart(p.MID ?? p.M_District ?? p.smd ?? p.major_id ?? p.maj_id);
    }

    function precinctParentId(feature, stationId) {
      const p = feature?.properties ?? {};
      if (isCouncilMode && effectiveVoteType === "smd") {
        return precinctMajorDistrict(feature) ?? _precinctToMajorId.get(stationId) ?? String(precinctRawDistrict(feature));
      }
      if (effectiveVoteType === "smd" && !isCouncilMode) {
        if (electionVal?.type !== "local") {
          const mid = precinctMajorDistrict(feature);
          if (mid != null) return mid;
        }
        const mayor = p.Mayor ?? p.selfgov_id;
        if (mayor != null) {
          const m = Number(mayor);
          return String(m === 99 ? 1 : m);
        }
        const d = Number(precinctRawDistrict(feature));
        return d >= 1 && d <= 10 ? "1" : String(d);
      }
      return String(precinctRawDistrict(feature));
    }

    function precinctDisplayProps(feature, stationId, parentDid) {
      const stationNum = precinctStationNumber(feature);
      const p = feature?.properties ?? {};
      const rawDist = String(precinctRawDistrict(feature));
      const nameGeo = (isCouncilMode && effectiveVoteType === "smd" && councilDistrictGeoData)
        ? councilDistrictGeoData
        : activeGeo;
      const distFeat = nameGeo?.features?.find(f => {
        const id = geoId(f);
        return id === parentDid || id === rawDist;
      });
      const distNameEn = (distFeat ? getDistrictBaseName(distFeat, "en") : null) ?? parentDid ?? rawDist;
      const distNameKa = (distFeat ? getDistrictBaseName(distFeat, "ka") : null) ?? distNameEn;
      const suffix = stationNum == null ? stationId : stationNum;
      return {
        ...p,
        name_en: `${distNameEn} N${suffix}`,
        name_ka: `${distNameKa} N${suffix}`,
        precinct_name_ka: p.name_ka || p.precinct_name || null,
        address_ka: p.address || null
      };
    }

    function enrichPrecinctRows(rows) {
      return rows.map(r => {
        if (!r.name_ka && !r.candidate_name) {
          if (isCouncilMode && effectiveVoteType === "smd") {
            const match = _allCouncilSMDResults.find(
              d => String(d.district_id) === String(r.district_id) && d.party_id === r.party_id
            );
            if (match?.name_ka) return {...r, name_ka: match.name_ka};
          } else if (ballotTypeVal === "mayor") {
            const match = selfgovResults.find(
              d => String(d.district_id) === String(r.selfgov_id) && d.party_id === r.party_id
            );
            if (match?.name_ka) return {...r, name_ka: match.name_ka};
          }
        }
        return r;
      });
    }

    async function _ensurePrecinctLayer() {
      if (_precinctDataLoaded) return;
      _precinctDataLoaded = true;

      let precinctGeoData  = null;
      let precinctResults  = [];

      if (precinctGeoPath && _precinctGeoRegistryUrl) {
        try {
          precinctGeoData = await loadPrecinctGeo(precinctGeoPath, _precinctGeoRegistryUrl);
        } catch(e) { console.warn("Precinct GeoJSON load failed", e); }
      }

      if (precinctCsvPath && _precinctCsvRegistryUrl) {
        try {
          precinctResults = await loadPrecinctCsv(precinctCsvPath, _precinctCsvRegistryUrl);
        } catch(e) { console.warn("Precinct CSV load failed", e); }
      }

      _precinctUsesExactKeys = precinctResults.some(r => r.precinct_key != null && String(r.precinct_key).trim() !== "");
      const precinctResultKeys = new Set(precinctResults.map(precinctResultKey));

      // Per-station inline turnout (precincts have registered/ballots columns)
      if (precinctResults.length > 0 && precinctResults[0]?.registered != null) {
        const _seenPids = new Set();
        for (const r of precinctResults) {
          const pid = precinctResultKey(r);
          if (!_seenPids.has(pid)) { _seenPids.add(pid); _precinctTurnoutByStation.set(pid, r); }
        }
      }

      // Council SMD: precinct_id → major_id lookup for correct coloring
      if (isCouncilMode && effectiveVoteType === "smd") {
        for (const r of precinctResults) {
          const pid = String(Math.round(r.precinct_id));
          if (!_precinctToMajorId.has(pid)) _precinctToMajorId.set(pid, String(r.district_id));
        }
      }

      // Per-precinct winner/share lookups (point precinct coloring)
      d3.group(precinctResults, precinctResultKey).forEach((rows, pid) => {
        const winner = rows.reduce((a, b) => (b.vote_share > a.vote_share ? b : a));
        winnerByPrecinct.set(pid, winner);
        shareByPrecinct.set(pid, d3.max(rows, r => r.vote_share));
      });

      // Party-filter share lookup
      for (const r of precinctResults) {
        const pid = precinctResultKey(r);
        if (!_shareByPartyByPrecinct.has(pid)) _shareByPartyByPrecinct.set(pid, new Map());
        const shares = _shareByPartyByPrecinct.get(pid);
        shares.set(r.party_id, (shares.get(r.party_id) ?? 0) + (Number(r.vote_share) || 0));
      }

      if (!precinctGeoData) return;
      if (_precinctUsesExactKeys) {
        precinctGeoData = {
          ...precinctGeoData,
          features: precinctGeoData.features?.filter(f => precinctResultKeys.has(precinctExactKey(f))) ?? []
        };
      }
      const isPoints = precinctGeoData.features?.[0]?.geometry?.type === "Point";

      if (isPoints) {
        precinctLayer = L.geoJSON(precinctGeoData, {
          pointToLayer(feature, latlng) {
            const _rawDist  = precinctRawDistrict(feature);
            const _d        = Number(_rawDist);
            const stationId = String(Math.round(feature.properties.id));
            const resultKey = precinctFeatureResultKey(feature) ?? stationId;
            const parentDid = precinctParentId(feature, stationId);
            let fillColor;
            if (viewMode === "turnout") {
              const td = _precinctTurnoutByStation.get(resultKey) ?? _precinctTurnoutByStation.get(stationId) ?? turnoutByDistrict.get(parentDid);
              fillColor = d3.interpolateRgb("#fee2e2", "#b91c1c")(turnoutNorm(td, _turnoutMetricCtrl.value, _invalidMax));
            } else {
              const winner = winnerByPrecinct.get(resultKey) ?? winnerByPrecinct.get(stationId) ?? winnerByDistrict.get(parentDid);
              if (winner) {
                const color     = partyColor(winner.party_id, electionVal?.id);
                const intensity = shareByPrecinct.get(resultKey) ?? shareByPrecinct.get(stationId) ?? shareByDistrict.get(parentDid) ?? 0.5;
                fillColor = d3.interpolateRgb("#f5f5f5", color)(0.4 + intensity * 0.6);
              } else {
                fillColor = "#cccccc";
              }
            }
            return L.circleMarker(latlng, {
              radius: 4, fillColor, fillOpacity: 0.85, color: "none", weight: 0
            });
          },
          onEachFeature(feature, layer) {
            const _rawStId   = feature.properties.id;
            const stationId  = String(Math.round(_rawStId));
            const resultKey  = precinctFeatureResultKey(feature) ?? stationId;
            const stationNum = precinctStationNumber(feature);
            const _rawDist   = precinctRawDistrict(feature);
            const _d         = Number(_rawDist);
            const parentDid  = precinctParentId(feature, stationId);
            const _nameGeo   = (isCouncilMode && effectiveVoteType === "smd" && councilDistrictGeoData)
              ? councilDistrictGeoData
              : activeGeo;
            const distFeat   = _nameGeo?.features?.find(f =>
              geoId(f) === parentDid
            );
            const distNameEn = (distFeat ? getDistrictBaseName(distFeat, "en") : null) ?? parentDid;
            const distNameKa = (distFeat ? getDistrictBaseName(distFeat, "ka") : null) ?? distNameEn ?? parentDid;
            const _geoNameKa = feature.properties.name_ka || feature.properties.precinct_name || null;
            const _geoAddrKa = feature.properties.address || null;
            const titleKa    = `${distNameKa} N${stationNum}`;
            const titleEn    = `${distNameEn} N${stationNum}`;

            layer.on("click", () => {
              const panel = document.getElementById("results-panel");
              if (!panel) return;
              const enhancedProps = {
                ...feature.properties,
                name_en:          titleEn,
                name_ka:          titleKa,
                precinct_name_ka: _geoNameKa,
                address_ka:       _geoAddrKa
              };
              if (viewMode === "turnout") {
                panel.replaceWith(renderTurnoutPanel(resultKey, enhancedProps, _precinctTurnoutByStation));
              } else {
                const stationRows = precinctResults
                  .filter(r => precinctResultKey(r) === resultKey)
                  .map(r => {
                    if (!r.name_ka && !r.candidate_name) {
                      if (isCouncilMode && effectiveVoteType === "smd") {
                        const match = _allCouncilSMDResults.find(
                          d => String(d.district_id) === String(r.district_id) && d.party_id === r.party_id
                        );
                        if (match?.name_ka) return {...r, name_ka: match.name_ka};
                      } else if (ballotTypeVal === "mayor") {
                        const match = selfgovResults.find(
                          d => String(d.district_id) === String(r.selfgov_id) && d.party_id === r.party_id
                        );
                        if (match?.name_ka) return {...r, name_ka: match.name_ka};
                      }
                    }
                    return r;
                  });
                panel.replaceWith(renderDistrictPanel("__precinct__", enhancedProps, stationRows));
              }
              updateCouncilSeatsForPrecinct(parentDid, stationId, enhancedProps);
            });
            bindDynamicTooltip(layer, () => {
              const title = lang === "ka" ? titleKa : titleEn;
              if (viewMode === "turnout") {
                const td = _precinctTurnoutByStation.get(resultKey)
                  ?? _precinctTurnoutByStation.get(stationId)
                  ?? turnoutByDistrict.get(parentDid);
                return buildTurnoutTooltip(title, td);
              }
              const stationRows = enrichPrecinctRows(
                precinctResults.filter(r => precinctResultKey(r) === resultKey)
              );
              const fallbackRows = [
                winnerByPrecinct.get(resultKey)
                  ?? winnerByPrecinct.get(stationId)
                  ?? winnerByDistrict.get(parentDid)
              ].filter(Boolean);
              return buildResultTooltipFromRows(title, stationRows.length ? stationRows : fallbackRows);
            });
          }
        });
      } else {
        // Polygon precincts — choropleth
        precinctLayer = L.geoJSON(precinctGeoData, {
          style(feature) {
            const stationId = precinctStationId(feature);
            const resultKey = precinctFeatureResultKey(feature) ?? stationId;
            const parentDid = precinctParentId(feature, stationId);
            if (viewMode === "turnout") {
              const td = _precinctTurnoutByStation.get(resultKey) ?? _precinctTurnoutByStation.get(stationId) ?? turnoutByDistrict.get(parentDid);
              if (!td) return {fillColor: "#e0e0e0", fillOpacity: 0.6, color: "#ccc", weight: 0.5};
              return {
                fillColor: d3.interpolateRgb("#fee2e2", "#b91c1c")(turnoutNorm(td, _turnoutMetricCtrl.value, _invalidMax)),
                fillOpacity: 0.9,
                color: "#ffffff",
                weight: 0.5
              };
            }
            const winner = winnerByPrecinct.get(resultKey) ?? winnerByPrecinct.get(stationId) ?? winnerByDistrict.get(parentDid);
            if (!winner) return {fillColor: "#e0e0e0", fillOpacity: 0.6, color: "#ccc", weight: 0.5};
            const baseColor = partyColor(winner.party_id, electionVal?.id);
            const intensity = shareByPrecinct.get(resultKey) ?? shareByPrecinct.get(stationId) ?? shareByDistrict.get(parentDid) ?? 0.5;
            const lightened = d3.color(baseColor) ? d3.interpolateRgb("#f5f5f5", baseColor)(0.4 + intensity * 0.6) : "#ccc";
            return {fillColor: lightened, fillOpacity: 0.9, color: "#ffffff", weight: 0.5};
          },
          onEachFeature(feature, layer) {
            const stationId = precinctStationId(feature);
            const resultKey = precinctFeatureResultKey(feature) ?? stationId;
            const parentDid = precinctParentId(feature, stationId);
            const enhancedProps = precinctDisplayProps(feature, stationId, parentDid);
            layer.on("click", () => {
              const panel = document.getElementById("results-panel");
              if (!panel) return;
              if (viewMode === "turnout") {
                panel.replaceWith(renderTurnoutPanel(resultKey, enhancedProps, _precinctTurnoutByStation));
              } else {
                const stationRows = enrichPrecinctRows(
                  precinctResults.filter(r => precinctResultKey(r) === resultKey)
                );
                panel.replaceWith(renderDistrictPanel("__precinct__", enhancedProps, stationRows));
              }
              updateCouncilSeatsForPrecinct(parentDid, stationId, enhancedProps);
            });
            bindDynamicTooltip(layer, () => {
              const title = lang === "ka" ? enhancedProps.name_ka : enhancedProps.name_en;
              if (viewMode === "turnout") {
                const td = _precinctTurnoutByStation.get(resultKey)
                  ?? _precinctTurnoutByStation.get(stationId)
                  ?? turnoutByDistrict.get(parentDid);
                return buildTurnoutTooltip(title, td);
              }
              const stationRows = enrichPrecinctRows(
                precinctResults.filter(r => precinctResultKey(r) === resultKey)
              );
              const fallbackRows = [
                winnerByPrecinct.get(resultKey)
                  ?? winnerByPrecinct.get(stationId)
                  ?? winnerByDistrict.get(parentDid)
              ].filter(Boolean);
              return buildResultTooltipFromRows(title, stationRows.length ? stationRows : fallbackRows);
            });
          }
        });
      }
    }

    // ── Manual level switcher control ─────────────────────────────────────
    const _councilSMD = isCouncilMode && effectiveVoteType === "smd";
    const availableLevels = _councilSMD
      ? [
          // In turnout mode, selfgov and district levels are also available (same ballots as mayor)
          ...(viewMode === "turnout" && selfgovLayer ? [{ id: "selfgov",  label: t("elections.map_level.selfgov") }] : []),
          ...(viewMode === "turnout"                 ? [{ id: "district", label: t("elections.map_level.district") }] : []),
          ...(councilDistrictLayer ? [{ id: "council_district", label: t("elections.map_level.council_district") }] : []),
          ...((precinctGeoPath || precinctCsvPath) ? [{ id: "precinct", label: t("elections.map_level.precinct") }] : []),
        ]
      : [
          ...(selfgovLayer  ? [{ id: "selfgov",  label: t("elections.map_level.selfgov") }] : []),
          { id: "district", label: t("elections.map_level.district") },
          ...((precinctGeoPath || precinctCsvPath) ? [{ id: "precinct", label: t("elections.map_level.precinct") }] : []),
        ];
    const multiLevel = availableLevels.length > 1;
    // In council SMD turnout mode, default to selfgov (broadest level with turnout data)
    const defaultLevel = _councilSMD
      ? (viewMode === "turnout" && selfgovLayer ? "selfgov" : (councilDistrictLayer ? "council_district" : "district"))
      : (selfgovLayer ? "selfgov" : "district");
    let currentLevel = availableLevels.some(lvl => lvl.id === _levelCtrl?.value) ? _levelCtrl.value : defaultLevel;

    function refreshPartyFilter() {
      if (_mapCtrl.current?.currentPartyId) {
        _mapCtrl.current.setPartyFilter(_mapCtrl.current.currentPartyId, true);
      }
    }

    function setLayerInteractivity(layerGroup, enabled) {
      if (!layerGroup) return;
      layerGroup.eachLayer(layer => {
        layer.options.interactive = enabled;
        const el = layer.getElement?.();
        if (el) el.style.pointerEvents = enabled ? "" : "none";
      });
    }

    function applyLevel(levelId, controlDiv) {
      currentLevel = levelId;
      if (_levelCtrl) _levelCtrl.value = currentLevel;
      if (_mapCtrl.current) _mapCtrl.current.currentLevel = currentLevel;
      if (levelId === "selfgov" && selfgovLayer) {
        if (!map.hasLayer(selfgovLayer)) selfgovLayer.addTo(map);
        districtLayer.setStyle(DISTRICT_HOLLOW);
        setLayerInteractivity(districtLayer, false);
        setLayerInteractivity(selfgovLayer, true);
        if (councilDistrictLayer && map.hasLayer(councilDistrictLayer)) map.removeLayer(councilDistrictLayer);
        if (precinctLayer        && map.hasLayer(precinctLayer))        map.removeLayer(precinctLayer);
      } else if (levelId === "district") {
        districtLayer.setStyle(districtStyle);
        setLayerInteractivity(districtLayer, true);
        if (selfgovLayer         && map.hasLayer(selfgovLayer))         map.removeLayer(selfgovLayer);
        if (councilDistrictLayer && map.hasLayer(councilDistrictLayer)) map.removeLayer(councilDistrictLayer);
        if (precinctLayer        && map.hasLayer(precinctLayer))        map.removeLayer(precinctLayer);
      } else if (levelId === "council_district" && councilDistrictLayer) {
        districtLayer.setStyle(DISTRICT_HOLLOW);
        setLayerInteractivity(districtLayer, false);
        if (selfgovLayer && map.hasLayer(selfgovLayer)) map.removeLayer(selfgovLayer);
        if (!map.hasLayer(councilDistrictLayer)) councilDistrictLayer.addTo(map);
        setLayerInteractivity(councilDistrictLayer, true);
        if (precinctLayer && map.hasLayer(precinctLayer)) map.removeLayer(precinctLayer);
      } else if (levelId === "precinct" && (precinctGeoPath || precinctCsvPath)) {
        _ensurePrecinctLayer().then(() => {
          if (!precinctLayer) return;
          districtLayer.setStyle(DISTRICT_HOLLOW);
          setLayerInteractivity(districtLayer, false);
          if (selfgovLayer         && map.hasLayer(selfgovLayer))         map.removeLayer(selfgovLayer);
          if (councilDistrictLayer && map.hasLayer(councilDistrictLayer)) map.removeLayer(councilDistrictLayer);
          if (!map.hasLayer(precinctLayer)) precinctLayer.addTo(map);
          setLayerInteractivity(precinctLayer, true);
          precinctLayer.bringToFront?.();
          if (_mapCtrl.current?.currentPartyId) refreshPartyFilter();
          else if (_mapCtrl.current) _mapCtrl.current.updatePrecinctDots(null);
        });
      }
      if (controlDiv) {
        controlDiv.querySelectorAll(".level-control-item").forEach(el => {
          el.classList.toggle("lc-active", el.dataset.level === currentLevel);
        });
      }
      if (levelId !== "precinct") refreshPartyFilter();
    }

    const LevelControl = L.Control.extend({
      onAdd() {
        const div = L.DomUtil.create("div", "leaflet-level-control");
        L.DomEvent.disableClickPropagation(div);
        const title = L.DomUtil.create("div", "level-control-title", div);
        title.textContent = t("elections.map_level");

        availableLevels.forEach(lvl => {
          const item = L.DomUtil.create("div", "level-control-item", div);
          item.dataset.level = lvl.id;
          item.textContent = lvl.label;
          if (lvl.id === currentLevel) item.classList.add("lc-active");
          if (multiLevel) {
            item.classList.add("lc-clickable");
            L.DomEvent.on(item, "click", () => applyLevel(lvl.id, div));
          }
        });
        return div;
      }
    });
    new LevelControl({ position: "topright" }).addTo(map);
    applyLevel(currentLevel, null);

    // ── Party filter: lookups for district, selfgov, and precinct vote shares ─
    function addShare(shareMap, areaId, partyId, voteShare) {
      const key = String(areaId);
      if (!shareMap.has(key)) shareMap.set(key, new Map());
      const shares = shareMap.get(key);
      shares.set(partyId, (shares.get(partyId) ?? 0) + (Number(voteShare) || 0));
    }

    const _shareByPartyByDistrict = new Map();
    for (const r of _districtRows) {
      addShare(_shareByPartyByDistrict, r.district_id, r.party_id, r.vote_share);
    }

    const _shareByPartyBySelfgov = new Map();
    for (const r of selfgovResults) {
      if (String(r.district_id) === "national") continue;
      addShare(_shareByPartyBySelfgov, r.district_id, r.party_id, r.vote_share);
    }

    const _shareByPartyByCouncilDistrict = new Map();
    for (const r of councilDistrictResults) {
      if (String(r.district_id) === "national") continue;
      addShare(_shareByPartyByCouncilDistrict, r.district_id, r.party_id, r.vote_share);
    }

    // ── Map legend control (bottom-left) ────────────────────────────────────
    function buildLegendHTML(activePartyId, legendMinVal, legendMaxVal) {
      if (viewMode === "turnout" || activePartyId) {
        const fromColor  = activePartyId ? "#f5f5f5" : "#fee2e2";
        const toColor    = activePartyId ? partyColor(activePartyId, electionVal?.id) : "#b91c1c";
        const stops      = [0, 0.25, 0.5, 0.75, 1.0];
        const stopColors = stops.map(s => d3.interpolateRgb(fromColor, toColor)(s));
        const gradCss    = `linear-gradient(to right, ${stopColors.join(", ")})`;

        let minLabel, maxLabel;
        if (activePartyId) {
          // Show actual min/max vote-share values for this party across districts
          const minPct = legendMinVal != null ? `${(legendMinVal * 100).toFixed(1)}%` : "0%";
          const maxPct = legendMaxVal != null ? `${(legendMaxVal * 100).toFixed(1)}%` : "—";
          minLabel = minPct;
          maxLabel = maxPct;
        } else {
          // Turnout metric: show 0 and realistic ceiling
          minLabel = "0%";
          maxLabel = _turnoutMetricCtrl.value === "invalid" ? `${(_invalidMax * 100).toFixed(0)}%`
                   : _turnoutMetricCtrl.value === "noon"    ? "30%"
                   : _turnoutMetricCtrl.value === "5pm"     ? "60%"
                   : "100%";
        }
        const labels = ["", "", "", "", ""];
        labels[0] = minLabel;
        labels[4] = maxLabel;

        const metricLabel = !activePartyId && viewMode === "turnout"
          ? `<div style="font-size:0.62rem;color:#555;font-weight:600;margin-bottom:3px;">${t("elections.turnout.metric." + _turnoutMetricCtrl.value) || _turnoutMetricCtrl.value}</div>`
          : "";
        return `<div style="min-width:140px;">${metricLabel}
          <div style="display:flex;justify-content:space-between;font-size:0.65rem;color:#555;margin-bottom:2px;">
            ${labels.map(l => `<span>${l}</span>`).join("")}
          </div>
          <div style="height:10px;border-radius:2px;background:${gradCss};"></div>
        </div>`;
      } else {
        const _mapWinnerIds  = new Set([...winnerByDistrict.values()].map(w => w.party_id));
        const _legendParties = passed.filter(p => _mapWinnerIds.has(p.party_id));
        return `<div style="display:flex;flex-direction:column;gap:3px;">
          ${_legendParties.map(p => {
            const name = p.party?.name?.[lang] || p.party_id;
            return `<div style="display:flex;align-items:center;gap:3px;">
              <span style="width:9px;height:9px;border-radius:2px;background:${p.color};display:inline-block;flex-shrink:0;"></span>
              <span style="font-size:0.65rem;color:#333;white-space:nowrap;">${name}</span>
            </div>`;
          }).join("")}
        </div>`;
      }
    }

    const LegendControl = L.Control.extend({
      onAdd() {
        const div = L.DomUtil.create("div", "map-legend");
        L.DomEvent.disableClickPropagation(div);
        div.innerHTML = buildLegendHTML(null);
        return div;
      }
    });
    const _legendCtrl = new LegendControl({ position: "bottomleft" }).addTo(map);

    // ── Zoom-to-country button (below +/−) ───────────────────────────────────
    function boundsForFeatures(geo, predicate) {
      const features = geo?.features?.filter(predicate) ?? [];
      if (features.length === 0) return null;
      const bounds = L.geoJSON({type: "FeatureCollection", features}).getBounds();
      return bounds.isValid() ? bounds : null;
    }

    function zoomToTbilisi() {
      const selfgovBounds = boundsForFeatures(selfgovGeoData, f => String(f.properties?.id) === "1");
      const districtBounds = boundsForFeatures(activeGeo, f => {
        const id = Number(geoId(f));
        return id >= 1 && id <= 10;
      });
      const councilBounds = boundsForFeatures(councilDistrictGeoData, f =>
        councilSelfgovIdFromMajorId(geoId(f)) === "1"
      );
      const bounds = selfgovBounds ?? districtBounds ?? councilBounds;
      if (bounds) map.fitBounds(bounds.pad(0.08), {maxZoom: 12});
      else map.setView([41.7151, 44.8271], 11);
    }

    const ZoomHomeControl = L.Control.extend({
      onAdd(map) {
        const container = L.DomUtil.create("div", "leaflet-bar leaflet-control");
        const btn = L.DomUtil.create("a", "", container);
        btn.href  = "#";
        const _label = t("elections.map.zoom_georgia");
        btn.title = _label;
        btn.setAttribute("role", "button");
        btn.setAttribute("aria-label", _label);
        btn.style.cssText = "display:flex;align-items:center;justify-content:center;width:26px;height:26px;color:#444;";
        // Georgia country outline (simplemaps.com)
        btn.innerHTML = `<svg viewBox="0 0 1000 510" width="20" height="10" fill="currentColor" stroke="none" xmlns="http://www.w3.org/2000/svg"><path d="M45.5 58.1l0.7-3.2 9.2-24.1 1.8-3 3.3-2.1 9.1-2.5 9.3 0 33.5 12.5 5.4 0.7 4.2-1.1 8.8-4.6 4.9-0.6 3.9 2 1.2 1 6.9 5.2 13.8 4.8 4.4 2.6 18.6 14.9 4.1 1.1 14.1-1.9 4.7 1 4.3 2.2 4.2 3.4 4.7 2.1 9.7-1.9 4.1 1.6 1.3 1.8 1.9 4.4 1.2 1.9 2 1.5 7.1 2.2 3.5 2.2 6.1 6.2 3.6 2 5 0.5 9.9-1.4 4.9 0.6 8.9 2.5 4.2 0.5 9.5-1.1 3.9 0.2 4 1.1 4.2 2.1 4.3 1.3 4.3 0.2 4.4-0.9 10.7-6 0.7-0.4 3.5-1.1 22.9-1.9 1.1 0.1 8.2 1.2 7.7 5.2 3.5 3.6 4 3.1 8.2 4.6 2.6 0.6 2-0.8 3.6-3.4 2.3-1.2 4.3-0.1 6.3-1.9 5.4 0.1 5.2 1.4 3.8 2.5 3.8 3.6 3.9 2.6 11.6 4.3 0 2.5-1 3-0.4 3 1.2 2 6.7 4.7 14.6 13.8 2.6 1.4 2.6 1.5 26 7.3 12.7 3.6 5.1 1.3 9.3 4.6 2.3 2 5.6 6.7 2.5 1.6 12.6 3.1 3.6 1.8 2.5 1.3 1.5 5.4-3.1 4.4-4.8 3.4-3.8 3.8-0.4 5.4 3.9 4.8 6.1 1.6 6.6 0.6 5.4 1.4 3.1 2.4 1.8 1.3 2.5 1.3 2.5-0.4 2.1-1.8 3.3-4.7 1.8-2 5.9-2.7 13-0.7 4.8-1.4 1.5-0.5 1.9-1.9 2.6-2.6 2.5-5.2 3.1-3.8 12.1-0.2 5.5-1.8 10.5-5.7 3.9-1.1 6.8-0.5 5.8 0.7 5.1 1.6 0.5 0.2 5 2.9 2.2 1.7 4 4.3 1.6 2.5 3.3 10.7 1.7 1.8 1.2-1.3 2.2-10.1 3.9-8.6 0.9-2.9 3.4-4.7 5.9 1.2 14.8 10.6 2.4 1.2 2.5 0.5 2.6-0.4 1.2-0.6 3.8-1.7 2.6-0.3 4.3 1.7 3.9 3.4 13.4 16.3 1.5 2.5 1.1 2.4 1.4 3.3 1.4 2.1 4.5 1.9 5.8-0.8 10.9-3.3 7.8 0.2 11.4 2 10.6 4.2 5.5 6.6 0 0.2-0.4 4.2-15.6 40.9 1.3 4.3 4.1 2.6 5.5 2.6 14.9 10.4 9.4 2.5 1.9 1.8 3.8 9.6 1.5 2 1.8 1 2.5 0.2 1-0.4 1.8-1.4 1.1-0.3 0.9 0.4 2.3 2 1.1 0.6 2.5-0.1 1.8-0.5 1.3 0.9 1 4 3.2 1.5 4.2 0.1 7.9-1.6 0.1 0 0-0.1 1.2-0.3 1.1-0.1 1.2 0.1 1.3 0.4 3.5 2.9 6 7.1 3.8 1.7 8.1 0.7 3.3 1.9 3.3 4.5-5.2 10.6-2.9 4.8-5.8 7.1-2 1.8-2.2 1-2.8 0.3-6.3-1.4-3 0.3-2.6 2.8-1.3 6.2 0.1 9.2 1.7 8.2 3.7 3 1.2-1 0.6-1.6 0.9-1.4 1.9-0.1 0.3 1 3 5.8 0.2 1.3 1.1 7.1 1.2 3.9 2.3 3 7.1 5 1.6 0.7 2.8 0.7 6.3 5.9 13.2 5.6 6.7 4 2.1 5 2.1-0.8 0.9 0.6 0.2 0.1 0.9 1.6 2.6 2.9 4.3 6.6 0.8 2.6-0.4 0.2-1.1-0.2-1.2 1.5-0.3 1.3-0.1 3.2-0.3 1.2-0.8 1.1-1.8 1.7-0.8 1.1-1.3 4.9-0.7 6.2-1.1 5.7-0.8 1.1-1.9 2.6-2.6 0.5-2.6-0.7-2.7-0.3-2.8 1.8-1.5 2.9-0.8 2.8-1.2 1.9-3 0.1-2.4-1.5-3.8-5.1-2.2-2-8.1-2.6-2.8-1.7-8-7.3-3.9-4.9-2.1-2.1-2.5-0.9-10.2 0.1-3 0.7-3.4 2.2-3.6 2.3-2.7 1-3.2 0.3-6.6-0.8-20.1-7.3-6.8-4.2-2.6-1.6-5.6-4.8-3.3-5.2 3-3.7 3.1-1.2 2-1-0.2-1.1-3.2-1.3-8.8-1.8-19.5-7.6-4.4-4.2-1.9-2.3-2-0.3-4.5 1.3-2.7 0.3-2.2-0.4-6.5-3.4-2.5-1.3-4.4-0.3-4.4 1.6-20.6 17-12.9 10.8-1.7 1-3 2.8-1.7 1.2-5.1 0.1-13.1-2-2.6 2.6 1.1 2.6 5.1 2.4 0.9 1.3 0.5 0.8-1.3 1.9-3.6 0.4-19.9-0.4-5.6-2.2-2.8-0.4-2.9 1.3-1.7 2.4-1.7 2.8-2 1.8-2.8-0.8-0.7-1.4-0.5-1.8-0.7-1.4-1.5 0.1-0.8 0.7-2.8 3-3.3 1-3-0.2-3-1.1-7.2-4.4-1.7-0.2-1.6 0.5-1.1 1-1 1.1-1.2 0.9-3.2 0.5-2.5-0.9-6.6-4.6-3.6-1.5-1.5 0-1.6 1.1-0.3 1.4-0.1 1.5-0.7 1.7-2.2 2.2-2.6 1.4-2.9 0.5-5.7-1.6-2.7 0.3-5.5 2.5-3.1 0.7 0 0.1-3 0.7-12.5 0.3-5.9 2.4-6.3 5.6-2.6 1.1-3.3 0.3-22.1-3.2-5.8 0.3-7.3 3-1.3 0.3-1.4-0.1-1.3-0.3 1.5-4.7-1.9-4.2-3.7-3.5-3.7-2.1-4.3-1.2-3.9 0.3-12.5 3.5-1.9-1.4-3.3-8-2.7-3.2-2.7-0.3-3 0.3-3.6-1.1 7.3-3.8 2-1.7 1.8-2.6-0.2-1-4-0.5-4.1-2-6.6-5.8-9.9-6.8-2-2.1-4.1-7.7-1-1.2-1.2-0.5-0.7-0.7-0.5-0.8-0.8-0.8-4-1.3-1.1-0.7-1.1-2-0.7-2.2-1-1.2-1.8 1.1-3.4 3.9-2.5-0.9-2.6-2.8-3.5-2.1 1.2-1.8 2.6-2.2 1.1-1.4 0.6-1.6 0.3-1.8 0.4-1.8 1.1-1.7-2.6-1.2-19-1.7-6.8 0.6-2.7 0.9-0.5 0.2-0.2 0.1-2.7 2.1-1.4 3-1.3 7.4-1.4 2.9-2.9 3.1-4.1 6.2-2.8 1.8-1.6 0.1-1.8 0.1-23.8-9.3-6.6 0.4-3.3-0.3-2.2-2.1-2-1.2-2 0-4.3 1.2-1.9-0.9-1.9-0.3-1.9 0.3-2 0.9-4.8 1.5-9.7-3.7-5.4 2.2-1.9 1.4-4.2 6.1-5.5 4.7-1.3 0.8-1.6-0.7-5.4-5.1-1.8-0.6-4-0.5-1.6-0.6-0.5-1.2 0-1.4 0.2-1.4-0.2-0.7-1.1 0-3.4 1.5-4 0.4-1.7-0.4-14.5-6.1 8.9-16 4-5.4 8.2-5.4 2.3-5.4 6.3-10.5 0.4-2.1 0-1.7 0.2-1.4 0.8-1.6 2.2-3.1 0.7-1.5 0.3-1.6 0-14.8 0-0.7-1.6-11.5-0.2-4.1-0.6-2.6-5.5-9.6-4.1-7.3-1.5-1.2-1.4-1.5-0.6-3.5-0.3-6.2-1.1-8.3-7.1-25.1-0.6-1.1-0.9-1.4-3.7-3.6-0.5-1.3-0.4-3.1-7-43-2.3-7.3-3.5-6.2-4.4-4.8-5.6-3.2-10.3-1.9-2.2-1.3-2.2-2-3.3-1.8-3.4-1.3-2.7-0.4-1.6 0.4-2.7 1.7-1.7 0.4-1.5-0.9-6.1-9.4-3.2-11.4-5.6-9.8-2.3-5.3-3.4 0.1-5.3 2.4-3.4-1.2-4-6.2-2.4-1.5-0.1-0.9-3.1-5.5-1-0.8-9.8-3.9-13.6-1.9-6.3 0.4-4.4 1.1-1.7 0.1-1.6-0.6-2.6-2.6-1.3-0.6-0.6-0.5-2.4-2.5-1.2-0.9-1.3-0.5-4.3-0.8-10.9-5.2-5-0.6-3.5 4.6-1.4-1.5-2-5-1.3-2.4-3-3.1-1.4-2.1 0.6-5.8-2.1-5.5-3-5-2.2-2.8-4.1-1.9-7.5-2.3-4.3-4.4-2-0.9-6.2-1-4.2-1.8-3.2-0.7z"/></svg>`;
        L.DomEvent.on(btn, "click", e => {
          L.DomEvent.preventDefault(e);
          map.setView([42.1, 43.0], 7);
        });
        const tbilisiBtn = L.DomUtil.create("a", "", container);
        tbilisiBtn.href = "#";
        const _tbilisiLabel = t("elections.map.zoom_tbilisi");
        tbilisiBtn.title = _tbilisiLabel;
        tbilisiBtn.setAttribute("role", "button");
        tbilisiBtn.setAttribute("aria-label", _tbilisiLabel);
        tbilisiBtn.style.cssText = "display:flex;align-items:center;justify-content:center;width:26px;height:26px;color:#444;text-decoration:none;";
        tbilisiBtn.innerHTML = `<svg viewBox="403.98 288.718 2699.87 1899.822" width="17" height="17" fill="currentColor" stroke="none" xmlns="http://www.w3.org/2000/svg"><path vector-effect="none" fill-rule="evenodd" d="M1285.44,2042.49 L1097.28,2005.25 L983.165,2014.44 L851.078,2006.01 L813.029,2038.73 L730.081,2051.67 L715.302,2039.2 L695.463,2059.25 L674.468,2060.2 L659.646,2031.95 L610.363,1996.92 L586.187,1898.98 L588.047,1862.41 L527.201,1853.79 L530.044,1812.21 L489.862,1776.02 L484.704,1740.88 L446.405,1710.8 L427.056,1643.36 L403.98,1625.94 L447.449,1587.01 L462.233,1595.55 L511.661,1566.53 L514.73,1581.97 L552.604,1564.44 L570.619,1574.32 L640.514,1564.1 L691.286,1579.26 L701.507,1568.05 L712.716,1574.32 L724.915,1556.51 L740.74,1563.77 L762.17,1560.14 L767.082,1548.27 L771.288,1544.59 L774.579,1543.24 L796.295,1549.11 L800.403,1523.58 L835.838,1508.41 L846.24,1488.45 L859.445,1491.68 L860.032,1472.9 L905.81,1441.5 L904.049,1425.07 L943.665,1425.07 L977.705,1398.33 L996.486,1402.76 L1021.43,1390.44 L1036.76,1347.42 L1055.25,1340.67 L1022.97,1326.59 L1012.99,1293.72 L966.921,1237.67 L922.903,1208.91 L1002.72,1127.57 L1037.94,1122.58 L1033.47,1095.23 L1013.06,1085.44 L1005.07,1065.95 L996.559,971.073 L937.282,960.509 L936.402,879.81 L816.743,786.81 L847.512,732.393 L820.803,713.488 L822.652,689.297 L833.129,680.515 L877.042,692.225 L881.973,663.874 L899.847,669.267 L902.158,650.931 L926.243,650.728 L921.021,640.556 L950.957,609.886 L1040.36,540.516 L1041.97,510.591 L1085.21,502.953 L1079.86,489.58 L1135.6,495.254 L1131.95,516.892 L1152.76,534.142 L1229.45,561.908 L1297.56,542.801 L1343.21,498.27 L1451.27,495.064 L1472.85,472.991 L1458.25,452.997 L1393.51,481.452 L1374.1,463.932 L1366.82,439.718 L1383.2,381.146 L1502.01,342.842 L1517.23,314.089 L1556.13,288.718 L1793.56,404.927 L1885.62,420.381 L2156.56,501.83 L2354.45,628.682 L2359.63,620.025 L2350.41,639.485 L2342.61,643.904 L2258.05,669.274 L2236.06,720.015 L2236.06,813.04 L2256.62,885.071 L2241.46,952.325 L2340.09,973.456 L2325.3,986.017 L2305.59,1021.52 L2355.97,1009.97 L2361.95,1026.97 L2384.92,1025.84 L2420.54,1011.59 L2475.02,934.615 L2500.45,921.531 L2572.65,959.846 L2594.41,946.275 L2630.4,994.309 L2708.97,1006.35 L2823.37,1057.92 L2838.25,1105.24 L2900.58,1190.91 L2925.4,1249.63 L2964.27,1261.41 L3024.3,1193.41 L3063.07,1271.76 L3094.33,1305.98 L3090.4,1342.27 L3070,1362.16 L3071.1,1403.78 L3093.25,1436.72 L3080.77,1469.5 L3102.66,1490.89 L3092.49,1520.64 L3103.85,1556.35 L3058.49,1632.89 L3002.96,1653.79 L2991.38,1670.44 L2989.79,1725.52 L2959.42,1759.95 L2962.76,1821.58 L2911.06,1868.28 L2854.85,1856.59 L2831.22,1902.06 L2788.6,1909.6 L2783.83,1931.63 L2731.19,1946.94 L2746.57,1998.68 L2737.36,2023.57 L2665.13,2036.55 L2591.47,2005.45 L2556.21,2029.27 L2490.23,2098.77 L2480.58,2188.54 L2393.71,2165.39 L2365.95,2173 L2360.23,2142.02 L2373.89,2074.28 L2355.18,2024.88 L2344.59,2038.81 L2263.3,2023.15 L2257.6,2013.84 L2283.64,1997.7 L2197.97,1961.41 L2170.32,1931.01 L2150.96,1955.72 L2122.96,1893.39 L2069.73,1903.75 L1790.38,1908.48 L1791.78,1926.87 L1757.47,1956.25 L1720.85,1937.37 L1680.82,1941.51 L1722.6,2034.07 L1767.55,2072.79 L1719.88,2101.39 L1726.81,2107.57 L1706.95,2145.8 L1681.13,2164.03 L1638.34,2067.77 L1606.46,2087.76 L1584.17,2070.87 L1574.27,2077.06 L1582.12,2099.34 L1487.29,2090.44 L1466.71,2115.94 L1456.48,2086.46 L1439.72,2090.74 L1433.71,2124.54 L1315.74,2026.87 L1285.44,2042.49"/></svg>`;
        L.DomEvent.on(tbilisiBtn, "click", e => {
          L.DomEvent.preventDefault(e);
          zoomToTbilisi();
        });
        L.DomEvent.disableClickPropagation(container);
        return container;
      }
    });
    new ZoomHomeControl({ position: "topleft" }).addTo(map);

    // ── Share button (below Tbilisi zoom button, same gap as between controls) ─
    if (shareUrlForCurrentMap) {
      const _shareIcon = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/></svg>`;
      const _checkIcon = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;
      const ShareControl = L.Control.extend({
        onAdd() {
          const container = L.DomUtil.create("div", "leaflet-bar leaflet-control");
          const btn = L.DomUtil.create("a", "", container);
          btn.href = "#";
          const _label = t("elections.map.share_view");
          btn.title = _label;
          btn.setAttribute("role", "button");
          btn.setAttribute("aria-label", _label);
          btn.style.cssText = "display:flex;align-items:center;justify-content:center;width:26px;height:26px;color:#444;text-decoration:none;";
          btn.innerHTML = _shareIcon;
          L.DomEvent.on(btn, "click", async e => {
            L.DomEvent.preventDefault(e);
            const url = shareUrlForCurrentMap();
            try {
              await navigator.clipboard.writeText(url);
              btn.innerHTML = _checkIcon;
              btn.style.color = "#2d7d46";
              setTimeout(() => { btn.innerHTML = _shareIcon; btn.style.color = "#444"; }, 1200);
            } catch {
              window.prompt(_label, url);
            }
          });
          L.DomEvent.disableClickPropagation(container);
          return container;
        }
      });
      new ShareControl({ position: "topleft" }).addTo(map);
    }

    // Expose imperative map controls for bar chart clicks (toggles party filter)
    _mapCtrl.current = {
      currentPartyId: null,
      currentTurnoutMetric: _turnoutMetricCtrl.value ?? "final",
      currentLevel,
      legendDiv: _legendCtrl.getContainer(),

      getShareState() {
        const center = map.getCenter();
        return {
          lat: center.lat,
          lng: center.lng,
          z: map.getZoom(),
          level: currentLevel,
          party: this.currentPartyId,
          metric: this.currentTurnoutMetric
        };
      },

      setTurnoutMetric(metric) {
        this.currentTurnoutMetric = metric;
        _turnoutMetricCtrl.value  = metric;
        // Highlight active metric rows in the displayed panel
        document.querySelectorAll(".turnout-metric-row[data-metric]").forEach(row => {
          row.classList.toggle("metric-row-active", row.dataset.metric === metric);
        });
        // Restyle the active map layer
        if (currentLevel === "district") {
          districtLayer.setStyle(districtStyle);
        } else if (currentLevel === "selfgov" && selfgovLayer && _selfgovStyleFn) {
          selfgovLayer.setStyle(_selfgovStyleFn);
        } else if (currentLevel === "council_district" && councilDistrictLayer && _councilDistrictStyleFn) {
          councilDistrictLayer.setStyle(_councilDistrictStyleFn);
        }
        // Update precinct dots
        this.updatePrecinctDots(viewMode === "turnout" ? null : this.currentPartyId);
        // Update legend
        if (this.legendDiv) this.legendDiv.innerHTML = buildLegendHTML(null);
      },

      setPartyFilter(partyId, force = false) {
        // Radio behaviour: clicking the active party deselects; clicking a new one replaces
        const newId = force ? partyId : (this.currentPartyId === partyId ? null : partyId);
        this.currentPartyId = newId;
        if (_partyCtrl) _partyCtrl.value = newId;

        // Visual feedback: highlight matching rows in bar chart and district/precinct tables
        document.querySelectorAll(".bar-row[data-party-id]").forEach(row => {
          row.classList.toggle("bar-row-active", newId != null && row.dataset.partyId === newId);
        });
        document.querySelectorAll(".dist-table-row[data-party-id]").forEach(row => {
          row.classList.toggle("dist-table-row-active", newId != null && row.dataset.partyId === newId);
        });

        // Only restyle the active layer; others must stay hollow
        const districtIsActive        = currentLevel === "district";
        const selfgovIsActive         = currentLevel === "selfgov";
        const councilDistrictIsActive = currentLevel === "council_district";
        const precinctIsActive        = currentLevel === "precinct";

        // Compute min/max from the active layer's share map
        const _activeShareMap = precinctIsActive && _shareByPartyByPrecinct.size
          ? _shareByPartyByPrecinct
          : councilDistrictIsActive
            ? _shareByPartyByCouncilDistrict
            : selfgovIsActive
              ? _shareByPartyBySelfgov
              : _shareByPartyByDistrict;
        const allShares = newId
          ? [..._activeShareMap.values()].map(m => m.get(newId) ?? 0).filter(v => v > 0)
          : [];
        const minShare = allShares.length ? d3.min(allShares) : 0;
        const maxShare = allShares.length ? d3.max(allShares) : 1;
        const range    = (maxShare - minShare) || 1;

        if (newId && districtIsActive) {
          const color = partyColor(newId, electionVal?.id);
          districtLayer.setStyle(feature => {
            const did   = geoId(feature);
            const share = _shareByPartyByDistrict.get(did)?.get(newId) ?? 0;
            return {
              fillColor:   d3.interpolateRgb("#f5f5f5", color)(0.15 + ((share - minShare) / range) * 0.85),
              fillOpacity: 0.9, color: "#ffffff", weight: 0.5
            };
          });
        } else if (districtIsActive) {
          districtLayer.setStyle(districtStyle);
        }

        if (newId && selfgovIsActive && selfgovLayer) {
          const color = partyColor(newId, electionVal?.id);
          selfgovLayer.setStyle(feature => {
            const sgid  = geoId(feature);
            const share = _shareByPartyBySelfgov.get(sgid)?.get(newId) ?? 0;
            return {
              fillColor:   d3.interpolateRgb("#f5f5f5", color)(0.15 + ((share - minShare) / range) * 0.85),
              fillOpacity: 0.9, color: "#ffffff", weight: 0.8
            };
          });
        } else if (selfgovIsActive && selfgovLayer && _selfgovStyleFn) {
          selfgovLayer.setStyle(_selfgovStyleFn);
        }

        if (newId && councilDistrictIsActive && councilDistrictLayer) {
          const color = partyColor(newId, electionVal?.id);
          councilDistrictLayer.setStyle(feature => {
            const did   = geoId(feature);
            const share = _shareByPartyByCouncilDistrict.get(did)?.get(newId) ?? 0;
            return {
              fillColor:   d3.interpolateRgb("#f5f5f5", color)(0.15 + ((share - minShare) / range) * 0.85),
              fillOpacity: 0.9, color: "#ffffff", weight: 0.8
            };
          });
        } else if (councilDistrictIsActive && councilDistrictLayer && _councilDistrictStyleFn) {
          councilDistrictLayer.setStyle(_councilDistrictStyleFn);
        }

        // Always fully re-style precinct dots from scratch (prevents stale colours)
        this.updatePrecinctDots(newId, minShare, maxShare);

        // Update legend — pass actual min/max so labels show real percentages
        if (this.legendDiv) this.legendDiv.innerHTML = buildLegendHTML(newId, newId ? minShare : null, newId ? maxShare : null);
      },

      updatePrecinctDots(activePartyId, distMinShare, distMaxShare) {
        if (!precinctLayer) return;
        let minS = 0, maxS = 1, range = 1;
        if (activePartyId) {
          // Use precinct-level min/max if available, else fall back to district-level values
          const precinctShares = [..._shareByPartyByPrecinct.values()]
            .map(m => m.get(activePartyId) ?? 0).filter(v => v > 0);
          minS  = precinctShares.length ? d3.min(precinctShares) : (distMinShare ?? 0);
          maxS  = precinctShares.length ? d3.max(precinctShares) : (distMaxShare ?? 1);
          range = (maxS - minS) || 1;
        }
        precinctLayer.eachLayer(l => {
          const pid       = String(Math.round(l.feature?.properties?.id ?? 0));
          const resultKey = precinctFeatureResultKey(l.feature) ?? pid;
          const _rawD     = precinctRawDistrict(l.feature);
          const _dn       = Number(_rawD);
          // Council SMD: resolve via precinct→major_id map; local SMD: Tbilisi fold; others: electoral district
          const parentDid = precinctParentId(l.feature, pid);
          let fillColor;
          if (activePartyId) {
            const share = _shareByPartyByPrecinct.get(resultKey)?.get(activePartyId)
                       ?? _shareByPartyByPrecinct.get(pid)?.get(activePartyId)
                       ?? _shareByPartyByCouncilDistrict.get(parentDid)?.get(activePartyId)
                       ?? _shareByPartyByDistrict.get(parentDid)?.get(activePartyId)
                       ?? _shareByPartyBySelfgov.get(parentDid)?.get(activePartyId)
                       ?? 0;
            const color = partyColor(activePartyId, electionVal?.id);
            fillColor = d3.interpolateRgb("#f5f5f5", color)(0.15 + ((share - minS) / range) * 0.85);
          } else if (viewMode === "turnout") {
            const td = _precinctTurnoutByStation.get(resultKey) ?? _precinctTurnoutByStation.get(pid) ?? turnoutByDistrict.get(parentDid);
            fillColor = d3.interpolateRgb("#fee2e2", "#b91c1c")(turnoutNorm(td, _turnoutMetricCtrl.value, _invalidMax));
          } else {
            const winner = winnerByPrecinct.get(resultKey) ?? winnerByPrecinct.get(pid) ?? winnerByDistrict.get(parentDid);
            const color  = winner ? partyColor(winner.party_id, electionVal?.id) : "#ccc";
            const intensity = shareByPrecinct.get(resultKey) ?? shareByPrecinct.get(pid) ?? shareByDistrict.get(parentDid) ?? 0.5;
            fillColor = d3.interpolateRgb("#f5f5f5", color)(0.4 + intensity * 0.6);
          }
          l.setStyle({fillColor, fillOpacity: 0.85});
        });
      }
    };

    if (viewMode !== "turnout" && _partyCtrl?.value) {
      _mapCtrl.current.setPartyFilter(_partyCtrl.value, true);
    }
  }

  setTimeout(() => map.invalidateSize(), 150);
}
