---
name: 2021 Local Elections — data pipeline, config, known issues
description: R loader, output CSVs, YAML config, GeoJSON, parties, runoff sub-election, bugs fixed
type: project
---

## Source Excel files

- `src/data/raw/7795_2021 საკრებულო მერი პირველი ტური.xlsx` — Round 1: sheets: [0] PR, [1] Majoritarian results, [2] Majoritarian candidates, [3] Mayor results, [4] Mayor candidates
- `src/data/raw/7795_2021 საკრებულო, მერი მეორე ტური.xlsx` — Round 2 (runoff): sheets: [0] Mayor, [1] Mayor candidates, [2] Majoritarian, [3] Majoritarian candidates

**Precinct code format:** `"DD.SS"` (e.g. `"01.01"` = CEC district 1, precinct 1). `parse_precinct_id` splits on `.` into 2 parts: `parts[1] * 1000 + parts[2]`. DO NOT use 3-part split — that always produces NA.

**Majoritarian sheet extra column:** has 10 metadata columns (vs 9 for PR/Mayor): district, district_name, **major_local**, precinct_code, main_list, special_list, voted_noon, voted_5pm, voted, ballots_received.

**R2 candidate columns reversed:** R2 candidates sheets have last_name BEFORE first_name (unlike R1). Code handles this.

---

## R data loader

**File:** `src/data/loaders/process_local2021.R`

**Outputs (all in `src/data/results/`):**
- `local2021_pr.csv` — PR results by CEC district (district_id = CEC district 1-83)
- `local2021_pr_selfgov.csv` — PR results by selfgov unit (district_id = selfgov_id)
- `local2021_pr_precincts.csv` — PR precinct results (precinct_id, district_id = CEC district)
- `local2021_smd.csv` — Mayor results by selfgov (district_id = selfgov_id, includes `round` column: 1=R1, 2=R2, `name_ka` = candidate name)
- `local2021_smd_districts.csv` — Mayor results expanded across CEC districts 1-83 (Tbilisi selfgov=1 duplicated as districts 2-10)
- `local2021_smd_precincts.csv` — Mayor precinct results (precinct_id, selfgov_id)
- `local2021_council_smd.csv` — Council majoritarian results (district_id = major_id = selfgov_id×100+seq, `round` column, `name_ka` = candidate name)
- `local2021_council_smd_precincts.csv` — Council majoritarian precinct results (precinct_id, district_id = major_id)
- `local2021_r2_smd.csv` — Mayor R2 only (selfgov-level, no `round` column)
- `local2021_r2_smd_districts.csv` — Mayor R2 expanded across CEC districts (Tbilisi replicated)
- `local2021_r2_smd_precincts.csv` — Mayor R2 precinct results
- `local2021_r2_council_smd.csv` — Council majoritarian R2 only (major_id level)
- `local2021_r2_council_smd_precincts.csv` — Council majoritarian R2 precinct results
- `local2021_seats.csv` — Seat composition from elected politicians list (selfgov_id → party → seats_pr/seats_smd/seats_mayor; includes `selfgov_id = "national"` row)

**Candidates:** `src/data/config/candidates/local/local_2021.yml`

**Key helpers:**
- `to_selfgov(d)`: districts 1-10 → selfgov_id=1 (Tbilisi); district N≥11 → selfgov_id=N
- `to_major_id(d, m)`: `to_selfgov(d) * 100 + m`
- `parse_precinct_id(code)`: `str_split_fixed(code, ".", 2)` → `parts[1]*1000 + parts[2]`

**Runoff handling:** 20 mayor runoffs, 42 council majoritarian runoffs. `runoff_selfgovs = unique(smd_r2_long$selfgov_id)`, `runoff_major_ids = unique(maj_r2_long$major_id)`. Main outputs merge R1+R2 (R2 wins); R2-only outputs are separate.

---

## GeoJSON files

- `src/data/shp/selfgov_areas_2025.geojson` — 64 self-governing unit polygons. Properties: `id` (selfgov_id int), `name_en`, `name_ka`
- `src/data/shp/local2021_precincts.geojson` — 3668 precinct points. Properties: `district` (CEC district int), `precinct` (seq int), `id` (= district×1000+precinct, matches CSV precinct_id), `name_ka`
- `src/data/shp/majoritarian_2021_major_id.geojson` — 665 council majoritarian district polygons. Properties: `major_id` (int, = selfgov_id×100+major_local), `major` (local seq int), `city` (selfgov_id as string), `district_name_en`, `district_name_ka` (added by Python). NO `id` property — `geoId()` uses `major_id`.
  - **Important:** GeoJSON has no `id` property. `geoId(feature) = String(feature.properties.major_id)` = e.g. "101".

