---
name: elections.md architecture and cell structure
description: How the main elections page is structured — cell order, key variables, data flow, render functions, election type flags
type: project
---

**File:** `src/elections.md`

## Cell order (top to bottom)

1. **Imports + config** — Leaflet, D3, state.js; load elections.json, parties.json, translations.json; define `lang`, `t()`
2. **typeInput / typeVal** — election type selector (parliamentary/presidential/adjara/plebiscite)
3. **electionInput / electionVal** — election dropdown, filtered by typeVal, sorted newest→oldest by date
4. **subElectionInput / subVal** — sub-election/question dropdown (runoffs, by-elections, referendum questions); `hasSubElections`
5. **voteTypeInput / voteTypeVal** — PR/SMD/compensation radio; `hasSMD`, `hasComp`, `voteTypeOptions`
6. **Election type flags** — computed immediately after voteTypeInput:
   ```js
   const isPresidential    = electionVal?.type === "presidential";
   const isIndirect        = isPresidential && electionVal?.sub_type === "indirect";
   const isPlebiscite      = electionVal?.type === "plebiscite";
   const isSubElectionSMD  = !isPresidential &&
     subVal?.id !== "__main__" &&
     (subVal?.type === "runoff" || subVal?.type === "by_election");
   const effectiveVoteType = isSubElectionSMD ? "smd" : voteTypeVal;
   ```
7. **mapModeInput / mapMode** — geographic vs cartogram radio (hidden for indirect presidential)
8. **hasPrecinct + mapLevelInput / mapLevel** — districts vs precincts toggle (shown only if precinct data exists, hidden for indirect)
9. **hasTurnout + viewModeInput / viewMode** — results vs turnout toggle (shown only if turnout data exists)
10. **seatFilterInput / seatFilter** — all/PR/SMD seat filter (shown only for mixed elections, hidden for presidential/plebiscite)
11. **Data loading** — `_allGeo`, `_allCsv`, `_allTurnout` pre-loaded FileAttachment dicts; `loadGeoJSON()`, `loadResults()`, `loadTurnout()`; reactive `geoData`, `cartData`, `results`, `turnoutData`
12. **Party helpers** — `getParty()` (checks electionVal.candidates first, then parties.yml), `partyColor()`; `nationalResults`, `nationalArray`, `hasThreshold`, `passed`, `failed`
13. **`presidentialWinnerId`** — `nationalArray[0].party_id` when runoff or vote_share > 0.5
14. **turnoutByDistrict** — Map keyed by district_id, built from `turnoutData`. TOP-LEVEL cell (not inside IIFE).
15. **mapContainer** — standalone stable `<div>` for Leaflet (no reactive deps)
16. **Container + display** — full layout HTML; explicit dep line at top; conditional filter panel items; bottom section switches between turnout summary and bar chart; indirect → renderElectoralCollege replaces map
17. **Map IIFE** — explicit dep line; Leaflet choropleth; `districtStyle()` uses blue gradient for turnout or party colors for results; zoom-based precinct layer transition
18. **Chart renderers** — `renderBarChart()`, `renderDots()`, `renderSeatLegend()`, `renderDistrictPanel()`, `renderTurnoutPanel()`, `renderTurnoutSummary()`, `renderElectoralCollege()`, `seatsFor()`, `partiesForFilter()`

## Key election type flags and their effects

| Flag | Condition | Effects |
|------|-----------|---------|
| `isPresidential` | `type === "presidential"` | Hides seat section; bar chart title → presidential.results_title; `isSMD=true` in district panel (shows candidates); uses `electionVal.candidates` for party lookup |
| `isIndirect` | presidential + `sub_type === "indirect"` | Replaces map with `renderElectoralCollege()`; hides map mode + map level controls |
| `isPlebiscite` | `type === "plebiscite"` | Hides seat section; hides turnout composition card; questions shown as sub-election radio buttons |
| `isSubElectionSMD` | non-presidential sub-election of type runoff/by_election | Forces `effectiveVoteType = "smd"`; hides vote type toggle |
| `presidentialWinnerId` | presidential + runoff OR vote_share > 0.5 | Passes winner id to `renderBarChart()` → ✓ badge shown |

## Elections.yml structure (key fields)

