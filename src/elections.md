---
theme: [air, alt, wide]
title: Elections
toc: false
---

```js
import L from "npm:leaflet";
import * as d3 from "npm:d3";
import {getLang, tr} from "./components/state.js";

// configs — YAML→JSON loaders in src/data/*.json.js
const dict     = await FileAttachment("data/config/translations.json").json();
const elections = await FileAttachment("data/elections.json").json();
const parties   = await FileAttachment("data/parties.json").json();
const lang      = getLang();
const t = k => tr(dict, lang, k);
```

```js
// ── DERIVED: election list for the type selector ──────────────────────────
const parlElections = elections.filter(e => e.type === "parliamentary");

const typeInput = Inputs.select(
  ["parliamentary", "presidential", "local", "adjara", "plebiscite"],
  { format: k => t(`type.${k}`) }
);
const typeVal = Generators.input(typeInput);
```

```js
// ── Election ID dropdown — filtered by type ───────────────────────────────
const filteredElections = elections.filter(e => e.type === typeVal);

const electionInput = Inputs.select(
  filteredElections,
  { format: e => e.name?.[lang] || e.name?.en || e.id,
    value: filteredElections[0] }
);
const electionVal = Generators.input(electionInput);
```

```js
// ── Sub-election dropdown (runoffs etc.) — only if present ────────────────
const subElections = electionVal?.sub_elections ?? [];
const hasSubElections = subElections.length > 0;

const subElectionInput = Inputs.select(
  [{id: "__main__", name: {en: "Main election", ka: "მთავარი"}}, ...subElections],
  { format: e => e.name?.[lang] || e.name?.en || e.id }
);
const subVal = Generators.input(subElectionInput);
```

```js
// ── Vote type toggle — derived from sub_type ─────────────────────────────
const subType  = electionVal?.sub_type ?? "pr";  // pr | mixed | messy
const hasSMD   = electionVal?.system?.smd?.enabled;
const hasComp  = electionVal?.system?.compensation?.enabled;

const voteTypeOptions = ["pr",
  ...(hasSMD  ? ["smd"]  : []),
  ...(hasComp ? ["compensation"] : [])
];

const voteTypeInput = Inputs.radio(voteTypeOptions, {
  value: "pr",
  format: k => ({
    pr:           t("elections.vote_type.party_list"),
    smd:          t("elections.vote_type.smd"),
    compensation: t("elections.vote_type.compensation")
  })[k]
});
const voteTypeVal = Generators.input(voteTypeInput);
```

```js
// ── Map mode ──────────────────────────────────────────────────────────────
const mapModeInput = Inputs.radio(["geographic", "cartogram"], {
  value: "geographic",
  format: k => k === "geographic" ? t("elections.mode.geo") : t("elections.mode.cart")
});
const mapMode = Generators.input(mapModeInput);
```

```js
// ── Map granularity (district vs precinct) ────────────────────────────────
const hasPrecinct = !!(
  voteTypeVal === "smd"          ? electionVal?.system?.smd?.precinct_shape_file
  : voteTypeVal === "compensation" ? electionVal?.system?.compensation?.precinct_shape_file
  : electionVal?.system?.pr?.precinct_shape_file
);

const mapLevelInput = Inputs.radio(["district", "precinct"], {
  value: "district",
  format: k => k === "district" ? t("elections.map_level.district") : t("elections.map_level.precinct")
});
const mapLevel = Generators.input(mapLevelInput);
```

```js
// ── View mode: Results vs Turnout ─────────────────────────────────────────
const hasTurnout = !!(electionVal?.turnout?.available);

const viewModeInput = Inputs.radio(["results", "turnout"], {
  value: "results",
  format: k => k === "results" ? t("elections.view_mode.results") : t("elections.view_mode.turnout")
});
const viewMode = Generators.input(viewModeInput);
```

```js
// ── Seat filter (combined / pr / smd) ─────────────────────────────────────
const seatFilterOptions = ["all",
  ...(hasSMD ? ["pr", "smd"] : [])
];
const seatFilterInput = Inputs.radio(seatFilterOptions, {
  value: "all",
  format: k => ({
    all: t("elections.seat_filter.all"),
    pr:  t("elections.seat_filter.pr"),
    smd: t("elections.seat_filter.smd")
  })[k]
});
const seatFilter = Generators.input(seatFilterInput);
```

