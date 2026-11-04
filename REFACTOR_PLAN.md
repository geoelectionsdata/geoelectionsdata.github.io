# Dashboard Review & Developer Refactor Plan

How to read this document: the 2026-11-04 section is the current priority list.
The 2026-10-14 section holds the basemap and data-contract design, corrected in
place. The July plan is kept as a historical appendix.

## Review update: 2026-11-04 (current priorities, proposal only)

This section takes precedence over everything below. Application code, loaders,
generated data, and workflows were not changed as part of this review. Findings
were checked against commit `18db7c7` and the live site. The R results loaders
were rerun on a throwaway export with local R 4.3.2 (CI uses 4.4).

### Phase 0: make deployed data match the repository

**Implementation checkpoint (2026-11-04, local; not deployed):** Council
candidate results now use the council file for the specific ballot and
sub-election. Candidate number and name disambiguate results within the district;
unresolved or conflicting matches remain blank. Compared with the static
snapshots, candidate-detail changes were limited to vote counts/shares and
geographic fields (IDs, English names and map coordinates). Fresh party
strongholds return for 2017 and 2021 because they derive from matched candidate
appearances. Election metadata changed in two entries; the five path manifests
and the party registry matched. The featured loader now uses the first available
configured election and parses quoted CSV fields correctly.

The shadowing JSON files were removed and local/CI checks added. Only the two
2010 council result files were copied out of the isolated R run: district rows
3,357 to 4,037; precinct rows 15,197 to 17,916; district and precinct vote totals
agree at 1,675,334 excluding the district file's national aggregate. Main-election
council candidate join coverage after the refresh:

| Election | Matched / total | No district | No same-party row in district | Candidate mismatch or ambiguity |
|---|---:|---:|---:|---:|
| 2010 | 4,012 / 4,079 | 0 | 57 | 10 |
| 2014 | 5,389 / 5,903 | 0 | 202 | 312 |
| 2017 | 4,685 / 4,731 | 4 | 34 | 8 |
| 2021 | 2,567 / 2,771 | 0 | 200 | 4 |
| 2025 | 2,220 / 2,230 | 0 | 3 | 7 |

The table classifies misses by exact district and party presence; it does not
establish whether differences are spelling, historical roster differences, or
incorrect source identifiers. Do not force matches on that basis.

**2016 isolated audit:** The geometry's lowercase `district` and `precinct`
properties, combined with `MID`, form 3,634 unique keys; the old `id` has
only 828 distinct values. The tuple encoded with the loader's fallback arithmetic
matches 3,634 of 3,691 regenerated PR IDs (every shape), 3,625 of 3,625
distinct first-round SMD IDs and 2,158 of 2,158 runoff IDs. Recommend storing
the tuple explicitly and preserving legacy links through an adapter. Account for
the 57 PR units without polygons separately. No 2016 production files were changed.

Local checks and a clean Observable build passed (9 pages, 54 links). The
schema report still finds 16 district and 20 precinct header signatures.
CI deployment still regenerates its existing CSVs pending a clean cross-platform
regeneration comparison and the CI policy decision. The daily schedule was
removed. Complete deployment parity before treating this as the baseline for
the contract pilot or broader refactor.

**Regeneration audit:** All 17 R entry points currently listed in the deployment
workflow passed in an isolated copy using Windows R 4.4.2. Against the current
working data, including the two refreshed 2010 CSVs, the results, turnout,
candidate, config and shape directories had 328 byte-identical files. There were
no removals or changes to existing files. Loaders did recreate 18 legacy
candidate CSVs and three legacy candidate YAMLs (local 2010, 2021 and 2025).
These were kept out of the working data. Parliamentary 2016 remains outside
this loader set and was audited separately.

GitHub Actions now snapshots the data before regeneration and reports differences
before building. The report does not change what gets deployed. Confirm the
Linux run before switching deployment to the checked-in CSVs.
For a local isolated run, compare with
`node scripts/compare-regenerated-data.js <isolated-src/data>`.

**Legacy roster consumer check:** All 11 dashboard loader outputs compared
identically with and without the 21 extra roster files, excluding generation
timestamps. All 46 download workbooks built and had their metadata refreshed
from a baseline without the extras. None of the extra paths is referenced
by election YAML or the download code, and none matches a canonical candidate
filename prefix. A complete side-by-side workbook content comparison was not
run to completion.

**Linux validation without publishing:** The workflow now accepts an
`audit_only` input on manual dispatch (on by default). It runs regeneration,
the comparison, contract checks, download generation and the Observable build,
but skips all Pages publishing steps. Push-triggered deployment is unchanged.
Once the revised workflow is on GitHub, run **Rebuild** with **audit_only**
enabled and review the **Report regenerated data differences** step. The
latest accessible successful run still uses commit `18db7c7`, which predates
the comparison step. The revised workflow has not been run remotely yet.
Pushing the prepared changes to `codex/linux-regeneration-audit` also starts
the Linux audit automatically. Pages publishing is restricted to `main`,
including when a non-main branch is dispatched manually.

