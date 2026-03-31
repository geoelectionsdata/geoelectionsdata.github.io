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
const filteredElections = elections
  .filter(e => e.type === typeVal)
  .sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));

const electionInput = Inputs.select(
  filteredElections,
  { format: e => e.name?.[lang] || e.name?.en || e.id,
    value: filteredElections[0] }
);
const electionVal = Generators.input(electionInput);
```

```js
// ── Ballot type toggle — local elections only: Mayor vs Sakrebulo ─────────
const isLocal    = electionVal?.type === "local";
const hasCouncil = isLocal && !!(electionVal?.files?.council_pr_results);

const ballotTypeInput = Inputs.radio(
  hasCouncil ? ["mayor", "council"] : ["mayor"],
  { value: "mayor",
    format: k => k === "mayor" ? t("elections.local.mayor") : t("elections.local.council") }
);
const ballotTypeVal = Generators.input(ballotTypeInput);
```

```js
// ── Sub-election dropdown (runoffs etc.) — only if present ────────────────
const isPlebisciteEarly = electionVal?.type === "plebiscite"; // early flag for sub-election setup
const subElections = isPlebisciteEarly
  ? (electionVal?.questions ?? [])
  : (electionVal?.sub_elections ?? []);
const hasSubElections = subElections.length > 0;

// Plebiscite: questions only (no __main__ option), always start at first question
const subElectionItems = isPlebisciteEarly
  ? subElections
  : [{id: "__main__", name: {en: "Main election", ka: "მთავარი"}}, ...subElections];
// Local elections: rounds shown as a radio below the HR — use radio input
// Other elections (parliament, plebiscite): keep dropdown in top section
const subElectionInput = (isLocal && hasSubElections)
  ? Inputs.radio(subElectionItems, {
      value: subElectionItems[0],
      format: (item, idx) => idx === 0
        ? t("elections.local.round1")
        : t("elections.local.round2")
    })
  : Inputs.select(subElectionItems, {
      format: e => e.name?.[lang] || e.name?.en || e.id
    });
const subVal = Generators.input(subElectionInput);
```

```js
// ── Vote type toggle — derived from sub_type ─────────────────────────────
const subType  = electionVal?.sub_type ?? "pr";  // pr | mixed | messy
const hasPR    = electionVal?.system?.pr?.enabled !== false;
const hasSMD   = electionVal?.system?.smd?.enabled;
const hasComp  = electionVal?.system?.compensation?.enabled;

const voteTypeOptions = [
  ...(hasPR   ? ["pr"]           : []),
  ...(hasSMD  ? ["smd"]          : []),
  ...(hasComp ? ["compensation"] : [])
];

const voteTypeInput = Inputs.radio(voteTypeOptions, {
  value: voteTypeOptions[0] ?? "pr",
  format: k => ({
    pr:           t("elections.vote_type.party_list"),
    smd:          t("elections.vote_type.smd"),
    compensation: t("elections.vote_type.compensation")
  })[k]
});
const voteTypeVal = Generators.input(voteTypeInput);
```

```js
// ── Election type flags ───────────────────────────────────────────────────
const isPresidential  = electionVal?.type === "presidential";
const isIndirect      = isPresidential && electionVal?.sub_type === "indirect";
const isPlebiscite    = electionVal?.type === "plebiscite";
const isCouncilMode   = isLocal && ballotTypeVal === "council";

// Runoffs/by-elections in parliamentary elections are always SMD — force "smd" and hide the toggle
const isSubElectionSMD = !isPresidential && !isPlebiscite &&
  subVal?.id !== "__main__" &&
  (subVal?.type === "runoff" || subVal?.type === "by_election");
const effectiveVoteType = isSubElectionSMD ? "smd" : voteTypeVal;
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
// ── Map granularity (district / council-district / precinct) ─────────────
const hasPrecinct = !!(
  effectiveVoteType === "smd"          ? electionVal?.system?.smd?.precinct_shape_file
  : effectiveVoteType === "compensation" ? electionVal?.system?.compensation?.precinct_shape_file
  : electionVal?.system?.pr?.precinct_shape_file
);
// Council mode only: intermediate sakrebulo-district layer
const hasCouncilDistricts = isCouncilMode && !!(electionVal?.council?.shape_file);

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
  ...(hasPR && hasSMD || (isLocal && ballotTypeVal === "council") ? ["pr", "smd"] : [])
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
// Data registries — auto-assembled from election YAMLs by data loaders.
// To add a new election: create the YAML + data files, then restart dev server. No changes needed here.
const _allGeo     = await FileAttachment("data/geo-registry.json").json();
const _allCsv     = await FileAttachment("data/csv-registry.json").json();
const _allTurnout = await FileAttachment("data/turnout-registry.json").json();

function lookupCSV(dataMap, path) {
  return dataMap?.[path] ?? [];
}

function loadGeoJSON(elec, vt, level) {
  let path;
  if (level === "council_district") {
    path = elec?.council?.shape_file;
  } else if (level === "precinct") {
    const ppath = vt === "smd"          ? elec?.system?.smd?.precinct_shape_file
                : vt === "compensation" ? elec?.system?.compensation?.precinct_shape_file
                : elec?.system?.pr?.precinct_shape_file;
    path = ppath ?? (vt === "smd" ? elec?.system?.smd?.shape_file
                  : vt === "compensation" ? elec?.system?.compensation?.shape_file
                  : elec?.system?.pr?.shape_file);
  } else {
    path = vt === "smd"          ? elec?.system?.smd?.shape_file
         : vt === "compensation" ? elec?.system?.compensation?.shape_file
         : (elec?.system?.pr?.shape_file ?? elec?.system?.smd?.shape_file); // fallback for PR-disabled elections
  }
  return _allGeo[path] ?? null;
}

