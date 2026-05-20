// Shared loader for the candidate search feature. Returns the parsed clusters
// list and metadata. Consumed by:
//   - src/data/candidates-index.json.js   (slim search index, no appearances)
//   - src/data/candidates-details.json.js (cluster_id → appearance[] map)
//
// Inputs:
//   - src/data/config/elections/**/*.yml            (per-election metadata)
//   - src/data/config/parties.yml                   (canonical party names)
//   - src/data/config/candidates/local/*.yml        (mayor/gamgebeli rosters)
//   - src/data/candidates/*.csv                     (PR / SMD / elected rosters)
//   - src/data/raw/party_lists_2024_georgia_unified.xlsx (2024 PR, no CSV yet)
//   - src/data/results/*.csv                        (joined to attach votes)
//   - src/data/shp/*.geojson                        (district names + centroids)

import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { load as yamlLoad } from "js-yaml";
import { csvParse } from "d3-dsv";
import ExcelJS from "exceljs";

const ROOT = "src";
const CONFIG_ELECTIONS_DIR = join(ROOT, "data/config/elections");
const PARTIES_YML = join(ROOT, "data/config/parties.yml");

// ─── helpers ─────────────────────────────────────────────────────────────────

function readYaml(path) {
  const text = readFileSync(path, "utf8");
  try {
    return yamlLoad(text);
  } catch {
    // Some legacy roster YAMLs (e.g. local_2014.yml) have duplicate keys.
    // Fall back to permissive JSON-compat mode (later dupes win).
    return yamlLoad(text, { json: true });
  }
}

function readCsv(relPath) {
  const abs = join(ROOT, relPath);
  if (!existsSync(abs)) return null;
  return csvParse(readFileSync(abs, "utf8"));
}

function readGeoJson(relPath) {
  const abs = join(ROOT, relPath);
  if (!existsSync(abs)) return null;
  try { return JSON.parse(readFileSync(abs, "utf8")); }
  catch { return null; }
}

function collectYmlFiles(base) {
  const out = [];
  for (const entry of readdirSync(base, { withFileTypes: true })) {
    const full = join(base, entry.name);
    if (entry.isDirectory()) out.push(...collectYmlFiles(full));
    else if (entry.name.endsWith(".yml")) out.push(full);
  }
  return out;
}

function geomCentroid(geom) {
  if (!geom) return null;
  let coords = [];
  if (geom.type === "Polygon") coords = geom.coordinates[0] || [];
  else if (geom.type === "MultiPolygon") {
    for (const poly of geom.coordinates) coords.push(...(poly[0] || []));
  }
  if (!coords.length) return null;
  let sx = 0, sy = 0;
  for (const [x, y] of coords) { sx += x; sy += y; }
  return [sx / coords.length, sy / coords.length];
}