This phase comes first because the live site does not match the repository, so
any before/after parity check would otherwise use the wrong baseline.

What production serves today:

| Layer | Production source | Problem |
|---|---|---|
| `src/data/*.json` summaries | Committed May 2026 snapshot | Static files override their `*.json.js` loaders, which never run |
| Results and turnout CSVs | Regenerated by CI | Committed CSVs can differ from live files |
| `parl2016` results | Committed CSVs | `process_parl2016.R` has never been in CI |
| Candidate CSVs | Committed CSVs | R candidate ingests do not run in CI |

**0.1 Fix the council candidate vote join.**
`candidates-build.js:423` always indexes `files.smd_results`, which is the mayoral
file in local elections, even for `council_smd` rows.

| Election | Matches now | Matches using `council_smd_results` |
|---|---|---|
| local_2010 | 0 | 3,343 of 4,079 (4,022 with regenerated CSV) |
| local_2014 | 0 | 4,891 of 5,858 |
| local_2017 | 0 | 4,329 of 4,727 |
| local_2021 | 0 | 2,571 of 2,771 |
| local_2025 | 0 | 2,193 of 2,228 |

The live snapshot is worse than empty: 247 local_2021 council rows show votes
because old IDs collided with mayoral districts. For example, a Martvili seat 11
candidate shows 13,314 votes (62.4%), which is GD's mayoral row for district 11.
The `district__party` key also lets independents in one district overwrite each
other, so the fix needs a candidate-level key. Investigate the remaining unmatched
rows rather than assuming they are expected.

**0.2 Review fresh loader output before it ships.**
Six of the 12 committed JSON files differ from fresh output: `elections`,
`index-featured`, `candidates-index`, `candidates-details` (4,755 of 56,230
candidates), `parties-index`, and `parties-details`. Timestamps and the
`index-featured` rotation are expected differences. Fresh output also drops party
strongholds (local_2017 from 8 to 0, local_2021 from 3 to 0). The 2021 values are
probably artifacts of the 0.1 collision; the 2017 drop is unexplained. Rerun this
comparison after 0.1 and explain each remaining category of change.

**0.3 Remove the shadowing files.**
Delete all 12 from disk as well as from git, because a local copy still overrides
its loader, and add them to `.gitignore`. Also delete the ignored local
`src/data/downloads.json`. Add a check that fails if `X.json` and `X.json.js` both
exist under `src/data/`.

**0.4 Commit the regenerated `local2010` CSVs after review.**
The raw XLSX changed in `4783da3`, but `local2010_council_smd.csv` and its precinct
file were not regenerated. The repository has 3,357 district rows and the live
file has 4,037. Precinct rows are 15,197 in the repository and 17,916 regenerated.

**0.5 Treat `parl2016` precincts as a geometry-key task.**
Do not simply regenerate these files or add the loader to CI yet.

| Check for `parl2016_pr_precincts` | Committed and live | Loader output |
|---|---|---|
| Units | 885 | 3,691 |
| Largest registered count on one row | 15,930 | 2,928 |
| Total votes | 1,759,632 | 1,759,632 |
| Units matching shape `id` | 828 | 602 |

The shape has 3,634 features but only 828 distinct `id` values, so the loader's
real precincts match worse on that key. Establish a unique shape key first, then
regenerate all six differing `parl2016_*_precincts` files together.

**0.6 Decide what CI is for.**
Recommended: commit generated CSVs as the record, and keep regeneration in CI only
as a check that fails on any difference. Then what is deployed is what is committed.
The daily schedule has been `disabled_inactivity` since about 2026-09-26. Recommended:
drop it, and move the featured-election rotation to the browser or remove it.
After 0.3, a build-time rotation would otherwise change only when a build runs.

**0.7 Add CI gates.**
Run `test-districts` (JS and R), `check-translations`, and the 0.3 shadow check.
All existing checks pass locally today, but none runs in CI and there is no
`npm test`. Add `validate-canonical.R` as report-only until results are migrated;
it currently writes tracked files under `reports/`, so give it an output path.

Phase 0 is complete when fresh loader output matches deployed JSON apart from
timestamps, council candidates show votes from council results, committed CSVs
match CI regeneration or have a documented `parl2016` exception, and the new gates
pass in CI.

### Additions and corrections to the plan

- **B4 can close.** Only 30 of 5,815 local_2017 council rows miss the geo join.
- **B5 is fixed in source but not live.** 2,230 dotted local_2025 IDs are live and
  fresh output has none. Phase 0 ships the fix.
- **Results normalization has not started.** The 174 results CSVs still have 16
  district and 20 precinct header signatures, and no `process_*.R` uses `common/`.
- **Results uniqueness needs a subject ID first.** 24 files fail the
  `district + party + round` key or its precinct equivalent, mostly from
  per-candidate `national` rows and independents.
- **Literal `NA` precinct IDs need a rule.** They appear in by-election precinct
  files, up to 487 rows in one file.
- **Candidate entry points are incomplete.** Only 9 candidate scripts exist. Rosters
  such as local_2010, local_2017 and parl_2024 have no `_candidates.R`. Either write
  those scripts or mark the rosters as curated. This belongs with the correction
  ownership decision in the contract work.
