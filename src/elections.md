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
```

```js
// ── Language — reactive (re-runs the whole chain when user switches) ───────
const lang = getLang();
```

```js
// ── t() translation helper — re-creates when lang or dict changes ──────────
const t = k => tr(dict, lang, k);
```

```js
// ── Stable selection state — no deps, runs once, survives language re-renders ──
const _urlParams    = new URLSearchParams(window.location.search);
const _typeCtrl     = {value: _urlParams.get("type") ?? "parliamentary"};
const _electionCtrl = {value: _urlParams.get("election") ?? null};
```

```js
// ── DERIVED: election list for the type selector ──────────────────────────
const parlElections = elections.filter(e => e.type === "parliamentary");

const typeInput = Inputs.select(
  ["parliamentary", "presidential", "local", "adjara", "plebiscite"],
  { format: k => t(`type.${k}`), value: _typeCtrl.value }
);
typeInput.addEventListener("input", () => {
  _typeCtrl.value = typeInput.value;
  const _p = new URLSearchParams(window.location.search);
  _p.set("type", typeInput.value); _p.delete("election");
  history.replaceState(null, "", "?" + _p.toString());
});
const typeVal = Generators.input(typeInput);
```

```js
// ── Election ID dropdown — filtered by type ───────────────────────────────
const filteredElections = elections
  .filter(e => e.type === typeVal)
  .sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));

const _restoredElec = filteredElections.find(e => e.id === _electionCtrl.value) ?? filteredElections[0];
const electionInput = Inputs.select(
  filteredElections,
  { format: e => e.name?.[lang] || e.name?.en || e.id,
    value: _restoredElec }
);
electionInput.addEventListener("input", () => {
  _electionCtrl.value = electionInput.value?.id ?? null;
  const _p = new URLSearchParams(window.location.search);
  if (electionInput.value?.id) _p.set("election", electionInput.value.id);
  history.replaceState(null, "", "?" + _p.toString());
});
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
const effectiveVoteType = isSubElectionSMD ? "smd"
  : (isLocal && ballotTypeVal === "mayor") ? "smd"
  : voteTypeVal;
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
// Council mode only: majoritarian district layer — only when SMD vote type is selected
const hasCouncilDistricts = isCouncilMode && effectiveVoteType === "smd" && !!(electionVal?.council?.shape_file);
// Self-governing unit level (local 2025+): available when pr.selfgov_shape_file is set
const hasSelfGov = isLocal && !!(electionVal?.system?.pr?.selfgov_shape_file);

```

```js
// ── Stable state objects — each in its own no-dep cell so they run ONCE and survive re-renders ──
const _viewModeCtrl    = {value: "results"};  // persists view mode across language switches
```

```js
// ── View mode: Results vs Turnout ─────────────────────────────────────────
const hasTurnout = !!(electionVal?.turnout?.available);

// Rebuild viewModeInput on lang change — restore previous selection from _viewModeCtrl
const viewModeInput = Inputs.radio(["results", "turnout"], {
  value: _viewModeCtrl.value,
  format: k => k === "results" ? t("elections.view_mode.results") : t("elections.view_mode.turnout")
});
viewModeInput.addEventListener("input", () => { _viewModeCtrl.value = viewModeInput.value; });
const viewMode = Generators.input(viewModeInput);
```

```js
// ── Turnout metric — controlled imperatively via _mapCtrl (like party filter) ─
const _turnoutMetrics = ["final", "noon", "5pm", "invalid"];
const _turnoutMetricCtrl = {value: "final"};  // mutated by setTurnoutMetric
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
const _allGeo          = await FileAttachment("data/geo-registry.json").json();
const _allCsv          = await FileAttachment("data/csv-registry.json").json();
const _allTurnout      = await FileAttachment("data/turnout-registry.json").json();
const _occupiedGeo     = await FileAttachment("data/shp/occupied_territories.geojson").json();

function lookupCSV(dataMap, path) {
  return dataMap?.[path] ?? [];
}

