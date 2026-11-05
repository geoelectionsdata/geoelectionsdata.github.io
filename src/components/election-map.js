import L from "npm:leaflet";
import * as d3 from "npm:d3";
import {addBasemap} from "./basemap.js";
import {createMapSelection} from "./map-selection.js";
import {bindMapTooltip, createMapHover, createMapTooltips} from "./map-tooltips.js";
import {addShare, buildLookups, geoId, getDistrictBaseName, getFeatureName} from "./map-data.js";
import {createPolygonStyles} from "./map-styles.js";
import {
  indexPrecinctResults, precinctExactKey, precinctMajorDistrict,
  precinctRawDistrict, precinctStationId, precinctStationNumber
} from "./precinct-data.js";
import {turnoutValue, turnoutNorm, councilSelfgovIdFromMajorId, selfgovIdFromRawDistrictId} from "./election-utils.js";
import {makeCsvManifestLoader, makeManifestLoader} from "./election-assets.js";
import {makeElectionCsvParser} from "./election-csv.js";
import {addMapNavigation} from "./map-navigation.js";
import {addFullscreenControl} from "./map-fullscreen.js";
import {createMapLegend} from "./map-legend.js";

const precinctGeoLoaders = new Map();
const precinctCsvLoaders = new Map();
const PRECINCT_CACHE_ENTRIES = 4;

function loadPrecinctGeo(path, registryUrl) {
  if (!precinctGeoLoaders.has(registryUrl)) {
    precinctGeoLoaders.set(registryUrl, makeManifestLoader(registryUrl, {maxEntries: PRECINCT_CACHE_ENTRIES}));
  }
  return precinctGeoLoaders.get(registryUrl)(path);
}

function loadPrecinctCsv(path, registryUrl) {
  if (!precinctCsvLoaders.has(registryUrl)) {
    precinctCsvLoaders.set(registryUrl, makeCsvManifestLoader(registryUrl, makeElectionCsvParser(d3), PRECINCT_CACHE_ENTRIES));
  }
  return precinctCsvLoaders.get(registryUrl)(path);
}