- **Legacy rosters come back.** The `process_*.R` loaders recreate 18 legacy roster
  files that are not in the repository. Stop writing them during results migration.
- **Candidates page speed is a new priority (P7).** It loads 23.5 MB of JSON up
  front (2.2 MB gzipped) and 48.5 MB on demand (4.4 MB gzipped). Measure this
  alongside P1.
- **`index-featured.json.js` needs a real CSV parser.** It splits lines on commas,
  which breaks on quoted values.

### Revised order

1. Phase 0, in order: 0.1, 0.2, 0.3, 0.4, then 0.6 and 0.7. Run 0.5 separately so it
   does not block the rest.
2. Read-only baseline, taken after Phase 0.
3. Contract specification, with basemap work in parallel.
4. `pres_2013` results pilot, then broaden gradually.
5. Typed manifests and build integration.
6. Module extraction and performance.

This replaces the numbered sequence in the 2026-10-14 section; its step details and
acceptance gates still apply.

### Owner decisions needed

1. CI policy in 0.6: check-only regeneration, or keep regenerating for deployment.
2. Whether to keep the rotating featured election, and if so, in the browser.
3. Which `parl2016` geometry key to adopt, and whether the current precinct view
   needs a public note until it is corrected.
4. Which candidate rosters are generated and which are curated.

### Housekeeping (low priority)

- Remove dependencies that appear unused after a clean build check: `css-loader`,
  `file-loader`, `style-loader`, `url-loader`, `r-integration`, `d3-color-legend`.
- Correct the footer link, which points to `geoelectionsdata`, not this repository.
- Remove the duplicate `theme` and `pager` keys in `observablehq.config.js`.
- Add or remove the missing `data/shp/parl1919_cartogram.geojson` reference.
- Review six result CSVs not referenced by any YAML file: `local2017_r2_smd_districts`,
  `local2021_council_pr`, `local2021_council_pr_precincts`, `local2021_r2`,
  `local2021_r2_smd_districts`, `parl2020_by_tbilisi`.

---

## Review update: 2026-10-14 (design reference, proposal only)

The 2026-11-04 section above takes precedence over this one. This section takes
precedence over conflicting recommendations and status claims in the historical
appendix. Application code, loaders, generated data, and workflows were not changed
as part of this review. Earlier owner decisions remain in effect; the refinements
here are proposals for review before implementation.

### 1. Basemap: establish the actual dependency, then replace it

Both `src/components/election-map.js:151` and `src/index.md:140` currently use
`https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png`.
Neither call supplies an API key. No Mapbox/MapTiler/Stadia key configuration was
found in the inspected source. An observed key requirement therefore needs to be
traced to the deployed version, provider response, or another environment before
we describe it as a code requirement. Keyless access and an open-source hosting
stack are separate goals.

Recommended sequence:

1. Introduce one shared basemap configuration/factory consumed by both maps.
   Include provider, style/URL, attribution, zoom limits, and failure handling.
   Initially preserve the existing tiles to establish behavior parity.
2. Pilot OpenFreeMap with a light, low-contrast style. Its documented Leaflet
   integration uses MapLibre GL Leaflet, so this is a renderer integration, not
   a raster URL substitution. Keep election polygons, selection, and tooltips
   in Leaflet. Check layer order, labels, mobile performance, fullscreen resize,
   renderer cleanup, and the featured map before adopting it. Also check how the
   provider labels and draws Abkhazia and South Ossetia, and whether map labels
   can follow the ka/en language toggle.
3. Compare the pilot with standard OpenStreetMap raster tiles as the simpler
   integration option. OSM Standard has a busier appearance and its public tile
   service has usage restrictions; open data does not imply unrestricted hosting.
   Preserve attribution, normal browser caching/referrers, and avoid bulk/offline
   tile fetching. Do not promise availability guarantees from a public service.
4. Consider self-hosted tiles only if traffic, availability, or offline use later
   justifies the operational work. Do not migrate the entire choropleth engine
   to MapLibre as part of this provider change.

References checked for this proposal:
- OpenFreeMap integration: https://openfreemap.org/quick_start/
- OSM tile hosting policy: https://operations.osmfoundation.org/policies/tiles/

### 2. Data contract: refine the existing scaffold before migrating

The repository already has R schema/io/district helpers and R candidate ingests.
It also has lazy path manifests, so replacing a giant registry payload is not
the starting task. The main remaining work is results/turnout normalization,
explicit geographic identity, and consistent consumption by maps and exports.

Evidence from current code:
- `schema.R` defines ordered result/candidate columns but no complete turnout
  contract, foreign-key validation, or result uniqueness checks.
- `district_id` in the candidate contract can mean an electoral district, SMD,
  self-government unit, or nationwide scope. Shape consumers choose between
  `id`, `major_id`, `maj_id`, `MID`, and other aliases.
- Page and precinct CSV loaders use `d3.autoType`; downloads also import it.
  Generic numeric conversion can lose leading zeros in identifiers. This is
  preventive for now: no result or turnout ID has a leading zero or a dotted-number
  form (checked 2026-11-04).