function loadResults(elec, vt, sub, level, ballotType) {
  // Council ballot type: load council-specific files (ignores sub-elections)
  if (ballotType === "council") {
    if (level === "council_district") {
      const path = vt === "smd"
        ? (elec?.files?.council_smd_precinct_results ?? elec?.files?.council_smd_results)
        : (elec?.files?.council_pr_precinct_results  ?? elec?.files?.council_pr_results);
      return lookupCSV(_allCsv,path);
    }
    const path = vt === "smd"
      ? elec?.files?.council_smd_results
      : elec?.files?.council_pr_results;
    return lookupCSV(_allCsv,path);
  }
  const isSubActive = sub?.id !== "__main__";
  if (isSubActive) {
    if (level === "precinct") {
      const subPrecinct = sub?.files?.smd_precinct_results ?? sub?.files?.pr_precinct_results;
      if (subPrecinct) return lookupCSV(_allCsv,subPrecinct);
    }
    const subPath = sub?.files?.smd_results ?? sub?.files?.pr_results ?? sub?.files?.results;
    if (subPath) return lookupCSV(_allCsv,subPath);
  }
  if (level === "precinct") {
    const path = vt === "smd"
      ? (elec?.files?.smd_precinct_results ?? elec?.files?.smd_results)
      : (elec?.files?.pr_precinct_results  ?? elec?.files?.pr_results);
    return lookupCSV(_allCsv,path);
  }
  const path = vt === "smd"          ? elec?.files?.smd_results
             : vt === "compensation" ? elec?.files?.compensation_results
             : elec?.files?.pr_results;
  return lookupCSV(_allCsv,path);
}

function loadTurnout(elec, level) {
  if (!elec?.turnout?.available) return [];
  const path = (level === "precinct" && elec.turnout.precinct_file)
    ? elec.turnout.precinct_file
    : elec.turnout.file;
  return lookupCSV(_allTurnout,path);
}

// For local council mode, always use SMD shapefile (PR shapefile is null for local elections)
const _geoVt = (isLocal && ballotTypeVal === "council") ? "smd" : effectiveVoteType;
const geoData  = electionVal ? loadGeoJSON(electionVal, _geoVt, "district") : null;
const cartData = _allGeo[electionVal?.files?.cartogram] ?? null;

// All CSV data is pre-loaded in the registries — lookups are synchronous
const results              = electionVal ? loadResults(electionVal, effectiveVoteType, subVal, "district", ballotTypeVal)         : [];
const turnoutData          = electionVal ? loadTurnout(electionVal, "district")                                                   : [];
// Council-district intermediate layer (sakrebulo districts, council mode only)
const councilDistrictGeoData = (electionVal && hasCouncilDistricts) ? loadGeoJSON(electionVal, _geoVt, "council_district") : null;
const councilDistrictResults = (electionVal && hasCouncilDistricts) ? loadResults(electionVal, effectiveVoteType, subVal, "council_district", ballotTypeVal) : [];
// Precinct layer
const precinctGeoData  = (electionVal && hasPrecinct) ? loadGeoJSON(electionVal, effectiveVoteType, "precinct") : null;
const precinctResults  = (electionVal && hasPrecinct) ? loadResults(electionVal, effectiveVoteType, subVal, "precinct", ballotTypeVal)                 : [];
const precinctTurnout  = (electionVal && hasPrecinct) ? loadTurnout(electionVal, "precinct")                                                          : [];
```

```js
// ── Party lookup helper ────────────────────────────────────────────────────
function getParty(partyId) {
  // For presidential elections, candidates are defined on the election itself
  const candidate = electionVal?.candidates?.find(c => c.id === partyId);
  if (candidate) {
    const partyRef = candidate.party ? parties.find(p => p.id === candidate.party) : null;
    const color = candidate.color ?? partyRef?.color ?? partyRef?.colors?.default ?? "#9E9E9E";
    return {id: partyId, name: candidate.name, color, colors: {default: color}};
  }
  const base = parties.find(p => p.id === partyId) ?? {
    id: partyId, name: {en: partyId, ka: partyId}, color: "#9E9E9E"
  };
  // Apply election-specific alias and color override from election YAML
  const elecParty = electionVal?.parties?.find(p => p.id === partyId);
  if (elecParty?.alias || elecParty?.color) {
    return {
      ...base,
      name:  elecParty.alias ?? base.name,
      color: elecParty.color ?? base.color ?? base.colors?.default
    };
  }
  return base;
}

function partyColor(partyId, elecId) {
  const p = getParty(partyId);
  // Support both new single-field (color) and legacy per-election dict (colors)
  return p.color ?? p.colors?.[elecId] ?? p.colors?.default ?? "#9E9E9E";
}

// ── Election YAML party metadata (threshold_status, alias, color) ──────────
const elecPartyMeta = new Map(
  (electionVal?.parties ?? []).map(p => [p.id, p])
);

// ── D'Hondt seat allocation ────────────────────────────────────────────────
function dhondtSeats(votesMap, totalSeats) {
  if (!totalSeats || votesMap.size === 0) return new Map();
  const qs = [];
  for (const [id, votes] of votesMap) {
    for (let s = 1; s <= totalSeats; s++) qs.push({id, q: votes / s});
  }
  qs.sort((a, b) => b.q - a.q);
  const seats = new Map();
  for (const {id} of qs.slice(0, totalSeats)) seats.set(id, (seats.get(id) ?? 0) + 1);
  return seats;
}

// Separate national summary rows (district_id="national") from district rows
// New combined CSV format includes "national" rows with accurate national vote totals.
const _nationalRows  = results.filter(r => String(r.district_id) === "national");
const _districtRows  = results.filter(r => String(r.district_id) !== "national");
const _hasNatRows    = _nationalRows.length > 0;

