---
name: Georgia Elections Dashboard Project Overview
description: Core project context — stack, architecture, elections data, current feature state, and goals
type: project
---

Georgia elections data dashboard built with Observable Framework (v1.13.2). Bilingual EN/Georgian. Currently a working wireframe with dummy/mock data.

**Why:** Visualize Georgia (country) election data, bilingual EN/Georgian, deployed to GitHub Pages.

**Three main goals:**
1. Finalize design/UI
2. Make it easy to add data and new elections
3. Deploy via GitHub Actions + GitHub Pages

**Stack:**
- Observable Framework — reactive markdown-based frontend
- D3.js + Leaflet — charts and maps
- BPG Georgian fonts (bpg-arial, bpg-arial-caps) via custom font loader
- YAML/JSON config — elections.yml, translations.json

**5 Pages:**
- `index.md` — landing/overview
- `elections.md` — main election analysis page (most developed)
- `candidates.md` — candidate browser (placeholder)
- `data.md` — data download hub (placeholder)
- `analysis.md` — analysis posts (placeholder)

**Key config files:**
- `observablehq.config.js` — base path `/electionsdata-wireframe/`, no sidebar
- `src/components/state.js` — language switching (EN/ka), tr() helper, getLang() reactive
- `src/components/header.html` — sticky header with nav + language toggle
- `src/custom-style.css` — full responsive styling
- `src/data/config/elections.yml` — election metadata (id, type, date, names, systems, file paths, turnout config)
- `src/data/config/translations.json` — ~150+ i18n keys, EN + Georgian
- `src/data/config/parties.yml` — party definitions with colors per election

**Data loaders:**
- `src/data/elections.json.js` — YAML→JSON (reads elections.yml)
- `src/data/parties.json.js` — YAML→JSON (reads parties.yml)

---

## Elections configured (all with dummy data)

### Parliamentary (`type: parliamentary`)
- `parl_2024` — 2024 Parliamentary (PR only, 150 seats). Turnout: detailed (snapshots + lists). Precinct data: 22 precincts.
- `parl_2020` — 2020 Parliamentary (mixed PR+SMD). Turnout: basic. Sub-elections: `parl2020_smd` runoff, `parl2020_by_tbilisi` by-election.
- `parl_1992` — 1992 Parliamentary (messy: PR+SMD+compensation). No turnout.
- `parl_1919` — 1919 Constituent Assembly (PR only). No turnout.

### Presidential (`type: presidential`)
- `pres_2018` — 2018 Presidential direct (2 rounds, sub_type: direct). PR choropleth map. Candidates: zourabichvili, vashadze, bakradze, other_pres. Precinct-level data for both rounds. Turnout: basic. Winner badge (✓) shown in bar chart.
- `pres_2024_indirect` — 2024 Presidential indirect (sub_type: indirect). Shows rectangular electoral-college dot grid (300 dots, square grid via √total cols). No map.

### Plebiscite/Referenda (`type: plebiscite`)
- `ref_2024` — 2024 Constitutional Referendum. Two questions (Q1: EU Membership, Q2: NATO Membership) as sub-elections of type `question`. PR choropleth map. Precinct data for both questions. Turnout: basic. Composition card hidden for plebiscites.

### Adjara Supreme Council (`type: adjara`)
- `adj_2020` — 2020 Adjara Supreme Council (mixed PR+SMD, sub_type: mixed). GD/UNM/EG/Other. 15 PR + 11 SMD seats. Turnout: basic.
- `adj_2016` — 2016 Adjara Supreme Council (mixed PR+SMD, sub_type: mixed). GD/UNM/Girchi/Other. 15 PR + 11 SMD seats. Turnout: basic.
- NOTE: Both reuse `parl2024_pr.geojson` and `parl2024_cartogram.geojson` as placeholder shapefiles (all 11 Georgian PR districts). Would need Adjara-specific shapefiles (6 municipalities) for production.

---

## elections.md features implemented