- `registry-utils.js` identifies precinct assets from filenames and silently
  excludes missing files. Election metadata should declare asset roles instead.
- Candidate documentation allows direct CSV corrections while R ingests can
  regenerate those files. Define correction ownership before more regeneration.
- `scripts/generate-registry.js` targets `AUTO-GENERATED` markers that no longer
  exist in `elections.md`, and no build step or workflow calls it. It can be deleted.

Proposed versioned contract (v1 compatibility first; v2 only with adapters):

| Dataset | Grain and identity | Required rules |
|---|---|---|
| Election configuration | Election, sub-election, ballot | Version; date; sources; declared asset role, level and geometry key; availability |
| Geographic units | Geometry set + level + unit ID | IDs as strings; native source code; `name_ka`, `name_en`; explicit district/selfgov/SMD parent relationships where applicable |
| Results | Election + sub-election + ballot + geometry set + level + unit + ballot subject | Unique key; subject identity distinct from party affiliation; votes and defined denominator; optional candidate reference |
| Turnout | Election + sub-election + ballot + geometry set + level + unit | One unit row; registered, voted, invalid and available snapshots; explicit denominator rules |
| Candidate appearances | Election + sub-election + ballot + contest/unit + candidate | Candidate and party identities separate; ballot number scoped to contest; list position and elected status |
| Seats | Election + sub-election + selfgov/unit + party + seat category | Reported/computed provenance; category totals validated against configured seats |

Keep raw source-specific columns in raw inputs or documented mapping tables.
Normalize `MID`/`maj_id`/`id` at the ingest boundary; the browser should ultimately
consume one declared key. Use explicit mappings per geography vintage rather
than a universal arithmetic encoder: 2014 carved-out cities, 2017 six-digit MIDs,
and parliamentary boundary changes do not share one encoding rule. A precinct
may have separate electoral-district, SMD, and selfgov parents; it is not a single
hierarchical tree. Preserve `precinct_key` and any load-bearing legacy fields
until join parity is demonstrated.

Do not treat the existing superset schema as automatically behavior-preserving.
Keep its current columns and paths behind a compatibility adapter while testing
the refined contract. Separate turnout at the canonical layer to avoid repeating
unit totals for every party, then supply the current combined view where existing
renderers require it. Preserve the national pseudo-row initially and define
whether it is reported or aggregated; do not silently recompute official totals.

Contract details to specify before migration:
- Parse identifiers as strings and only declared measures as numbers in both
  browser and download readers. Never identify parties across years by ballot code.
- Document fractions versus percentages per field, valid/total vote denominators,
  blank versus zero versus unknown, annulled precincts, partial coverage, and
  reported versus derived totals. A share sum mismatch may be archival evidence,
  not an error to erase.
- Preserve bilingual display names and election-specific coalition labels.
  Do not infer an individual candidate from a party alone; join by contest/unit
  and candidate ballot number where no stable candidate identifier is available.
- Choose reproducible raw-to-canonical generation with explicit correction files,
  or curated canonical data with regeneration protection. Recommended: raw data
  plus versioned corrections, applied by the loader and recorded in provenance.
- Let downloads consume the same validated canonical datasets as the dashboard;
  leave ExcelJS presentation/packaging in Node as previously agreed.

### 3. Implementation order and acceptance gates

The sequence is superseded by "Revised order" in the 2026-11-04 section, which puts
Phase 0 first and runs basemap work alongside the contract specification.

1. **Read-only baseline:** fresh header inventory; YAML-to-file coverage; ID and
   candidate joins; asset sizes and load timing; current workbook sheet/totals
   inventory. Capture expected discrepancies rather than regenerating everything.
2. **Basemap configuration and pilot:** shared factory, then provider choice,
   with main/featured maps and desktop/mobile/fullscreen checks.
3. **Contract specification:** amend schemas and docs with types, keys, turnout,
   geometry mappings and provenance. Add read-only validators, initially reporting
   legacy violations. Fail only newly migrated datasets on their declared version.
4. **First results pilot:** a single-round presidential election (e.g. pres_2013),
   preserving its documented preliminary/final-data discrepancies. Use one parser
   and adapter for map/export consumers; compare precinct/district/national rows,
   shares, turnout and candidate labels before and after.
5. **Broaden gradually:** parliamentary PR, parliamentary SMD, local PR/mayor,
   local SMD, then runoffs/repeated/by-elections. Include 2014 city/rural units,
   2017 MIDs, 2020 precinct parents, annulled units and partial turnout as fixtures.
6. **Typed manifests and build integration:** declare roles in YAML instead of
   guessing from filenames; required missing assets fail with election/path context,
   intentionally unavailable optional assets remain allowed. Keep Observable's
   asset registration/hashing and lazy fetching working under GitHub Pages paths.
   Ensure local builds and CI invoke the same agreed validation/generation steps.
7. **Module extraction and performance:** once contracts are stable, extract
   parsing, geographic lookup and subject resolution before splitting stateful
   map lifecycle code. Measure before geometry simplification or renderer changes.