// Loose Georgian-aware normalization for fuzzy clustering on (first, last).
function normalizeName(s) {
  if (!s) return "";
  let x = String(s).toLowerCase().trim();
  x = x.replace(/[„""«»".,()]/g, "");
  x = x.replace(/\s+/g, " ");
  x = x.replace(/ი\b/g, "");   // strip trailing nominative -ი
  return x.trim();
}

function splitName(name_ka, first_name, last_name) {
  const f = (first_name ?? "").toString().trim();
  const l = (last_name ?? "").toString().trim();
  if (f && l) return { first_name: f, last_name: l, name_ka: (name_ka || `${f} ${l}`).trim() };
  const full = (name_ka ?? "").toString().trim();
  if (!full) return { first_name: "", last_name: "", name_ka: "" };
  const parts = full.split(/\s+/);
  if (parts.length === 1) return { first_name: parts[0], last_name: "", name_ka: full };
  return { first_name: parts[0], last_name: parts.slice(1).join(" "), name_ka: full };
}

function clusterId(first_norm, last_norm) {
  return `${last_norm}__${first_norm}`;
}

function yearFromId(id) {
  const m = String(id).match(/(\d{4})/);
  return m ? Number(m[1]) : null;
}

// ─── parties / geo / results caches ──────────────────────────────────────────

const partiesYml = readYaml(PARTIES_YML);
const partyRegistry = {};
for (const p of (partiesYml?.parties ?? [])) {
  partyRegistry[p.id] = {
    name_ka: p.name?.ka ?? p.id,
    name_en: p.name?.en ?? p.id
  };
}

function buildElectionPartyMap(election) {
  const m = {};
  for (const p of (election.parties ?? [])) {
    const base = partyRegistry[p.id] ?? { name_ka: p.id, name_en: p.id };
    m[p.id] = {
      name_ka: p.alias?.ka ?? base.name_ka,
      name_en: p.alias?.en ?? base.name_en
    };
  }
  return m;
}

// Normalize Georgian party labels for fuzzy matching: lowercase, strip the
// various flavours of Georgian / typographic quotes, collapse dashes and
// whitespace. This lets us match e.g.
//   "საარჩევნო ბლოკი „ბაქრაძე, უგულავა-ევროპული საქართველო""
// against the registry name
//   "ევროპული საქართველო"
// despite the bloc-prefix and the quoted-form differences.
function normPartyLabel(s) {
  return (s ?? "")
    .toString()
    .toLowerCase()
    .replace(/[„""""''«»]/g, "")
    .replace(/[-‒–—―]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function partyIdFromLabel(label, electionPartyMap) {
  if (!label) return null;
  const norm = normPartyLabel(label);
  // Stage 1: try the election's own party map (aliases override registry).
  for (const [pid, names] of Object.entries(electionPartyMap)) {
    if (!names.name_ka) continue;
    const nk = normPartyLabel(names.name_ka);
    if (!nk) continue;
    if (norm === nk || norm.includes(nk) || nk.includes(norm)) return pid;
  }
  // Stage 2: fall through to the global registry. Some XLSX labels carry
  // names that the election YAML alias has rewritten (e.g. registry says
  // "ევროპული საქართველო" but the election alias says
  // "ევროპული საქართველო-მოძრაობა თავისუფლებისთვის"); the XLSX may match
  // the registry root better.
  for (const pid of Object.keys(electionPartyMap)) {
    const reg = partyRegistry[pid];
    if (!reg?.name_ka) continue;
    const rk = normPartyLabel(reg.name_ka);
    if (!rk) continue;
    if (norm === rk || norm.includes(rk) || rk.includes(norm)) return pid;
  }
  return null;
}

const geoCache = new Map();
function loadGeoIndex(shapeFile) {
  if (!shapeFile) return null;
  if (geoCache.has(shapeFile)) return geoCache.get(shapeFile);
  const gj = readGeoJson(shapeFile);
  if (!gj?.features) { geoCache.set(shapeFile, null); return null; }
  const byId = {};
  for (const feat of gj.features) {
    const p = feat.properties ?? {};
    // Match the elections page's geoId() fallback chain — different vintages
    // of council-district shape files use different property names: 2025/2021
    // use `major_id`, 2010/2014 use `maj_id`, 2017 uses `MID`.
    const id =
      p.district_id ??
      p.electoral_district_id ??
      p.major_id ??
      p.maj_id ??
      p.MID ??
      p.selfgov_id ??
      p.self_gov_id ??
      p.id ??
      p.OBJECTID;
    if (id == null) continue;
    const c = geomCentroid(feat.geometry);
    // Council-district vintages also vary in how the human-readable name is
    // stored: 2025/2021 → district_name_{ka,en}; 2014 → name_{ka,en};
    // 2010 → district_{ka,en}; 2017 has no name field at all.
    const name_ka = p.name_ka ?? p.district_name_ka ?? p.district_ka ?? p.NAME_KA ?? p.name ?? null;
    const name_en = p.name_en ?? p.district_name_en ?? p.district_en ?? p.NAME_EN ?? null;
    // Multiple features can share an id (e.g. a council district split into
    // several polygons). First write wins for the name; centroid stays from
    // the first polygon, which is good enough for the "view on map" anchor.
    const key = String(id);
    if (!byId[key]) {
      byId[key] = {
        name_ka,
        name_en,
        lat: c ? c[1] : null,
        lng: c ? c[0] : null,
        zoom: 9
      };
    }
  }
  const idx = { byId };
  geoCache.set(shapeFile, idx);
  return idx;
}

function lookupDistrict(shapeFile, id) {
  if (!shapeFile || id == null) return {};
  const idx = loadGeoIndex(shapeFile);
  if (!idx) return {};
  return idx.byId[String(id)] ?? {};
}

const resultsCache = new Map();
function loadResults(relPath) {
  if (!relPath) return null;
  if (resultsCache.has(relPath)) return resultsCache.get(relPath);
  const rows = readCsv(relPath);
  resultsCache.set(relPath, rows);
  return rows;
}

function indexSmdResults(rows) {
  const idx = {};
  if (!rows) return idx;
  for (const r of rows) {
    const did = r.district_id ?? r.major_id ?? r.electoral_district_id ?? r.smd_code ?? r.maj_id;
    const pid = r.party_id;
    if (!did || !pid) continue;
    idx[`${did}__${pid}`] = {
      votes: Number(r.votes ?? r.votes_total ?? 0) || 0,
      vote_share: Number(r.vote_share ?? 0) || 0
    };
  }
  return idx;
}

function indexPresResults(rows) {
  const idx = {};
  if (!rows) return idx;
  let total = 0;
  const byParty = {};
  for (const r of rows) {
    const pid = r.party_id;
    if (!pid) continue;
    const v = Number(r.votes) || 0;
    if (r.district_id === "national" || r.district_id === "0") {
      byParty[pid] = { votes: v, vote_share: Number(r.vote_share) || 0 };
    } else {
      byParty[pid] ??= { votes: 0, vote_share: 0 };
      byParty[pid].votes += v;
      total += v;
    }
  }
  if (total > 0) {
    for (const pid of Object.keys(byParty)) {
      if (!byParty[pid].vote_share) byParty[pid].vote_share = byParty[pid].votes / total;
    }
  }
  Object.assign(idx, byParty);
  return idx;
}

function makeAppearance(o) {
  return {
    election_id: o.election_id,
    election_type: o.election_type,
    election_year: o.election_year,
    vote_type: o.vote_type,
    party_id: o.party_id ?? null,
    party_label_ka: o.party_label_ka ?? null,
    party_label_en: o.party_label_en ?? null,
    list_order: o.list_order ?? null,
    district_id: o.district_id ?? null,
    district_name_ka: o.district_name_ka ?? null,
    district_name_en: o.district_name_en ?? null,
    district_lat: o.district_lat ?? null,
    district_lng: o.district_lng ?? null,
    district_zoom: o.district_zoom ?? null,
    votes: o.votes ?? null,
    vote_share: o.vote_share ?? null,
    elected: o.elected ?? false,
    notes: o.notes ?? null,
    // placeholders — to be populated in a later pass:
    bio_link: null,
    photo_link: null,
    dob: o.dob ?? null
  };
}

// Read the local-2017 PR list + elected sheets from the
// adg_2017_candidates_unified.xlsx raw file. Returns
//   { prRows: [{selfgov_id, party_label, list_order, first_name, last_name}], electedNames: Set<"first__last"> }
async function read2017LocalXlsx() {
  const path = join(ROOT, "data/raw/adg_2017_candidates_unified.xlsx");
  if (!existsSync(path)) return { prRows: [], electedNames: new Set() };
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(path);

  // PR list candidates
  const prRows = [];
  const prWs = wb.getWorksheet("PR candidates");
  if (prWs) {
    const hdr = prWs.getRow(1).values.slice(1);
    for (let i = 2; i <= prWs.rowCount; i++) {
      const row = prWs.getRow(i).values.slice(1);
      const rec = Object.fromEntries(hdr.map((h, j) => [h, row[j]]));
      const first = rec.name?.toString().trim();
      const last = rec.last_name?.toString().trim();
      if (!first && !last) continue;
      prRows.push({
        selfgov_id: rec.district_number != null ? String(rec.district_number) : null,
        party_label: rec.party_list_name?.toString().trim() ?? null,
        list_order: Number(rec.order_id) || null,
        first_name: first,
        last_name: last,
        partisanship: rec.partisanship?.toString().trim() ?? null
      });
    }
  }

  // Elected politicians — covers PR, SMD, mayor in one sheet
  const electedNames = new Set();
  const elWs = wb.getWorksheet("elected politicians");
  if (elWs) {
    const hdr = elWs.getRow(1).values.slice(1);
    for (let i = 2; i <= elWs.rowCount; i++) {
      const row = elWs.getRow(i).values.slice(1);
      const rec = Object.fromEntries(hdr.map((h, j) => [h, row[j]]));
      const first = rec.name?.toString().trim() ?? "";
      const last = rec.last_name?.toString().trim() ?? "";
      if (!first && !last) continue;
      electedNames.add(`${normalizeName(first)}__${normalizeName(last)}`);
    }
  }

  return { prRows, electedNames };
}

async function read2024PrListXlsx() {
  const path = join(ROOT, "data/raw/party_lists_2024_georgia_unified.xlsx");
  if (!existsSync(path)) return [];
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(path);
  const ws = wb.getWorksheet("Candidates");
  if (!ws) return [];
  const headerRow = ws.getRow(1).values.slice(1);
  const out = [];
  for (let i = 2; i <= ws.rowCount; i++) {
    const row = ws.getRow(i).values.slice(1);
    const rec = Object.fromEntries(headerRow.map((h, j) => [h, row[j]]));
    if (!rec.name && !rec.last_name) continue;
    out.push({
      first_name: rec.name?.toString().trim(),
      last_name: rec.last_name?.toString().trim(),
      list_order: Number(rec.order_id) || null,
      party_label: rec.party_name?.toString().trim(),
      partisanship: rec.partisanship?.toString().trim()
    });
  }
  return out;
}

function loadElectedKeys(electionFiles) {
  if (!electionFiles?.elected) return new Set();
  const rows = readCsv(electionFiles.elected);
  if (!rows) return new Set();
  const set = new Set();
  for (const r of rows) {
    const { first_name, last_name } = splitName(r.name_ka, r.first_name, r.last_name);
    set.add(`${normalizeName(first_name)}__${normalizeName(last_name)}`);
  }
  return set;
}

// Compact: drop null fields + the cluster-redundant name fields.
function compactAppearance(a) {
  const out = {};
  for (const [k, v] of Object.entries(a)) {
    if (v == null) continue;
    if (k === "first_name" || k === "last_name" || k === "name_ka") continue;
    out[k] = v;
  }
  return out;
}

// ─── main build ──────────────────────────────────────────────────────────────

export async function buildCandidates() {
  const electionFiles = collectYmlFiles(CONFIG_ELECTIONS_DIR);
  const elections = electionFiles.map(f => readYaml(f));

  const electionMeta = elections.map(e => ({
    id: e.id,
    type: e.type,
    year: yearFromId(e.id),
    name_ka: e.name?.ka ?? e.id,
    name_en: e.name?.en ?? e.id
  })).sort((a, b) => (b.year ?? 0) - (a.year ?? 0));

  const appearances = [];

  function pushCsvAppearances({ rows, electionId, electionType, electionYear, voteType, partyMap, electedKeys, shapeFile, smdIdx, getDistrictId, getPartyId, getListOrder }) {
    if (!rows) return;
    for (const r of rows) {
      const { first_name, last_name, name_ka } = splitName(r.name_ka, r.first_name, r.last_name);
      if (!first_name && !last_name) continue;
      const did = getDistrictId ? getDistrictId(r) : null;
      const pid = getPartyId ? getPartyId(r) : (r.party_id || null);
      const partyNames = (pid && partyMap[pid]) ? partyMap[pid] : null;
      const district = shapeFile ? lookupDistrict(shapeFile, did) : {};
      const joinKey = (did != null && pid) ? `${did}__${pid}` : null;
      const result = joinKey && smdIdx ? smdIdx[joinKey] : null;
      const electedKey = `${normalizeName(first_name)}__${normalizeName(last_name)}`;
      const ap = makeAppearance({
        election_id: electionId,
        election_type: electionType,
        election_year: electionYear,
        vote_type: voteType,
        party_id: pid,
        party_label_ka: partyNames?.name_ka ?? r.party_label ?? r.party_label_ka ?? r.party_name ?? null,
        party_label_en: partyNames?.name_en ?? null,
        list_order: getListOrder ? getListOrder(r) : null,
        district_id: did,
        district_name_ka: district.name_ka ?? r.district_name_ka ?? r.smd_name ?? null,
        district_name_en: district.name_en ?? null,
        district_lat: district.lat ?? null,
        district_lng: district.lng ?? null,
        district_zoom: district.zoom ?? null,
        votes: result?.votes ?? null,
        vote_share: result?.vote_share ?? null,
        elected: electedKeys?.has(electedKey) ?? false
      });
      ap.first_name = first_name;
      ap.last_name = last_name;
      ap.name_ka = name_ka;
      appearances.push(ap);
    }
  }

  for (const election of elections) {
    const partyMap = buildElectionPartyMap(election);
    const electedKeys = loadElectedKeys(election.files);
    const year = yearFromId(election.id);
    const f = election.files ?? {};

    // Special-case raw-XLSX ingestion for elections whose candidate data lives
    // in a not-yet-converted XLSX. Currently only local_2017 — the XLSX
    // carries the sakrebulo PR list (12.9k rows) + a unified elected-politicians
    // sheet that covers mayor / SMD / PR winners. Loaded once per pass; the
    // elected names are unioned into electedKeys BEFORE the YAML candidate
    // roster is processed, so `elected: true` is correct for both branches.
    let xlsx2017 = null;
    if (election.id === "local_2017") {
      xlsx2017 = await read2017LocalXlsx();
      for (const k of xlsx2017.electedNames) electedKeys.add(k);
    }

    if (f.party_lists) {
      // For local elections, the PR list is per selfgov unit — pass the selfgov
      // shape so each candidate gets the selfgov name as their district label.
      const prShapeFile = election.type === "local"
        ? (election.system?.pr?.selfgov_shape_file ?? election.system?.smd?.shape_file ?? null)
        : null;
      pushCsvAppearances({
        rows: readCsv(f.party_lists),
        electionId: election.id,
        electionType: election.type,
        electionYear: year,
        voteType: "pr",
        partyMap, electedKeys,
        shapeFile: prShapeFile,
        getDistrictId: r => r.district_id ?? null,
        getPartyId: r => r.party_id ?? null,
        getListOrder: r => Number(r.list_order ?? r.order_id ?? r.candidate_order) || null
      });
    }

    if (f.candidates && f.candidates.endsWith(".csv") && election.type !== "presidential") {
      // For local elections the SMD candidate CSV is actually a sakrebulo
      // (council) SMD roster — the matching geojson is election.council.shape_file
      // and the id to match is major_id. For parliamentary/adjara, the regular
      // election.system.smd.shape_file is correct.
      const isLocal = election.type === "local";
      const smdShape = isLocal
        ? (election.council?.shape_file ?? election.system?.smd?.shape_file ?? null)
        : (election.system?.smd?.shape_file ?? null);
      const smdIdx = indexSmdResults(f.smd_results ? loadResults(f.smd_results) : null);
      pushCsvAppearances({
        rows: readCsv(f.candidates),
        electionId: election.id,
        electionType: election.type,
        electionYear: year,
        voteType: isLocal ? "council_smd" : "smd",
        partyMap, electedKeys,
        shapeFile: smdShape, smdIdx,
        getDistrictId: isLocal
          ? (r => r.major_id ?? r.district_id ?? r.electoral_district_id ?? r.smd_code ?? null)
          : (r => r.electoral_district_id ?? r.district_id ?? r.major_id ?? r.smd_code ?? null),
        getPartyId: r => r.party_id ?? null
      });
    }

    if (election.type === "local") {
      const stem = election.id.replace("_", "");
      const mayorCsv = `data/candidates/${stem}_mayor_candidates.csv`;
      const mayorGCsv = `data/candidates/${stem}_mayor_gamgebeli_candidates.csv`;
      const selfgovShape = election.system?.pr?.selfgov_shape_file ?? election.system?.smd?.shape_file ?? null;
      if (existsSync(join(ROOT, mayorCsv))) {
        pushCsvAppearances({
          rows: readCsv(mayorCsv),
          electionId: election.id,
          electionType: election.type,
          electionYear: year,
          voteType: "mayor",
          partyMap, electedKeys,
          shapeFile: selfgovShape,
          getDistrictId: r => r.selfgov_id ?? r.district_id ?? null,
          getPartyId: r => r.party_id ?? null
        });
      }
      if (existsSync(join(ROOT, mayorGCsv))) {
        pushCsvAppearances({
          rows: readCsv(mayorGCsv),
          electionId: election.id,
          electionType: election.type,
          electionYear: year,
          voteType: "gamgebeli",
          partyMap, electedKeys,
          shapeFile: election.system?.smd?.shape_file ?? null,
          getDistrictId: r => r.district_id ?? r.major_id ?? null,
          getPartyId: r => r.party_id ?? null
        });
      }
    }

    if (election.type === "presidential" && f.candidates?.endsWith(".csv")) {
      const candRows = readCsv(f.candidates);
      const presIdx = indexPresResults(loadResults(f.pr_results));
      if (candRows) {
        for (const r of candRows) {
          const { first_name, last_name, name_ka } = splitName(r.name_ka, r.first_name, r.last_name);
          if (!first_name && !last_name) continue;
          const pid = r.party_id;
          const partyNames = pid ? partyMap[pid] : null;
          const result = pid ? presIdx[pid] : null;
          const electedKey = `${normalizeName(first_name)}__${normalizeName(last_name)}`;
          const ap = makeAppearance({
            election_id: election.id,
            election_type: election.type,
            election_year: year,
            vote_type: "presidential",
            party_id: pid,
            party_label_ka: partyNames?.name_ka ?? r.party_label_ka ?? null,
            party_label_en: partyNames?.name_en ?? null,
            votes: result?.votes ?? null,
            vote_share: result?.vote_share ?? null,
            elected: electedKeys.has(electedKey)
          });
          ap.first_name = first_name; ap.last_name = last_name; ap.name_ka = name_ka;
          appearances.push(ap);
        }
      }
    }

    const localCandYml = f.candidates && f.candidates.endsWith(".yml") ? join(ROOT, f.candidates) : null;
    if (localCandYml && existsSync(localCandYml)) {
      const doc = readYaml(localCandYml);
      const selfgovShape = election.system?.smd?.shape_file ?? null;
      const councilShape = election.council?.shape_file ?? null;
      for (const c of Object.values(doc.candidates ?? {})) {
        const { first_name, last_name, name_ka } = splitName(c.name_ka, null, null);
        if (!first_name && !last_name) continue;
        const pid = c.party ?? null;
        const partyNames = pid ? partyMap[pid] : null;
        const electionType = c.election_type ?? "mayor";

        // Council SMD candidates carry both a selfgov_id and a major_id; the
        // relevant geographic unit is the council district (major_id), and the
        // matching geojson is election.council.shape_file — NOT the selfgov
        // polygons. Resolving against the wrong shape gives the selfgov
        // centroid instead of the specific council-district centroid, and the
        // elections page can't drill down on the `unit` param.
        const isCouncilSmd = electionType === "sakrebulo_smd" || electionType === "council_smd";
        const did = isCouncilSmd
          ? (c.major_id ?? c.district_id ?? c.selfgov_id ?? null)
          : (c.selfgov_id ?? c.district_id ?? null);
        const shape = isCouncilSmd ? (councilShape ?? selfgovShape) : selfgovShape;
        const district = shape ? lookupDistrict(shape, did) : {};

        const electedKey = `${normalizeName(first_name)}__${normalizeName(last_name)}`;
        const ap = makeAppearance({
          election_id: election.id,
          election_type: election.type,
          election_year: year,
          vote_type: electionType,
          party_id: pid,
          party_label_ka: partyNames?.name_ka ?? null,
          party_label_en: partyNames?.name_en ?? null,
          district_id: did,
          district_name_ka: district.name_ka ?? null,
          district_name_en: district.name_en ?? null,
          district_lat: district.lat ?? null,
          district_lng: district.lng ?? null,
          district_zoom: district.zoom ?? null,
          elected: electedKeys.has(electedKey)
        });
        ap.first_name = first_name; ap.last_name = last_name; ap.name_ka = name_ka;
        appearances.push(ap);
      }
    }

    // local_2017 sakrebulo PR list — sourced from adg_2017 XLSX. The local
    // YAML roster only covers mayor / sakrebulo_smd, so PR candidates would
    // otherwise be absent. Each row is one PR-list slot inside a selfgov unit.
    if (election.id === "local_2017" && xlsx2017) {
      const selfgovShape = election.system?.pr?.selfgov_shape_file
                       ?? election.system?.smd?.shape_file ?? null;
      for (const r of xlsx2017.prRows) {
        const first_name = r.first_name ?? "";
        const last_name = r.last_name ?? "";
        if (!first_name && !last_name) continue;
        const pid = partyIdFromLabel(r.party_label, partyMap);
        const partyNames = pid ? partyMap[pid] : null;
        const did = r.selfgov_id;
        const district = selfgovShape ? lookupDistrict(selfgovShape, did) : {};
        const electedKey = `${normalizeName(first_name)}__${normalizeName(last_name)}`;
        const ap = makeAppearance({
          election_id: "local_2017",
          election_type: "local",
          election_year: 2017,
          vote_type: "pr",
          party_id: pid,
          party_label_ka: partyNames?.name_ka ?? r.party_label ?? null,
          party_label_en: partyNames?.name_en ?? null,
          list_order: r.list_order,
          district_id: did,
          district_name_ka: district.name_ka ?? null,
          district_name_en: district.name_en ?? null,
          district_lat: district.lat ?? null,
          district_lng: district.lng ?? null,
          district_zoom: district.zoom ?? null,
          elected: electedKeys.has(electedKey),
          notes: r.partisanship && r.partisanship !== r.party_label ? r.partisanship : null
        });
        ap.first_name = first_name;
        ap.last_name = last_name;
        ap.name_ka = `${first_name} ${last_name}`.trim();
        appearances.push(ap);
      }
    }
  }

  // 2024 PR list — sourced from raw XLSX (no CSV yet).
  const parl2024 = elections.find(e => e.id === "parl_2024");
  if (parl2024) {
    const partyMap = buildElectionPartyMap(parl2024);
    const rows = await read2024PrListXlsx();
    for (const r of rows) {
      const first_name = (r.first_name ?? "").trim();
      const last_name = (r.last_name ?? "").trim();
      if (!first_name && !last_name) continue;
      const pid = partyIdFromLabel(r.party_label, partyMap);
      const partyNames = pid ? partyMap[pid] : null;
      const ap = makeAppearance({
        election_id: "parl_2024",
        election_type: "parliamentary",
        election_year: 2024,
        vote_type: "pr",
        party_id: pid,
        party_label_ka: partyNames?.name_ka ?? r.party_label ?? null,
        party_label_en: partyNames?.name_en ?? null,
        list_order: r.list_order ?? null,
        notes: r.partisanship && r.partisanship !== r.party_label ? r.partisanship : null
      });
      ap.first_name = first_name;
      ap.last_name = last_name;
      ap.name_ka = `${first_name} ${last_name}`.trim();
      appearances.push(ap);
    }
  }

  // ─── cluster ───────────────────────────────────────────────────────────────

  const clusters = new Map();
  for (const ap of appearances) {
    const fn = normalizeName(ap.first_name);
    const ln = normalizeName(ap.last_name);
    if (!fn && !ln) continue;
    const cid = clusterId(fn, ln);
    let c = clusters.get(cid);
    if (!c) {
      c = {
        cluster_id: cid,
        name_ka: ap.name_ka,
        first_name: ap.first_name,
        last_name: ap.last_name,
        name_variants: new Set(),
        latest_party_id: null,
        latest_year: -Infinity,
        parties: new Set(),                  // all party_ids the candidate ran for
        appearances: []
      };
      clusters.set(cid, c);
    }
    c.name_variants.add(ap.name_ka);
    c.appearances.push(ap);
    if (ap.party_id) c.parties.add(ap.party_id);
    if (ap.election_year != null && ap.election_year > c.latest_year) {
      c.latest_year = ap.election_year;
      c.latest_party_id = ap.party_id ?? c.latest_party_id;
      if (ap.name_ka) c.name_ka = ap.name_ka;
    }
  }

  const clustersOut = [...clusters.values()]
    .map(c => {
      const sortedAppearances = c.appearances
        .sort((a, b) => (b.election_year ?? 0) - (a.election_year ?? 0));
      // Compact per-cluster summary list: election_id + vote_type pairs in display
      // order. `d` (district name) is included when meaningful — used in the
      // search-results column to show e.g. "Local 2014, PR list (Tbilisi)".
      const appearances_summary = sortedAppearances.map(a => {
        const obj = { e: a.election_id, v: a.vote_type };
        if (a.district_name_ka) obj.d = a.district_name_ka;
        return obj;
      });
      // Parties ordered by most-recent-appearance.
      const partiesOrdered = [];
      const partyLabels = new Map();
      const seen = new Set();
      for (const a of sortedAppearances) {
        if (a.party_id && !seen.has(a.party_id)) {
          seen.add(a.party_id);
          partiesOrdered.push(a.party_id);
        }
        if (a.party_id && !partyLabels.has(a.party_id)) {
          const base = partyRegistry[a.party_id] ?? {};
          const name_ka = a.party_label_ka ?? base.name_ka ?? a.party_id;
          const name_en = a.party_label_en ?? base.name_en ?? name_ka;
          const needsInlineLabel =
            !base.name_ka ||
            base.name_ka === a.party_id ||
            (a.party_label_ka && a.party_label_ka !== base.name_ka);
          if (needsInlineLabel) {
            partyLabels.set(a.party_id, { id: a.party_id, name_ka, name_en });
          }
        }
      }
      return {
        cluster_id: c.cluster_id,
        name_ka: c.name_ka,
        first_name: c.first_name,
        last_name: c.last_name,
        name_variants: [...c.name_variants].filter(Boolean),
        latest_party_id: c.latest_party_id,
        latest_year: c.latest_year === -Infinity ? null : c.latest_year,
        parties: partiesOrdered,
        party_labels: partiesOrdered.map(pid => partyLabels.get(pid)).filter(Boolean),
        appearances_summary,
        appearance_count: c.appearances.length,
        appearances: sortedAppearances.map(compactAppearance)
      };
    })
    .sort((a, b) =>
      (a.last_name ?? "").localeCompare(b.last_name ?? "", "ka") ||
      (a.first_name ?? "").localeCompare(b.first_name ?? "", "ka")
    );

  return {
    generated_at: new Date().toISOString(),
    elections: electionMeta,
    parties: partyRegistry,
    clusters: clustersOut,
    appearance_count: appearances.length
  };
}
