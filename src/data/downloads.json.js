// src/data/downloads.json.js
// Observable Framework data loader
// Generates one Excel (.xlsx) file per election + sub-election in src/data/downloads/
// Outputs a JSON manifest to stdout (served at /data/downloads.json)

import fs     from "node:fs";
import path   from "node:path";
import crypto from "node:crypto";
import yaml   from "js-yaml";
import ExcelJS from "exceljs";

// ── Paths ──────────────────────────────────────────────────────────────────
const ROOT         = process.cwd();
const SRC          = path.join(ROOT, "src");
const ELECTIONS_DIR = path.join(SRC, "data", "config", "elections");
const PARTIES_YML   = path.join(SRC, "data", "config", "parties.yml");
const OUT_DIR       = path.join(SRC, "data", "downloads");
const GEN_DT        = new Date();

fs.mkdirSync(OUT_DIR, { recursive: true });

// ── CSV reader ─────────────────────────────────────────────────────────────
function parseCSVLine(line) {
  const out = []; let cur = ""; let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') { if (inQ && line[i + 1] === '"') { cur += '"'; i++; } else inQ = !inQ; }
    else if (c === ',' && !inQ) { out.push(cur); cur = ""; }
    else cur += c;
  }
  out.push(cur);
  return out.map(s => s.replace(/^"|"$/g, "").trim());
}

function readCSV(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return [];
  const lines = fs.readFileSync(filePath, "utf8").trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  const headers = parseCSVLine(lines[0]);
  return lines.slice(1).map(line => {
    const vals = parseCSVLine(line);
    const obj  = {};
    headers.forEach((h, i) => {
      const v = vals[i] ?? "";
      const n = Number(v);
      obj[h] = v !== "" && !isNaN(n) ? n : v;
    });
    return obj;
  });
}

// ── GeoJSON reader/lookup (cached) ─────────────────────────────────────────
const _geoCache = new Map();
function readGeoJSON(p) {
  if (!p || !fs.existsSync(p)) return null;
  if (_geoCache.has(p)) return _geoCache.get(p);
  const g = JSON.parse(fs.readFileSync(p, "utf8"));
  _geoCache.set(p, g);
  return g;
}

// Build id→properties map from GeoJSON features
function makePropLookup(geojson, idProp = "id") {
  const m = new Map();
  for (const f of (geojson?.features ?? [])) {
    const raw = f.properties?.[idProp];
    if (raw != null) m.set(String(Math.round(Number(raw))), f.properties);
  }
  return m;
}

// Extract lat/lon from GeoJSON feature, trying multiple property names
function getCoords(props, geometry) {
  // Try common property names first (faster than computing centroid)
  const lat = props?.latitude ?? props?.lat ?? null;
  const lon = props?.longitude ?? props?.lon ?? null;
  if (lat != null && lon != null) return { latitude: +lat, longitude: +lon };
  // Fall back to geometry
  if (!geometry) return { latitude: "", longitude: "" };
  if (geometry.type === "Point") return { latitude: geometry.coordinates[1], longitude: geometry.coordinates[0] };
  const ring = geometry.type === "Polygon" ? geometry.coordinates[0] : geometry.coordinates[0]?.[0] ?? [];
  if (!ring.length) return { latitude: "", longitude: "" };
  return {
    latitude:  ring.reduce((s, c) => s + c[1], 0) / ring.length,
    longitude: ring.reduce((s, c) => s + c[0], 0) / ring.length,
  };
}

// ── YAML reader — scan elections directory recursively ─────────────────────
function readAllElections() {
  const elections = [];
  function scan(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) scan(p);
      else if (/\.ya?ml$/i.test(entry.name)) {
        try { const e = yaml.load(fs.readFileSync(p, "utf8")); if (e?.id) elections.push(e); } catch {}
      }
    }
  }
  if (fs.existsSync(ELECTIONS_DIR)) scan(ELECTIONS_DIR);
  return elections;
}