// National aggregates per party
const nationalResults = _hasNatRows
  // New format: use pre-computed national rows from CSV (accurate vote_share)
  ? d3.rollup(_nationalRows, rows => ({
      votes:      rows[0].votes,
      vote_share: rows[0].vote_share,
      seats_pr:   0,  // calculated below via D'Hondt
      seats_smd:  rows[0]?.seats_smd  ?? 0,
      seats_comp: rows[0]?.seats_comp ?? 0,
      threshold_status: "notrun"  // overridden below from YAML
    }), d => d.party_id)
  // Legacy format: aggregate district rows
  : d3.rollup(_districtRows, rows => ({
      votes:      d3.sum(rows, r => r.votes),
      vote_share: d3.mean(rows, r => r.vote_share),
      seats_pr:   isCouncilMode ? d3.sum(rows, r => r.seats_pr)  : (rows[0]?.seats_pr  ?? 0),
      seats_smd:  isCouncilMode ? d3.sum(rows, r => r.seats_smd) : (rows[0]?.seats_smd ?? 0),
      seats_comp: rows[0]?.seats_comp ?? 0,
      threshold_status: rows[0]?.threshold_status ?? "notrun"
    }), d => d.party_id);

// Compute D'Hondt PR seats if method is defined in election YAML
const _prCfg = electionVal?.system?.pr;
const _seatsByParty = (_prCfg?.method === "dhondt" && _prCfg?.seats)
  ? dhondtSeats(
      new Map([...nationalResults.entries()]
        .filter(([pid]) => elecPartyMeta.get(pid)?.threshold_status === "passed")
        .map(([pid, d]) => [pid, d.votes])
      ),
      _prCfg.seats
    )
  : new Map();

const nationalArray = Array.from(nationalResults, ([party_id, v]) => {
  const meta = elecPartyMeta.get(party_id);
  const threshold_status = meta?.threshold_status ?? v.threshold_status ?? "notrun";
  const seats_pr = _seatsByParty.size > 0 ? (_seatsByParty.get(party_id) ?? 0) : (v.seats_pr ?? 0);
  return {
    party_id, ...v,
    seats_pr, threshold_status,
    party: getParty(party_id),
    color: partyColor(party_id, electionVal?.id)
  };
}).sort((a, b) => b.vote_share - a.vote_share);

// "notrun" = no threshold applies (SMD / by-elections / presidential) — show all without break
const hasThreshold = nationalArray.some(d => d.threshold_status === "passed" || d.threshold_status === "failed");