Each migration must preserve existing public URLs, selections, unit outlines,
candidate panels, downloads and lazy loading. Acceptance includes a clean
Observable build and targeted UI checks for affected workflows. No wholesale
loader rewrite, geometry regeneration or all-election regeneration is proposed
as the first step. Rollback remains possible by retaining the legacy adapter and
previous dataset until the pilot passes.

Status corrections to the historical plan: candidate R ports and CSS/translation
extraction are already present. B2's map helper now calls the shared
`selfgovIdFromRawDistrictId`; reassess its semantics rather than assuming the
old duplicate remains. B3 already logs geographic join misses, although English
names still come from geometry. B4 and B5 now have join evidence; see the
2026-11-04 section. Do not execute the historical nine-step sequence verbatim.

---

# Appendix: July 2026 plan (historical)

Kept for the record. Status claims, counts, and sequencing below reflect July 2026
and may be out of date; use the sections above for current work. Owner decisions at
the end of this appendix remain in effect.

Senior-engineer review of the Georgia Elections dashboard (Observable Framework).
**Updated 2026-07-03** to add the loader-unification goals: pure-R data cleaning,
per-election loader pairs, standardized output schemas, and translation hygiene —
on top of the original five axes (speed, redundancy, CSS → modules, JS → modules,
documentation).

---

## 0. Architecture snapshot (as-is)

| Area | File(s) | Size | State |
|------|---------|------|-------|
| Pages | `src/*.md` (7) | ~4 200 lines total | CSS embedded inline (see §4) |
| Map engine | `src/components/election-map.js` | **1 876 lines** | One `buildElectionMap()` megafunction, ~50 inner fns |
| Renderers | `src/components/election-renderers.js` | 694 | Extracted via `makeRenderers()` factory — good model |
| Pure utils | `src/components/election-utils.js` | 128 | Well documented — the template to follow |
| i18n/lang | `src/components/state.js` | 94 | `getLang`, `tr`, `LanguageSwitcher` — **plus a hardcoded navDict (§7)** |
| Shared CSS | `src/custom-style.css` | 666 | Design system, linked in config head — good |
| OF build loaders | `src/data/*.json.js` (13) | small | Build-time YAML/CSV → JSON, manifest + lazy fetch |
| Build join | `src/data/config/candidates-build.js` | ~540 | Geo join, appearance resolution |
| **Results/turnout loaders** | `src/loaders/process_*.R` (**18**) | ~300–1 600 ea | One per election; raw XLSX → results/turnout CSVs |
| **Candidate ingest** | `scripts/ingest-*.js` (**9 node**) | ~300 ea | Raw XLSX → canonical candidate CSVs |
| Downloads generators | `src/loaders/downloads/*.js` (40 node) | small | Per-election XLSX bundles (exceljs) |
| Stray | `add_ka_2021.py` (root) | — | Orphan Python one-off — delete or archive |

**Measured messes (2026-07-03 audit):**
- 174 results CSVs → **36 distinct header signatures** (drift in `party_num`, `round`,
  `name_ka`, `precinct_key`, `raw_district_id`, `selfgov_id` vs `district_id`, column order).
- 19 election YMLs vs 18 R loaders vs 9 node ingests — three parallel per-election conventions.
- ~1 441 lines of CSS inside `.md` pages (breakdown in §4).
- `translations.json` is at full en/ka key parity (278/278) — but nav strings are hardcoded
  in `state.js`, and renderers carry inline English fallback literals.

---

## 1. Bugs & correctness issues (status)

### B1. Presidential featured-map grey districts — **FIXED**
`index.md` now resolves colors/legend from `featured.candidates` for presidential elections.

### B2. Duplicate, divergent selfgov-ID logic — **OPEN**
`election-utils.js` `councilSelfgovIdFromMajorId` vs `election-map.js:193`
`councilSelfgovIdFromDistrictId` (different branch logic; can disagree).
Delete the inner copy, import the canonical one, add a fixture test.
→ In R-unification terms this logic must also exist exactly once in the R layer (§3.4).

### B3. ka/en asymmetry in district-name resolution — **OPEN**
`candidates-build.js` `appearanceFromCanonicalRow`: ka falls back row → geo; en comes
**only** from geo. Make en symmetric; log join coverage at build time.

### B4. `local_2017` district codes don't join the geojson — **OPEN**
XLSX 5/6-digit codes vs 4-digit geo MIDs → 0 % join for council_smd/elected.
Agreed fix: re-encode at ingest (transform table in git history / earlier notes).
→ Fold into the standardized R candidate loader for 2017 (§3) rather than a one-off node script.

### B5. `local_2025` majoritarian code parsing — **OPEN**
`"01.01"` → `parseInt(code.replace(/\./g,''),10)` → `101`, Tbilisi as selfgov 1.
→ Same: implement inside the R candidate loader for 2025.

### B6. (new) 2014-style selfgov/major-ID traps — **PARTIALLY FIXED, generalize**
The 2014 fix (use explicit `selfgov_id` from the corrected XLSX; `maj_id =
selfgov_id*100 + seat`; never `map_city_selfgov()` when an explicit column exists)
must become a shared R helper so 2017/2021/2025 can't re-introduce it.