// ── Party lookup: id → { name_en, name_ka } ───────────────────────────────
// Respects election-level alias overrides (from election YAML parties array)
function buildPartyLookup(partiesYaml, electionParties = []) {
  const lookup = {};
  // Base entries from parties.yml
  for (const [id, p] of Object.entries(partiesYaml ?? {})) {
    if (typeof p !== "object" || !p) continue;
    lookup[id] = {
      name_en: p.name?.en ?? id,
      name_ka: p.name?.ka ?? p.name?.en ?? id,
    };
  }
  // Override with election-specific aliases
  for (const ep of electionParties) {
    const id = ep.id;
    if (!id) continue;
    const alias = ep.alias ?? {};
    const name  = ep.name  ?? {};
    if (alias.en || name.en) lookup[id] = { ...lookup[id], name_en: alias.en ?? name.en ?? lookup[id]?.name_en ?? id };
    if (alias.ka || name.ka) lookup[id] = { ...lookup[id], name_ka: alias.ka ?? name.ka ?? lookup[id]?.name_ka ?? id };
  }
  return lookup;
}

// ── Pivot long→wide: one row per id, parties as columns ───────────────────
const TURNOUT_COLS = ["registered","voted","voted_noon","voted_5pm",
  "main_list","special_list","turnout_pct","noon_pct","five_pct","invalid_ballots","invalid_pct"];

function pivotLong(rows, idCol) {
  const groups = new Map();
  for (const r of rows) {
    const id = String(r[idCol] ?? "");
    if (!groups.has(id)) {
      const base = { [idCol]: id };
      for (const c of TURNOUT_COLS) base[c] = null;
      groups.set(id, base);
    }
    const g = groups.get(id);
    for (const c of TURNOUT_COLS) { if (g[c] == null && r[c] != null) g[c] = r[c]; }
    const pid = r.party_id;
    if (pid) {
      g[`${pid}__votes`] = r.votes      ?? null;
      g[`${pid}__pct`]   = r.vote_share ?? null;
      if (r.seats_pr  != null) g[`${pid}__seats_pr`]  = r.seats_pr;
      if (r.seats_smd != null) g[`${pid}__seats_smd`] = r.seats_smd;
      // Carry candidate name at district level
      if (r.name_ka) g[`${pid}__name_ka`] = r.name_ka;
    }
  }
  return [...groups.values()];
}

function uniqueParties(rows) {
  const seen = new Set(); const ids = [];
  for (const r of rows) { if (r.party_id && !seen.has(r.party_id)) { seen.add(r.party_id); ids.push(r.party_id); } }
  return ids;
}

// ── Excel styling helpers ──────────────────────────────────────────────────
const HDR_FILL = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1a3a5c" } };
const HDR_FONT = { bold: true, color: { argb: "FFFFFFFF" }, size: 9, name: "Calibri" };
const ALT_FILL = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF2F6FA" } };

function styleHeader(row) {
  row.height = 34;
  row.eachCell(cell => {
    cell.fill      = HDR_FILL;
    cell.font      = HDR_FONT;
    cell.alignment = { wrapText: true, vertical: "middle", horizontal: "center" };
    cell.border    = { bottom: { style: "medium", color: { argb: "FF4a7aac" } } };
  });
}

function addAltRows(sheet, fromRow) {
  for (let r = fromRow; r <= sheet.rowCount; r++) {
    if (r % 2 === 0) {
      sheet.getRow(r).eachCell({ includeEmpty: false }, cell => {
        if (!cell.fill?.fgColor) cell.fill = ALT_FILL;
      });
    }
  }
}

function pct(v) { return v != null ? Number((v * 100).toFixed(2)) : ""; }
function coord(v) { return v != null && v !== "" ? Number(Number(v).toFixed(6)) : ""; }

// ── Party column builders ──────────────────────────────────────────────────
function partyColumns(parties, partyLookup, { includeSeats = false } = {}) {
  return parties.flatMap(pid => {
    const p = partyLookup[pid] ?? { name_en: pid, name_ka: pid };
    const hdr = `${p.name_en}\n${p.name_ka}`;
    const cols = [
      { key: `${pid}__votes`, header: `${hdr}\nVotes / ხმები` },
      { key: `${pid}__pct`,   header: `${hdr}\n% / წილი`,     isPct: true },
    ];
    if (includeSeats) {
      cols.push({ key: `${pid}__seats_pr`,  header: `${hdr}\nSeats PR / მან. პრ`,  optional: true });
      cols.push({ key: `${pid}__seats_smd`, header: `${hdr}\nSeats SMD / მან. მაჟ`, optional: true });
    }
    return cols;
  });
}

function addPartyValues(row, partyCols, wideRow) {
  return partyCols.map(c => {
    const v = wideRow[c.key];
    if (v == null) return "";
    return c.isPct ? pct(v) : v;
  });
}

function setColWidths(sheet, widths) {
  widths.forEach((w, i) => { if (w) sheet.getColumn(i + 1).width = w; });
}