function loadGeoJSON(elec, vt, level) {
  let path;
  if (level === "council_district") {
    path = elec?.council?.shape_file;
  } else if (level === "selfgov") {
    path = elec?.system?.pr?.selfgov_shape_file;
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
    if (level === "selfgov") {
      // Self-governing unit level for council PR
      return lookupCSV(_allCsv, elec?.files?.pr_selfgov_results ?? elec?.files?.council_pr_results);
    }
    if (level === "council_district") {
      const path = vt === "smd"
        ? elec?.files?.council_smd_results
        : elec?.files?.council_pr_results;
      return lookupCSV(_allCsv, path);
    }
    if (level === "precinct") {
      const path = vt === "smd"
        ? (elec?.files?.council_smd_precinct_results ?? elec?.files?.council_smd_results)
        : (elec?.files?.council_pr_precinct_results  ?? elec?.files?.council_pr_results);
      return lookupCSV(_allCsv, path);
    }
    const path = vt === "smd"
      ? elec?.files?.council_smd_results
      : elec?.files?.council_pr_results;
    return lookupCSV(_allCsv, path);
  }
  if (level === "selfgov") {
    // Self-governing unit level for mayor (smd_results are already keyed by selfgov_id)
    const path = vt === "smd" ? elec?.files?.smd_results : elec?.files?.pr_selfgov_results;
    return lookupCSV(_allCsv, path);
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
  // Mayor district level: use CEC-district-indexed file (Tbilisi expanded to districts 1–10)
  // instead of selfgov-indexed smd_results (where Tbilisi=1 would leave districts 2–10 uncoloured)
  const path = (ballotType === "mayor" && level === "district" && elec?.files?.smd_district_results)
    ? elec.files.smd_district_results
    : vt === "smd"          ? elec?.files?.smd_results
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

// For all local modes, use PR shapefile (electoral districts) for the district layer.
// Mayor elections were previously using the SMD (selfgov) shapefile, which rendered selfgov
// outlines instead of CEC electoral district outlines at the district level.
const _geoVt = isLocal ? "pr" : effectiveVoteType;
const geoData  = electionVal ? loadGeoJSON(electionVal, _geoVt, "district") : null;
const cartData = _allGeo[electionVal?.files?.cartogram] ?? null;

// All CSV data is pre-loaded in the registries — lookups are synchronous
const results              = electionVal ? loadResults(electionVal, effectiveVoteType, subVal, "district", ballotTypeVal)         : [];
const turnoutData          = electionVal ? loadTurnout(electionVal, "district")                                                   : [];
// Council-district intermediate layer (sakrebulo districts, council mode only)
const councilDistrictGeoData = (electionVal && hasCouncilDistricts) ? loadGeoJSON(electionVal, _geoVt, "council_district") : null;
const councilDistrictResults = (electionVal && hasCouncilDistricts) ? loadResults(electionVal, effectiveVoteType, subVal, "council_district", ballotTypeVal) : [];
// Always load council SMD results for seat computation, even in PR map mode
const _allCouncilSMDResults = (electionVal && isCouncilMode && electionVal?.files?.council_smd_results)
  ? lookupCSV(_allCsv, electionVal.files.council_smd_results)
  : councilDistrictResults;
// Self-governing unit layer (local elections with selfgov_shape_file set)
const selfgovGeoData = (electionVal && hasSelfGov) ? loadGeoJSON(electionVal, "pr", "selfgov") : null;
const selfgovResults = (electionVal && hasSelfGov) ? loadResults(electionVal, effectiveVoteType, subVal, "selfgov", ballotTypeVal) : [];
// Precinct layer
const precinctGeoData  = (electionVal && hasPrecinct) ? loadGeoJSON(electionVal, effectiveVoteType, "precinct") : null;
const precinctResults  = (electionVal && hasPrecinct) ? loadResults(electionVal, effectiveVoteType, subVal, "precinct", ballotTypeVal)                 : [];
const precinctTurnout  = (electionVal && hasPrecinct) ? loadTurnout(electionVal, "precinct")                                                          : [];
// Actual seat composition from elected-people list (council mode + mayor mode)
const _needsSeatsData = isCouncilMode || (isLocal && ballotTypeVal === "mayor");
const seatsData = (electionVal && _needsSeatsData && electionVal?.files?.seats)
  ? lookupCSV(_allCsv, electionVal.files.seats)
  : [];
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

// ── Election YAML party/candidate metadata (threshold_status, alias, color) ──
// Parliamentary elections use a "parties" key; presidential elections use "candidates".
const elecPartyMeta = new Map(
  [...(electionVal?.parties ?? []), ...(electionVal?.candidates ?? [])].map(p => [p.id, p])
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

// For council mode: compute actual district wins from council SMD results
// major_id = selfgov_id * 100 + local_sequential; one winner per district = one SMD seat
// Computed always (not just in SMD map mode) so seat chart is stable across vote type switches
const _councilSMDWins = isCouncilMode
  ? (() => {
      const wins = new Map();
      for (const rows of d3.group(
        _allCouncilSMDResults.filter(r => String(r.district_id) !== "national"),
        r => String(r.district_id)
      ).values()) {
        const w = rows.reduce((a, b) => b.votes > a.votes ? b : a);
        wins.set(w.party_id, (wins.get(w.party_id) ?? 0) + 1);
      }
      return wins;
    })()
  : new Map();
const _totalCouncilSMD = d3.sum([..._councilSMDWins.values()]);

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

// Build seat lookup from CSV: selfgov_id → Map(party_id → {seats_pr, seats_smd, seats_mayor})
const _seatsMap = new Map();
for (const r of seatsData) {
  const sid = String(r.selfgov_id);
  if (!_seatsMap.has(sid)) _seatsMap.set(sid, new Map());
  _seatsMap.get(sid).set(String(r.party_id), {
    seats_pr:    Number(r.seats_pr)    || 0,
    seats_smd:   Number(r.seats_smd)   || 0,
    seats_mayor: Number(r.seats_mayor) || 0
  });
}
const _natSeatsByParty      = _seatsMap.get("national") ?? new Map();
const _totalPRSeatsFromCSV  = d3.sum([..._natSeatsByParty.values()], d => d.seats_pr);
const _totalSMDSeatsFromCSV = d3.sum([..._natSeatsByParty.values()], d => d.seats_smd);
const _totalMayorsFromCSV   = d3.sum([..._natSeatsByParty.values()], d => d.seats_mayor);

const nationalArray = Array.from(nationalResults, ([party_id, v]) => {
  const meta = elecPartyMeta.get(party_id);
  const threshold_status = meta?.threshold_status ?? v.threshold_status ?? "notrun";
  // Use actual election results from CSV when available (council mode),
  // otherwise fall back to YAML-declared seats or D'Hondt calculation
  const seats_pr = isCouncilMode && _natSeatsByParty.size > 0
    ? (_natSeatsByParty.get(party_id)?.seats_pr ?? 0)
    : (meta?.seats_pr != null
        ? meta.seats_pr
        : _seatsByParty.size > 0 ? (_seatsByParty.get(party_id) ?? 0) : (v.seats_pr ?? 0));
  const seats_smd = isCouncilMode
    ? (_councilSMDWins.get(party_id) ?? 0)
    : (meta?.seats_smd ?? v.seats_smd ?? 0);
  const seats_mayor = _natSeatsByParty.get(party_id)?.seats_mayor ?? 0;
  const seats_comp = meta?.seats_compensation ?? v.seats_comp ?? 0;
  return {
    party_id, ...v,
    seats_pr, seats_smd, seats_mayor, seats_comp, threshold_status,
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
// Helper: pick the right fraction from a turnout data row based on selected metric
// Returns the raw fraction for a given turnout metric
function turnoutValue(td, metric) {
  if (!td) return 0;
  if (metric === "noon")    return td.noon_pct    ?? (td.voted_noon != null && td.registered > 0 ? td.voted_noon / td.registered : 0);
  if (metric === "5pm")     return td.five_pct    ?? (td.voted_5pm  != null && td.registered > 0 ? td.voted_5pm  / td.registered : 0);
  // For invalid: prefer pre-computed pct, fall back to computing from raw counts
  if (metric === "invalid") return td.invalid_pct ?? (td.invalid_ballots != null && td.voted > 0 ? td.invalid_ballots / td.voted : 0);
  return td.turnout_pct ?? 0;  // "final" default
}

// Dynamic max for invalid-ballot normalization — computed after turnoutByDistrict is populated.
// Using 95th-percentile of district values (×1.2), capped at 0.30, floor at 0.02.
// Mutable so it can be updated after the data builds.
let _invalidMax = 0.05;

// Normalizes turnoutValue to [0,1] relative to the expected max for the metric.
function turnoutNorm(td, metric) {
  const v = turnoutValue(td, metric);
  const max = metric === "invalid" ? _invalidMax
            : metric === "noon"    ? 0.30
            : metric === "5pm"     ? 0.60
            : 1.0;
  return Math.min(1, v / max);
}

const turnoutByDistrict = new Map();
// In council SMD mode `results` uses major_ids (101…) as district_id, not CEC electoral district
// IDs (1-84). Use council PR results as the source so the district-layer choropleth can resolve
// turnout by CEC district ID. PR results carry the same polling-day turnout columns.
const _distTurnoutSource = (isCouncilMode && effectiveVoteType === "smd" && electionVal?.files?.council_pr_results)
  ? lookupCSV(_allCsv, electionVal.files.council_pr_results)
  : results;
const _hasInlineTurnout = _distTurnoutSource.length > 0 && _distTurnoutSource[0]?.registered != null;
if (_hasInlineTurnout) {
  // New combined CSV: turnout columns are denormalized into every party row.
  // Take the first row per district_id (all rows for the same district have identical turnout).
  const _seenDids = new Set();
  for (const r of _distTurnoutSource) {
    const did = String(r.district_id);
    if (!_seenDids.has(did)) {
      _seenDids.add(did);
      const _td = {...r, vote_type: r.vote_type ?? effectiveVoteType ?? "pr"};
      if (_td.turnout_pct == null && _td.registered > 0) _td.turnout_pct = _td.voted / _td.registered;
      if (_td.invalid_pct == null && _td.voted > 0 && _td.invalid_ballots != null) _td.invalid_pct = _td.invalid_ballots / _td.voted;
      if (_td.noon_pct    == null && _td.registered > 0 && _td.voted_noon != null) _td.noon_pct    = _td.voted_noon / _td.registered;
      if (_td.five_pct    == null && _td.registered > 0 && _td.voted_5pm  != null) _td.five_pct    = _td.voted_5pm  / _td.registered;
      turnoutByDistrict.set(did, _td);
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
      turnout_pct:  reg > 0 ? voted / reg : 0,
      invalid_ballots: d3.sum(distEntries, d => d.invalid_ballots ?? 0),
      invalid_pct:  voted > 0 ? d3.sum(distEntries, d => d.invalid_ballots ?? 0) / voted : 0,
      noon_pct:     reg > 0 ? d3.sum(distEntries, d => d.voted_noon ?? 0) / reg : 0,
      five_pct:     reg > 0 ? d3.sum(distEntries, d => d.voted_5pm  ?? 0) / reg : 0
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

// Compute dynamic max for invalid-ballot coloring from actual district data.
// 95th-percentile × 1.2, capped at 0.30, minimum 0.02.
{
  const _invVals = [...turnoutByDistrict.values()]
    .map(d => turnoutValue(d, "invalid"))
    .filter(v => v > 0)
    .sort(d3.ascending);
  if (_invVals.length > 0) {
    _invalidMax = Math.min(0.30, Math.max(0.02, d3.quantile(_invVals, 0.95) * 1.2));
  }
}

const hasTurnoutMetrics = hasTurnout && !!(
  turnoutByDistrict.size > 0 &&
  [...turnoutByDistrict.values()][0]?.voted_noon != null
);
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

// Persistent map view state — survives reactive re-renders so zoom/pan is preserved
// when switching view mode (results ↔ turnout) without changing the election.
const _mapState = { center: [42.1, 43.0], zoom: 7, elecId: null };
```

```js
// ════════════════════════════════════════════════════════════
// LAYOUT
// ════════════════════════════════════════════════════════════
// Explicit reactive deps — ensures container re-renders when any of these change
hasTurnout; hasPrecinct; hasCouncilDistricts; viewMode; voteTypeOptions; seatFilterOptions; hasSubElections; isSubElectionSMD; isPresidential; isIndirect; presidentialWinnerId; isPlebiscite; isLocal; hasCouncil; ballotTypeVal; isCouncilMode; lang;
// Forward refs: renderer functions defined later; listing them ensures this cell waits for them
renderNationalPanel; renderElectionInfo; renderBarChart; renderDots; renderCouncilDots; selectPartyOnMap; renderPrecinctPanel;

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

  /* Active bar row (party filter) */
  .bar-row-active { background: rgba(0,0,0,0.06); border-radius: 3px; }

  /* Clickable district/precinct table rows */
  .dist-table-row { cursor: pointer; transition: background 0.1s; }
  .dist-table-row:hover td { background: rgba(0,0,0,0.04); }
  .dist-table-row-active td { background: rgba(0,0,0,0.07); }
  .dist-table-row-active td:first-child { font-weight: 700; }

  /* Turnout metric rows — clickable to switch the map metric */
  .turnout-metric-row {
    display: flex; justify-content: space-between; align-items: baseline;
    padding: 5px 4px; margin: 0 -4px;
    border-bottom: 1px solid var(--border);
    font-size: 0.82rem; cursor: pointer;
    border-radius: 3px; transition: background 0.1s;
  }
  .turnout-metric-row:hover { background: rgba(0,0,0,0.04); }
  .metric-row-active { background: rgba(0,0,0,0.07) !important; }
  .metric-row-active .metric-row-label { font-weight: 700; color: var(--theme-foreground); }

  /* Map legend control */
  .map-legend {
    background: rgba(255,255,255,0.93);
    padding: 7px 10px;
    border-radius: 5px;
    font-size: 0.68rem;
    box-shadow: 0 1px 5px rgba(0,0,0,0.18);
    pointer-events: none;
    max-width: 240px;
  }
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
    ${voteTypeOptions.length > 1 && !isSubElectionSMD && !isPlebiscite && !(isLocal && ballotTypeVal === "mayor") ? html`
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
    ${seatFilterOptions.length > 1 && !isPresidential && !isPlebiscite && !(isLocal && ballotTypeVal === "mayor") ? html`
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

      <!-- RIGHT: seat distribution (or turnout summary in turnout mode) -->
      ${!isPresidential && !isPlebiscite ? html`
      <div class="card">
        ${viewMode === "turnout" ? html`
        <h4 style="margin-top:0; font-size:0.85rem;">${t("elections.results.national")}</h4>
        ${renderTurnoutSummary(
          turnoutData.length > 0 ? turnoutData
            : turnoutByDistrict.has("national") ? [turnoutByDistrict.get("national")] : [],
          electionVal
        )}` : isCouncilMode ? html`
        <div id="council-seat-chart">
          <h4 style="margin-top:0; font-size:0.85rem;">${t("elections.local.council_seats_title")}</h4>
          ${renderCouncilDots(nationalArray, {...electionVal, council: {
            ...electionVal?.council,
            total_smd_seats: _totalSMDSeatsFromCSV > 0 ? _totalSMDSeatsFromCSV : _totalCouncilSMD,
            total_pr_seats:  _totalPRSeatsFromCSV  > 0 ? _totalPRSeatsFromCSV  : (electionVal?.council?.total_pr_seats ?? 0)
          }}, seatFilter)}
          ${renderSeatLegend(nationalArray, seatFilter, electionVal)}
        </div>` : (isLocal && ballotTypeVal === "mayor") ? html`
        <div id="council-seat-chart">
          <h4 style="margin-top:0; font-size:0.85rem;">${t("elections.local.mayor_seats_title")}</h4>
          ${renderCouncilDots(nationalArray, {...electionVal, council: {
            total_pr_seats:  0,
            total_smd_seats: _totalMayorsFromCSV > 0 ? _totalMayorsFromCSV : (electionVal?.system?.smd?.seats ?? 0)
          }}, "mayor")}
          ${renderSeatLegend(nationalArray, "mayor", electionVal)}
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
  selfgovGeoData; selfgovResults;
  precinctGeoData; precinctResults; precinctTurnout;
  seatsData;

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
      const fillColor = d3.interpolateRgb("#fee2e2", "#b91c1c")(turnoutNorm(td, _turnoutMetricCtrl.value));
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
          return {fillColor: d3.interpolateRgb("#fee2e2", "#b91c1c")(turnoutNorm(td, _turnoutMetricCtrl.value)), fillOpacity: 0.9, color: "#ffffff", weight};
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
          layer.on("click", () => {
            const panel = document.getElementById("results-panel");
            if (panel) panel.replaceWith(viewMode === "turnout"
              ? renderTurnoutPanel(did, feature.properties, turnoutMap)
              : renderDistrictPanel(did, feature.properties, councilDistrictResults));
            if (isCouncilMode) updateCouncilSeats(did, feature.properties);
          });
          layer.bindTooltip(
            `<strong>${lang === "ka" ? feature.properties.name_ka : feature.properties.name_en}</strong>`,
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
              fillColor = d3.interpolateRgb("#fee2e2", "#b91c1c")(turnoutNorm(td, _turnoutMetricCtrl.value));
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
            const distNameEn = distFeat?.properties?.name_en ?? parentDid;
            const distNameKa = distFeat?.properties?.name_ka ?? parentDid;
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
                    if (isCouncilMode && effectiveVoteType === "smd" && !r.name_ka && !r.candidate_name) {
                      const match = _allCouncilSMDResults.find(
                        d => String(d.district_id) === String(r.district_id) && d.party_id === r.party_id
                      );
                      if (match?.name_ka) return {...r, name_ka: match.name_ka};
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
            fillColor = d3.interpolateRgb("#fee2e2", "#b91c1c")(turnoutNorm(td, _turnoutMetricCtrl.value));
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
})();
```

```js
// ── CHART RENDERERS ────────────────────────────────────────────────────────
// Declare lang as a dep so all renderer functions re-create when language changes
lang;

// Renders national vote results into the info panel (default state — bar chart or turnout metrics)
function renderNationalPanel() {
  const resultTitle = t(isPresidential ? "elections.presidential.results_title"
                      : isPlebiscite   ? "elections.plebiscite_results_title"
                      :                  "elections.party_list_title");
  if (viewMode === "turnout") {
    // Turnout mode: show clickable metric rows for national data (same layout as district panels)
    return renderTurnoutPanel("national", {name_en: "National", name_ka: "ეროვნული"});
  }
  return html`<div class="card results-panel" id="results-panel">
    <div style="font-size:0.72rem; font-weight:700; text-transform:uppercase; letter-spacing:0.05em; color:var(--muted); margin-bottom:0.75rem; padding-bottom:0.5rem; border-bottom:1px solid var(--border);">
      ${t("elections.results.national")}
    </div>
    <div style="font-size:0.8rem; font-weight:600; color:var(--muted); margin-bottom:0.5rem;">${resultTitle}</div>
    ${renderBarChart(passed, failed, electionVal?.id, presidentialWinnerId)}
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
      <div class="bar-row" data-party-id="${d.party_id}" style="cursor:pointer;" title="${t("elections.chart.click_filter") || "Click to filter map"}">
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
          ${t("elections.chart.see_more")}
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
// isSelfgov=true: distId is a selfgov_id; aggregate all majoritarian districts in that unit
function updateCouncilSeats(distId, props, isSelfgov = false) {
  const chart = document.getElementById("council-seat-chart");
  if (!chart) return;

  // Select rows for this district or self-governing unit
  // Seat composition always reflects SMD wins (stable across PR/SMD map view)
  let distRows;
  if (isSelfgov) {
    // Always use council SMD results for selfgov seat charts regardless of current map vote type
    // major_id = selfgov_id * 100 + local_seq  →  selfgov_id = floor(major_id / 100)
    distRows = _allCouncilSMDResults.filter(r =>
      String(r.district_id) !== "national" &&
      Math.floor(Number(r.district_id) / 100) === Number(distId)
    );
  } else {
    distRows = results.filter(r => String(r.district_id) === distId);
  }

  // Compute actual wins (1 winner per majoritarian district); seat chart is always SMD-win based
  const _smdWins = new Map();
  for (const rows of d3.group(
    distRows.filter(r => String(r.district_id) !== "national"),
    r => String(r.district_id)
  ).values()) {
    const w = rows.reduce((a, b) => b.votes > a.votes ? b : a);
    _smdWins.set(w.party_id, (_smdWins.get(w.party_id) ?? 0) + 1);
  }
  const _totalSMD = d3.sum([..._smdWins.values()]);

  // Look up actual PR seats for this selfgov unit from the seats CSV
  const _unitSeats    = isSelfgov ? (_seatsMap.get(distId) ?? new Map()) : new Map();
  const _totalPRUnit  = d3.sum([..._unitSeats.values()], d => d.seats_pr);

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
      seats_smd: _smdWins.get(party_id) ?? 0,  // always use computed wins
      seats_pr:  isSelfgov ? (_unitSeats.get(party_id)?.seats_pr ?? 0) : (v.seats_pr ?? 0),
      party: getParty(party_id),
      color: partyColor(party_id, electionVal?.id)
    })
  ).sort((a, b) => b.vote_share - a.vote_share);

  const distElec = {...electionVal, council: {
    total_pr_seats:  _totalPRUnit,
    total_smd_seats: _totalSMD
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
    const color        = partyColor(r.party_id, electionVal?.id);
    const shareStr     = `${(r.vote_share * 100).toFixed(1)}%`;
    const countStr     = r.votes != null ? r.votes.toLocaleString() : "—";
    const partyName    = getParty(r.party_id).name?.[lang] || r.party_id;
    const candidateName = r.candidate_name || r.name_ka || null;
    const el = html`<tr class="dist-table-row" data-party-id="${r.party_id}" title="${t("elections.chart.click_filter") || "Click to filter map"}">
      <td style="vertical-align:middle;">
        <span class="party-dot" style="background:${color}; vertical-align:middle;"></span>
        ${isSMD && candidateName
          ? html`<strong style="font-size:0.82rem;">${candidateName}</strong>
                 <div style="font-size:0.72rem; color:var(--muted); margin-left:15px;">${partyName}</div>`
          : html`${partyName}${r.threshold_status === "failed" ? html`<span style="color:var(--muted);font-size:0.72rem;"> ✗</span>` : ""}`
        }
      </td>
      <td style="text-align:right; white-space:nowrap; vertical-align:middle;">
        <span style="font-weight:700;">${shareStr}</span>
        <span style="color:var(--muted); font-size:0.75rem; margin-left:4px;">(${countStr})</span>
      </td>
    </tr>`;
    el.addEventListener("click", () => selectPartyOnMap(r.party_id));
    return el;
  }

  const panel = html`<div class="card results-panel" id="results-panel">
    ${panelBackHeader(pname)}
    ${distId === "__precinct__" && props?.address_ka ? html`
      <div style="font-size:0.75rem; color:var(--muted); padding:0 0 8px 0;">
        <span style="font-weight:600;">${t("elections.results.address") || "Address"}:</span>
        ${props.address_ka}
      </div>` : ""}
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
          ${t("elections.chart.see_more")}
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
  const isNational = distId === "national";
  const td = turnoutLookup instanceof Map ? turnoutLookup.get(distId) : turnoutByDistrict.get(distId);
  const turnoutCfg = electionVal?.turnout ?? {};

  if (!td) {
    return html`<div class="card results-panel" id="results-panel">
      ${isNational ? "" : panelBackHeader(pname)}
      <p style="color:var(--muted); font-size:0.85rem;">${t("elections.turnout.no_data")}</p>
    </div>`;
  }

  const activeMet = _mapCtrl.current?.currentTurnoutMetric ?? "final";

  // Metric rows — clickable, switches the map coloring
  function metricRow(metric, label, value, sub) {
    if (!value) return "";
    const isActive = activeMet === metric;
    const el = html`<div class="turnout-metric-row${isActive ? " metric-row-active" : ""}" data-metric="${metric}">
      <span class="metric-row-label" style="color:var(--muted);">${label}</span>
      <span style="font-weight:700;">${value}${sub ? html`<span style="font-weight:400;color:var(--muted);font-size:0.74rem;margin-left:4px;">${sub}</span>` : ""}</span>
    </div>`;
    el.addEventListener("click", () => _mapCtrl.current?.setTurnoutMetric(metric));
    return el;
  }

  // Static rows (non-metric info)
  function statRow(label, value, sub) {
    return html`<div style="display:flex;justify-content:space-between;align-items:baseline;padding:5px 0;border-bottom:1px solid var(--border);font-size:0.82rem;">
      <span style="color:var(--muted);">${label}</span>
      <span style="font-weight:700;">${value}${sub ? html`<span style="font-weight:400;color:var(--muted);font-size:0.75rem;margin-left:4px;">${sub}</span>` : ""}</span>
    </div>`;
  }

  const pct      = td.turnout_pct  != null ? `${(td.turnout_pct  * 100).toFixed(1)}%`
                 : (td.voted != null && td.registered > 0) ? `${(td.voted / td.registered * 100).toFixed(1)}%` : null;
  const noonPct  = td.noon_pct  != null ? `${(td.noon_pct  * 100).toFixed(1)}%`
                 : (td.voted_noon != null && td.registered > 0) ? `${(td.voted_noon / td.registered * 100).toFixed(1)}%` : null;
  const fivePct  = td.five_pct  != null ? `${(td.five_pct  * 100).toFixed(1)}%`
                 : (td.voted_5pm  != null && td.registered > 0) ? `${(td.voted_5pm  / td.registered * 100).toFixed(1)}%` : null;
  const invPct   = td.invalid_pct != null ? `${(td.invalid_pct * 100).toFixed(1)}%`
                 : (td.invalid_ballots != null && td.voted > 0) ? `${(td.invalid_ballots / td.voted * 100).toFixed(1)}%` : null;

  return html`<div class="card results-panel" id="results-panel">
    ${isNational
      ? html`<div style="font-size:0.72rem;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;color:var(--muted);margin-bottom:0.75rem;padding-bottom:0.5rem;border-bottom:1px solid var(--border);">${t("elections.results.national")}</div>`
      : panelBackHeader(pname)}
    ${props.precinct_name_ka ? html`<div style="font-size:0.78rem;color:var(--muted);margin:-4px 0 8px;">${props.precinct_name_ka}</div>` : ""}
    ${metricRow("final", t("elections.turnout.pct"), pct)}
    ${statRow(t("elections.turnout.voted"),      td.voted      != null ? td.voted.toLocaleString()      : "—")}
    ${statRow(t("elections.turnout.registered"), td.registered != null ? td.registered.toLocaleString() : "—")}
    ${(turnoutCfg.has_snapshots || noonPct) && noonPct ? metricRow("noon", t("elections.turnout.noon"), noonPct, td.voted_noon != null ? `(${td.voted_noon.toLocaleString()})` : null) : ""}
    ${(turnoutCfg.has_snapshots || fivePct) && fivePct ? metricRow("5pm",  t("elections.turnout.5pm"),  fivePct,  td.voted_5pm  != null ? `(${td.voted_5pm.toLocaleString()})` : null)  : ""}
    ${turnoutCfg.has_lists && td.main_list    != null ? statRow(t("elections.turnout.main_list"),    td.main_list.toLocaleString())    : ""}
    ${turnoutCfg.has_lists && td.special_list != null ? statRow(t("elections.turnout.special_list"), td.special_list.toLocaleString()) : ""}
    ${invPct ? metricRow("invalid", t("elections.turnout.invalid_pct") || "Invalid ballots", invPct, td.invalid_ballots != null ? `(${td.invalid_ballots.toLocaleString()})` : null) : ""}
  </div>`;
}

// ── Precinct info panel (unified: vote results + turnout) ─────────────────
// Shows voting breakdown first, then turnout stats. Metric rows are clickable.
function renderPrecinctPanel(props, td, stationRows) {
  const pname = lang === "ka" ? props.name_ka : props.name_en;
  const turnoutCfg = electionVal?.turnout ?? {};
  const activeMet  = _mapCtrl.current?.currentTurnoutMetric ?? "final";
  const isSMDPrec  = effectiveVoteType === "smd" || isPresidential;

  // ── Voting results block ─────────────────────────────────────────────────
  const _sortedRows = [...stationRows].sort((a, b) => b.vote_share - a.vote_share);
  const _topRows    = _sortedRows.slice(0, 5);
  const _moreRows   = _sortedRows.slice(5);
  const colHeader   = isSMDPrec ? t("elections.results.candidate") : t("elections.results.party");

  function voteRow(r) {
    const color        = partyColor(r.party_id, electionVal?.id);
    const shareStr     = `${(r.vote_share * 100).toFixed(1)}%`;
    const countStr     = r.votes != null ? r.votes.toLocaleString() : "—";
    const pname_r      = getParty(r.party_id).name?.[lang] || r.party_id;
    const candidateName = r.candidate_name || r.name_ka || null;
    return html`<tr>
      <td style="vertical-align:middle;">
        <span class="party-dot" style="background:${color};vertical-align:middle;"></span>
        ${isSMDPrec && candidateName
          ? html`<strong style="font-size:0.82rem;">${candidateName}</strong>
                 <div style="font-size:0.72rem;color:var(--muted);margin-left:15px;">${pname_r}</div>`
          : html`${pname_r}`}
      </td>
      <td style="text-align:right;white-space:nowrap;vertical-align:middle;">
        <span style="font-weight:700;">${shareStr}</span>
        <span style="color:var(--muted);font-size:0.75rem;margin-left:4px;">(${countStr})</span>
      </td>
    </tr>`;
  }

  const voteBlock = _sortedRows.length > 0 ? html`
    <table class="dist-table">
      <thead><tr>
        <th>${colHeader}</th>
        <th style="text-align:right;">${t("elections.results.share")}</th>
      </tr></thead>
      <tbody>${_topRows.map(voteRow)}</tbody>
    </table>
    ${_moreRows.length > 0 ? html`
      <details class="below-threshold-details">
        <summary class="below-threshold-summary">
          ${t("elections.chart.see_more")}
          <span class="below-threshold-count">${_moreRows.length}</span>
        </summary>
        <table class="dist-table"><tbody>${_moreRows.map(voteRow)}</tbody></table>
      </details>` : ""}
  ` : "";

  // ── Turnout block ────────────────────────────────────────────────────────
  // Clickable metric row — clicking switches the map to that turnout metric
  function metricRow(metric, label, value, sub) {
    if (!value) return "";
    const isActive = activeMet === metric;
    const el = html`<div class="turnout-metric-row${isActive ? " metric-row-active" : ""}" data-metric="${metric}">
      <span class="metric-row-label" style="color:var(--muted);">${label}</span>
      <span style="font-weight:700;">${value}${sub ? html`<span style="font-weight:400;color:var(--muted);font-size:0.74rem;margin-left:4px;">${sub}</span>` : ""}</span>
    </div>`;
    el.addEventListener("click", () => _mapCtrl.current?.setTurnoutMetric(metric));
    return el;
  }
  function statRow(label, value) {
    return html`<div style="display:flex;justify-content:space-between;align-items:baseline;padding:4px 0;border-bottom:1px solid var(--border);font-size:0.81rem;">
      <span style="color:var(--muted);">${label}</span>
      <span style="font-weight:700;">${value}</span>
    </div>`;
  }

  const _pct     = td?.turnout_pct != null ? `${(td.turnout_pct * 100).toFixed(1)}%` : null;
  const _noonPct = td?.noon_pct  != null ? `${(td.noon_pct  * 100).toFixed(1)}%`
                 : (td?.voted_noon != null && td?.registered > 0) ? `${(td.voted_noon / td.registered * 100).toFixed(1)}%` : null;
  const _fivePct = td?.five_pct  != null ? `${(td.five_pct  * 100).toFixed(1)}%`
                 : (td?.voted_5pm  != null && td?.registered > 0) ? `${(td.voted_5pm  / td.registered * 100).toFixed(1)}%` : null;
  const _invPct  = td?.invalid_pct != null ? `${(td.invalid_pct * 100).toFixed(1)}%`
                 : (td?.invalid_ballots != null && td?.voted > 0) ? `${(td.invalid_ballots / td.voted * 100).toFixed(1)}%` : null;

  const turnoutBlock = td ? html`
    <div style="font-size:0.7rem;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;color:var(--muted);margin:10px 0 4px;padding-top:8px;border-top:1px solid var(--border);">
      ${t("elections.turnout.title")}
    </div>
    ${metricRow("final", t("elections.turnout.pct"), _pct)}
    ${statRow(t("elections.turnout.voted"),      td.voted      != null ? td.voted.toLocaleString()      : "—")}
    ${statRow(t("elections.turnout.registered"), td.registered != null ? td.registered.toLocaleString() : "—")}
    ${(turnoutCfg.has_snapshots || _noonPct) && _noonPct ? metricRow("noon", t("elections.turnout.noon"), _noonPct, td.voted_noon != null ? `(${td.voted_noon.toLocaleString()})` : null) : ""}
    ${(turnoutCfg.has_snapshots || _fivePct) && _fivePct ? metricRow("5pm",  t("elections.turnout.5pm"),  _fivePct, td.voted_5pm  != null ? `(${td.voted_5pm.toLocaleString()})` : null)  : ""}
    ${turnoutCfg.has_lists && td.main_list    != null ? statRow(t("elections.turnout.main_list"),    td.main_list.toLocaleString())    : ""}
    ${turnoutCfg.has_lists && td.special_list != null ? statRow(t("elections.turnout.special_list"), td.special_list.toLocaleString()) : ""}
    ${_invPct ? metricRow("invalid", t("elections.turnout.invalid_pct") || "Invalid ballots", _invPct, td.invalid_ballots != null ? `(${td.invalid_ballots.toLocaleString()})` : null) : ""}
  ` : "";

  return html`<div class="card results-panel" id="results-panel">
    ${panelBackHeader(pname)}
    ${props.address_ka ? html`
      <div style="font-size:0.74rem;color:var(--muted);padding-bottom:6px;border-bottom:1px solid var(--border);margin-bottom:4px;">
        <span style="font-weight:600;">${t("elections.results.address") || "Address"}:</span> ${props.address_ka}
      </div>` : ""}
    ${voteBlock}
    ${turnoutBlock}
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
        ${(turnoutCfg.has_snapshots || row.voted_noon != null) && row.voted_noon != null ? html`
          <div style="font-size:0.78rem; color:var(--muted); margin-bottom:3px;">
            ${t("elections.turnout.noon")}: <strong>${row.noon_pct != null ? `${(row.noon_pct*100).toFixed(1)}%` : `${(row.voted_noon/row.registered*100).toFixed(1)}%`}</strong>
            <span style="opacity:0.7;"> (${row.voted_noon.toLocaleString()})</span>
          </div>
          <div style="font-size:0.78rem; color:var(--muted); margin-bottom:3px;">
            ${t("elections.turnout.5pm")}: <strong>${row.five_pct != null ? `${(row.five_pct*100).toFixed(1)}%` : `${(row.voted_5pm/row.registered*100).toFixed(1)}%`}</strong>
            <span style="opacity:0.7;"> (${row.voted_5pm.toLocaleString()})</span>
          </div>` : ""}
        ${row.invalid_ballots != null ? html`
          <div style="font-size:0.78rem; color:var(--muted); margin-bottom:3px;">
            ${t("elections.turnout.invalid_pct") || "Invalid"}: <strong>${row.invalid_pct != null ? `${(row.invalid_pct*100).toFixed(1)}%` : "—"}</strong>
            <span style="opacity:0.7;"> (${row.invalid_ballots.toLocaleString()})</span>
          </div>` : ""}
        ${turnoutCfg.has_lists && row.main_list != null ? html`
          <div style="font-size:0.78rem; color:var(--muted); margin-bottom:3px;">
            ${t("elections.turnout.main_list")}: <strong>${row.main_list.toLocaleString()}</strong>
          </div>
          <div style="font-size:0.78rem; color:var(--muted);">
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
  if (filter === "pr")    return d.seats_pr    ?? 0;
  if (filter === "smd")   return d.seats_smd   ?? 0;
  if (filter === "mayor") return d.seats_mayor ?? 0;
  return (d.seats_pr ?? 0) + (d.seats_smd ?? 0) + (d.seats_comp ?? 0);
}

function partiesForFilter(parties, filter, elec) {
  return parties.filter(d => seatsFor(d, filter) > 0);
}
```