```yaml
- id: parl_2024
  type: parliamentary | presidential | adjara | plebiscite
  sub_type: pr | mixed | messy | direct | indirect
  date: "YYYY-MM-DD"
  system:
    pr:
      enabled: true/false
      seats: N
      shape_file: "..."
      precinct_shape_file: "..."  # optional, enables precinct drill-down
    smd:
      enabled: true/false
      seats: N
      shape_file: "..."
    compensation:
      enabled: true/false
  candidates:               # presidential only
    - id: zourabichvili
      name: {en: "...", ka: "..."}
      party: gd             # affiliated party for color
      color: "#hex"         # override color
  questions:                # plebiscite only — treated as sub-elections
    - id: ref_2024_q1
      type: question
      name: {en: "...", ka: "..."}
      text: {en: "...", ka: "..."}
      files:
        pr_results: "..."
        pr_precinct_results: "..."
  electoral_college:        # indirect presidential only
    total: 300
    for: 224
    against: 0
    abstained: 19
    absent: 57
  files:
    pr_results: "..."
    pr_precinct_results: "..."  # optional
    smd_results: "..."
    smd_precinct_results: "..."  # optional
    cartogram: "..."
  turnout:
    available: true/false
    type: basic | detailed
    file: "..."
    precinct_file: "..."   # optional
    has_snapshots: true/false
    has_lists: true/false
  sub_elections:
    - id: ...
      type: runoff | by_election | question
      name: {en: "...", ka: "..."}
      files:
        smd_results: "..."
        smd_precinct_results: "..."  # optional
        pr_precinct_results: "..."   # optional
```

## loadResults() function (data routing logic)

```js
function loadResults(elec, vt, sub, level) {
  const isSubActive = sub?.id !== "__main__";
  if (isSubActive) {
    if (level === "precinct") {
      const subPrecinct = sub?.files?.smd_precinct_results ?? sub?.files?.pr_precinct_results;
      if (subPrecinct) return _allCsv[subPrecinct] ?? [];
    }
    const subPath = sub?.files?.smd_results ?? sub?.files?.results;
    if (subPath) return _allCsv[subPath] ?? [];
  }
  if (level === "precinct") {
    const path = vt === "smd"
      ? (elec?.files?.smd_precinct_results ?? elec?.files?.smd_results)
      : (elec?.files?.pr_precinct_results  ?? elec?.files?.pr_results);
    return _allCsv[path] ?? [];
  }
  const path = vt === "smd"        ? elec?.files?.smd_results
             : vt === "compensation" ? elec?.files?.compensation_results
             : elec?.files?.pr_results;
  return _allCsv[path] ?? [];
}
```

## Zoom-based precinct layer (map IIFE)

When `hasPrecinct` is true and `mapLevel === "district"`, the map renders BOTH:
- A **district layer** (choropleth, fades to hollow at high zoom)
- A **precinct layer** (hidden at low zoom, appears at high zoom)

Transition zoom threshold is configured in the map IIFE. At high zoom:
- District layer: opacity lowered or stroke-only
- Precinct layer: becomes visible, colored by party/turnout

## renderElectoralCollege() — square dot grid

```js
function renderElectoralCollege(elec) {
  const ec = elec.electoral_college;
  const COLS = Math.round(Math.sqrt(ec.total));
  const totalSlots = COLS * Math.ceil(ec.total / COLS);
  const allDots = [...dots, ...Array(totalSlots - dots.length).fill("empty")];
  // grid-template-columns: repeat(${COLS}, 9px); gap: 2px;
}
```

## getParty() — presidential candidate lookup

```js
function getParty(partyId) {
  // 1. Check election-level candidates (presidential)
  const candidate = electionVal?.candidates?.find(c => c.id === partyId);
  if (candidate) {
    const partyRef = candidate.party ? parties.find(p => p.id === candidate.party) : null;
    const color = candidate.color ?? partyRef?.colors?.default ?? "#9E9E9E";
    return {id: partyId, name: candidate.name, colors: {default: color}};
  }
  // 2. Fallback to parties.yml
  return parties.find(p => p.id === partyId) ?? {id: partyId, name: {en: partyId, ka: partyId}, colors: {default: "#9E9E9E"}};
}
```

## Parties.yml structure

```yaml
- id: gd
  name: {en: "Georgian Dream", ka: "ქართული ოცნება"}
  colors:
    default: "#1565C0"
    parl_2024: "#1565C0"   # election-specific override optional
```

## Filter panel CSS

- `.filter-panel { --input-width: 186px; overflow: hidden; }` — controls Observable input width
- Labels stripped from all `Inputs.select`/`Inputs.radio` calls; manual `.filter-label` divs above each input
- Modern select styling: `appearance: none`, custom SVG chevron, `border-radius: 8px`, hover/focus states

## Layout CSS

```css
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
```

## Container dep line (must include all conditional variables)

```js
hasTurnout; hasPrecinct; viewMode; mapLevel; voteTypeOptions; seatFilterOptions;
hasSubElections; isSubElectionSMD; isPresidential; isIndirect; isPlebiscite; presidentialWinnerId;
```