// ── Sheet: PR/Council-PR Precincts ─────────────────────────────────────────
function buildPRPrecinctSheet(wb, rows, partyLookup, precinctGeo, distGeo, sheetName) {
  if (!rows.length) return;
  const sheet     = wb.addWorksheet(sheetName);
  const parties   = uniqueParties(rows);
  const pCols     = partyColumns(parties, partyLookup);
  const distLookup = makePropLookup(distGeo);
  // Build precinct feature map: id → {props, geometry}
  const pFeat = new Map((precinctGeo?.features ?? []).map(f => [String(Math.round(Number(f.properties?.id ?? 0))), f]));

  const fixedHdrs = [
    "Precinct ID\nსაარჩ. კოდი",
    "District ID\nოლქის კოდი", "District Name (EN)", "District Name (KA)\nოლქის სახელი",
    "Precinct Name (KA)\nსაარჩ. ბიულ.",
    "Latitude / განედი", "Longitude / გრძედი",
    "Registered\nამომრჩ. სია", "Voted\nმისვლა",
    "Voted Noon\n12:00", "Voted 5pm\n17:00",
    "Turnout %\nაქტ. %", "Noon %\n12:00 %", "5pm %\n17:00 %",
    "Invalid Ballots\nბათილი", "Invalid %\nბათილი %",
  ];
  const hRow = sheet.addRow([...fixedHdrs, ...pCols.map(c => c.header)]);
  styleHeader(hRow);
  setColWidths(sheet, [12, 10, 22, 24, 32, 11, 11, 12, 10, 10, 10, 10, 9, 9, 14, 10,
    ...pCols.map(() => 16)]);

  const wide = pivotLong(rows, "precinct_id");
  for (const r of wide) {
    const pid   = String(Math.round(Number(r.precinct_id)));
    const feat  = pFeat.get(pid);
    const props = feat?.properties ?? {};
    const { latitude, longitude } = getCoords(props, feat?.geometry);
    const distId = String(props.district ?? props.district_id ?? r.district_id ?? "");
    const dProps = distLookup.get(distId) ?? {};
    const nameKa = props.name_ka ?? props.address ?? "";

    sheet.addRow([
      r.precinct_id, distId,
      dProps.name_en ?? dProps.district_name_en ?? distId,
      dProps.name_ka ?? dProps.district_name_ka ?? "",
      nameKa, coord(latitude), coord(longitude),
      r.registered, r.voted, r.voted_noon, r.voted_5pm,
      pct(r.turnout_pct), pct(r.noon_pct), pct(r.five_pct),
      r.invalid_ballots, pct(r.invalid_pct),
      ...addPartyValues(null, pCols, r),
    ]);
  }
  sheet.views = [{ state: "frozen", ySplit: 1 }];
}

// ── Sheet: Mayor Precincts (local) ─────────────────────────────────────────
function buildMayorPrecinctSheet(wb, rows, partyLookup, precinctGeo, selfgovGeo, sheetName) {
  if (!rows.length) return;
  const sheet     = wb.addWorksheet(sheetName);
  const parties   = uniqueParties(rows);
  const pCols     = partyColumns(parties, partyLookup);
  const sgLookup  = makePropLookup(selfgovGeo);
  // Build precinct → CEC district lookup from GeoJSON (properties.district)
  const pFeat = new Map((precinctGeo?.features ?? []).map(f => [String(Math.round(Number(f.properties?.id ?? 0))), f]));

  const fixedHdrs = [
    "Selfgov ID\nთვ.მმართ. კოდი", "Selfgov Name (EN)", "Selfgov Name (KA)",
    "CEC District ID\nოლქის კოდი", "Precinct ID\nსაარჩ. კოდი",
    "Precinct Name (KA)\nსაარჩ. ბიულ.",
    "Latitude / განედი", "Longitude / გრძედი",
    "Registered\nამომრჩ. სია", "Voted\nმისვლა",
    "Voted Noon\n12:00", "Voted 5pm\n17:00",
    "Turnout %\nაქტ. %", "Noon %", "5pm %",
    "Invalid Ballots\nბათილი", "Invalid %",
  ];
  const hRow = sheet.addRow([...fixedHdrs, ...pCols.map(c => c.header)]);
  styleHeader(hRow);
  setColWidths(sheet, [12, 24, 26, 12, 12, 32, 11, 11, 12, 10, 10, 10, 10, 9, 9, 14, 10,
    ...pCols.map(() => 16)]);

  // Note: mayor CSV uses selfgov_id (not district_id)
  const wide = pivotLong(rows, "precinct_id");
  for (const r of wide) {
    const pid    = String(Math.round(Number(r.precinct_id)));
    const feat   = pFeat.get(pid);
    const props  = feat?.properties ?? {};
    const { latitude, longitude } = getCoords(props, feat?.geometry);
    const sgId   = String(r.selfgov_id ?? "");
    const sgProps = sgLookup.get(sgId) ?? {};
    const cecDist = String(Math.round(Number(props.district ?? "")));
    const nameKa  = props.name_ka ?? props.address ?? "";

    sheet.addRow([
      sgId,
      sgProps.name_en ?? sgId, sgProps.name_ka ?? "",
      cecDist, r.precinct_id, nameKa,
      coord(latitude), coord(longitude),
      r.registered, r.voted, r.voted_noon, r.voted_5pm,
      pct(r.turnout_pct), pct(r.noon_pct), pct(r.five_pct),
      r.invalid_ballots, pct(r.invalid_pct),
      ...addPartyValues(null, pCols, r),
    ]);
  }
  sheet.views = [{ state: "frozen", ySplit: 1 }];
}