---

## 2. Guiding decision: one pipeline, R end-to-end for data cleaning

**Target:** for every election, all *data cleaning* is pure, portable R. Node remains
only where the Observable Framework build requires it (the thin `*.json.js` packaging
loaders) and — pending decision — the XLSX download bundles.

```
raw XLSX/CSV (CEC, NDI, …)
        │   R (one pair of scripts per election, shared helpers)
        ▼
canonical CSVs                      ← THE standardized interface (§3.2, §3.3)
  src/data/results/…                   results + turnout, one schema per level
  src/data/candidates/…                candidates + elected, one schema
        │   node (unchanged, thin)
        ▼
Observable build loaders (*.json.js) → dashboard
downloads generators (exceljs)       → XLSX bundles
```

Why this split: the `*.json.js` loaders don't *clean* anything — they walk YAML,
check files exist, and emit JSON manifests. Rewriting them in R buys no portability
(they are Framework-specific by nature) and Observable would happily run `.json.R`
loaders anyway if we ever want that. The cleaning layer — where humans add new
elections — is what must be R, uniform, and documented.

**Open questions for the owner (blocking §3 kickoff):** see end of document.

---

## 3. Loader unification (NEW — the largest pillar)

### 3.1 Per-election loader pair, uniform naming

Every election gets exactly two R entry points (plus shared helpers):

```
src/loaders/
  R/
    common/
      schema.R          # canonical column specs + validators (writes nothing)
      io.R              # read_cec_xlsx(), write_canonical_csv() (UTF-8, ordered cols)
      districts.R       # selfgov/major-ID encoders (B2/B6 logic, ONCE)
      parties.R         # party-label → party_id resolver against parties.yml + election YAML
      turnout.R         # shared turnout/derived-pct computations (round6, shares)
    elections/
      {election_id}_results.R      # raw → results + turnout CSVs
      {election_id}_candidates.R   # raw → candidate + elected CSVs
```

- `{election_id}` matches the YAML id (`local_2014`, `parl_2024`, …) — greppable 1:1.
- Each script: `Rscript src/loaders/R/elections/local_2014_results.R` from repo root,
  no arguments needed, idempotent, prints a row-count + validation summary.
- Existing 18 `process_*.R` migrate into `_results.R` files (mostly renames + moving
  duplicated helpers into `common/`); the 9 node `ingest-*.js` get ported to
  `_candidates.R` (parity-checked against current CSV output before deletion —
  same procedure as the earlier legacy→canonical candidate migration).
- The one-off root `add_ka_2021.py` is deleted after confirming its output is already
  committed.

### 3.2 Canonical results/turnout schema (kills the 36 signatures)

One schema per aggregation level, superset-style — columns always present, empty when
not applicable, **fixed order**:

| Level | File pattern | Columns (fixed order) |
|---|---|---|
| District/unit | `{eid}_{votetype}.csv` | `district_id, party_id, party_num, name_ka, round, votes, vote_share, registered, voted, voted_noon, voted_5pm, main_list, special_list, invalid_ballots, turnout_pct, noon_pct, five_pct, invalid_pct` |
| Precinct | `{eid}_{votetype}_precincts.csv` | `precinct_id, district_id, selfgov_id, precinct_number, party_id, party_num, name_ka, round, votes, vote_share, registered, voted, voted_noon, voted_5pm, invalid_ballots, turnout_pct, noon_pct, five_pct, invalid_pct` |
| Seats | `{eid}_seats.csv` | `selfgov_id, party_id, seats_pr, seats_smd, seats_mayor` |
| Turnout | `data/turnout/{eid}_…` | keep current shape, document it in schema.R |

- The `national` pseudo-row convention stays (documented).
- `schema.R` exposes `validate_results(df, level)` — every loader calls it before
  writing; CI-style check script (`scripts/validate-canonical.R`) re-validates the
  whole `src/data/results/` tree so drift is caught immediately.
- Renderers/map read only documented columns, so the superset change is additive;
  verify with a full build + spot checks per election after each migration.

### 3.3 Canonical candidate schema — already exists, becomes the R contract

`src/data/candidates/README.md` (16 columns) is already the standard; `schema.R`
encodes it as `validate_candidates(df)`. The `_candidates.R` loaders must reproduce
today's CSVs byte-comparably (modulo column-order normalization) before the node
ingests are retired. Keep `scripts/parity-check.js` (or port it) for this.

### 3.4 District/party helpers become single-source

- `districts.R`: `council_maj_id(selfgov_id, seat)`, Tbilisi rules, carved-out-town
  rules (2014/2017), `parse_dotted_code("01.01") → 101` (B5). Mirrors what
  `election-utils.js` does client-side; a small fixture CSV
  (`src/loaders/R/common/districts_fixtures.csv`) is tested from **both** R and JS
  so the two implementations can never diverge silently (resolves B2 permanently).
- `parties.R`: one normalizer (`ური→ული` etc.) + alias resolution against
  `parties.yml` and the election YAML — replaces the copy-pasted resolver in every
  node ingest.