- **Left filter panel:** election type, election selector (sorted newest→oldest), sub-election/question, vote type toggle (hidden for forced-SMD contexts), view mode, map type (geo/cartogram), map detail level (district/precinct), seat filter
- **Map:** Leaflet choropleth (geographic or cartogram), coloured by winner OR by turnout intensity (blue gradient). Zoom-based precinct layer: at high zoom, district boundaries fade and precinct outlines appear.
- **District results panel:** click a district/precinct to see results or turnout stats. Shows candidate names for SMD and presidential elections.
- **Bar chart:** party vote shares with threshold separator line (dashed). Presidential elections show ✓ winner badge. Title changes for presidential.
- **Seat composition:** dot tiles grouped by party. Hidden for presidential and plebiscite elections.
- **Turnout view:** national summary card (big %, voted, registered + optional snapshots + optional list breakdown). Composition card hidden for plebiscite type.
- **Precinct drill-down:** Districts/Precincts toggle (shown only when `hasPrecinct=true`).
- **View toggle:** Results/Turnout (shown only when `hasTurnout=true`).
- **Presidential direct:** Map + district panel + turnout — same pipeline as PR parliamentary.
- **Presidential indirect:** Electoral college dot grid (300 dots, square layout). No map shown.
- **Plebiscite:** Questions as sub-elections of type `question`. Reuses PR pipeline entirely. No seat section. No composition card in turnout.
- **Adjara mixed:** Full parliamentary mixed pipeline — PR tab, SMD tab (with candidate names), seat composition, turnout.
- **SMD/runoff:** vote type toggle hidden for runoff/by-election sub-elections; always renders as SMD.
- **Layout:** max-width 1200px on `.elections-outer`, map column `minmax(0, 680px)`, info panel 280px.

---

## UI labels (key translations)
- "View" / "დათვალიერება" — view mode toggle label
- "Turnout" / "აქტივობა" — turnout option in view mode
- "Boundaries" / "საზღვრები" — geographic map mode
- "Map level" / "რუქის დონე" — district/precinct toggle label

---

## Data files (src/data/)

**Shapefiles (src/data/shp/):**
- `parl2024_pr.geojson`, `parl2024_cartogram.geojson`, `parl2024_pr_precincts.geojson`
- `parl2020_pr.geojson`, `parl2020_smd.geojson`, `parl2020_cartogram.geojson`

**Results CSVs (src/data/results/):**
- parl2024: `parl2024_pr.csv`, `parl2024_precincts.csv`
- parl2020: `parl2020_pr.csv`, `parl2020_smd.csv`, `parl2020_smd_runoff.csv`, `parl2020_by_tbilisi.csv`
- parl1992/1919: `parl1992_pr.csv`, `parl1919_pr.csv`
- pres2018: `pres2018_r1.csv`, `pres2018_r2.csv`, `pres2018_r1_precincts.csv`, `pres2018_r2_precincts.csv`
- ref2024: `ref2024_q1.csv`, `ref2024_q1_precincts.csv`, `ref2024_q2.csv`, `ref2024_q2_precincts.csv`
- adj2020: `adj2020_pr.csv`, `adj2020_smd.csv`
- adj2016: `adj2016_pr.csv`, `adj2016_smd.csv`

**Turnout CSVs (src/data/turnout/):**
- `parl2024_turnout.csv`, `parl2024_precincts_turnout.csv`
- `parl2020_turnout.csv`
- `pres2018_turnout.csv`, `pres2018_precincts_turnout.csv`
- `ref2024_turnout.csv`, `ref2024_precincts_turnout.csv`
- `adj2020_turnout.csv`, `adj2016_turnout.csv`

**How to apply:** When suggesting changes, consider bilingual support, elections.yml-driven data model, Observable Framework reactivity, FileAttachment static path requirement (all files pre-loaded in _allGeo/_allCsv/_allTurnout lookup dicts), and the goal of making data addition easy. Always delete `src/.observablehq/cache/data/elections.json` after modifying `elections.yml`.