// Presidential winner: leading candidate in runoff, or first-round winner (>50%)
const presidentialWinnerId = isPresidential && nationalArray.length > 0
  ? (subVal?.type === "runoff" || nationalArray[0]?.vote_share > 0.5 ? nationalArray[0]?.party_id : null)
  : null;
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
const _hasInlineTurnout = results.length > 0 && results[0]?.registered != null;
if (_hasInlineTurnout) {
  // New combined CSV: turnout columns are denormalized into every party row.
  // Take the first row per district_id (all rows for the same district have identical turnout).
  const _seenDids = new Set();
  for (const r of results) {
    const did = String(r.district_id);
    if (!_seenDids.has(did)) {
      _seenDids.add(did);
      turnoutByDistrict.set(did, {...r, vote_type: r.vote_type ?? effectiveVoteType ?? "pr"});
    }
  }
  // Synthesize "national" entry from district totals if not already in CSV
  if (!turnoutByDistrict.has("national")) {
    const distEntries = [...turnoutByDistrict.values()];
    const reg   = d3.sum(distEntries, d => d.registered  ?? 0);
    const voted = d3.sum(distEntries, d => d.voted        ?? 0);
    turnoutByDistrict.set("national", {
      district_id:  "national",
      vote_type:    effectiveVoteType ?? "pr",
      registered:   reg,
      voted,
      voted_noon:   d3.sum(distEntries, d => d.voted_noon   ?? 0),
      voted_5pm:    d3.sum(distEntries, d => d.voted_5pm    ?? 0),
      main_list:    d3.sum(distEntries, d => d.main_list    ?? 0),
      special_list: d3.sum(distEntries, d => d.special_list ?? 0),
      turnout_pct:  reg > 0 ? voted / reg : 0
    });
  }
} else if (turnoutData.length > 0) {
  const relevantRows = turnoutData.filter(r =>
    !r.vote_type || r.vote_type === effectiveVoteType || r.vote_type === "pr"
  );
  d3.group(relevantRows, r => String(r.district_id)).forEach((rows, did) => {
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
// Module-level map control handle — .current set by the map IIFE, called by bar chart clicks
const _mapCtrl = {current: null};
function selectPartyOnMap(partyId) { _mapCtrl.current?.setPartyFilter(partyId); }
```

```js
// ════════════════════════════════════════════════════════════
// LAYOUT
// ════════════════════════════════════════════════════════════
// Explicit reactive deps — ensures container re-renders when any of these change
hasTurnout; hasPrecinct; hasCouncilDistricts; viewMode; voteTypeOptions; seatFilterOptions; hasSubElections; isSubElectionSMD; isPresidential; isIndirect; presidentialWinnerId; isPlebiscite; isLocal; hasCouncil; ballotTypeVal; isCouncilMode;
// Forward refs: renderer functions defined later; listing them ensures this cell waits for them
renderNationalPanel; renderElectionInfo; renderBarChart; renderDots; renderCouncilDots; selectPartyOnMap;

const container = html`
<style>
  .elections-outer {
    display: grid;
    grid-template-columns: 210px 1fr;
    gap: 1rem;
    align-items: start;
    max-width: 1200px;
    width: 100%;
  }
  .elections-main {
    display: grid;
    grid-template-columns: minmax(0, 680px) 280px;
    gap: 1rem;
    align-items: start;
  }
  .elections-bottom {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 1rem;
    align-items: start;
  }
  @media (max-width: 900px) { .elections-bottom { grid-template-columns: 1fr; } }
  .results-panel { min-height: 200px; overflow-y: auto; }
  .election-info { font-size: 0.85rem; line-height: 1.65; }
  .election-info .info-date { font-size: 0.78rem; color: var(--muted); margin-bottom: 0.5rem; }
  .election-info a { color: var(--theme-foreground-focus); }
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

  /* Map level control */
  .leaflet-level-control {
    background: white;
    border: 1px solid rgba(0,0,0,0.12);
    border-radius: 6px;
    padding: 6px 10px;
    font-size: 0.75rem;
    min-width: 110px;
    box-shadow: 0 1px 4px rgba(0,0,0,0.10);
    line-height: 1.4;
  }
  .level-control-title {
    font-size: 0.68rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: #888;
    margin-bottom: 4px;
    padding-bottom: 3px;
    border-bottom: 1px solid rgba(0,0,0,0.08);
  }
  .level-control-item {
    padding: 2px 0;
    color: #aaa;
  }
  .level-control-item.lc-clickable {
    cursor: pointer;
  }
  .level-control-item.lc-clickable:hover { color: #333; }
  .level-control-item.lc-active { color: #333; font-weight: 600; }


  /* Bar chart */
  .bar-row { display: flex; align-items: flex-start; gap: 8px; margin-bottom: 6px; font-size: 0.82rem; }
  .bar-label { width: 140px; white-space: normal; line-height: 1.3; flex-shrink: 0; }
  .bar-track { flex: 1; background: var(--border); border-radius: 2px; height: 14px; position: relative; margin-top: 2px; }
  .bar-fill  { height: 100%; border-radius: 2px; transition: width 0.3s; }
  .bar-value { width: 80px; text-align: right; flex-shrink: 0; display: flex; flex-direction: column; align-items: flex-end; line-height: 1.25; margin-top: 1px; }
  .bar-value-main { font-size: 0.78rem; color: var(--muted); }
  .bar-value-sub  { font-size: 0.70rem; color: var(--muted); opacity: 0.7; }
  /* Expandable below-threshold section */
  .below-threshold-details { margin-top: 6px; }
  .below-threshold-details[open] { margin-top: 8px; }
  .below-threshold-summary {
    display: flex; align-items: center; gap: 6px;
    font-style: italic; text-transform: uppercase;
    font-size: 0.70rem; color: var(--muted);
    cursor: pointer; list-style: none;
    border-top: 2px dashed #bbb; padding-top: 6px;
    user-select: none;
  }
  .below-threshold-summary::-webkit-details-marker { display: none; }
  .below-threshold-summary::before {
    content: "▸"; font-style: normal; font-size: 0.65rem;
    transition: transform 0.15s;
  }
  .below-threshold-details[open] .below-threshold-summary::before { content: "▾"; }
  .below-threshold-count {
    background: var(--muted); color: #fff;
    font-size: 0.65rem; font-style: normal;
    border-radius: 10px; padding: 1px 6px; line-height: 1.4;
  }
  .below-threshold-details .bar-row { margin-top: 6px; }
  .below-threshold-details .dist-table { margin-top: 4px; }

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
    ${isLocal && hasCouncil ? html`
    <div class="filter-item">
      <div class="filter-label">${t("elections.local.ballot_type")}</div>
      ${ballotTypeInput}
    </div>` : ""}
    ${hasSubElections && !isLocal ? html`
    <div class="filter-item">
      <div class="filter-label">${isPlebiscite ? t("elections.question_label") : t("elections.sub_election")}</div>
      ${subElectionInput}
    </div>` : ""}
    ${voteTypeOptions.length > 1 && !isSubElectionSMD && !isPlebiscite ? html`
    <div class="filter-item">
      <div class="filter-label">${t("elections.vote_type")}</div>
      ${voteTypeInput}
    </div>` : ""}

    <hr>
    ${hasTurnout ? html`<div class="filter-item">
      <div class="filter-label">${t("elections.view_mode")}</div>
      ${viewModeInput}
    </div>` : ""}
    ${isLocal && !isCouncilMode && hasSubElections && viewMode === "results" ? html`
    <div class="filter-item">
      <div class="filter-label">${t("elections.local.round")}</div>
      ${subElectionInput}
    </div>` : ""}
    ${!isIndirect ? html`
    <div class="filter-item">
      <div class="filter-label">${t("elections.map_mode")}</div>
      ${mapModeInput}
    </div>
` : ""}
    ${seatFilterOptions.length > 1 && !isPresidential && !isPlebiscite ? html`
    <div class="filter-item">
      <div class="filter-label">${t("elections.seat_filter")}</div>
      ${seatFilterInput}
    </div>` : ""}
  </div>

  <!-- RIGHT: MAP + RESULTS PANEL + CHARTS -->
  <div>

    ${isIndirect ? html`
    <!-- INDIRECT PRESIDENTIAL: electoral college dot grid -->
    ${renderElectoralCollege(electionVal)}
    ` : html`
    <!-- MAP + INFO PANEL side by side -->
    <div class="elections-main" style="margin-bottom: 0.75rem;">

      <!-- MAP — mapContainer is a stable node embedded here so Leaflet survives re-renders -->
      <div class="card" style="padding: 0; height: 380px; overflow: hidden; position: relative;">
        ${mapContainer}
      </div>

      <!-- INFO PANEL — shows national results by default; updated by map click -->
      ${renderNationalPanel()}

    </div>
    `}

    <!-- BOTTOM: election info (notes) + seat distribution -->
    <div class="${(!isPresidential && !isPlebiscite) ? "elections-bottom" : ""}">

      <!-- LEFT: election notes/blurb from YAML -->
      ${renderElectionInfo(electionVal)}

      <!-- RIGHT: seat distribution (hidden for presidential / plebiscite) -->
      ${!isPresidential && !isPlebiscite ? html`
      <div class="card">
        ${isCouncilMode ? html`
        <div id="council-seat-chart">
          <h4 style="margin-top:0; font-size:0.85rem;">${t("elections.local.council_seats_title")}</h4>
          ${renderCouncilDots(nationalArray, electionVal, seatFilter)}
          ${renderSeatLegend(nationalArray, seatFilter, electionVal)}
        </div>` : html`
        <h4 style="margin-top:0; font-size:0.85rem;">${t("elections.legislature_title")}</h4>
        ${renderDots(nationalArray, seatFilter, electionVal)}
        ${renderSeatLegend(nationalArray, seatFilter, electionVal)}`}
      </div>` : ""}

    </div>

  </div>
</div>
`;

display(container);
```

```js
// ── MAP ────────────────────────────────────────────────────────────────────
(async () => {
  // Declare reactive deps — this cell re-runs when any of these change
  electionVal; voteTypeVal; effectiveVoteType; mapMode; viewMode; lang; isCouncilMode;
  geoData; cartData; results; turnoutData; turnoutByDistrict;
  councilDistrictGeoData; councilDistrictResults;
  precinctGeoData; precinctResults; precinctTurnout;

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
      if (!td) return {fillColor: "#e0e0e0", fillOpacity: 0.5, color: "#fff", weight: 1};
      const fillColor = d3.interpolateRgb("#dbeafe", "#1d4ed8")(td.turnout_pct ?? 0);
      return {fillColor, fillOpacity: 0.85, color: "#ffffff", weight: 1.5};
    }
    const winner = winnerByDistrict.get(did);
    if (!winner) return {fillColor: "#e0e0e0", fillOpacity: 0.5, color: "#fff", weight: 1};
    const baseColor = partyColor(winner.party_id, electionVal?.id);
    const intensity = shareByDistrict.get(did) ?? 0.5;
    const lightened = d3.color(baseColor) ? d3.interpolateRgb("#f5f5f5", baseColor)(0.4 + intensity * 0.6) : "#ccc";
    return {fillColor: lightened, fillOpacity: 0.85, color: "#ffffff", weight: 1.5};
  }

  // Stringify GeoJSON integer ids once — both winnerByDistrict and turnoutByDistrict
  // are keyed by string (from CSV), but GeoJSON feature.properties.id is an integer.
  function geoId(feature) { return String(feature.properties.id); }

  const DISTRICT_HOLLOW  = {fillColor: "transparent", fillOpacity: 0, color: "#999", weight: 1.5};
  const SAKREBULO_HOLLOW = {fillColor: "transparent", fillOpacity: 0, color: "#bbb", weight: 0.8};

  if (mapMode === "cartogram" && activeGeo.features[0]?.geometry?.type === "Point") {
    // Cartogram — proportional circles, no precinct overlay
    activeGeo.features.forEach(f => {
      const did  = String(f.properties.id);
      const winner = winnerByDistrict.get(did);
      let fillColor;
      if (viewMode === "turnout") {
        const td = turnoutByDistrict.get(did);
        fillColor = d3.interpolateRgb("#dbeafe", "#1d4ed8")(td?.turnout_pct ?? 0);
      } else {
        const color = winner ? partyColor(winner.party_id, electionVal?.id) : "#ccc";
        fillColor = d3.interpolateRgb("#f5f5f5", color)(0.4 + (shareByDistrict.get(did) ?? 0.5) * 0.6);
      }
      const circle = L.circle(
        [f.geometry.coordinates[1], f.geometry.coordinates[0]],
        { radius: (f.properties.radius_km ?? 10) * 1000, fillColor, fillOpacity: 0.85, color: "#fff", weight: 1.5 }
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
    function buildLookups(resultsArr, turnoutArr) {
      const winnerMap  = new Map();
      const shareMap   = new Map();
      const turnoutMap = new Map();
      d3.group(resultsArr, r => String(r.district_id)).forEach((rows, did) => {
        const winner = rows.reduce((a, b) => (b.vote_share > a.vote_share ? b : a));
        winnerMap.set(did, winner);
        shareMap.set(did, d3.max(rows, r => r.vote_share));
      });
      d3.group(turnoutArr, r => String(r.district_id)).forEach((rows, did) => {
        turnoutMap.set(did, rows[0]);
      });
      return {winnerMap, shareMap, turnoutMap};
    }

    function makeLayerStyle(winnerMap, shareMap, turnoutMap, weight = 0.5) {
      return function(feature) {
        const did = String(feature.properties.id);
        if (viewMode === "turnout") {
          const td = turnoutMap.get(did);
          if (!td) return {fillColor: "#e0e0e0", fillOpacity: 0.6, color: "#ccc", weight};
          return {fillColor: d3.interpolateRgb("#dbeafe", "#1d4ed8")(td.turnout_pct ?? 0), fillOpacity: 0.9, color: "#ffffff", weight};
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

    if (councilDistrictGeoData) {
      const {winnerMap, shareMap, turnoutMap} = buildLookups(councilDistrictResults, []);
      const cdStyle = makeLayerStyle(winnerMap, shareMap, turnoutMap, 0.8);

      councilDistrictLayer = L.geoJSON(councilDistrictGeoData, {
        style: cdStyle,
        onEachFeature(feature, layer) {
          const did = geoId(feature);
          layer.on("click", () => {
            const panel = document.getElementById("results-panel");
            if (panel) panel.replaceWith(renderDistrictPanel(did, feature.properties, councilDistrictResults));
            if (isCouncilMode) updateCouncilSeats(did, feature.properties);
          });
          layer.bindTooltip(
            `<strong>${lang === "ka" ? feature.properties.name_ka : feature.properties.name_en}</strong>`,
            {sticky: true}
          );
        }
      });
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
            const parentDid = String(feature.properties.district_id);
            let fillColor;
            if (viewMode === "turnout") {
              const td = turnoutByDistrict.get(parentDid);
              fillColor = d3.interpolateRgb("#dbeafe", "#1d4ed8")(td?.turnout_pct ?? 0);
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
            const parentDid = String(feature.properties.district_id);
            const stationId = String(feature.properties.id);
            layer.on("click", () => {
              const panel = document.getElementById("results-panel");
              if (panel) {
                if (viewMode === "turnout") {
                  panel.replaceWith(renderTurnoutPanel(parentDid, feature.properties));
                } else {
                  // Show per-station results; pre-filter by precinct_id
                  const stationRows = precinctResults.filter(r => String(r.precinct_id) === stationId);
                  panel.replaceWith(renderDistrictPanel("__precinct__", feature.properties, stationRows));
                }
              }
            });
            layer.bindTooltip(
              `<strong>${feature.properties.name_ka ?? stationId}</strong>`,
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
    const availableLevels = [
      { id: "district",        label: t("elections.map_level.district") },
      ...(councilDistrictLayer ? [{ id: "council_district", label: t("elections.map_level.council_district") }] : []),
      ...(precinctLayer        ? [{ id: "precinct",         label: t("elections.map_level.precinct") }] : []),
    ];
    const multiLevel = availableLevels.length > 1;
    let currentLevel = "district";

    function applyLevel(levelId, controlDiv) {
      currentLevel = levelId;
      if (levelId === "district") {
        districtLayer.setStyle(districtStyle);
        if (councilDistrictLayer && map.hasLayer(councilDistrictLayer)) map.removeLayer(councilDistrictLayer);
        if (precinctLayer        && map.hasLayer(precinctLayer))        map.removeLayer(precinctLayer);
      } else if (levelId === "council_district" && councilDistrictLayer) {
        districtLayer.setStyle(DISTRICT_HOLLOW);
        if (!map.hasLayer(councilDistrictLayer)) councilDistrictLayer.addTo(map);
        if (precinctLayer && map.hasLayer(precinctLayer)) map.removeLayer(precinctLayer);
      } else if (levelId === "precinct" && precinctLayer) {
        districtLayer.setStyle(DISTRICT_HOLLOW);
        if (councilDistrictLayer && map.hasLayer(councilDistrictLayer)) map.removeLayer(councilDistrictLayer);
        if (!map.hasLayer(precinctLayer)) precinctLayer.addTo(map);
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
          if (lvl.id === "district") item.classList.add("lc-active");
          if (multiLevel) {
            item.classList.add("lc-clickable");
            L.DomEvent.on(item, "click", () => applyLevel(lvl.id, div));
          }
        });
        return div;
      }
    });
    new LevelControl({ position: "topright" }).addTo(map);

    // ── Party filter: build per-district party-share lookup ─────────────────
    const _shareByPartyByDistrict = new Map();
    for (const r of _districtRows) {
      const did = String(r.district_id);
      if (!_shareByPartyByDistrict.has(did)) _shareByPartyByDistrict.set(did, new Map());
      _shareByPartyByDistrict.get(did).set(r.party_id, r.vote_share);
    }

    // Expose imperative map controls for bar chart clicks (toggles party filter)
    _mapCtrl.current = {
      currentPartyId: null,
      setPartyFilter(partyId) {
        const newId = this.currentPartyId === partyId ? null : partyId;
        this.currentPartyId = newId;

        if (newId) {
          const partyStyle = (feature) => {
            const did = String(feature.properties.id);
            const share = _shareByPartyByDistrict.get(did)?.get(newId) ?? 0;
            const color = partyColor(newId, electionVal?.id);
            return {
              fillColor: d3.interpolateRgb("#f5f5f5", color)(Math.min(1, share * 2.2)),
              fillOpacity: 0.9, color: "#ffffff", weight: 1
            };
          };
          districtLayer.setStyle(partyStyle);
        } else {
          districtLayer.setStyle(districtStyle);
        }

        // Also update any visible precinct dots
        if (precinctLayer) {
          precinctLayer.eachLayer(l => {
            const did = String(l.feature?.properties?.district_id);
            let fillColor;
            if (newId) {
              const share = _shareByPartyByDistrict.get(did)?.get(newId) ?? 0;
              const color = partyColor(newId, electionVal?.id);
              fillColor = d3.interpolateRgb("#f5f5f5", color)(Math.min(1, share * 2.2));
            } else {
              const winner = winnerByDistrict.get(did);
              const color = winner ? partyColor(winner.party_id, electionVal?.id) : "#ccc";
              fillColor = d3.interpolateRgb("#f5f5f5", color)(0.4 + (shareByDistrict.get(did) ?? 0.5) * 0.6);
            }
            l.setStyle({fillColor, fillOpacity: 0.85});
          });
        }
      }
    };
  }

  setTimeout(() => map.invalidateSize(), 150);
})();
```

```js
// ── CHART RENDERERS ────────────────────────────────────────────────────────

// Renders national vote results into the info panel (default state — bar chart or turnout)
function renderNationalPanel() {
  const resultTitle = t(isPresidential ? "elections.presidential.results_title"
                      : isPlebiscite   ? "elections.plebiscite_results_title"
                      :                  "elections.party_list_title");
  return html`<div class="card results-panel" id="results-panel">
    <div style="font-size:0.72rem; font-weight:700; text-transform:uppercase; letter-spacing:0.05em; color:var(--muted); margin-bottom:0.75rem; padding-bottom:0.5rem; border-bottom:1px solid var(--border);">
      ${t("elections.results.national")}
    </div>
    ${viewMode === "turnout" ? html`
      ${renderTurnoutSummary(
        turnoutData.length > 0 ? turnoutData
          : turnoutByDistrict.has("national") ? [turnoutByDistrict.get("national")] : [],
        electionVal
      )}
    ` : html`
      <div style="font-size:0.8rem; font-weight:600; color:var(--muted); margin-bottom:0.5rem;">${resultTitle}</div>
      ${renderBarChart(passed, failed, electionVal?.id, presidentialWinnerId)}
    `}
  </div>`;
}

// Resets the info panel to national results (called by "National" controls)
function showNationalPanel() {
  const panel = document.getElementById("results-panel");
  if (panel) panel.replaceWith(renderNationalPanel());
}

function renderBarChart(passed, failed, elecId, winnerId = null) {
  const maxVal = d3.max([...passed, ...failed], d => d.vote_share) || 1;

  function barRow(d) {
    const pct      = (d.vote_share / maxVal) * 100;
    const shareStr = `${(d.vote_share * 100).toFixed(1)}%`;
    const countStr = d.votes != null ? d.votes.toLocaleString() : "—";
    const pname    = d.party?.name?.[lang] || d.party_id;
    const isWinner = winnerId && d.party_id === winnerId;
    const el = html`
      <div class="bar-row" style="cursor:pointer;" title="${t("elections.chart.click_filter") || "Click to filter map"}">
        <div class="bar-label" title="${pname}">
          <span class="party-dot" style="background:${d.color};"></span>${pname}
          ${isWinner ? html`<span style="margin-left:4px; font-size:0.68rem; background:${d.color}; color:#fff; border-radius:3px; padding:1px 5px; vertical-align:middle;">✓</span>` : ""}
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
    el.addEventListener("click", () => selectPartyOnMap(d.party_id));
    return el;
  }

  return html`
    ${passed.map(barRow)}
    ${failed.length > 0 ? html`
      <details class="below-threshold-details">
        <summary class="below-threshold-summary">
          ${t("elections.chart.threshold_line")}
          <span class="below-threshold-count">${failed.length}</span>
        </summary>
        ${failed.map(barRow)}
      </details>
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

// ── Council seat grid — square dot grid for sakrebulo composition ─────────
function renderCouncilDots(nationalArray, elec, filter) {
  const totalPR  = elec?.council?.total_pr_seats  ?? 200;
  const totalSMD = elec?.council?.total_smd_seats ?? 200;
  const total    = totalPR + totalSMD;
  const COLS     = Math.round(Math.sqrt(total));
  const ROWS     = Math.ceil(total / COLS);
  const totalSlots = COLS * ROWS;

  const all = partiesForFilter(nationalArray, filter, elec);
  if (d3.sum(all, d => seatsFor(d, filter)) === 0)
    return html`<p style="color:var(--muted); font-size:0.85rem; text-align:center;">No seat data</p>`;

  // Build flat array of coloured dots (ordered by party)
  const dots = [];
  for (const d of all) {
    const n = seatsFor(d, filter);
    for (let i = 0; i < n; i++) dots.push(d.color);
  }
  // Pad to fill the grid
  while (dots.length < totalSlots) dots.push(null);

  return html`<div style="display:grid;grid-template-columns:repeat(${COLS},9px);gap:2px;margin-top:0.5rem;">
    ${dots.map(c => html`<div style="width:9px;height:9px;border-radius:1px;background:${c ?? "transparent"};opacity:${c ? 1 : 0};"></div>`)}
  </div>
  <div style="font-size:0.72rem;color:var(--muted);margin-top:4px;">${total} ${t("elections.seats_label")}</div>`;
}

// ── Update council seat chart imperatively on district click ──────────────
function updateCouncilSeats(distId, props) {
  const chart = document.getElementById("council-seat-chart");
  if (!chart) return;

  const distRows = results.filter(r => String(r.district_id) === distId);
  const distArray = Array.from(
    d3.rollup(distRows, rows => ({
      votes:      d3.sum(rows, r => r.votes),
      vote_share: d3.mean(rows, r => r.vote_share),
      seats_pr:   rows[0]?.seats_pr  ?? 0,
      seats_smd:  rows[0]?.seats_smd ?? 0,
      threshold_status: rows[0]?.threshold_status ?? "notrun"
    }), d => d.party_id),
    ([party_id, v]) => ({
      party_id, ...v,
      party: getParty(party_id),
      color: partyColor(party_id, electionVal?.id)
    })
  ).sort((a, b) => b.vote_share - a.vote_share);

  const distElec = {...electionVal, council: {
    total_pr_seats:  d3.sum(distArray, d => d.seats_pr),
    total_smd_seats: d3.sum(distArray, d => d.seats_smd)
  }};

  const name = props ? (lang === "ka" ? props.name_ka : props.name_en) : null;
  const title = name
    ? `${name} — ${t("elections.local.council_seats_title")}`
    : t("elections.local.council_seats_title");

  chart.replaceWith(html`<div id="council-seat-chart">
    <h4 style="margin-top:0; font-size:0.85rem;">${title}</h4>
    ${renderCouncilDots(distArray, distElec, seatFilter)}
    ${renderSeatLegend(distArray, seatFilter, distElec)}
  </div>`);
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

// ── Shared back-to-national header for district / turnout panels ──────────
function panelBackHeader(districtName) {
  const btn = html`<button style="background:none;border:none;cursor:pointer;font-size:0.75rem;color:var(--theme-foreground-focus);padding:0;display:inline-flex;align-items:center;gap:3px;line-height:1;">← ${t("elections.results.national")}</button>`;
  btn.addEventListener("click", showNationalPanel);
  return html`<div style="display:flex;align-items:center;gap:0.5rem;margin-bottom:0.75rem;padding-bottom:0.5rem;border-bottom:1px solid var(--border);">
    ${btn}
    <span style="color:var(--border);">|</span>
    <span style="font-size:0.85rem;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${districtName}</span>
  </div>`;
}

// ── District results panel ────────────────────────────────────────────────
function renderDistrictPanel(distId, props, data = results) {
  // "__precinct__" sentinel: data is already pre-filtered to the desired rows
  const rows = (distId === "__precinct__"
    ? [...data]
    : data.filter(r => String(r.district_id) === distId)
  ).sort((a, b) => b.vote_share - a.vote_share);
  const pname = lang === "ka" ? props.name_ka : props.name_en || distId;
  const isSMD = effectiveVoteType === "smd" || isPresidential;
  const colHeader = isSMD ? t("elections.results.candidate")
                  : isPlebiscite ? t("elections.results.vote")
                  : t("elections.results.party");
  const SHOW_N    = 5;
  const topRows   = rows.slice(0, SHOW_N);
  const moreRows  = rows.slice(SHOW_N);

  function distRow(r) {
    const color     = partyColor(r.party_id, electionVal?.id);
    const shareStr  = `${(r.vote_share * 100).toFixed(1)}%`;
    const countStr  = r.votes != null ? r.votes.toLocaleString() : "—";
    const partyName = getParty(r.party_id).name?.[lang] || r.party_id;
    return html`<tr>
      <td style="vertical-align:middle;">
        <span class="party-dot" style="background:${color}; vertical-align:middle;"></span>
        ${isSMD && r.candidate_name
          ? html`<strong style="font-size:0.82rem;">${r.candidate_name}</strong>
                 <div style="font-size:0.72rem; color:var(--muted); margin-left:15px;">${partyName}</div>`
          : html`${partyName}${r.threshold_status === "failed" ? html`<span style="color:var(--muted);font-size:0.72rem;"> ✗</span>` : ""}`
        }
      </td>
      <td style="text-align:right; white-space:nowrap; vertical-align:middle;">
        <span style="font-weight:700;">${shareStr}</span>
        <span style="color:var(--muted); font-size:0.75rem; margin-left:4px;">(${countStr})</span>
      </td>
    </tr>`;
  }

  const panel = html`<div class="card results-panel" id="results-panel">
    ${panelBackHeader(pname)}
    <table class="dist-table">
      <thead><tr>
        <th>${colHeader}</th>
        <th style="text-align:right;">${t("elections.results.share")}</th>
      </tr></thead>
      <tbody>
        ${topRows.map(distRow)}
      </tbody>
    </table>
    ${moreRows.length > 0 ? html`
      <details class="below-threshold-details">
        <summary class="below-threshold-summary">
          ${t("elections.chart.threshold_line")}
          <span class="below-threshold-count">${moreRows.length}</span>
        </summary>
        <table class="dist-table">
          <tbody>${moreRows.map(distRow)}</tbody>
        </table>
      </details>
    ` : ""}
  </div>`;
  return panel;
}

// ── Turnout panel ─────────────────────────────────────────────────────────
function renderTurnoutPanel(distId, props, turnoutLookup = turnoutByDistrict) {
  const pname = lang === "ka" ? props.name_ka : props.name_en || distId;
  const td = turnoutLookup.get(distId);
  const turnoutCfg = electionVal?.turnout ?? {};

  if (!td) {
    return html`<div class="card results-panel" id="results-panel">
      ${panelBackHeader(pname)}
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
    ${panelBackHeader(pname)}
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

// ── Election info / blurb (shown below the map) ──
// The notes field in YAML may contain HTML: <b>, <a href="...">, <em>, etc.
function renderElectionInfo(elec) {
  const notesRaw = elec?.notes?.[lang] ?? elec?.notes?.en ?? null;
  if (!notesRaw) return "";

  const notesNode = document.createElement("div");
  notesNode.innerHTML = notesRaw;

  return html`<div class="card election-blurb">${notesNode}</div>`;
}

// ── Electoral college (indirect presidential) ─────────────────────────────
function renderElectoralCollege(elec) {
  const ec = elec?.electoral_college;
  if (!ec) return html`<p style="color:var(--muted);">${t("elections.electoral_college.no_data")}</p>`;

  const candidate = elec.candidates?.[0];
  const candidateName = candidate?.name?.[lang] || candidate?.name?.en || "—";
  const partyRef = candidate?.party ? parties.find(p => p.id === candidate.party) : null;
  const winColor = candidate?.color ?? partyRef?.colors?.default ?? "#1565C0";
  const invalid  = ec.invalid  ?? 0;
  const abstained = ec.abstained ?? 0;
  // Absent: use YAML value if present; otherwise fill remaining to reach total
  const absent   = ec.absent  ?? Math.max(0, ec.total - ec.for - ec.against - abstained - invalid);

  // Build dot sequence: for → against → abstained → invalid → absent
  const dots = [
    ...Array(ec.for).fill("for"),
    ...Array(ec.against).fill("against"),
    ...Array(abstained).fill("abstained"),
    ...Array(invalid).fill("invalid"),
    ...Array(absent).fill("absent"),
  ];
  const dotColors = { for: winColor, against: "#C62828", abstained: "#9E9E9E", invalid: "#FF8F00", absent: "#E8E8E8" };

  // Square grid: cols ≈ √total, pad with transparent dots to fill last row
  const COLS = Math.round(Math.sqrt(ec.total));
  const totalSlots = COLS * Math.ceil(ec.total / COLS);
  const allDots = [...dots, ...Array(totalSlots - dots.length).fill("empty")];

  const legend = [
    {key: "for",        label: t("elections.electoral_college.for"),        n: ec.for,            color: winColor},
    {key: "against",    label: t("elections.electoral_college.against"),    n: ec.against,        color: "#C62828"},
    {key: "abstained",  label: t("elections.electoral_college.abstained"),  n: abstained,         color: "#9E9E9E"},
    {key: "invalid",    label: t("elections.electoral_college.invalid"),    n: invalid,           color: "#FF8F00"},
    {key: "absent",     label: t("elections.electoral_college.absent"),     n: absent,            color: "#E8E8E8"},
  ].filter(d => d.n > 0);

  return html`<div style="margin-bottom:1rem;">
    <div class="card" style="padding:1.25rem;">
      <div style="display:flex; align-items:center; gap:0.75rem; margin-bottom:1rem;">
        <span style="width:14px; height:14px; border-radius:50%; background:${winColor}; display:inline-block; flex-shrink:0;"></span>
        <span style="font-size:1rem; font-weight:700;">${candidateName}</span>
        <span style="font-size:0.8rem; background:${winColor}; color:#fff; border-radius:4px; padding:2px 8px;">${t("elections.electoral_college.elected")}</span>
      </div>
      <div style="display:grid; grid-template-columns:repeat(${COLS}, 9px); gap:2px; margin-bottom:1rem;">
        ${allDots.map(k => html`<div style="width:9px;height:9px;border-radius:1px;background:${k === 'empty' ? 'transparent' : dotColors[k]};"></div>`)}
      </div>
      <div style="display:flex; flex-wrap:wrap; gap:0.75rem 1.5rem; font-size:0.82rem;">
        ${legend.map(d => html`<div style="display:flex;align-items:center;gap:5px;">
          <span style="width:10px;height:10px;border-radius:2px;background:${d.color};display:inline-block;border:1px solid #ccc;"></span>
          <span style="color:var(--muted);">${d.label}</span>
          <strong>${d.n}</strong>
        </div>`)}
        <div style="color:var(--muted);font-size:0.75rem;align-self:center;">(${t("elections.electoral_college.total")}: ${ec.total})</div>
      </div>
    </div>
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