// ── Sheet: Council SMD Precincts (local) ───────────────────────────────────
function buildCouncilSMDPrecinctSheet(wb, rows, partyLookup, precinctGeo, majorGeo, selfgovGeo, sheetName) {
  if (!rows.length) return;
  const sheet      = wb.addWorksheet(sheetName);
  const parties    = uniqueParties(rows);
  const pCols      = partyColumns(parties, partyLookup);
  const majorLookup = makePropLookup(majorGeo, "major_id");
  const sgLookup   = makePropLookup(selfgovGeo);
  const pFeat = new Map((precinctGeo?.features ?? []).map(f => [String(Math.round(Number(f.properties?.id ?? 0))), f]));

  const fixedHdrs = [
    "Selfgov ID\nთვ.მმართ. კოდი", "Selfgov Name (EN)", "Selfgov Name (KA)",
    "Major District ID\nმაჟ. კოდი", "Major District Name (EN)", "Major District Name (KA)",
    "CEC District ID\nოლქ. კოდი", "Precinct ID\nსაარჩ. კოდი",
    "Precinct Name (KA)\nსაარჩ. ბიულ.",
    "Latitude / განედი", "Longitude / გრძედი",
    "Registered\nამომრჩ. სია", "Voted\nმისვლა",
    "Voted Noon\n12:00", "Voted 5pm\n17:00",
    "Turnout %\nაქტ. %", "Noon %", "5pm %",
    "Invalid Ballots\nბათილი", "Invalid %",
  ];
  const hRow = sheet.addRow([...fixedHdrs, ...pCols.map(c => c.header)]);
  styleHeader(hRow);
  setColWidths(sheet, [12, 24, 26, 12, 24, 26, 12, 12, 32, 11, 11, 12, 10, 10, 10, 10, 9, 9, 14, 10,
    ...pCols.map(() => 16)]);

  // council_smd_precincts: district_id = major_id (e.g. 101, 102…)
  const wide = pivotLong(rows, "precinct_id");
  for (const r of wide) {
    const pid    = String(Math.round(Number(r.precinct_id)));
    const feat   = pFeat.get(pid);
    const props  = feat?.properties ?? {};
    const { latitude, longitude } = getCoords(props, feat?.geometry);
    const majorId = String(Math.round(Number(r.district_id ?? 0)));
    const sgId    = String(Math.floor(Number(majorId) / 100));
    const mProps  = majorLookup.get(majorId) ?? {};
    const sgProps = sgLookup.get(sgId) ?? {};
    const cecDist = String(Math.round(Number(props.district ?? "")));
    const nameKa  = props.name_ka ?? props.address ?? "";

    sheet.addRow([
      sgId, sgProps.name_en ?? sgId, sgProps.name_ka ?? "",
      majorId,
      mProps.district_name_en ?? mProps.name_en ?? majorId,
      mProps.district_name_ka ?? mProps.name_ka ?? "",
      cecDist, r.precinct_id, nameKa,
      coord(latitude), coord(longitude),
      r.registered, r.voted, r.voted_noon, r.voted_5pm,
      pct(r.turnout_pct), pct(r.noon_pct), pct(r.five_pct),
      r.invalid_ballots, pct(r.invalid_pct),
      ...addPartyValues(null, pCols, r),
    ]);
  }
  sheet.views = [{ state: "frozen", ySplit: 1 }];
}