```js
// ── Pre-load all known data files (Observable Framework requires static FileAttachment paths)
// Add new entries here as more elections are added.
const _allGeo = {
  "data/shp/parl2024_pr.geojson":                  await FileAttachment("data/shp/parl2024_pr.geojson").json(),
  "data/shp/parl2024_cartogram.geojson":            await FileAttachment("data/shp/parl2024_cartogram.geojson").json(),
  "data/shp/parl2024_pr_precincts.geojson":         await FileAttachment("data/shp/parl2024_pr_precincts.geojson").json(),
  "data/shp/parl2020_pr.geojson":                   await FileAttachment("data/shp/parl2020_pr.geojson").json(),
  "data/shp/parl2020_smd.geojson":                  await FileAttachment("data/shp/parl2020_smd.geojson").json(),
  "data/shp/parl2020_cartogram.geojson":            await FileAttachment("data/shp/parl2020_cartogram.geojson").json(),
};
const _allCsv = {
  "data/results/parl2024_pr.csv":              await FileAttachment("data/results/parl2024_pr.csv").csv({typed: true}),
  "data/results/parl2024_pr_precincts.csv":    await FileAttachment("data/results/parl2024_pr_precincts.csv").csv({typed: true}),
  "data/results/parl2020_pr.csv":              await FileAttachment("data/results/parl2020_pr.csv").csv({typed: true}),
  "data/results/parl2020_smd.csv":             await FileAttachment("data/results/parl2020_smd.csv").csv({typed: true}),
  "data/results/parl2020_smd_runoff.csv":      await FileAttachment("data/results/parl2020_smd_runoff.csv").csv({typed: true}),
  "data/results/parl2020_by_tbilisi.csv":      await FileAttachment("data/results/parl2020_by_tbilisi.csv").csv({typed: true}),
};

const _allTurnout = {
  "data/turnout/parl2024_turnout.csv":                  await FileAttachment("data/turnout/parl2024_turnout.csv").csv({typed: true}),
  "data/turnout/parl2024_pr_precincts_turnout.csv":     await FileAttachment("data/turnout/parl2024_pr_precincts_turnout.csv").csv({typed: true}),
  "data/turnout/parl2020_turnout.csv":                  await FileAttachment("data/turnout/parl2020_turnout.csv").csv({typed: true}),
};

function loadGeoJSON(elec, vt, level) {
  let path;
  if (level === "precinct") {
    const ppath = vt === "smd"          ? elec?.system?.smd?.precinct_shape_file
                : vt === "compensation" ? elec?.system?.compensation?.precinct_shape_file
                : elec?.system?.pr?.precinct_shape_file;
    path = ppath ?? (vt === "smd" ? elec?.system?.smd?.shape_file
                  : vt === "compensation" ? elec?.system?.compensation?.shape_file
                  : elec?.system?.pr?.shape_file);
  } else {
    path = vt === "smd"          ? elec?.system?.smd?.shape_file
         : vt === "compensation" ? elec?.system?.compensation?.shape_file
         : elec?.system?.pr?.shape_file;
  }
  return _allGeo[path] ?? null;
}

function loadResults(elec, vt, sub, level) {
  let path = null;
  if (sub?.id !== "__main__" && sub?.files?.smd_results) {
    path = sub.files.smd_results;
  } else if (level === "precinct") {
    path = vt === "smd"
      ? (elec?.files?.smd_precinct_results ?? elec?.files?.smd_results)
      : (elec?.files?.pr_precinct_results  ?? elec?.files?.pr_results);
  } else {
    path = vt === "smd"          ? elec?.files?.smd_results
         : vt === "compensation" ? elec?.files?.compensation_results
         : elec?.files?.pr_results;
  }
  return _allCsv[path] ?? [];
}

function loadTurnout(elec, level) {
  if (!elec?.turnout?.available) return [];
  const path = (level === "precinct" && elec.turnout.precinct_file)
    ? elec.turnout.precinct_file
    : elec.turnout.file;
  return _allTurnout[path] ?? [];
}

const geoData     = electionVal ? loadGeoJSON(electionVal, voteTypeVal, mapLevel) : null;
const cartData    = _allGeo[electionVal?.files?.cartogram] ?? null;
const results     = electionVal ? loadResults(electionVal, voteTypeVal, subVal, mapLevel) : [];
const turnoutData = electionVal ? loadTurnout(electionVal, mapLevel) : [];
```