// Builds (or rebuilds) the Leaflet election map.
// Called from elections.md as an awaited async cell.
// ctx must include all reactive state plus mutable handles and renderer functions.
export async function buildElectionMap({
  t: _initT, lang: _initLang, electionVal, voteTypeVal, effectiveVoteType, mapMode, viewMode, isCouncilMode, ballotTypeVal,
  geoData, cartData, results, turnoutData, turnoutByDistrict,
  councilDistrictGeoData, councilDistrictResults,
  selfgovGeoData, selfgovResults,
  precinctGeoPath, precinctCsvPath, precinctTurnout,
  _precinctGeoRegistryUrl, _precinctCsvRegistryUrl,
  seatsData, _districtRows, _allCouncilSMDResults, _invalidMax,
  _mapCtrl, _mapState, _turnoutMetricCtrl, _levelCtrl, _partyCtrl,
  _selectedUnitLevelCtrl, _selectedUnitCtrl, updateUrlParams, mapContainer,
  getParty, partyColor, passed,
  renderers,
  shareUrlForCurrentMap,
  invalidation
}) {
  // Mutable `t` and `lang` so a language change can be applied imperatively
  // via _mapCtrl.current.setLang(newLang, newT) without rebuilding the whole map.
  // All in-function code that references `t` or `lang` reads these let-bindings,
  // so re-rendering the legend after setLang() picks up the new values automatically.
  let t    = _initT;
  let lang = _initLang;

  // Delegate wrappers — read the latest renderer functions from the `renderers` handle
  // at call time, so panels opened after a language toggle pick up the refreshed
  // translations even though the map cell did NOT re-run.
  const renderTurnoutPanel  = (...args) => renderers.renderTurnoutPanel(...args);
  const renderDistrictPanel = (...args) => renderers.renderDistrictPanel(...args);
  const updateCouncilSeats  = (...args) => renderers.updateCouncilSeats(...args);

  // Restore saved view if we're staying on the same election and ballot.
  const _viewCfg    = (ballotTypeVal === "mayor" && electionVal?.map_view_mayor)
    ? electionVal.map_view_mayor
    : electionVal?.map_view;
  const _sameElec   = _mapState.elecId === electionVal?.id && _mapState.ballotType === ballotTypeVal;
  const _defCenter  = _viewCfg?.center ?? [42.1, 43.0];
  const _defZoom    = _viewCfg?.zoom   ?? 7;
  const _initCenter = _sameElec ? _mapState.center : _defCenter;
  const _initZoom   = _sameElec ? _mapState.zoom   : _defZoom;

  const hover = createMapHover();
  // Clean up previous Leaflet instance; save current view first so we can restore it
  invalidation.then(() => {
    mapContainer.removeEventListener("mouseleave", hover.clear);
    hover.clear();
    try {
      _mapState.center = map.getCenter();
      _mapState.zoom   = map.getZoom();
      _mapState.elecId = electionVal?.id;
      _mapState.ballotType = ballotTypeVal;
      map.remove();
    } catch(e) {}
  });

  const map = L.map(mapContainer, {zoomControl: true, doubleClickZoom: false}).setView(_initCenter, _initZoom);
  map.on("movestart dragstart zoomstart", hover.clear);
  mapContainer.addEventListener("mouseleave", hover.clear);

  // Clicking on empty map area (tile background) deselects the active unit
  // and resets the side panel back to the national view. Polygons and
  // precinct circles attach the `leaflet-interactive` class to their SVG
  // elements; we ignore those so the layer-level click handlers continue
  // to drive selection. This matches the back-button behaviour without
  // requiring the user to find the small ← button in the results panel.
  map.on("click", e => {
    const target = e.originalEvent?.target;
    if (!target) return;
    if (target.classList?.contains("leaflet-interactive")) return;
    if (selection.level || selection.id) {
      clearSelectedUnit();
      if (typeof renderers?.showNationalPanel === "function") {
        renderers.showNationalPanel();
      }
    }
  });

  addBasemap(map);

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

  const polygonStyles = createPolygonStyles({
    interpolateRgb: d3.interpolateRgb,
    isColor: d3.color,
    partyColor: id => partyColor(id, electionVal?.id),
    turnoutIntensity: row => turnoutNorm(row, _turnoutMetricCtrl.value, _invalidMax)
  });
  function districtStyle(feature) {
    const did = geoId(feature);
    return viewMode === "turnout"
      ? polygonStyles.district.turnout(turnoutByDistrict.get(did))
      : polygonStyles.district.result(winnerByDistrict.get(did), shareByDistrict.get(did));
  }

  // Stringify GeoJSON integer ids once: result maps are keyed by string from CSV,
  // while shape keys vary across vintages (`id`, `maj_id`, `major_id`, etc.).
  function updateCouncilSeatsForDistrict(did, props) {
    // `did` here is a raw electoral/exec district number (already selfgov-scale),
    // NOT a council maj_id — see the domain note in election-utils.js.
    const sgId = selfgovIdFromRawDistrictId(did);
    const sgFeat = selfgovGeoData?.features?.find(f => String(f.properties.id) === sgId);
    updateCouncilSeats(sgId, sgFeat?.properties ?? props, true);
  }



  function activePartyId() {
    return _mapCtrl.current?.currentPartyId ?? _partyCtrl?.value ?? null;
  }

  const selection = createMapSelection({
    container: mapContainer,
    level: _selectedUnitLevelCtrl?.value,
    id: _selectedUnitCtrl?.value,
    onChange({level, id, updateUrl}) {
      if (_selectedUnitLevelCtrl) _selectedUnitLevelCtrl.value = level;
      if (_selectedUnitCtrl) _selectedUnitCtrl.value = id;
      if (_mapCtrl.current) {
        _mapCtrl.current.currentSelectedUnitLevel = level;
        _mapCtrl.current.currentSelectedUnit = id;
      }
      if (!updateUrl || typeof updateUrlParams !== "function") return;
      if (level) updateUrlParams({level, unit_level: level, unit: id}, []);
      else updateUrlParams({}, ["unit_level", "unit"]);
    }
  });
  const {register: registerSelection, apply: applySelection, clear: clearSelectedUnit} = selection;

  const tooltips = createMapTooltips({
    lang, t, getParty, partyColor, electionId: electionVal?.id,
    activePartyId, getTurnoutMetric: () => _turnoutMetricCtrl.value
  });
  const {buildTurnoutTooltip, buildResultTooltipFromRows, buildAreaResultTooltip} = tooltips;
  const bindDynamicTooltip = (layer, content) => bindMapTooltip(layer, content, hover);

  const DISTRICT_HOLLOW  = {fillColor: "transparent", fillOpacity: 0, color: "#999", weight: 0.5};
  const SAKREBULO_HOLLOW = {fillColor: "transparent", fillOpacity: 0, color: "#bbb", weight: 0.8};

  if (mapMode === "cartogram" && activeGeo.features[0]?.geometry?.type === "Point") {
    // Cartogram — proportional circles, no precinct overlay
    activeGeo.features.forEach(f => {
      const did  = geoId(f);
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
      const selectDistrict = () => {
        const panel = document.getElementById("results-panel");
        if (panel) panel.replaceWith(viewMode === "turnout"
          ? renderTurnoutPanel(did, f.properties)
          : renderDistrictPanel(did, f.properties));

        if (isCouncilMode) updateCouncilSeatsForDistrict(did, f.properties);
      };
      registerSelection("district", did, selectDistrict, circle);
      circle.on("click", () => applySelection("district", did));
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
        const selectDistrict = () => {
          const panel = document.getElementById("results-panel");
          if (panel) panel.replaceWith(viewMode === "turnout"
            ? renderTurnoutPanel(did, feature.properties)
            : renderDistrictPanel(did, feature.properties));
          if (isCouncilMode) updateCouncilSeatsForDistrict(did, feature.properties);
        };
        registerSelection("district", did, selectDistrict, layer);
        layer.on("click", () => applySelection("district", did));
        layer.on("dblclick", e => {
          L.DomEvent.stop(e);
          drillDownOnDoubleClick(layer);
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


    function makeLayerStyle(winnerMap, shareMap, turnoutMap, weight = 0.5) {
      const style = polygonStyles.detailed(weight);
      return feature => {
        const did = geoId(feature);
        return viewMode === "turnout"
          ? style.turnout(turnoutMap.get(did))
          : style.result(winnerMap.get(did), shareMap.get(did));
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
          const selectCouncilDistrict = () => {
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
          };
          registerSelection("council_district", did, selectCouncilDistrict, layer);
          layer.on("click", () => applySelection("council_district", did));
          layer.on("dblclick", e => {
            L.DomEvent.stop(e);
            drillDownOnDoubleClick(layer);
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
          const selectSelfgov = () => {
            const panel = document.getElementById("results-panel");
            if (panel) panel.replaceWith(viewMode === "turnout"
              ? renderTurnoutPanel(did, feature.properties, turnoutMap)
              : renderDistrictPanel(did, feature.properties, selfgovResults));
            if (isCouncilMode) updateCouncilSeats(did, feature.properties, true);
          };
          registerSelection("selfgov", did, selectSelfgov, layer);
          layer.on("click", () => applySelection("selfgov", did));
          layer.on("dblclick", e => {
            L.DomEvent.stop(e);
            drillDownOnDoubleClick(layer);
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
    let _precinctLayerPromise     = null;
    let _precinctUsesExactKeys    = false;
    let precinctRowsByKey         = new Map();

    function updateCouncilSeatsForPrecinct(parentDid, stationId, props) {
      if (!isCouncilMode) return;
      const sgId = effectiveVoteType === "smd"
        ? councilSelfgovIdFromMajorId(_precinctToMajorId.get(stationId) ?? parentDid)
        : selfgovIdFromRawDistrictId(parentDid);
      const sgFeat = selfgovGeoData?.features?.find(f => String(f.properties.id) === sgId);
      updateCouncilSeats(sgId, sgFeat?.properties ?? props, true);
    }

    function precinctFeatureResultKey(feature) {
      return _precinctUsesExactKeys ? precinctExactKey(feature) : precinctStationId(feature);
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
      const featureNameEn = p.name_en || p.precinct_name_en || null;
      const featureNameKa = p.name_ka || p.precinct_name_ka || p.precinct_name || null;
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
        name_en: featureNameEn ?? `${distNameEn} N${suffix}`,
        name_ka: featureNameKa ?? `${distNameKa} N${suffix}`,
        precinct_name_ka: featureNameKa ? null : (p.name_ka || p.precinct_name || null),
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

    function _ensurePrecinctLayer() {
      return _precinctLayerPromise ??= loadPrecinctLayer();
    }

    async function loadPrecinctLayer() {
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

      const index = indexPrecinctResults(precinctResults, {
        councilSmd: isCouncilMode && effectiveVoteType === "smd"
      });
      precinctRowsByKey = index.byUnit;
      _precinctUsesExactKeys = index.usesExactKeys;
      _precinctTurnoutByStation = index.turnoutByUnit;
      _precinctToMajorId = index.majorByStation;
      winnerByPrecinct = index.winnerByUnit;
      shareByPrecinct = index.maxShareByUnit;
      _shareByPartyByPrecinct = index.partySharesByUnit;

      if (!precinctGeoData) return;
      if (_precinctUsesExactKeys) {
        precinctGeoData = {
          ...precinctGeoData,
          features: precinctGeoData.features?.filter(f => precinctRowsByKey.has(precinctExactKey(f))) ?? []
        };
      }
      const isPoints = precinctGeoData.features?.[0]?.geometry?.type === "Point";

      if (isPoints) {
        precinctLayer = L.geoJSON(precinctGeoData, {
          pointToLayer(feature, latlng) {
            const _rawDist  = precinctRawDistrict(feature);
            const _d        = Number(_rawDist);
            const stationId = precinctStationId(feature);
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
            const stationId  = precinctStationId(feature);
            const resultKey  = precinctFeatureResultKey(feature) ?? stationId;
            const stationNum = precinctStationNumber(feature);
            const _rawDist   = precinctRawDistrict(feature);
            const _d         = Number(_rawDist);
            const parentDid  = precinctParentId(feature, stationId);
            const featureNameEn = feature.properties.name_en || feature.properties.precinct_name_en || null;
            const featureNameKa = feature.properties.name_ka || feature.properties.precinct_name_ka || feature.properties.precinct_name || null;
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
            const titleKa    = featureNameKa ?? `${distNameKa} N${stationNum}`;
            const titleEn    = featureNameEn ?? `${distNameEn} N${stationNum}`;

            const selectPrecinct = () => {
              const panel = document.getElementById("results-panel");
              if (!panel) return;
              const enhancedProps = {
                ...feature.properties,
                name_en:          titleEn,
                name_ka:          titleKa,
                precinct_name_ka: featureNameKa ? null : _geoNameKa,
                address_ka:       _geoAddrKa
              };
              if (viewMode === "turnout") {
                panel.replaceWith(renderTurnoutPanel(resultKey, enhancedProps, _precinctTurnoutByStation));
              } else {
                const stationRows = (precinctRowsByKey.get(resultKey) ?? [])
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
            };
            registerSelection("precinct", resultKey, selectPrecinct, layer);
            if (resultKey !== stationId) registerSelection("precinct", stationId, selectPrecinct, layer);
            layer.on("click", () => applySelection("precinct", resultKey));
            bindDynamicTooltip(layer, () => {
              const title = lang === "ka" ? titleKa : titleEn;
              if (viewMode === "turnout") {
                const td = _precinctTurnoutByStation.get(resultKey)
                  ?? _precinctTurnoutByStation.get(stationId)
                  ?? turnoutByDistrict.get(parentDid);
                return buildTurnoutTooltip(title, td);
              }
              const stationRows = enrichPrecinctRows(
                precinctRowsByKey.get(resultKey) ?? []
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
        const precinctStyle = polygonStyles.detailed(0.5);
        precinctLayer = L.geoJSON(precinctGeoData, {
          style(feature) {
            const stationId = precinctStationId(feature);
            const resultKey = precinctFeatureResultKey(feature) ?? stationId;
            const parentDid = precinctParentId(feature, stationId);
            if (viewMode === "turnout") {
              return precinctStyle.turnout(_precinctTurnoutByStation.get(resultKey)
                ?? _precinctTurnoutByStation.get(stationId) ?? turnoutByDistrict.get(parentDid));
            }
            return precinctStyle.result(
              winnerByPrecinct.get(resultKey) ?? winnerByPrecinct.get(stationId) ?? winnerByDistrict.get(parentDid),
              shareByPrecinct.get(resultKey) ?? shareByPrecinct.get(stationId) ?? shareByDistrict.get(parentDid)
            );
          },
          onEachFeature(feature, layer) {
            const stationId = precinctStationId(feature);
            const resultKey = precinctFeatureResultKey(feature) ?? stationId;
            const parentDid = precinctParentId(feature, stationId);
            const enhancedProps = precinctDisplayProps(feature, stationId, parentDid);
            const selectPrecinct = () => {
              const panel = document.getElementById("results-panel");
              if (!panel) return;
              if (viewMode === "turnout") {
                panel.replaceWith(renderTurnoutPanel(resultKey, enhancedProps, _precinctTurnoutByStation));
              } else {
                const stationRows = enrichPrecinctRows(
                  precinctRowsByKey.get(resultKey) ?? []
                );
                panel.replaceWith(renderDistrictPanel("__precinct__", enhancedProps, stationRows));
              }
              updateCouncilSeatsForPrecinct(parentDid, stationId, enhancedProps);
            };
            registerSelection("precinct", resultKey, selectPrecinct, layer);
            if (resultKey !== stationId) registerSelection("precinct", stationId, selectPrecinct, layer);
            layer.on("click", () => applySelection("precinct", resultKey));
            bindDynamicTooltip(layer, () => {
              const title = lang === "ka" ? enhancedProps.name_ka : enhancedProps.name_en;
              if (viewMode === "turnout") {
                const td = _precinctTurnoutByStation.get(resultKey)
                  ?? _precinctTurnoutByStation.get(stationId)
                  ?? turnoutByDistrict.get(parentDid);
                return buildTurnoutTooltip(title, td);
              }
              const stationRows = enrichPrecinctRows(
                precinctRowsByKey.get(resultKey) ?? []
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
    // Default-level priority: URL ?level=… > YAML map_view.default_level > heuristic.
    // Heuristic: broadest level available — selfgov for local elections (or for council SMD
    // turnout view), council_district for council SMD results view, else district.
    const _heuristicLevel = _councilSMD
      ? (viewMode === "turnout" && selfgovLayer ? "selfgov" : (councilDistrictLayer ? "council_district" : "district"))
      : (selfgovLayer ? "selfgov" : "district");
    const _yamlLevel = electionVal?.map_view?.default_level;
    const _yamlLevelValid = availableLevels.some(lvl => lvl.id === _yamlLevel);
    const defaultLevel = _yamlLevelValid ? _yamlLevel : _heuristicLevel;
    let currentLevel = availableLevels.some(lvl => lvl.id === _levelCtrl?.value) ? _levelCtrl.value : defaultLevel;

    // DOM ref to the level-control panel (top-right), captured during the
    // LevelControl's onAdd() below. Click handlers reference it to keep the
    // visual highlighted-item state in sync when they programmatically switch.
    let _levelControlDiv = null;

    // Drill-down on double click: zoom to the clicked feature and jump straight to
    // the most granular level available (precinct when the election has one,
    // otherwise no level change — just the zoom). Skipped when already at
    // precinct (the leaf level — nothing lower to go to).
    function drillDownOnDoubleClick(layer) {
      if (currentLevel === "precinct") return;
      const bounds = layer.getBounds?.();
      if (bounds && bounds.isValid?.()) {
        map.fitBounds(bounds.pad(0.1), {maxZoom: 14, animate: true, duration: 0.5});
      }
      if (precinctGeoPath || precinctCsvPath) {
        applyLevel("precinct", _levelControlDiv, {clearSelection: true});
      }
    }

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

    function applyLevel(levelId, controlDiv, {clearSelection = false, updateUrl = true} = {}) {
      hover.clear();
      currentLevel = levelId;
      if (_levelCtrl) _levelCtrl.value = currentLevel;
      if (_mapCtrl.current) _mapCtrl.current.currentLevel = currentLevel;
      if (updateUrl && typeof updateUrlParams === "function") updateUrlParams({level: currentLevel}, []);
      if (clearSelection) clearSelectedUnit();
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
          if (!precinctLayer || currentLevel !== "precinct") return;
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
        _levelControlDiv = div;
        const title = L.DomUtil.create("div", "level-control-title", div);
        title.textContent = t("elections.map_level");

        availableLevels.forEach(lvl => {
          const item = L.DomUtil.create("div", "level-control-item", div);
          item.dataset.level = lvl.id;
          item.textContent = lvl.label;
          if (lvl.id === currentLevel) item.classList.add("lc-active");
          if (multiLevel) {
            item.classList.add("lc-clickable");
            L.DomEvent.on(item, "click", () => applyLevel(lvl.id, div, {clearSelection: true}));
          }
        });
        return div;
      }
    });
    new LevelControl({ position: "topright" }).addTo(map);
    applyLevel(currentLevel, null, {updateUrl: false});

    function restoreSelectedUnitFromUrl() {
      if (!selection.level || !selection.id) return;
      if (!availableLevels.some(lvl => lvl.id === selection.level)) return;

      const restorePanel = () => {
        applySelection(selection.level, selection.id, {updateUrl: false});
      };

      if (selection.level === "precinct" && (precinctGeoPath || precinctCsvPath)) {
        _ensurePrecinctLayer().then(() => {
          applyLevel("precinct", _levelControlDiv, {updateUrl: false});
          setTimeout(restorePanel, 0);
        });
      } else {
        if (selection.level !== currentLevel) {
          applyLevel(selection.level, _levelControlDiv, {updateUrl: false});
        }
        setTimeout(restorePanel, 0);
      }
    }

    // ── Party filter: lookups for district, selfgov, and precinct vote shares ─

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

    const buildLegendHTML = createMapLegend({
      viewMode, partyColor: id => partyColor(id, electionVal?.id), interpolateRgb: d3.interpolateRgb,
      winnerByDistrict, passed, getLang: () => lang, translate: key => t(key),
      getMetric: () => _turnoutMetricCtrl.value, invalidMax: _invalidMax
    });
    const LegendControl = L.Control.extend({
      onAdd() {
        const div = L.DomUtil.create("div", "map-legend");
        L.DomEvent.disableClickPropagation(div);
        div.innerHTML = buildLegendHTML(null);
        return div;
      }
    });
    const _legendCtrl = new LegendControl({position: "bottomleft"}).addTo(map);

    const translateControl = key => t(key);
    addMapNavigation({map, t: translateControl, activeGeo, selfgovGeoData, councilDistrictGeoData, shareUrlForCurrentMap});
    addFullscreenControl({map, mapContainer, t: translateControl});

    // ── Overlay opacity slider ───────────────────────────────────────────────
    // Lets the user dim the choropleth so the basemap's settlement names
    // bleed through. Implementation: drive a CSS custom property on the map
    // container; the matching stylesheet rule applies `opacity` to the
    // Leaflet overlay panes (where path/circle SVG elements live). One
    // property → both polygon layers and precinct circles fade together, no
    // per-layer re-styling needed.
    const OpacityControl = L.Control.extend({
      onAdd() {
        const container = L.DomUtil.create("div", "leaflet-bar leaflet-control map-opacity-ctrl");
        const toggle = L.DomUtil.create("a", "map-opacity-toggle", container);
        toggle.href = "#";
        toggle.setAttribute("role", "button");
        const labelTxt = t("elections.map.layer_opacity") || "Layer opacity";
        toggle.title = labelTxt;
        toggle.setAttribute("aria-label", labelTxt);
        // Half-shaded circle icon = the opacity concept at a glance.
        toggle.innerHTML = `
          <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
            <path d="M12 2 a10 10 0 0 0 0 20 z" fill="currentColor"/>
            <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="1.5"/>
          </svg>`;
        const tray = L.DomUtil.create("div", "map-opacity-tray", container);
        tray.hidden = true;
        const slider = L.DomUtil.create("input", "map-opacity-slider", tray);
        slider.type = "range";
        slider.min = "20";
        slider.max = "100";
        slider.step = "5";
        slider.value = String(Math.round((mapContainer.dataset.overlayOpacity ?? 1) * 100));
        slider.setAttribute("aria-label", labelTxt);
        const valueEl = L.DomUtil.create("span", "map-opacity-value", tray);
        valueEl.textContent = slider.value + "%";

        function applyOpacity(pct) {
          const ratio = Math.max(0.05, Math.min(1, pct / 100));
          mapContainer.style.setProperty("--map-overlay-opacity", String(ratio));
          mapContainer.dataset.overlayOpacity = String(ratio);
          valueEl.textContent = pct + "%";
        }

        L.DomEvent.on(toggle, "click", e => {
          L.DomEvent.preventDefault(e);
          tray.hidden = !tray.hidden;
          container.classList.toggle("map-opacity-open", !tray.hidden);
        });
        L.DomEvent.on(slider, "input", () => applyOpacity(Number(slider.value)));

        // Initialise from the data attribute so the value survives a control
        // re-mount (e.g. when the map cell re-runs on a language change).
        if (mapContainer.dataset.overlayOpacity != null) {
          applyOpacity(Math.round(Number(mapContainer.dataset.overlayOpacity) * 100));
        }

        L.DomEvent.disableClickPropagation(container);
        L.DomEvent.disableScrollPropagation(container);
        return container;
      }
    });
    new OpacityControl({ position: "topleft" }).addTo(map);

    // Expose imperative map controls for bar chart clicks (toggles party filter)
    _mapCtrl.current = {
      currentPartyId: null,
      currentTurnoutMetric: _turnoutMetricCtrl.value ?? "final",
      currentLevel,
      currentSelectedUnitLevel: selection.level,
      currentSelectedUnit: selection.id,
      clearSelectedUnit,
      legendDiv: _legendCtrl.getContainer(),

      // Imperative language refresh — called from a separate lang-only cell in elections.md
      // so a language toggle does NOT invalidate the map cell (which would tear down Leaflet,
      // re-fetch tiles, and rebuild every layer). Only the legend is re-rendered here; tooltip
      // labels are refreshed for the next hover. Layer-bound static tooltips, button titles
      // and the level-control labels stay in whichever language was active at build time —
      // they catch up on the next election / vote-type switch.
      setLang(newLang, newT) {
        if (newLang === lang && newT === t) return;
        lang = newLang;
        t    = newT;
        tooltips.setLang(newLang, newT);
        if (this.legendDiv) this.legendDiv.innerHTML = buildLegendHTML(this.currentPartyId);
      },

      getShareState() {
        const center = map.getCenter();
        return {
          lat: center.lat,
          lng: center.lng,
          z: map.getZoom(),
          level: currentLevel,
          party: this.currentPartyId,
          unitLevel: this.currentSelectedUnitLevel,
          unit: this.currentSelectedUnit,
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

        // Visual feedback: highlight matching rows in bar chart, district/
        // precinct tables, and the seat legend so the user can always see
        // which party drives the map colouring (whether they arrived via a
        // ?party= link from /parties or clicked a row themselves).
        document.querySelectorAll(".bar-row[data-party-id]").forEach(row => {
          row.classList.toggle("bar-row-active", newId != null && row.dataset.partyId === newId);
        });
        document.querySelectorAll(".dist-table-row[data-party-id]").forEach(row => {
          row.classList.toggle("dist-table-row-active", newId != null && row.dataset.partyId === newId);
        });
        document.querySelectorAll(".seat-legend-row[data-party-id]").forEach(row => {
          row.classList.toggle("seat-legend-row-active", newId != null && row.dataset.partyId === newId);
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
          const pid       = precinctStationId(l.feature);
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
    restoreSelectedUnitFromUrl();
  }

  setTimeout(() => map.invalidateSize(), 150);
}