### 3.5 Migration order (lowest-risk first)

1. ~~Scaffold `common/` + `schema.R` + validator script; baseline drift report.~~
   **DONE 2026-07-03.** `src/loaders/R/common/{schema,io,districts}.R` +
   `scripts/validate-canonical.R` + `src/loaders/R/README.md`. Baseline:
   district **0/92 exact (16 sigs)**, precinct **0/77 exact (20 sigs)**,
   seats **5/5 ✓**, canonical candidates **45/45 ✓**, 11 legacy candidate files
   to retire. Reports: `reports/schema-drift.csv`, `reports/schema-signatures.csv`.
   *Schema amendment while scaffolding:* `precinct_key` added to the precinct spec —
   it is load-bearing (`election-map.js` exact-key matching for by-elections).
   Confirmed loader-internal (droppable at migration): `raw_district_id`,
   `electoral_district_id`, `dd`/`pp`/`smd` (parl2016 debris), CSV-side
   `district_name_ka/en` (components read those from geojson props only).
2. Port candidate ingests to R one election at a time, parity-check, delete node twin.
   Start with `local_2021` or `adj2024` (smallest), end with `local_2014` (dual-pipeline,
   subtlest — see memory notes on selfgov encoding).
   **COMPLETE: 9/9 ported (2026-07-03), every output verified byte-identical (SHA-256);
   all `scripts/ingest-*.js` deleted. Zero node left in the candidate-cleaning layer.**
   - `adj_2024` (2 files), `adj_2008` (1), `parl_2020` (3), `parl_2016` (3),
     `local_2025` (4), `local_2021` (4), `local_2014` (5, incl. the
     selfgov*100+seat council-id recomposition), `presidential` (5 files / 4 elections,
     preserving the self-referencing id map + JS Map last-wins semantics),
     `parl_1919` (1).
   - `parl_1919`: committed CSV was STALE (XLSX re-edited after last node run);
     logic parity proven fresh-vs-fresh, CSV refreshed from R.
   - `parl_2016`: SOURCE DATA ERROR found — Elected sheet row 118 last_name
     "ელისაბედრულოვს" is missing its internal space (should be first "სანდრა ელისაბედ",
     last "რულოვს"). Committed CSV kept (it has the correct split); **fix the XLSX
     cell**, then `Rscript src/loaders/R/elections/parl_2016_candidates.R --apply`.
   Shared pieces: `common/parties.R` (resolver + `is_initiative_label` +
   `report_unresolved`), `common/candidates.R` (`col_or_blank`, `norm_name`,
   `split_name`, `split_historic_name`, `join_name`, `elected_flag`), `common/io.R`
   `read_xlsx_sheet()` (normalizes in-cell CRLF→LF exactly like exceljs) +
   `format_csv_d3()` (d3-compatible minimal quoting → hash-equality parity checks).
   Parity gotchas encoded in the helpers: JS `Number("")` is 0 (finite), JS `Map.set`
   last-wins, JS `??` vs `||` fallback semantics, prefix-only vs full initiative check.
   *Cross-language gotcha, now guarded:* R's `yaml` is YAML 1.1 (`id: yes/no` → logical)
   while node's js-yaml v4 is YAML 1.2 (string). The plebiscite option ids in
   `parties.yml` are now quoted (`id: "yes"`), and `make_party_resolver()` fails with an
   explicit message if an unquoted boolean-like id ever reappears.
3. Migrate `process_*.R` → `elections/{eid}_results.R` with `common/` helpers;
   normalize each election's output to the §3.2 schema; full build + visual spot
   check per election.
4. Only then: downloads generators decision (see Questions).

---

## 4. CSS → dedicated modules — **DONE (2026-07-03): zero `<style>` in any page**

All ~1 441 lines moved out of the 7 `.md` pages into `src/styles/`, linked
globally in the config `head` (Observable serves them as hashed `_file/styles/*`):

```
src/styles/
  index.css (158)  elections.css (617)  candidates.css  parties.css
  cand-shared.css  analysis.css (12)    about.css (59)  downloads.css (130)
```

Findings encoded in the extraction:
- **candidates.md and parties.md carried byte-identical copies of the entire
  candidate-table UI** (24 shared blocks) — deduplicated into `cand-shared.css`.
- Exactly ONE rule diverged between them (`.cand-row-detail .cand-detail-meta`):
  split into a common base + page variants scoped by new `.cand-grid-parties` /
  `.cand-grid-cands` modifier classes on each page's grid (only markup change).
- elections.md's generic-looking classes (.bar-row, .year-chips, .dist-table…)
  were verified to be emitted ONLY by election-renderers.js / election-map.js
  on the elections page — no other page's markup uses them, so global loading
  is collision-free. Design-system overrides (.card, .input-group) were already
  ancestor-scoped in the page CSS.
- Verified: live preview on index/elections/parties/candidates (computed styles,
  CSSOM scoped-rule presence, zero console errors) + clean build (54 links;
  parties page HTML shrank 35→30 kB).