// ── Sheet: SMD Precincts (parliamentary / adjara) ──────────────────────────
function buildSMDPrecinctSheet(wb, rows, partyLookup, precinctGeo, distGeo, sheetName) {
  if (!rows.length) return;
  const sheet     = wb.addWorksheet(sheetName);
  const parties   = uniqueParties(rows);
  const pCols     = partyColumns(parties, partyLookup);
  const distLookup = makePropLookup(distGeo);
  const pFeat = new Map((precinctGeo?.features ?? []).map(f => [String(Math.round(Number(f.properties?.id ?? 0))), f]));

  const fixedHdrs = [
    "District ID\nოლქ. კოდი", "District Name (EN)", "District Name (KA)",
    "Precinct ID\nსაარჩ. კოდი", "Precinct Name (KA)\nსაარჩ. ბიულ.",
    "Latitude / განედი", "Longitude / გრძედი",
    "Registered\nამომრჩ. სია", "Voted\nმისვლა",
    "Voted Noon\n12:00", "Voted 5pm\n17:00",
    "Turnout %\nაქტ. %", "Noon %", "5pm %",
    "Invalid Ballots\nბათილი", "Invalid %",
  ];
  const hRow = sheet.addRow([...fixedHdrs, ...pCols.map(c => c.header)]);
  styleHeader(hRow);
  setColWidths(sheet, [12, 24, 26, 12, 32, 11, 11, 12, 10, 10, 10, 10, 9, 9, 14, 10,
    ...pCols.map(() => 16)]);

  const wide = pivotLong(rows, "precinct_id");
  for (const r of wide) {
    const pid    = String(Math.round(Number(r.precinct_id)));
    const feat   = pFeat.get(pid);
    const props  = feat?.properties ?? {};
    const { latitude, longitude } = getCoords(props, feat?.geometry);
    const distId = String(props.district ?? props.district_id ?? r.district_id ?? "");
    const dProps = distLookup.get(distId) ?? {};
    const nameKa = props.name_ka ?? props.address ?? "";

    sheet.addRow([
      distId, dProps.name_en ?? dProps.district_name_en ?? distId,
      dProps.name_ka ?? dProps.district_name_ka ?? "",
      r.precinct_id, nameKa,
      coord(latitude), coord(longitude),
      r.registered, r.voted, r.voted_noon, r.voted_5pm,
      pct(r.turnout_pct), pct(r.noon_pct), pct(r.five_pct),
      r.invalid_ballots, pct(r.invalid_pct),
      ...addPartyValues(null, pCols, r),
    ]);
  }
  sheet.views = [{ state: "frozen", ySplit: 1 }];
}

// ── Sheet: District Results (PR) ───────────────────────────────────────────
function buildDistrictSheet(wb, rows, partyLookup, distGeo, sheetName) {
  if (!rows.length) return;
  const sheet     = wb.addWorksheet(sheetName);
  const parties   = uniqueParties(rows);
  const hasSeats  = rows.some(r => r.seats_pr != null || r.seats_smd != null);
  const pCols     = partyColumns(parties, partyLookup, { includeSeats: hasSeats });
  const distLookup = makePropLookup(distGeo);

  const fixedHdrs = [
    "District ID\nოლქის კოდი", "District Name (EN)", "District Name (KA)",
    "Registered\nამომრჩ. სია", "Voted\nმისვლა",
    "Voted Noon\n12:00", "Voted 5pm\n17:00",
    "Turnout %\nაქტ. %", "Noon %", "5pm %",
    "Invalid Ballots\nბათილი", "Invalid %",
  ];
  const hRow = sheet.addRow([...fixedHdrs, ...pCols.map(c => c.header)]);
  styleHeader(hRow);
  setColWidths(sheet, [14, 24, 26, 12, 10, 10, 10, 10, 9, 9, 14, 10,
    ...pCols.map(() => 16)]);

  // National row first, then district rows
  const allRows = [
    ...rows.filter(r => r.district_id === "national"),
    ...rows.filter(r => r.district_id !== "national"),
  ];
  const wide = pivotLong(allRows, "district_id");

  for (const r of wide) {
    const isNat  = r.district_id === "national";
    const dProps = distLookup.get(r.district_id) ?? {};
    const rowData = sheet.addRow([
      r.district_id,
      isNat ? "National" : (dProps.name_en ?? dProps.district_name_en ?? r.district_id),
      isNat ? "ეროვნული" : (dProps.name_ka ?? dProps.district_name_ka ?? ""),
      r.registered, r.voted, r.voted_noon, r.voted_5pm,
      pct(r.turnout_pct), pct(r.noon_pct), pct(r.five_pct),
      r.invalid_ballots, pct(r.invalid_pct),
      ...addPartyValues(null, pCols, r),
    ]);
    if (isNat) rowData.font = { bold: true };
  }
  sheet.views = [{ state: "frozen", ySplit: 1 }];
}

