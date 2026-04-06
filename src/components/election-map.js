import L from "npm:leaflet";
import * as d3 from "npm:d3";
import {turnoutValue, turnoutNorm} from "./election-utils.js";

// Builds (or rebuilds) the Leaflet election map.
// Called from elections.md as an awaited async cell.
// ctx must include all reactive state plus mutable handles and renderer functions.
export async function buildElectionMap({
  t, lang, electionVal, voteTypeVal, effectiveVoteType, mapMode, viewMode, isCouncilMode, ballotTypeVal,
  geoData, cartData, results, turnoutData, turnoutByDistrict,
  councilDistrictGeoData, councilDistrictResults,
  selfgovGeoData, selfgovResults,
  precinctGeoData, precinctResults, precinctTurnout,
  seatsData, _districtRows, _allCouncilSMDResults, _invalidMax,
  _mapCtrl, _mapState, _turnoutMetricCtrl, mapContainer,
  partyColor, passed,
  renderTurnoutPanel, renderDistrictPanel, updateCouncilSeats,
  invalidation
}) {
  // Restore saved view if we're staying on the same election (e.g. switching viewMode)
  const _sameElec  = _mapState.elecId === electionVal?.id;
  const _initCenter = _sameElec ? _mapState.center : [42.1, 43.0];
  const _initZoom   = _sameElec ? _mapState.zoom   : 7;

  // Clean up previous Leaflet instance; save current view first so we can restore it
  invalidation.then(() => {
    try {
      _mapState.center = map.getCenter();
      _mapState.zoom   = map.getZoom();
      _mapState.elecId = electionVal?.id;
      map.remove();
    } catch(e) {}
  });

  const map = L.map(mapContainer, {zoomControl: true}).setView(_initCenter, _initZoom);

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
  function geoId(feature) { return String(feature.properties.id ?? feature.properties.major_id); }

  // Returns the full human-readable feature name for panels and tooltips.
  // Handles majoritarian GeoJSON (district_name_en + N + major) where name_en/name_ka are absent.
  function getFeatureName(feature, l = "en") {
    const p = feature?.properties ?? {};
    if (l === "ka" && p.name_ka) return p.name_ka;
    if (p.name_en) return p.name_en;
    if (l === "ka" && p.district_name_ka != null && p.major != null) return `${p.district_name_ka} N${p.major}`;
    if (p.district_name_en != null && p.major != null) return `${p.district_name_en} N${p.major}`;
    if (l === "ka" && p.district_name_ka) return p.district_name_ka;
    if (p.district_name_en) return p.district_name_en;
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
    return null;
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

        if (isCouncilMode) updateCouncilSeats(did, f.properties);
      });
      circle.bindTooltip(
        `<strong>${lang === "ka" ? f.properties.name_ka : f.properties.name_en}</strong>`,
        {sticky: true, className: "leaflet-tooltip"}
      );
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
          if (isCouncilMode) updateCouncilSeats(did, feature.properties);
        });
        layer.bindTooltip(
          `<strong>${lang === "ka" ? feature.properties.name_ka : feature.properties.name_en}</strong>`,
          {sticky: true}
        );
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
            if (isCouncilMode) updateCouncilSeats(did, _props);
          });
          layer.bindTooltip(
            `<strong>${getFeatureName(feature, lang)}</strong>`,
            {sticky: true}
          );
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
          layer.bindTooltip(
            `<strong>${lang === "ka" ? feature.properties.name_ka : feature.properties.name_en}</strong>`,
            {sticky: true}
          );
        }
      });
    }

    // ── Per-station turnout lookup (precincts have inline turnout columns) ──
    const _precinctTurnoutByStation = new Map();
    if (precinctResults.length > 0 && precinctResults[0]?.registered != null) {
      const _seenPids = new Set();
      for (const r of precinctResults) {
        const pid = String(r.precinct_id);
        if (!_seenPids.has(pid)) { _seenPids.add(pid); _precinctTurnoutByStation.set(pid, r); }
      }
    }

    // ── Council SMD: precinct_id → major_id lookup for correct coloring ──────
    // council_smd_precincts.csv has district_id = major_id per precinct row
    const _precinctToMajorId = new Map();
    if (isCouncilMode && effectiveVoteType === "smd") {
      for (const r of precinctResults) {
        const pid = String(Math.round(r.precinct_id));
        if (!_precinctToMajorId.has(pid)) _precinctToMajorId.set(pid, String(r.district_id));
      }
    }

    // ── Precinct layer (zoom-activated) ──────────────────────────────────
    // Precincts may be Point features (polling station coordinates) rather than
    // polygons. In that case each point is coloured by its parent CEC district
    // winner (feature.properties.district_id) and rendered as a small circle.
    let precinctLayer = null;

    if (precinctGeoData) {
      const isPoints = precinctGeoData.features?.[0]?.geometry?.type === "Point";

      if (isPoints) {
        // Point precincts — CircleMarker, graduated color by parent district winner share
        precinctLayer = L.geoJSON(precinctGeoData, {
          pointToLayer(feature, latlng) {
            // Resolve parent district for coloring
            // Council SMD: color by major_id (from CSV); others: electoral district
            const _rawDist = feature.properties.district ?? feature.properties.district_id;
            const _d       = Number(_rawDist);
            const parentDid = (isCouncilMode && effectiveVoteType === "smd")
              ? (_precinctToMajorId.get(String(Math.round(feature.properties.id))) ?? String(_rawDist))
              : (effectiveVoteType === "smd" && !isCouncilMode && _d >= 1 && _d <= 10)
                ? "1" : String(_rawDist);
            let fillColor;
            if (viewMode === "turnout") {
              // Use computed id (feature.properties.id) — matches CSV precinct_id.
              // feature.properties.precinct_id is the raw CEC code and does NOT match.
              const stationId = String(Math.round(feature.properties.id));
              const td = _precinctTurnoutByStation.get(stationId) ?? turnoutByDistrict.get(parentDid);
              fillColor = d3.interpolateRgb("#fee2e2", "#b91c1c")(turnoutNorm(td, _turnoutMetricCtrl.value, _invalidMax));
            } else {
              const winner = winnerByDistrict.get(parentDid);
              if (winner) {
                const color = partyColor(winner.party_id, electionVal?.id);
                const intensity = shareByDistrict.get(parentDid) ?? 0.5;
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
            // `id` = computed district*1000+seq (matches CSV precinct_id)
            const _rawStId   = feature.properties.id;
            const stationId  = String(Math.round(_rawStId));
            const stationNum = Math.round(_rawStId) % 1000;
            const _rawDist   = feature.properties.district ?? feature.properties.district_id;
            const _d         = Number(_rawDist);
            // Council SMD: resolve parent to major_id; local SMD: Tbilisi fold; others: electoral district
            const parentDid  = (isCouncilMode && effectiveVoteType === "smd")
              ? (_precinctToMajorId.get(stationId) ?? String(_rawDist))
              : (effectiveVoteType === "smd" && !isCouncilMode && _d >= 1 && _d <= 10)
                ? "1" : String(_rawDist);
            // Use council district GeoData for name lookups in council SMD mode
            const _nameGeo   = (isCouncilMode && effectiveVoteType === "smd" && councilDistrictGeoData)
              ? councilDistrictGeoData
              : activeGeo;
            const distFeat   = _nameGeo?.features?.find(f =>
              String(f.properties.id ?? f.properties.major_id) === parentDid
            );
            const distNameEn = (distFeat ? getDistrictBaseName(distFeat, "en") : null) ?? parentDid;
            const distNameKa = (distFeat ? getDistrictBaseName(distFeat, "ka") : null) ?? distNameEn ?? parentDid;
            // Precinct title: always "district name Nseq" format (consistent across election types)
            // Building/school name (name_ka from GeoJSON) is shown inside the panel below the title
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
                precinct_name_ka: _geoNameKa,   // building/school name shown inside the panel
                address_ka:       _geoAddrKa
              };
              if (viewMode === "turnout") {
                panel.replaceWith(renderTurnoutPanel(stationId, enhancedProps, _precinctTurnoutByStation));
              } else {
                // Enrich council SMD precinct rows with candidate names from district-level results
                const stationRows = precinctResults
                  .filter(r => String(r.precinct_id) === stationId)
                  .map(r => {
                    if (!r.name_ka && !r.candidate_name) {
                      if (isCouncilMode && effectiveVoteType === "smd") {
                        // Enrich council SMD precincts with candidate names from district-level results
                        const match = _allCouncilSMDResults.find(
                          d => String(d.district_id) === String(r.district_id) && d.party_id === r.party_id
                        );
                        if (match?.name_ka) return {...r, name_ka: match.name_ka};
                      } else if (ballotTypeVal === "mayor") {
                        // Enrich mayor precincts with candidate names from selfgov-level results
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
            });
            layer.bindTooltip(
              `<strong>${lang === "ka" ? titleKa : titleEn}</strong>`,
              {sticky: true}
            );
          }
        });
      } else {
        // Polygon precincts — choropleth as usual
        const {winnerMap, shareMap, turnoutMap} = buildLookups(precinctResults, precinctTurnout);
        const pStyle = makeLayerStyle(winnerMap, shareMap, turnoutMap, 0.5);
        precinctLayer = L.geoJSON(precinctGeoData, {
          style: pStyle,
          onEachFeature(feature, layer) {
            const did = geoId(feature);
            layer.on("click", () => {
              const panel = document.getElementById("results-panel");
              if (panel) panel.replaceWith(viewMode === "turnout"
                ? renderTurnoutPanel(did, feature.properties, turnoutMap)
                : renderDistrictPanel(did, feature.properties, precinctResults));
            });
            layer.bindTooltip(
              `<strong>${lang === "ka" ? feature.properties.name_ka : feature.properties.name_en}</strong>`,
              {sticky: true}
            );
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
          ...(precinctLayer        ? [{ id: "precinct",         label: t("elections.map_level.precinct") }] : []),
        ]
      : [
          ...(selfgovLayer  ? [{ id: "selfgov",  label: t("elections.map_level.selfgov") }] : []),
          { id: "district", label: t("elections.map_level.district") },
          ...(precinctLayer ? [{ id: "precinct", label: t("elections.map_level.precinct") }] : []),
        ];
    const multiLevel = availableLevels.length > 1;
    // In council SMD turnout mode, default to selfgov (broadest level with turnout data)
    let currentLevel = _councilSMD
      ? (viewMode === "turnout" && selfgovLayer ? "selfgov" : (councilDistrictLayer ? "council_district" : "district"))
      : (selfgovLayer ? "selfgov" : "district");

    function applyLevel(levelId, controlDiv) {
      currentLevel = levelId;
      if (levelId === "selfgov" && selfgovLayer) {
        if (!map.hasLayer(selfgovLayer)) selfgovLayer.addTo(map);
        districtLayer.setStyle(DISTRICT_HOLLOW);
        if (councilDistrictLayer && map.hasLayer(councilDistrictLayer)) map.removeLayer(councilDistrictLayer);
        if (precinctLayer        && map.hasLayer(precinctLayer))        map.removeLayer(precinctLayer);
      } else if (levelId === "district") {
        districtLayer.setStyle(districtStyle);
        if (selfgovLayer         && map.hasLayer(selfgovLayer))         map.removeLayer(selfgovLayer);
        if (councilDistrictLayer && map.hasLayer(councilDistrictLayer)) map.removeLayer(councilDistrictLayer);
        if (precinctLayer        && map.hasLayer(precinctLayer))        map.removeLayer(precinctLayer);
      } else if (levelId === "council_district" && councilDistrictLayer) {
        districtLayer.setStyle(DISTRICT_HOLLOW);
        if (selfgovLayer && map.hasLayer(selfgovLayer)) map.removeLayer(selfgovLayer);
        if (!map.hasLayer(councilDistrictLayer)) councilDistrictLayer.addTo(map);
        if (precinctLayer && map.hasLayer(precinctLayer)) map.removeLayer(precinctLayer);
      } else if (levelId === "precinct" && precinctLayer) {
        districtLayer.setStyle(DISTRICT_HOLLOW);
        if (selfgovLayer         && map.hasLayer(selfgovLayer))         map.removeLayer(selfgovLayer);
        if (councilDistrictLayer && map.hasLayer(councilDistrictLayer)) map.removeLayer(councilDistrictLayer);
        if (!map.hasLayer(precinctLayer)) precinctLayer.addTo(map);
        // Re-style dots to match current party filter (dots are styled at creation, may be stale)
        if (_mapCtrl.current) _mapCtrl.current.updatePrecinctDots(_mapCtrl.current.currentPartyId);
      }
      if (controlDiv) {
        controlDiv.querySelectorAll(".level-control-item").forEach(el => {
          el.classList.toggle("lc-active", el.dataset.level === currentLevel);
        });
      }
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
    const _shareByPartyByDistrict = new Map();
    for (const r of _districtRows) {
      const did = String(r.district_id);
      if (!_shareByPartyByDistrict.has(did)) _shareByPartyByDistrict.set(did, new Map());
      _shareByPartyByDistrict.get(did).set(r.party_id, r.vote_share);
    }

    const _shareByPartyBySelfgov = new Map();
    for (const r of selfgovResults) {
      if (String(r.district_id) === "national") continue;
      const sgid = String(r.district_id);
      if (!_shareByPartyBySelfgov.has(sgid)) _shareByPartyBySelfgov.set(sgid, new Map());
      _shareByPartyBySelfgov.get(sgid).set(r.party_id, r.vote_share);
    }

    const _shareByPartyByPrecinct = new Map();
    for (const r of precinctResults) {
      const pid = String(r.precinct_id);
      if (!_shareByPartyByPrecinct.has(pid)) _shareByPartyByPrecinct.set(pid, new Map());
      _shareByPartyByPrecinct.get(pid).set(r.party_id, r.vote_share);
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
    const ZoomHomeControl = L.Control.extend({
      onAdd(map) {
        const container = L.DomUtil.create("div", "leaflet-bar leaflet-control");
        const btn = L.DomUtil.create("a", "", container);
        btn.href  = "#";
        const _label = lang === "ka" ? "საქართველოს მასშტაბი" : "Zoom to Georgia";
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
        L.DomEvent.disableClickPropagation(container);
        return container;
      }
    });
    new ZoomHomeControl({ position: "topleft" }).addTo(map);

    // Expose imperative map controls for bar chart clicks (toggles party filter)
    _mapCtrl.current = {
      currentPartyId: null,
      currentTurnoutMetric: "final",
      legendDiv: _legendCtrl.getContainer(),

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
        this.updatePrecinctDots(this.currentPartyId);
        // Update legend
        if (this.legendDiv) this.legendDiv.innerHTML = buildLegendHTML(null);
      },

      setPartyFilter(partyId) {
        // Radio behaviour: clicking the active party deselects; clicking a new one replaces
        const newId = this.currentPartyId === partyId ? null : partyId;
        this.currentPartyId = newId;

        // Visual feedback: highlight matching rows in bar chart and district/precinct tables
        document.querySelectorAll(".bar-row[data-party-id]").forEach(row => {
          row.classList.toggle("bar-row-active", newId != null && row.dataset.partyId === newId);
        });
        document.querySelectorAll(".dist-table-row[data-party-id]").forEach(row => {
          row.classList.toggle("dist-table-row-active", newId != null && row.dataset.partyId === newId);
        });

        // Only restyle the active layer; others must stay hollow
        const districtIsActive = currentLevel === "district";
        const selfgovIsActive  = currentLevel === "selfgov";

        // Compute min/max from the active layer's share map
        const _activeShareMap = selfgovIsActive ? _shareByPartyBySelfgov : _shareByPartyByDistrict;
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
          const _rawD     = l.feature?.properties?.district ?? l.feature?.properties?.district_id;
          const _dn       = Number(_rawD);
          // Council SMD: resolve via precinct→major_id map; local SMD: Tbilisi fold; others: electoral district
          const parentDid = (isCouncilMode && effectiveVoteType === "smd")
            ? (_precinctToMajorId.get(pid) ?? String(_rawD))
            : (effectiveVoteType === "smd" && !isCouncilMode && _dn >= 1 && _dn <= 10)
              ? "1" : String(_rawD);
          let fillColor;
          if (activePartyId) {
            const share = _shareByPartyByPrecinct.get(pid)?.get(activePartyId)
                       ?? _shareByPartyByDistrict.get(parentDid)?.get(activePartyId) ?? 0;
            const color = partyColor(activePartyId, electionVal?.id);
            fillColor = d3.interpolateRgb("#f5f5f5", color)(0.15 + ((share - minS) / range) * 0.85);
          } else if (viewMode === "turnout") {
            const td = _precinctTurnoutByStation.get(pid) ?? turnoutByDistrict.get(parentDid);
            fillColor = d3.interpolateRgb("#fee2e2", "#b91c1c")(turnoutNorm(td, _turnoutMetricCtrl.value, _invalidMax));
          } else {
            const winner = winnerByDistrict.get(parentDid);
            const color  = winner ? partyColor(winner.party_id, electionVal?.id) : "#ccc";
            fillColor = d3.interpolateRgb("#f5f5f5", color)(0.4 + (shareByDistrict.get(parentDid) ?? 0.5) * 0.6);
          }
          l.setStyle({fillColor, fillOpacity: 0.85});
        });
      }
    };
  }

  setTimeout(() => map.invalidateSize(), 150);
}