```js
// ── Party lookup helper ────────────────────────────────────────────────────
function getParty(partyId) {
  return parties.find(p => p.id === partyId) ?? {
    id: partyId,
    name: {en: partyId, ka: partyId},
    colors: {default: "#9E9E9E"}
  };
}

function partyColor(partyId, elecId) {
  const p = getParty(partyId);
  return p.colors?.[elecId] ?? p.colors?.default ?? "#9E9E9E";
}

// National aggregates per party
const nationalResults = d3.rollup(
  results,
  rows => ({
    votes:      d3.sum(rows, r => r.votes),
    vote_share: d3.mean(rows, r => r.vote_share),
    seats_pr:   rows[0]?.seats_pr  ?? 0,
    seats_smd:  rows[0]?.seats_smd ?? 0,
    seats_comp: rows[0]?.seats_comp ?? 0,
    threshold_status: rows[0]?.threshold_status ?? "notrun"
  }),
  d => d.party_id
);

const nationalArray = Array.from(nationalResults, ([party_id, v]) => ({
  party_id, ...v,
  party: getParty(party_id),
  color: partyColor(party_id, electionVal?.id)
})).sort((a, b) => b.vote_share - a.vote_share);

// "notrun" = no threshold applies (SMD / by-elections) — show all parties without break
const hasThreshold = nationalArray.some(d => d.threshold_status === "passed" || d.threshold_status === "failed");
const passed = hasThreshold
  ? nationalArray.filter(d => d.threshold_status === "passed")
  : nationalArray;
const failed = hasThreshold
  ? nationalArray.filter(d => d.threshold_status === "failed")
  : [];
```

```js
// ── Turnout by district/precinct lookup (top-level so renderTurnoutPanel can access it) ──
const turnoutByDistrict = new Map();
if (turnoutData.length > 0) {
  const relevantRows = turnoutData.filter(r =>
    !r.vote_type || r.vote_type === voteTypeVal || r.vote_type === "pr"
  );
  d3.group(relevantRows, r => r.district_id).forEach((rows, did) => {
    turnoutByDistrict.set(did, rows[0]);
  });
}
```

```js
// District panel is updated imperatively (DOM manipulation in map click handlers).
// No reactive Mutable needed — avoids re-rendering the container/map on each click.
void 0;
```

```js
// Standalone map div — no reactive deps, so created once and reused across container re-renders.
// Embedding it as ${mapContainer} in the layout moves (not copies) this node, preserving the map.
const mapContainer = html`<div style="width:100%;height:100%;z-index:0;"></div>`;
```