// ── Sheet: Candidates ──────────────────────────────────────────────────────
function buildCandidatesSheet(wb, election, partyLookup) {
  const sheet = wb.addWorksheet("Candidates - კანდიდატები");
  const hRow  = sheet.addRow([
    "Candidate Name (KA)\nკანდიდატის სახელი",
    "Candidate Name (EN)",
    "Election Type\nარჩევნების ტიპი",
    "Party ID",
    "Party Name (EN)", "Party Name (KA)",
    "District / Unit\nოლქი / ერთეული",
    "District Name (EN)", "District Name (KA)",
    "Notes / შენიშვნა",
  ]);
  styleHeader(hRow);
  setColWidths(sheet, [26, 26, 20, 18, 24, 26, 14, 22, 24, 24]);

  const indepCount = new Map();

  function addRow(nameKa, nameEn, elecType, partyId, distId, distNameEn, distNameKa, notes = "") {
    const p = partyLookup[partyId];
    let pEn = p?.name_en ?? partyId ?? "";
    let pKa = p?.name_ka ?? pEn;
    if (!partyId || partyId === "independent") {
      const key = `${elecType}:${distId}`;
      const n   = (indepCount.get(key) ?? 0) + 1;
      indepCount.set(key, n);
      pEn = n > 1 ? `Independent (${n})` : "Independent";
      pKa = n > 1 ? `დამოუკიდებელი (${n})` : "დამოუკიდებელი";
    }
    sheet.addRow([nameKa ?? "", nameEn ?? "", elecType, partyId ?? "",
      pEn, pKa, distId ?? "", distNameEn ?? "", distNameKa ?? "", notes]);
  }

  const type = election.type;

  // Presidential: candidates in election YAML
  if (type === "presidential" && Array.isArray(election.candidates)) {
    for (const c of election.candidates) {
      addRow(c.name?.ka ?? "", c.name?.en ?? "", "Presidential", c.party ?? c.id,
        "", "", "", c.threshold_status === "passed" ? "Proceeded to 2nd round" : "");
    }
    return;
  }

  // Parliamentary/Adjara: candidates from files.candidates CSV (if available)
  if ((type === "parliamentary" || type === "adjara") && election.files?.candidates) {
    const fp = path.join(SRC, election.files.candidates);
    const cRows = readCSV(fp);
    if (cRows.length > 0) {
      for (const c of cRows) {
        addRow(c.name_ka ?? c.candidate_name ?? "", c.name_en ?? "",
          c.election_type ?? "Parliamentary SMD", c.party_id ?? "",
          c.district_id ?? "", c.district_name_en ?? "", c.district_name_ka ?? "", "");
      }
      return; // done if CSV found
    }
  }

  // Local: SMD (mayor) candidates from smd_results
  const smdPath = election.files?.smd_results;
  if (smdPath) {
    const seen = new Set();
    for (const r of readCSV(path.join(SRC, smdPath))) {
      if (!r.name_ka || r.district_id === "national") continue;
      const key = `${r.district_id}:${r.party_id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      addRow(r.name_ka, "", "Mayor", r.party_id, r.district_id, "", "", "");
    }
  }

  // Local: Council SMD candidates from council_smd_results
  const cSMDPath = election.files?.council_smd_results;
  if (cSMDPath) {
    const seen = new Set();
    for (const r of readCSV(path.join(SRC, cSMDPath))) {
      if (!r.name_ka || r.district_id === "national") continue;
      const key = `${r.district_id}:${r.party_id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      addRow(r.name_ka, "", "Council SMD / საკრებულო მაჟ.", r.party_id, r.district_id, "", "", "");
    }
  }

  // Placeholder for PR list candidates
  const prPlaceholder = sheet.addRow(["", "", "PR List / პ.სია", "", "", "", "", "", "",
    "[PR candidate lists to be uploaded separately]"]);
  prPlaceholder.getCell(10).font = { italic: true, color: { argb: "FF888888" } };

  sheet.views = [{ state: "frozen", ySplit: 1 }];
}

// ── Sheet: Metadata / Citation ─────────────────────────────────────────────
function buildMetadataSheet(wb, election, sub) {
  const sheet = wb.addWorksheet("About - მეტამონაცემები");
  sheet.getColumn(1).width = 28;
  sheet.getColumn(2).width = 72;

  const subName = (!sub || sub.id === "__main__") ? "Main Election" : (sub.name?.en ?? sub.id);
  const year    = GEN_DT.getFullYear();
  const rows = [
    ["Archive", "Comprehensive Election Data Archive of Georgia (CEDAG)"],
    ["Website", "https://electionsdata.ge"],
    ["Author",  "David Sichinava"],
    ["Citation (APA)", `Sichinava, D. (${year}). Results of the ${election.name?.en ?? election.id}. Comprehensive Election Data Archive of Georgia (CEDAG). https://electionsdata.ge/${election.id}`],
    ["Citation (Chicago)", `Sichinava, David. ${year}. "Results of the ${election.name?.en ?? election.id}." Comprehensive Election Data Archive of Georgia (CEDAG). https://electionsdata.ge/${election.id}.`],
    ["", ""],
    ["Election (EN)",    election.name?.en ?? election.id],
    ["Election (KA)",    election.name?.ka ?? ""],
    ["Election ID",      election.id],
    ["Election Type",    election.type],
    ["Election Date",    election.date ?? ""],
    ["Sub-election",     subName],
    ["", ""],
    ["File Generated",   GEN_DT.toISOString()],
    ["Data Source",      "Central Election Commission of Georgia (cesko.ge)"],
    ["",                 ""],
    ["License",          "Open data. Please cite CEDAG when using."],
  ];
  for (const [k, v] of rows) {
    const row = sheet.addRow([k, v]);
    if (k) row.getCell(1).font = { bold: true, size: 9 };
    row.getCell(2).font = { size: 9 };
    row.getCell(2).alignment = { wrapText: true };
  }
  sheet.getRow(4).getCell(2).font = { italic: true, size: 9 };
}

// ── Filename helpers ───────────────────────────────────────────────────────
function sanitize(s) {
  return (s ?? "").replace(/[<>:"/\\|?*]/g, "").replace(/\s+/g, "_").replace(/_+/g, "_").slice(0, 60).replace(/_$/, "");
}
function subTypeLabel(sub) {
  if (!sub || sub.id === "__main__") return "main";
  if (sub.type === "runoff")      return "runoff";
  if (sub.type === "by_election") return "by_election";
  return sub.type ?? "sub";
}
function makeFilename(election, sub) {
  const name = sanitize(election.name?.en ?? election.id);
  // For date ranges like "1919-02-14 - 1919-02-16", take first date only
  const rawDate = (election.date ?? "").split(/\s/)[0];
  const date = rawDate.replace(/-/g, "");
  const dt   = GEN_DT.toISOString().replace(/[:.TZ-]/g, "").slice(0, 15);
  return `${name}_${subTypeLabel(sub)}_${date}_data_${dt}.xlsx`;
}

// ── Main ───────────────────────────────────────────────────────────────────
const elections  = readAllElections();
const partiesRaw = yaml.load(fs.readFileSync(PARTIES_YML, "utf8")) ?? {};
const manifest   = { generated: GEN_DT.toISOString(), files: [] };

// Remove stale Excel files from a previous run
for (const f of fs.readdirSync(OUT_DIR)) {
  if (f.endsWith(".xlsx")) fs.unlinkSync(path.join(OUT_DIR, f));
}

for (const election of elections) {
  if (!election?.id) continue;

  const partyLookup = buildPartyLookup(partiesRaw, election.parties ?? []);
  const type  = election.type;
  const isLocal  = type === "local";
  const isParl   = type === "parliamentary";
  const isAdjara = type === "adjara";

  // Resolve shape files (always from parent election)
  const resolve = (p) => (p ? path.join(SRC, p) : null);
  const prShape      = readGeoJSON(resolve(election.system?.pr?.shape_file));
  const smdShape     = readGeoJSON(resolve(election.system?.smd?.shape_file));
  const precinctShape = readGeoJSON(resolve(
    election.system?.pr?.precinct_shape_file ?? election.system?.smd?.precinct_shape_file
  ));
  const selfgovShape = readGeoJSON(resolve(election.system?.pr?.selfgov_shape_file));
  const majorShape   = readGeoJSON(resolve(election.council?.shape_file));

  // Sub-elections to process (main + all sub)
  const mainSub = { id: "__main__", type: "main", name: { en: "Main" } };
  const subs    = [mainSub, ...(election.sub_elections ?? []).filter(s => s?.id)];

  for (const sub of subs) {
    const isMain = sub.id === "__main__";
    // Merged file refs: sub overrides parent
    const f = { ...(election.files ?? {}), ...(isMain ? {} : (sub.files ?? {})) };

    // Load CSVs
    const prPrecinctRows   = readCSV(resolve(f.pr_precinct_results));
    const prDistRows       = readCSV(resolve(f.pr_results));
    const smdPrecinctRows  = readCSV(resolve(f.smd_precinct_results));
    const smdDistRows      = readCSV(resolve(f.smd_results));
    const cPRPrecinctRows  = readCSV(resolve(f.council_pr_precinct_results));
    const cSMDPrecinctRows = readCSV(resolve(f.council_smd_precinct_results));

    // Skip if truly no data
    const hasData = [prPrecinctRows, prDistRows, smdPrecinctRows,
      smdDistRows, cPRPrecinctRows, cSMDPrecinctRows].some(r => r.length > 0);
    if (!hasData) continue;

    const wb = new ExcelJS.Workbook();
    wb.creator  = "CEDAG - Comprehensive Election Data Archive of Georgia";
    wb.created  = GEN_DT;
    wb.modified = GEN_DT;

    // ── Sheet 1: PR Precincts ─────────────────────────────────────────────
    const prPrecSource = isLocal ? cPRPrecinctRows : prPrecinctRows;
    if (prPrecSource.length > 0) {
      buildPRPrecinctSheet(wb, prPrecSource, partyLookup, precinctShape, prShape,
        isLocal ? "Council PR - Precincts" : "PR - Precincts");
    }

    // ── Sheet 2: Mayor Precincts (local only) ─────────────────────────────
    if (isLocal && smdPrecinctRows.length > 0) {
      buildMayorPrecinctSheet(wb, smdPrecinctRows, partyLookup,
        precinctShape, selfgovShape, "Mayor - Precincts");
    }

    // ── Sheet 3: Council SMD Precincts (local only) ───────────────────────
    if (isLocal && cSMDPrecinctRows.length > 0) {
      buildCouncilSMDPrecinctSheet(wb, cSMDPrecinctRows, partyLookup,
        precinctShape, majorShape, selfgovShape, "Council SMD - Precincts");
    }

    // ── Sheet 4: SMD Precincts (parliamentary / adjara) ───────────────────
    if ((isParl || isAdjara) && smdPrecinctRows.length > 0) {
      buildSMDPrecinctSheet(wb, smdPrecinctRows, partyLookup,
        precinctShape, smdShape ?? prShape, "SMD - Precincts");
    }

    // ── Sheet 5: District-level PR Results ───────────────────────────────
    if (prDistRows.length > 0) {
      buildDistrictSheet(wb, prDistRows, partyLookup, prShape, "PR - Districts");
    }

    // ── Sheet 6: Candidates ───────────────────────────────────────────────
    // Only on main sub-election (candidates don't change between rounds)
    if (isMain) {
      buildCandidatesSheet(wb, election, partyLookup);
    }

    // ── Sheet 7: Metadata ─────────────────────────────────────────────────
    buildMetadataSheet(wb, election, sub);

    // Save
    const filename = makeFilename(election, sub);
    const outPath = path.join(OUT_DIR, filename);
    await wb.xlsx.writeFile(outPath);
    const fileBuffer = fs.readFileSync(outPath);
    const size = fileBuffer.length;
    const sha  = crypto.createHash("sha256").update(fileBuffer).digest("hex");

    manifest.files.push({
      election_id:  election.id,
      election_type: election.type,
      sub_id:       sub.id,
      sub_type:     subTypeLabel(sub),
      label_en:     election.name?.en ?? election.id,
      label_ka:     election.name?.ka ?? "",
      sub_name_en:  isMain ? "Main" : (sub.name?.en ?? sub.id),
      sub_name_ka:  isMain ? ""     : (sub.name?.ka ?? ""),
      date:         election.date ?? "",
      filename,
      sha,
      size_bytes:   size,
    });
  }
}

process.stdout.write(JSON.stringify(manifest, null, 2));