---

## 5. JS functions → dedicated modules (unchanged plan, still pending)

Split `election-map.js` (1 876 lines) following the proven `makeRenderers()` pattern:

```
src/components/
  format-utils.js   escapeHtml, formatCount, formatPct, geoId, getFeatureName,
                    getDistrictBaseName, selfgov-id (canonical — pairs with §3.4 fixtures)
  map-tooltips.js   tooltipFrame/Line/Subject, buildTurnoutTooltip, buildResultTooltip*, bindDynamicTooltip
  map-precincts.js  precinct* family (stationId, keys, parentId, enrichPrecinctRows…)
  map-selection.js  selectionKey, highlight, set/clearSelectedUnit, URL restore
  map-layers.js     districtStyle, makeLayerStyle, buildLookups, addShare, legend, bounds/zoom
  election-map.js   buildElectionMap() orchestrator only
```
Pure functions first; one behavioral change per commit; `buildElectionMap` signature stable.
Also: consolidate `candidateLabel(row, lang)` and turnout-row builders in the renderers
(currently duplicated between district & precinct panels).

---

## 6. Speed (unchanged, augmented)

- P1 audit per-page loader payloads (elections.md `Promise.all` of 11).
- P2 LRU cache hit-rate instrumentation (`CSV_CACHE_MAX_ENTRIES = 20`).
- P3 pre-simplify precinct GeoJSON at build time; serve detail on drill-down.
- P4 defer Leaflet until after first paint.
- P5 language toggle should mutate text, not rebuild map/panels.
- **P6 (new):** schema standardization (§3.2) lets the CSV parser and lookups be
  simpler/faster — one column map instead of per-election special-casing.

---

## 7. Translations compatibility — **DONE (2026-07-03)**

- **T1 ✔** `state.js`'s `LanguageSwitcher` + `updateGlobalNavbar` + navDict were
  dead code with STALE values (referenced nowhere) — deleted; `state.js` now only
  exports `tr()` + `getLang()` (JSDoc'd) and runs `loadFonts()`. `header.html`'s
  inline navDict is kept deliberately as the no-flash fallback (applied before
  translations.json is fetched, which then wins) — annotated, and the checker
  fails if it drifts from translations.json.
- **T2 ✔** Zero missing keys found: every literal key referenced in source exists
  in translations.json; the `t(...) || "…"` fallbacks in renderers are inert
  safety nets. Georgian literals in `downloads/shared.js` are bilingual manifest
  DATA fields (sub_name_ka/en), not UI translations — intentionally left.
- **T3 ✔** `scripts/check-translations.js`: fails on en/ka divergence, missing
  referenced keys, header-fallback drift, or dynamic-key prefixes matching no key;
  reports unused keys (104 currently — report-only, since variable-key lookups
  are invisible to static scan) and unverifiable dynamic patterns (4).
- **T4 ✔** Key convention (`page.section.item`) documented in the checker header.
- Verified end-to-end in the live preview: ka→en toggle switches header AND page
  body (lang-change → getLang chain), zero console errors; full build clean
  (54 links). Also fixed `.claude/launch.json` to pin `--port 3001` (the preview
  panel pointed at 3001 while `observable preview` defaulted to 3000).

---

## 8. Documentation standard (unchanged)

JSDoc on every JS export (`election-utils.js` is the reference); roxygen-style
headers (`#' @param`, `#' @return`) on every R function in `common/`; each loader
starts with a header naming its raw inputs, outputs, and quirks. Loader README in
`src/loaders/R/` explains "how to add a new election" step by step — that is the
portability deliverable the R rewrite exists to serve.

---

## 9. Execution order (revised)

1. **Bugs** B2, B3 (small, self-contained). B4/B5 fold into §3 loaders.
2. **§3.1–3.2 scaffold**: `common/` + schema validators + drift report. No behavior change.
3. **Translations T1–T3** (small, independent, high hygiene value).
4. **CSS extraction** page-by-page (§4).
5. **Candidate loaders → R** election-by-election with parity checks (§3.5 step 2).
6. **Results loaders normalization** (§3.5 step 3) — the long tail, one election at a time.
7. **JS module split** (§5) + renderer de-dup.
8. **Speed passes** (§6), measured.
9. Docs (§8) ride along with every step, not at the end.

**Guardrails:** parity-check before deleting any working loader; full `npm run build`
+ spot check after each election migration; no commits without explicit request;
public signatures and canonical CSV paths stay stable throughout.

---

## Decisions (confirmed by owner, 2026-07-03)

1. **Scope of "pure R": cleaning layer only.** The 13 Observable `*.json.js` build
   loaders and the 40 exceljs download generators stay node — framework plumbing,
   not data cleaning.
2. **Node candidate ingests: port all 9 to R**, one election at a time, each
   parity-checked against current CSV output before its node twin is deleted.
3. **Canonical results schema: adopted as proposed in §3.2** (superset columns,
   fixed order, empty when N/A; district + precinct variants).
4. **R code shape: sourced `common/` scripts** under `src/loaders/R/common/` —
   zero install step, copy-the-folder portability.
