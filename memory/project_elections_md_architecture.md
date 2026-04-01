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

## elections.md — URL deep-link support

`_typeCtrl` and `_electionCtrl` are bootstrapped from URL params on page load:

```js
const _urlParams    = new URLSearchParams(window.location.search);
const _typeCtrl     = {value: _urlParams.get("type") ?? "parliamentary"};
const _electionCtrl = {value: _urlParams.get("election") ?? null};
```

Event listeners call `history.replaceState` to keep the URL in sync:
```js
typeInput.addEventListener("input", () => {
  _typeCtrl.value = typeInput.value;
  const _p = new URLSearchParams(window.location.search);
  _p.set("type", typeInput.value); _p.delete("election");
  history.replaceState(null, "", "?" + _p.toString());
});
electionInput.addEventListener("input", () => {
  _electionCtrl.value = electionInput.value?.id ?? null;
  const _p = new URLSearchParams(window.location.search);
  if (electionInput.value?.id) _p.set("election", electionInput.value.id);
  history.replaceState(null, "", "?" + _p.toString());
});
```

Links to a specific election from any page: `elections?type=parliamentary&election=parl_2024`

---

## index.md — Main page architecture

**File:** `src/index.md`

### Cell order

1. **Static imports** — L, d3, getLang, tr; FileAttachments: dict, elections, parties, `_allGeo` (geo-registry.json), `_allCsv` (csv-registry.json)
2. **`lang`** — reactive Generator (own cell)
3. **`t`** — translation fn, depends on lang+dict
4. **Featured election** — picks from national elections (parliamentary/presidential, non-indirect, has geo+results), rotates daily via `Math.floor(Date.now() / 86400000) % n`. Builds `_winnerMap` (district → winner row). Defines `featPartyColor()`, `featPartyName()`.
5. **`mapContainer`** — stable fixed-height div (`height: 440px`), no reactive deps, created once
6. **Layout cell** — depends on `lang`; re-renders text but moves (not copies) `mapContainer` back in. Renders: 60/40 grid (3fr 2fr), map card (left) + info card (right), browse section (election cards by type). Calls `display(layout)`.
7. **Map IIFE** — has `lang;` dep to guarantee it runs AFTER the layout cell calls `display()`. Initializes Leaflet, adds tile layer, adds GeoJSON choropleth colored by district winner. `interactive: false`. `setTimeout(() => map.invalidateSize(), 100)`.

### Key design decisions

- **Fixed map height**: `mapContainer` uses `height: 440px` (not `height: 100%`). `height: 100%` inside a flex item resolves to 0. Fixed height is required for Leaflet to have concrete dimensions.
- **`lang;` in map IIFE**: Ensures map IIFE runs after layout cell (which also depends on `lang`) has called `display()`. Without this, the map may initialize before the container is in the DOM.
- **Browse section**: Cards (not accordions). Each election type has a heading + row of compact cards. Cards link to `elections?type=X&election=Y`. Cards with no results data are shown at 50% opacity.
- **Info card**: `max-height: 480px; overflow-y: auto` so long notes blurbs scroll rather than stretching the layout.
- **Election name lookup**: `featPartyName(p)` checks `p.alias?.[lang]` first (used in historical YAMLs like 1919), falls back to `parties.json` name.

### Notes / blurb rendering — always use innerHTML

Notes fields in YAMLs may contain HTML (`<a href="...">, <b>, <em>`). Never embed them via `html\`...\`` template literals — that escapes tags as text. Always create an element and set `innerHTML`:

```js
// WRONG — shows <a href="..."> as literal text
html`<p>${featNotes}</p>`

// CORRECT
const _n = document.createElement("p");
_n.className = "idx-info-notes";
_n.innerHTML = featNotes;
// then embed _n in the template: ${_n}
```

Inline IIFE pattern used in index.md:
```js
${(() => { if (!featNotes) return ""; const _n = document.createElement("p"); _n.className = "idx-info-notes"; _n.innerHTML = featNotes; return _n; })()}
```

`renderElectionInfo()` in elections.md uses the same pattern (`notesNode.innerHTML = notesRaw`).

---

### Browse section pattern

Collapsible `<details>` per type — starts collapsed, shows count pill and `▸` chevron:

```js
function renderBrowseSection(typeKey) {
  const list = (_byType.get(typeKey) ?? []).sort(...);
  return html`<details class="idx-browse-section">
    <summary class="idx-browse-summary">
      <span class="idx-browse-type-label">${t(`type.${typeKey}`)}</span>
      <span class="idx-browse-count">${list.length}</span>
      <span class="idx-browse-chevron">▸</span>
    </summary>
    <div class="idx-elec-cards">
      ${list.map(e => html`<a href="elections?type=${e.type}&election=${e.id}" class="idx-elec-card">
        <div class="idx-elec-card-year">${year}</div>
        <div class="idx-elec-card-name">${name}</div>
      </a>`)}
    </div>
  </details>`;
}
```

### Layout notes
- **Grid overflow fix**: `min-width: 0` on all grid children prevents items overflowing their columns
- **Page width**: `.idx-page-wrap { max-width: 1150px }` wraps all content
- **Split**: `7fr 3fr` (70/30) at `min-width: 700px`

---

## Container dep line (must include all conditional variables)

```js
hasTurnout; hasPrecinct; viewMode; mapLevel; voteTypeOptions; seatFilterOptions;
hasSubElections; isSubElectionSMD; isPresidential; isIndirect; isPlebiscite; presidentialWinnerId;
isCouncilMode; lang;
```

## Language reactivity — cell split pattern

`lang` and `t` must each be in their own separate cells. If combined with async `FileAttachment` loads, Observable Framework won't cascade `t` as "changed" to downstream cells:

```js
// Cell 1 — static imports (runs once)
import L from "npm:leaflet";
import * as d3 from "npm:d3";
import {getLang, tr} from "./components/state.js";
const dict      = await FileAttachment("data/config/translations.json").json();
const elections = await FileAttachment("data/elections.json").json();
const parties   = await FileAttachment("data/parties.json").json();

// Cell 2 — lang alone (reactive Generator, cascades on language switch)
const lang = getLang();

// Cell 3 — t depends on lang and dict
const t = k => tr(dict, lang, k);
```

Also add `lang;` to:
- The container dep line
- The chart renderers cell top (forces re-creation of all renderer functions)
- The map IIFE dep line

## `_viewModeCtrl` — standalone no-dep cell

Must be in its **own cell with no dependencies**. If placed in the same cell as `hasTurnout` (which depends on `electionVal`), any language switch causes `hasTurnout` cell to re-run, resetting `_viewModeCtrl` to `{value: "results"}` and losing the user's view mode selection.

```js
// Standalone cell — runs exactly once on page load
const _viewModeCtrl = {value: "results"};
```

The `viewModeInput` cell reads `_viewModeCtrl.value` as its initial value and writes back on user input:

```js
viewModeInput.addEventListener("input", () => { _viewModeCtrl.value = viewModeInput.value; });
```

## Imperative turnout metric switching — `_turnoutMetricCtrl`

No sidebar radio for turnout metric. Metric switching is imperative (no full re-render):

```js
// Standalone cell
const _turnoutMetrics = ["final", "noon", "5pm", "invalid"];
const _turnoutMetricCtrl = {value: "final"};
```

`setTurnoutMetric(metric)` on `_mapCtrl.current` updates `_turnoutMetricCtrl.value`, toggles `.metric-row-active` CSS on `.turnout-metric-row[data-metric]` elements, and calls `districtLayer.setStyle(districtStyle)` imperatively — analogous to `setPartyFilter`.

Inside `pointToLayer` (precinct dots), always read `_turnoutMetricCtrl.value` (not any reactive `turnoutMetricVal`).

## Turnout UI layout

- **Top-right panel (national):** `renderNationalPanel()` — in turnout mode calls `renderTurnoutPanel("national", ...)` showing clickable metric rows
- **Bottom-right card (seat allocation area):** shows `renderTurnoutSummary()` in turnout mode instead of seat chart
- **`renderTurnoutPanel`** supports `distId === "national"` (no back button); metric rows are clickable → call `_mapCtrl.current?.setTurnoutMetric(metric)`
- **`renderTurnoutSummary`** layout: no vote_type label; noon and 5pm each on separate `<div>` lines; main_list and special_list each on separate `<div>` lines

## Map centering

```js
const map = L.map(mapContainer, {zoomControl: true}).setView([42.1, 43.0], 7);
```
Shows full Georgia with Sukhumi visible on the left coast.

## Occupied territories

Abkhazia and South Ossetia are handled at the district level within the existing choropleth (no separate GeoJSON overlay layer needed). The `_occupiedGeo` FileAttachment is present but the overlay approach was abandoned.
