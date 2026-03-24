---
name: Observable Framework patterns and gotchas
description: Critical Observable Framework dev patterns learned from debugging — cache, FileAttachment, reactive deps, election type additions
type: feedback
---

## Stale data loader cache

Observable Framework caches data loader output in `src/.observablehq/cache/data/`. The cache key is based on the loader JS file hash, NOT the files it reads. So if you update `elections.yml` but not `elections.json.js`, the cache is NOT invalidated.

**Fix:** Delete `src/.observablehq/cache/data/elections.json` after every change to `elections.yml`. Use:
```bash
rm "src/.observablehq/cache/data/elections.json"
```

**Why:** Spent a session debugging "why aren't the toggles showing" — the cached elections.json didn't have `turnout`/`precinct_shape_file` fields. The browser was getting stale data.

**Rule:** Whenever `elections.yml` or `parties.yml` is modified, ALWAYS delete the corresponding cache file before testing.

---

## FileAttachment requires static string literals

`FileAttachment("some/path.json")` must have a LITERAL string — no variables. Observable Framework does static analysis at build time.

**Fix:** Pre-load ALL known files into lookup dictionaries (`_allGeo`, `_allCsv`, `_allTurnout`) with static string keys. Then look up by path at runtime.

**Pattern for adding a new election:**
1. Add election to `elections.yml`
2. Create all CSV files
3. Add FileAttachment entries to `_allCsv` and/or `_allTurnout` in `elections.md`
4. Delete elections.json cache
5. Hard refresh

---

## Explicit reactive dependency declarations

Observable Framework's static analysis can miss dependencies buried inside nested `html\`...\`` template literals. The map IIFE uses an explicit dep line at the top:
```js
electionVal; voteTypeVal; mapMode; mapLevel; viewMode; lang; geoData; cartData;
results; turnoutData; turnoutByDistrict; isPresidential; isIndirect; presidentialWinnerId;
```
The layout container cell also has:
```js
hasTurnout; hasPrecinct; viewMode; mapLevel; voteTypeOptions; seatFilterOptions;
hasSubElections; isSubElectionSMD; isPresidential; isIndirect; isPlebiscite; presidentialWinnerId;
```
**Why:** Without explicit deps, cells with conditionals like `${hasTurnout ? html\`...\` : ""}` may not re-render when the condition changes.

**Rule:** When adding a new boolean flag (e.g. `isPlebiscite`), add it to BOTH dep lines.

---

## Cross-cell variable scope

Variables defined inside an IIFE (async arrow function) are NOT accessible to other Observable cells. `turnoutByDistrict` was originally inside the map IIFE and couldn't be used by `renderTurnoutPanel`. Fix: define at top-level cell scope.

---

## Stable Leaflet map node

`mapContainer` is defined as a standalone cell with no reactive deps, so it's created once. It's embedded via `${mapContainer}` in the layout — this MOVES (not copies) the DOM node, preserving the Leaflet instance across container re-renders. Cleanup: `invalidation.then(() => { try { map.remove(); } catch(e) {} })`.

---

## Election type flags pattern

Election types are determined after `voteTypeInput` is defined (same cell block):

```js
const isPresidential    = electionVal?.type === "presidential";
const isIndirect        = isPresidential && electionVal?.sub_type === "indirect";
const isPlebiscite      = electionVal?.type === "plebiscite";
const isAdjara          = electionVal?.type === "adjara";
const isSubElectionSMD  = !isPresidential &&
  subVal?.id !== "__main__" &&
  (subVal?.type === "runoff" || subVal?.type === "by_election");
const effectiveVoteType = isSubElectionSMD ? "smd" : voteTypeVal;
```

**Critical:** `isSubElectionSMD` must have `!isPresidential` guard, or presidential runoffs will try to load non-existent `system.smd.shape_file`.

---

## Adding a new election type (checklist)

1. **elections.yml** — add type value (e.g. `type: adjara`) and relevant entries
2. **typeInput** — add new option to the election type selector input in elections.md
3. **filteredElections** — already filters by `e.type === typeVal`, no change needed
4. **isXxx flags** — add any needed flags (e.g. `isPlebiscite`)
5. **Conditional UI** — add `&& !isXxx` guards wherever the new type needs different behavior:
   - Seat section: `${!isPresidential && !isPlebiscite ? html\`...\` : ""}`
   - Turnout composition card: `${!isPlebiscite ? html\`...composition...\` : ""}`
   - Map controls: `${!isIndirect ? html\`...map controls...\` : ""}`
6. **Dep line** — add new flags to container dep line and map IIFE dep line
7. **_allCsv / _allTurnout** — add FileAttachment entries for all new CSV files
8. **Delete cache** — `rm src/.observablehq/cache/data/elections.json`

---

## Plebiscite / referendum pattern

Questions are modeled as sub-elections with `type: question` inside a `questions:` array in elections.yml. In elections.md, the questions array is merged into `sub_elections` for the dropdown:

```js
const allSubs = [
  {id: "__main__", name: ...},
  ...(electionVal?.questions ?? []),
  ...(electionVal?.sub_elections ?? [])
];
```

Each question has its own `files.pr_results` and `files.pr_precinct_results`. Results use `party_id: "yes"` / `"no"` which are defined in parties.yml with green/red colors.

Plebiscite-specific UI suppressions:
- No seat section (hidden with `!isPlebiscite` guard)
- No turnout composition card (hidden with `!isPlebiscite` guard)
- Questions appear in sub-election dropdown naturally

---

## Presidential elections pattern

Direct presidential: exactly like PR parliamentary — same map, same bar chart, same district panel. The trick is `party_id = candidate_id` in results CSVs, so the entire pipeline works unchanged. `getParty()` falls back to `electionVal.candidates` before `parties.yml`.

Indirect presidential: `renderElectoralCollege()` replaces map. Dot grid uses `Math.round(Math.sqrt(total))` columns for square layout.

Winner badge: pass `presidentialWinnerId` to `renderBarChart()`. Shows ✓ badge on winning candidate's bar.

---

## Adjara elections pattern

Adjara Supreme Council mixed elections work exactly like parliamentary mixed elections. No code changes needed — just:
- `type: adjara` in elections.yml (add to typeInput options)
- Same `system.pr` / `system.smd` structure as parliamentary
- Reuses `parl2024_pr.geojson` as placeholder shapefile (production needs Adjara municipality shapefiles)
- CSV format identical to parliamentary: `district_id, party_id, votes, vote_share, seats_pr, seats_smd, threshold_status`
- SMD CSV includes `candidate_name` column (same as parl2020_smd.csv)
- Both PR and SMD files must have MATCHING `seats_pr`/`seats_smd` columns for consistent seat chart

---

## Sub-election precinct data routing

`loadResults()` checks sub-election precinct files BEFORE falling back to district files. Order:
1. If sub active + level=precinct → `sub.files.smd_precinct_results ?? sub.files.pr_precinct_results`
2. If sub active → `sub.files.smd_results ?? sub.files.results`
3. If level=precinct → election-level precinct files
4. Otherwise → election-level district files by voteType

This allows referendum questions (sub-elections of type `question`) to have their own precinct files.