```js
// ════════════════════════════════════════════════════════════
// LAYOUT
// ════════════════════════════════════════════════════════════
// Explicit reactive deps — ensures container re-renders when any of these change
hasTurnout; hasPrecinct; viewMode; mapLevel; voteTypeOptions; seatFilterOptions; hasSubElections;

const container = html`
<style>
  .elections-outer {
    display: grid;
    grid-template-columns: 220px 1fr;
    gap: 1rem;
    align-items: start;
  }
  .elections-main {
    display: grid;
    grid-template-columns: 1fr 300px;
    gap: 1rem;
    align-items: start;
  }
  .elections-bottom {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 1rem;
    align-items: start;
  }
  .results-panel { min-height: 200px; }
  @media (max-width: 900px) {
    .elections-outer  { grid-template-columns: 1fr; }
    .elections-main   { grid-template-columns: 1fr; }
    .elections-bottom { grid-template-columns: 1fr; }
  }

  /* Filter panel */
  .filter-panel { --input-width: 186px; overflow: hidden; }
  .filter-label {
    font-size: 0.72rem; color: var(--muted);
    text-transform: uppercase; letter-spacing: 0.05em;
    font-weight: 700; margin-bottom: 4px;
  }
  .filter-item { margin-bottom: 1rem; }

  /* Modern select styling */
  .filter-panel select {
    appearance: none;
    -webkit-appearance: none;
    width: 100%;
    padding: 7px 30px 7px 10px;
    font-size: 0.82rem;
    font-family: inherit;
    color: var(--theme-foreground, #1a1a1a);
    background-color: var(--theme-background, #fff);
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='%23888' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E");
    background-repeat: no-repeat;
    background-position: right 9px center;
    border: 1.5px solid var(--border, #ddd);
    border-radius: 8px;
    cursor: pointer;
    transition: border-color 0.15s ease, box-shadow 0.15s ease;
    box-shadow: 0 1px 2px rgba(0,0,0,0.04);
  }
  .filter-panel select:hover {
    border-color: #aaa;
    box-shadow: 0 1px 4px rgba(0,0,0,0.08);
  }
  .filter-panel select:focus {
    outline: none;
    border-color: #6b9bd2;
    box-shadow: 0 0 0 3px rgba(107,155,210,0.18);
  }

  /* Bar chart */
  .bar-row { display: flex; align-items: flex-start; gap: 8px; margin-bottom: 6px; font-size: 0.82rem; }
  .bar-label { width: 140px; white-space: normal; line-height: 1.3; flex-shrink: 0; }
  .bar-track { flex: 1; background: var(--border); border-radius: 2px; height: 14px; position: relative; margin-top: 2px; }
  .bar-fill  { height: 100%; border-radius: 2px; transition: width 0.3s; }
  .bar-value { width: 80px; text-align: right; flex-shrink: 0; display: flex; flex-direction: column; align-items: flex-end; line-height: 1.25; margin-top: 1px; }
  .bar-value-main { font-size: 0.78rem; color: var(--muted); }
  .bar-value-sub  { font-size: 0.70rem; color: var(--muted); opacity: 0.7; }
  /* Threshold section header */
  .threshold-row { margin: 8px 0 !important; align-items: center !important; }
  .threshold-label {
    font-style: italic; text-transform: uppercase;
    font-size: 0.70rem; color: var(--muted); white-space: nowrap;
  }
  .threshold-track {
    height: 1px !important;
    background: none !important;
    border-top: 2px dashed #bbb;
    margin-top: 0 !important;
  }

  /* District results table */
  .dist-table { width: 100%; border-collapse: collapse; font-size: 0.82rem; }
  .dist-table th { color: var(--muted); font-weight: 700; font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.04em; border-bottom: 2px solid var(--border); padding: 4px 6px; text-align: left; }
  .dist-table td { padding: 5px 6px; border-bottom: 1px solid var(--border); }
  .dist-table tr:last-child td { border-bottom: none; }
  .party-dot { width: 10px; height: 10px; border-radius: 50%; display: inline-block; margin-right: 5px; flex-shrink: 0; }

  /* Seat tiles — rectangles grouped by party */
  .seat-block { display: flex; flex-wrap: wrap; gap: 2px; }
  .seat-tile  { width: 9px; height: 9px; border-radius: 1px; }
</style>

<div class="elections-outer">

  <!-- LEFT: FILTER PANEL -->
  <div class="card filter-panel" style="align-self: start; padding: 1rem;">

    <div class="filter-item">
      <div class="filter-label">${t("elections.type")}</div>
      ${typeInput}
    </div>
    <div class="filter-item">
      <div class="filter-label">${t("elections.choice")}</div>
      ${electionInput}
    </div>
    ${hasSubElections ? html`
    <div class="filter-item">
      <div class="filter-label">${t("elections.sub_election")}</div>
      ${subElectionInput}
    </div>` : ""}
    ${voteTypeOptions.length > 1 ? html`
    <div class="filter-item">
      <div class="filter-label">${t("elections.vote_type")}</div>
      ${voteTypeInput}
    </div>` : ""}

    <hr>
    ${hasTurnout ? html`<div class="filter-item">
      <div class="filter-label">${t("elections.view_mode")}</div>
      ${viewModeInput}
    </div>` : ""}
    <div class="filter-item">
      <div class="filter-label">${t("elections.map_mode")}</div>
      ${mapModeInput}
    </div>
    ${hasPrecinct ? html`<div class="filter-item">
      <div class="filter-label">${t("elections.map_level")}</div>
      ${mapLevelInput}
    </div>` : ""}
    ${seatFilterOptions.length > 1 ? html`
    <div class="filter-item">
      <div class="filter-label">${t("elections.seat_filter")}</div>
      ${seatFilterInput}
    </div>` : ""}
  </div>

  <!-- RIGHT: MAP + RESULTS PANEL + CHARTS -->
  <div>

    <!-- MAP + DISTRICT RESULTS side by side -->
    <div class="elections-main" style="margin-bottom: 1rem;">

      <!-- MAP — mapContainer is a stable node embedded here so Leaflet survives re-renders -->
      <div class="card" style="padding: 0; height: 380px; overflow: hidden; position: relative;">
        ${mapContainer}
        <div style="position: absolute; bottom: 8px; left: 8px; background: white; border: 1px solid var(--border); border-radius: var(--radius); padding: 4px 10px; font-size: 0.75rem; color: var(--muted); z-index: 500; pointer-events: none;">
          ${t("elections.map.click_hint")}
        </div>
      </div>

      <!-- DISTRICT RESULTS PANEL — updated by map click via renderDistrictPanel() -->
      <div class="card results-panel" id="results-panel">
        <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; min-height: 180px; color: var(--muted); text-align: center; gap: 0.5rem;">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7"/>
          </svg>
          <span style="font-size: 0.85rem;">${t("elections.map.click_hint")}</span>
        </div>
      </div>

    </div>

    ${viewMode === "turnout" ? html`
    <!-- TURNOUT BOTTOM: national summary + vote type breakdown -->
    <div class="elections-bottom">
      <div class="card">
        <h4 style="margin-top:0; font-size:0.85rem;">${t("elections.turnout.title")}</h4>
        ${renderTurnoutSummary(turnoutData, electionVal)}
      </div>
      <div class="card">
        <h4 style="margin-top:0; font-size:0.85rem;">${t("elections.legislature_title")}</h4>
        ${renderDots(nationalArray, seatFilter, electionVal)}
        ${renderSeatLegend(nationalArray, seatFilter, electionVal)}
      </div>
    </div>
    ` : html`
    <!-- RESULTS BOTTOM: bar chart + seat composition -->
    <div class="elections-bottom">

      <!-- BAR CHART -->
      <div class="card">
        <h4 style="margin-top: 0; font-size: 0.85rem;">${t("elections.party_list_title")}</h4>
        ${renderBarChart(passed, failed, electionVal?.id)}
      </div>

      <!-- SEAT COMPOSITION (grouped rectangle tiles) -->
      <div class="card">
        <h4 style="margin-top: 0; font-size: 0.85rem;">${t("elections.legislature_title")}</h4>
        ${renderDots(nationalArray, seatFilter, electionVal)}
        ${renderSeatLegend(nationalArray, seatFilter, electionVal)}
      </div>

    </div>
    `}

  </div>
</div>
`;

display(container);
```

```js
// ── MAP ────────────────────────────────────────────────────────────────────
(async () => {
  // Declare reactive deps — this cell re-runs when any of these change
  electionVal; voteTypeVal; mapMode; mapLevel; viewMode; lang; geoData; cartData; results; turnoutData; turnoutByDistrict;

  // Clean up previous Leaflet instance before this cell re-runs
  invalidation.then(() => { try { map.remove(); } catch(e) {} });

  const map = L.map(mapContainer, {zoomControl: true}).setView([41.9, 43.5], 7);

  L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
    subdomains: 'abcd', maxZoom: 19
  }).addTo(map);

  const activeGeo = mapMode === "cartogram" ? cartData : geoData;
  if (!activeGeo) {
    setTimeout(() => map.invalidateSize(), 150);
    return;
  }

  // Build district → winner lookup
  const winnerByDistrict = new Map();
  const shareByDistrict  = new Map();
  d3.group(results, r => r.district_id).forEach((rows, distId) => {
    const winner = rows.reduce((a, b) => (b.vote_share > a.vote_share ? b : a));
    winnerByDistrict.set(distId, winner);
    const maxShare = d3.max(rows, r => r.vote_share);
    shareByDistrict.set(distId, maxShare);
  });

  function districtStyle(feature) {
    const did = feature.properties.id;
    if (viewMode === "turnout") {
      const td = turnoutByDistrict.get(did);
      if (!td) return {fillColor: "#e0e0e0", fillOpacity: 0.5, color: "#fff", weight: 1};
      const intensity = td.turnout_pct ?? 0;
      const fillColor = d3.interpolateRgb("#dbeafe", "#1d4ed8")(intensity);
      return {fillColor, fillOpacity: 0.85, color: "#ffffff", weight: 1.5};
    }
    const winner = winnerByDistrict.get(did);
    if (!winner) return {fillColor: "#e0e0e0", fillOpacity: 0.5, color: "#fff", weight: 1};
    const baseColor = partyColor(winner.party_id, electionVal?.id);
    const intensity = shareByDistrict.get(did) ?? 0.5;
    const lightened = d3.color(baseColor) ? d3.interpolateRgb("#f5f5f5", baseColor)(0.4 + intensity * 0.6) : "#ccc";
    return {fillColor: lightened, fillOpacity: 0.85, color: "#ffffff", weight: 1.5};
  }

  if (mapMode === "cartogram" && activeGeo.features[0]?.geometry?.type === "Point") {
    // Render as proportional circles
    activeGeo.features.forEach(f => {
      const did  = f.properties.id;
      const winner = winnerByDistrict.get(did);
      let fillColor;
      if (viewMode === "turnout") {
        const td = turnoutByDistrict.get(did);
        const intensity = td?.turnout_pct ?? 0;
        fillColor = d3.interpolateRgb("#dbeafe", "#1d4ed8")(intensity);
      } else {
        const color = winner ? partyColor(winner.party_id, electionVal?.id) : "#ccc";
        const intensity = shareByDistrict.get(did) ?? 0.5;
        fillColor = d3.interpolateRgb("#f5f5f5", color)(0.4 + intensity * 0.6);
      }
      const radius = (f.properties.radius_km ?? 10) * 1000; // metres

      const circle = L.circle(
        [f.geometry.coordinates[1], f.geometry.coordinates[0]],
        {
          radius,
          fillColor,
          fillOpacity: 0.85,
          color: "#fff",
          weight: 1.5
        }
      ).addTo(map);

      circle.on("click", () => {
        const panel = document.getElementById("results-panel");
        if (panel) panel.replaceWith(viewMode === "turnout"
          ? renderTurnoutPanel(did, f.properties)
          : renderDistrictPanel(did, f.properties));
      });

      circle.bindTooltip(
        `<strong>${lang === "ka" ? f.properties.name_ka : f.properties.name_en}</strong>`,
        {sticky: true, className: "leaflet-tooltip"}
      );
    });

  } else {
    // Choropleth polygons
    L.geoJSON(activeGeo, {
      style: districtStyle,
      onEachFeature(feature, layer) {
        const did = feature.properties.id;
        layer.on("click", () => {
          const panel = document.getElementById("results-panel");
          if (panel) panel.replaceWith(viewMode === "turnout"
            ? renderTurnoutPanel(did, feature.properties)
            : renderDistrictPanel(did, feature.properties));
        });
        layer.bindTooltip(
          `<strong>${lang === "ka" ? feature.properties.name_ka : feature.properties.name_en}</strong>`,
          {sticky: true}
        );
      }
    }).addTo(map);
  }

  setTimeout(() => map.invalidateSize(), 150);
})();
```

```js
// ── CHART RENDERERS ────────────────────────────────────────────────────────

function renderBarChart(passed, failed, elecId) {
  const maxVal = d3.max([...passed, ...failed], d => d.vote_share) || 1;

  function barRow(d) {
    const pct      = (d.vote_share / maxVal) * 100;
    const shareStr = `${(d.vote_share * 100).toFixed(1)}%`;
    const countStr = d.votes != null ? d.votes.toLocaleString() : "—";
    const pname = d.party?.name?.[lang] || d.party_id;
    return html`
      <div class="bar-row">
        <div class="bar-label" title="${pname}">
          <span class="party-dot" style="background:${d.color};"></span>${pname}
        </div>
        <div class="bar-track">
          <div class="bar-fill" style="width:${pct}%; background:${d.color};"></div>
        </div>
        <div class="bar-value">
          <span class="bar-value-main">${shareStr}</span>
          <span class="bar-value-sub">${countStr}</span>
        </div>
      </div>
    `;
  }

  return html`
    ${passed.map(barRow)}
    ${failed.length > 0 ? html`
      <div class="bar-row threshold-row">
        <div class="bar-label threshold-label">${t("elections.chart.threshold_line")}</div>
        <div class="bar-track threshold-track"></div>
        <div class="bar-value"></div>
      </div>
      ${failed.map(barRow)}
    ` : ""}
  `;
}

// ── Seat composition — rectangular tiles grouped by party ─────────────────
function renderDots(parties, filter, elec) {
  const all = partiesForFilter(parties, filter, elec);
  const total = d3.sum(all, d => seatsFor(d, filter));
  if (total === 0) return html`<p style="color:var(--muted); font-size:0.85rem; text-align:center;">No seat data</p>`;

  // Aim for ~10 tiles per row within each party block
  const COLS = 10;
  return html`<div style="display:flex; flex-wrap:wrap; align-items:flex-start; gap:6px; padding:0.4rem 0;">
    ${all.map(d => {
      const seats = seatsFor(d, filter);
      if (seats === 0) return "";
      const cols = Math.min(seats, COLS);
      const pname = d.party?.name?.[lang] || d.party_id;
      return html`<div class="seat-block" style="width:${cols * 11}px;" title="${pname}: ${seats} ${t('elections.seats_label')}">
        ${Array.from({length: seats}, () =>
          html`<div class="seat-tile" style="background:${d.color};"></div>`
        )}
      </div>`;
    })}
  </div>`;
}

// ── Legend ───────────────────────────────────────────────────────────────
function renderSeatLegend(parties, filter, elec) {
  const subset = partiesForFilter(parties, filter, elec);
  return html`<div style="display:flex; flex-wrap:wrap; gap:0.75rem 1.25rem; margin-top:0.75rem;">
    ${subset.map(d => {
      const seats = seatsFor(d, filter);
      const pname = d.party?.name?.[lang] || d.party_id;
      return html`<div style="display:flex; align-items:center; gap:5px; font-size:0.8rem;">
        <span style="width:10px;height:10px;border-radius:2px;background:${d.color};display:inline-block;flex-shrink:0;"></span>
        <span style="color:var(--muted);">${pname}</span>
        <strong style="color:var(--dark);">${seats}</strong>
      </div>`;
    })}
  </div>`;
}

// ── District results panel ────────────────────────────────────────────────
function renderDistrictPanel(distId, props) {
  const rows = results.filter(r => r.district_id === distId)
                      .sort((a, b) => b.vote_share - a.vote_share);
  const pname = lang === "ka" ? props.name_ka : props.name_en || distId;
  const panel = html`<div class="card results-panel" id="results-panel">
    <h4 style="margin-top:0; font-size:0.9rem;">${pname}</h4>
    <table class="dist-table">
      <thead><tr>
        <th>${t("elections.results.party")}</th>
        <th style="text-align:right;">${t("elections.results.share")}</th>
      </tr></thead>
      <tbody>
        ${rows.map(r => {
          const color    = partyColor(r.party_id, electionVal?.id);
          const shareStr = `${(r.vote_share * 100).toFixed(1)}%`;
          const countStr = r.votes != null ? r.votes.toLocaleString() : "—";
          return html`<tr>
            <td><span class="party-dot" style="background:${color};"></span>${getParty(r.party_id).name?.[lang] || r.party_id}${r.threshold_status === "failed" ? html`<span style="color:var(--muted);font-size:0.72rem;"> ✗</span>` : ""}</td>
            <td style="text-align:right; white-space:nowrap;">
              <span style="font-weight:700;">${shareStr}</span>
              <span style="color:var(--muted); font-size:0.75rem; margin-left:4px;">(${countStr})</span>
            </td>
          </tr>`;
        })}
      </tbody>
    </table>
  </div>`;
  return panel;
}

// ── Turnout panel ─────────────────────────────────────────────────────────
function renderTurnoutPanel(distId, props) {
  const pname = lang === "ka" ? props.name_ka : props.name_en || distId;
  const td = turnoutByDistrict.get(distId);
  const turnoutCfg = electionVal?.turnout ?? {};

  if (!td) {
    return html`<div class="card results-panel" id="results-panel">
      <h4 style="margin-top:0; font-size:0.9rem;">${pname}</h4>
      <p style="color:var(--muted); font-size:0.85rem;">${t("elections.turnout.no_data")}</p>
    </div>`;
  }

  const pct = td.turnout_pct != null ? `${(td.turnout_pct * 100).toFixed(1)}%` : "—";
  const voted = td.voted != null ? td.voted.toLocaleString() : "—";
  const registered = td.registered != null ? td.registered.toLocaleString() : "—";

  function statRow(label, value, sub) {
    return html`<div style="display:flex; justify-content:space-between; align-items:baseline; padding:5px 0; border-bottom:1px solid var(--border); font-size:0.82rem;">
      <span style="color:var(--muted);">${label}</span>
      <span style="font-weight:700;">${value}${sub ? html`<span style="font-weight:400; color:var(--muted); font-size:0.75rem; margin-left:4px;">${sub}</span>` : ""}</span>
    </div>`;
  }

  return html`<div class="card results-panel" id="results-panel">
    <h4 style="margin-top:0; font-size:0.9rem;">${pname}</h4>
    ${statRow(t("elections.turnout.pct"), pct)}
    ${statRow(t("elections.turnout.voted"), voted)}
    ${statRow(t("elections.turnout.registered"), registered)}
    ${turnoutCfg.has_snapshots && td.voted_noon != null ? statRow(t("elections.turnout.noon"), td.voted_noon.toLocaleString(), `(${(td.voted_noon/td.voted*100).toFixed(0)}%)`) : ""}
    ${turnoutCfg.has_snapshots && td.voted_5pm != null ? statRow(t("elections.turnout.5pm"), td.voted_5pm.toLocaleString(), `(${(td.voted_5pm/td.voted*100).toFixed(0)}%)`) : ""}
    ${turnoutCfg.has_lists && td.main_list != null ? statRow(t("elections.turnout.main_list"), td.main_list.toLocaleString()) : ""}
    ${turnoutCfg.has_lists && td.special_list != null ? statRow(t("elections.turnout.special_list"), td.special_list.toLocaleString()) : ""}
  </div>`;
}

// ── Turnout summary ───────────────────────────────────────────────────────
function renderTurnoutSummary(data, elec) {
  if (!data || data.length === 0) {
    return html`<p style="color:var(--muted); font-size:0.85rem;">${t("elections.turnout.no_data")}</p>`;
  }
  const turnoutCfg = elec?.turnout ?? {};
  // National row(s)
  const nationalRows = data.filter(r => r.district_id === "national");
  if (nationalRows.length === 0) return html`<p style="color:var(--muted);">—</p>`;

  function voteTypeLabel(vt) {
    if (!vt) return "";
    return vt === "smd" ? t("elections.turnout.smd") : t("elections.turnout.pr");
  }

  return html`<div>
    ${nationalRows.map(row => html`
      <div style="margin-bottom:1rem;">
        ${nationalRows.length > 1 ? html`<div style="font-size:0.75rem; font-weight:700; text-transform:uppercase; color:var(--muted); margin-bottom:6px;">${voteTypeLabel(row.vote_type)}</div>` : ""}
        <div style="display:flex; gap:1.5rem; flex-wrap:wrap; margin-bottom:0.75rem;">
          <div style="text-align:center;">
            <div style="font-size:1.6rem; font-weight:800; color:var(--theme-foreground);">${row.turnout_pct != null ? `${(row.turnout_pct*100).toFixed(1)}%` : "—"}</div>
            <div style="font-size:0.72rem; color:var(--muted); text-transform:uppercase;">${t("elections.turnout.pct")}</div>
          </div>
          <div style="text-align:center;">
            <div style="font-size:1.1rem; font-weight:700;">${row.voted != null ? row.voted.toLocaleString() : "—"}</div>
            <div style="font-size:0.72rem; color:var(--muted); text-transform:uppercase;">${t("elections.turnout.voted")}</div>
          </div>
          <div style="text-align:center;">
            <div style="font-size:1.1rem; font-weight:700; color:var(--muted);">${row.registered != null ? row.registered.toLocaleString() : "—"}</div>
            <div style="font-size:0.72rem; color:var(--muted); text-transform:uppercase;">${t("elections.turnout.registered")}</div>
          </div>
        </div>
        ${turnoutCfg.has_snapshots && row.voted_noon != null ? html`
          <div style="font-size:0.78rem; color:var(--muted); margin-bottom:4px;">
            ${t("elections.turnout.noon")}: <strong>${row.voted_noon.toLocaleString()}</strong>
            &nbsp;·&nbsp;
            ${t("elections.turnout.5pm")}: <strong>${row.voted_5pm.toLocaleString()}</strong>
          </div>` : ""}
        ${turnoutCfg.has_lists && row.main_list != null ? html`
          <div style="font-size:0.78rem; color:var(--muted);">
            ${t("elections.turnout.main_list")}: <strong>${row.main_list.toLocaleString()}</strong>
            &nbsp;·&nbsp;
            ${t("elections.turnout.special_list")}: <strong>${row.special_list.toLocaleString()}</strong>
          </div>` : ""}
      </div>
    `)}
  </div>`;
}

// ── Seat helpers ──────────────────────────────────────────────────────────
function seatsFor(d, filter) {
  if (filter === "pr")  return d.seats_pr  ?? 0;
  if (filter === "smd") return d.seats_smd ?? 0;
  return (d.seats_pr ?? 0) + (d.seats_smd ?? 0) + (d.seats_comp ?? 0);
}

function partiesForFilter(parties, filter, elec) {
  return parties.filter(d => seatsFor(d, filter) > 0);
}
```