---

## YAML config (`src/data/config/elections/local/local_2021.yml`)

```yaml
type: local
council:
  shape_file: "data/shp/majoritarian_2021_major_id.geojson"
  total_pr_seats: 0   # computed from elected list at runtime
  total_smd_seats: 0  # computed from elected list at runtime
system:
  pr:
    selfgov_shape_file: "data/shp/selfgov_areas_2025.geojson"
    precinct_shape_file: "data/shp/local2021_precincts.geojson"
  smd:
    shape_file: "data/shp/selfgov_areas_2025.geojson"
    precinct_shape_file: "data/shp/local2021_precincts.geojson"
sub_elections:
  - id: local_2021_r2
    type: runoff
    name: {en: "Second Round", ka: "მეორე ტური"}
    files:
      smd_results:                  "data/results/local2021_r2_smd.csv"
      smd_district_results:         "data/results/local2021_r2_smd_districts.csv"
      smd_precinct_results:         "data/results/local2021_r2_smd_precincts.csv"
      council_smd_results:          "data/results/local2021_r2_council_smd.csv"
      council_smd_precinct_results: "data/results/local2021_r2_council_smd_precincts.csv"
files:
  seats:                        "data/results/local2021_seats.csv"
  pr_results:                   "data/results/local2021_pr.csv"
  pr_selfgov_results:           "data/results/local2021_pr_selfgov.csv"
  pr_precinct_results:          "data/results/local2021_pr_precincts.csv"
  smd_results:                  "data/results/local2021_smd.csv"
  smd_district_results:         "data/results/local2021_smd_districts.csv"
  smd_precinct_results:         "data/results/local2021_smd_precincts.csv"
  council_smd_results:          "data/results/local2021_council_smd.csv"
  council_smd_precinct_results: "data/results/local2021_council_smd_precincts.csv"
  council_pr_results:           "data/results/local2021_pr.csv"
  council_pr_precinct_results:  "data/results/local2021_pr_precincts.csv"
  candidates:                   "data/config/candidates/local/local_2021.yml"
turnout:
  available: true
  has_snapshots: true   # voted_noon / voted_5pm columns in CSVs
  file: null            # turnout comes from inline columns in results CSVs
  precinct_file: null
```

---

## Parties

2021-specific parties are in `src/data/config/parties.yml` (lines ~319–501) with correct `name.ka` values. Key aliases in `local_2021.yml` parties section for ballot labels with candidate names prepended (e.g. `gd`, `european_georgia`, `patriots`, `labour`, `citizens`, `droa`, etc.).

---

## Known bugs fixed

1. **`parse_precinct_id` returned NA** — was splitting by "." into 3 parts and using parts 2+3. Code is "DD.SS", needs parts 1+2. Fixed.
2. **Council composition "filtered" at council_district/precinct level** — clicking a majoritarian district called `updateCouncilSeats(major_id, ..., false)` showing just 1 seat. Fixed: derive `selfgov_id = Math.floor(major_id / 100)` and call `isSelfgov=true`. Same for precinct clicks.
3. **Council SMD precinct dots all grey** — `_precinctToMajorId` empty because precinct_id was NA. Fixed by fixing `parse_precinct_id`.
4. **Sakrebulo composition seats wrong for runoff** — `_allCouncilSMDResults` was overridden with sub-election data. Fixed: always use parent election's `council_smd_results` for seat computation.
5. **Tbilisi shows only Mtatsminda in mayor district map for runoff** — runoff results are selfgov-indexed; Tbilisi (selfgov=1) maps to only CEC district 1. Fixed: generate `local2021_r2_smd_districts.csv` with Tbilisi expanded across CEC districts 1-10.
6. **Sub-election round selector hidden in turnout mode / council mode** — was gated on `!isCouncilMode && viewMode === "results"`. Fixed: moved to top filter section as a `select` dropdown (like other elections), removed from below-HR.
7. **YAML syntax error**: `girchi_more_freedom` alias had unquoted `": "` in Georgian text. Must quote: `ka: "ზურაბ გირჩი ჯაფარიძე: გირჩი - მეტი თავისუფლება"`.
8. **`district_name_ka` missing from majoritarian GeoJSON** — Python script must re-run after any GeoJSON file regeneration. Uses `selfgov_areas_2025.geojson` for non-Tbilisi; `TBILISI_KA` dict for Tbilisi sub-districts.
