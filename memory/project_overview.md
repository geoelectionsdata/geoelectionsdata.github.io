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
- `src/data/config/translations.json` — ~120+ i18n keys, EN + Georgian
- `src/data/config/parties.yml` — party definitions with colors per election

**Data loaders:**
- `src/data/elections.json.js` — YAML→JSON (reads elections.yml)
- `src/data/parties.json.js` — YAML→JSON (reads parties.yml)

**Elections configured (all with dummy data):**
- `parl_2024` — 2024 Parliamentary (PR only, 150 seats). Has turnout (detailed: snapshots + lists), precinct-level data (22 precincts)
- `parl_2020` — 2020 Parliamentary (mixed PR+SMD). Has turnout (basic). Sub-elections: 2020 SMD runoff, 2021 Tbilisi by-election
- `parl_1992` — 1992 Parliamentary (messy: PR+SMD+compensation). No turnout.
- `parl_1919` — 1919 Constituent Assembly (PR). No turnout.
- `pres_2018` — 2018 Presidential (2 rounds). No turnout.

**elections.md features implemented:**
- Left filter panel: election type, election selector, sub-election, vote type, view mode, map type, map detail level, seat filter
- Map: Leaflet choropleth (geographic or cartogram), coloured by winner OR by turnout intensity (blue gradient)
- District results panel: click a district/precinct to see results or turnout stats
- Bar chart: party vote shares with threshold separator line (dashed, italic "ბარიერი" label)
- Seat composition: rectangular tiles grouped by party
- Turnout view: national summary card (big %, voted, registered + snapshots + list breakdown)
- Precinct drill-down: Districts/Precincts toggle (only shown for elections with precinct data)
- View toggle: Results/Turnout (only shown for elections with turnout data)

**Data files (dummy):**
- `src/data/shp/` — GeoJSONs for parl2024 PR, cartogram, precincts (22); parl2020 PR, SMD, cartogram
- `src/data/results/` — CSVs for parl2024 PR, parl2024 precincts, parl2020 PR/SMD/runoff/by-election
- `src/data/turnout/` — parl2024 district turnout, parl2024 precinct turnout, parl2020 turnout

**How to apply:** When suggesting changes, consider bilingual support, elections.yml-driven data model, Observable Framework reactivity, FileAttachment static path requirement (all files pre-loaded in _allGeo/_allCsv/_allTurnout lookup dicts), and the goal of making data addition easy.
