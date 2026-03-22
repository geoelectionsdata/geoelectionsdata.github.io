---
name: Observable Framework patterns and gotchas
description: Critical Observable Framework dev patterns learned from debugging — cache, FileAttachment, reactive deps
type: feedback
---

## Stale data loader cache
Observable Framework caches data loader output in `src/.observablehq/cache/data/`. The cache key is based on the loader JS file hash, NOT the files it reads. So if you update `elections.yml` but not `elections.json.js`, the cache is NOT invalidated and the browser gets stale data.

**Fix:** Delete `src/.observablehq/cache/data/elections.json` (or whichever loader's output changed), then hard-refresh the browser.

**Why:** Spent a session debugging "why aren't the toggles showing" — the elections.json served to the browser simply didn't have the new `turnout`/`precinct_shape_file` fields because the cache was stale from before the YAML was updated.

**How to apply:** Whenever `elections.yml` or `parties.yml` is modified, always delete the corresponding cache file before testing.

---

## FileAttachment requires static string literals
`FileAttachment("some/path.json")` must have a LITERAL string — no variables. Observable Framework does static analysis at build time.

**Fix:** Pre-load ALL known files into lookup dictionaries (`_allGeo`, `_allCsv`, `_allTurnout`) with static string keys. Then look up by path at runtime.

---

## Explicit reactive dependency declarations
Observable Framework's static analysis can miss dependencies buried inside nested `html\`...\`` template literals. The map IIFE uses an explicit dep line at the top:
```js
electionVal; voteTypeVal; mapMode; mapLevel; viewMode; lang; geoData; cartData; results; turnoutData; turnoutByDistrict;
```
The layout container cell also has this:
```js
hasTurnout; hasPrecinct; viewMode; mapLevel; voteTypeOptions; seatFilterOptions; hasSubElections;
```
**Why:** Without explicit deps, cells with conditionals like `${hasTurnout ? html\`...\` : ""}` may not re-render when the condition changes.

---

## Cross-cell variable scope
Variables defined inside an IIFE (async arrow function) are NOT accessible to other Observable cells. `turnoutByDistrict` was originally inside the map IIFE and couldn't be used by `renderTurnoutPanel`. Fix: define at top-level cell scope.

---

## Stable Leaflet map node
`mapContainer` is defined as a standalone cell with no reactive deps, so it's created once. It's embedded via `${mapContainer}` in the layout — this MOVES (not copies) the DOM node, preserving the Leaflet instance across container re-renders. Cleanup: `invalidation.then(() => { try { map.remove(); } catch(e) {} })`.
