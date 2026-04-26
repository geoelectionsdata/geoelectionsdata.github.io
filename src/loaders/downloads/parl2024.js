import ExcelJS from "exceljs";
import fs from "node:fs";
import path from "node:path";
import { csvParse, autoType } from "d3-dsv";
import {
  OUT_DIR,
  PARL2024_DOWNLOAD_FILENAME,
  buildPartyLookup,
  downloadEntry,
  mainSubElection,
  readElection,
  readJSON,
  readParties,
  resolveSrcPath,
} from "./shared.js";

const RESULTS_FILE = "data/results/parl2024_pr.csv";
const PRECINCT_RESULTS_FILE = "data/results/parl2024_pr_precincts.csv";
const DISTRICT_SHAPE_FILE = "data/shp/parl2024_pr.geojson";
const PRECINCT_SHAPE_FILE = "data/shp/parl2024_pr_precincts.geojson";
const RAW_RESULTS_FILE = "src/data/raw/2024.26.10 - პარლამენტი.xlsx";
const PARTY_LISTS_FILE = "src/data/raw/party_lists_2024_georgia_unified.xlsx";
const ANNULLED_PRECINCT_ID = "22069";

const PARTY_BY_BALLOT = new Map([
  [3, "unity_development"],
  [4, "coalition_for_change"],
  [5, "unity"],
  [6, "european_democrats"],
  [8, "patriots"],
  [9, "strong_georgia"],
  [10, "labour"],
  [12, "our_georgia"],
  [16, "change_georgia"],
  [17, "georgia_party"],
  [20, "free_georgia"],
  [21, "tribuna"],
  [23, "chven"],
  [25, "gakharia"],
  [26, "left_alliance"],
  [27, "georgian_unity"],
  [36, "girchi"],
  [41, "gd"],
]);

const TURNOUT_COLS = [
  "registered",
  "voted",
  "voted_noon",
  "voted_5pm",
  "main_list",
  "special_list",
  "turnout_pct",
  "noon_pct",
  "five_pct",
  "invalid_ballots",
  "invalid_pct",
];

const HDR_FILL = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1A3A5C" } };
const HDR_FONT = { bold: true, color: { argb: "FFFFFFFF" }, size: 9, name: "Calibri" };
const ALT_FILL = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF2F6FA" } };

function readCSV(filePath) {
  return csvParse(fs.readFileSync(filePath, "utf8"), autoType);
}

function asText(value) {
  if (value == null) return "";
  if (typeof value === "object") {
    if (value.text != null) return String(value.text);
    if (Array.isArray(value.richText)) return value.richText.map(d => d.text ?? "").join("");
    if (value.result != null) return String(value.result);
  }
  return String(value).trim();
}

function asNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function safePct(value) {
  if (value == null || value === "" || value === "NA") return "";
  const n = Number(value);
  return Number.isFinite(n) ? Number((n * 100).toFixed(2)) : "";
}

function coord(value) {
  if (value == null || value === "" || value === "NA") return "";
  const n = Number(value);
  return Number.isFinite(n) ? Number(n.toFixed(6)) : "";
}

function districtCode(id) {
  if (id === "national") return "national";
  const n = Number(id);
  return Number.isFinite(n) ? String(n).padStart(2, "0") : String(id ?? "");
}

function styleHeader(row) {
  row.height = 34;
  row.eachCell(cell => {
    cell.fill = HDR_FILL;
    cell.font = HDR_FONT;
    cell.alignment = { wrapText: true, vertical: "middle", horizontal: "center" };
    cell.border = { bottom: { style: "medium", color: { argb: "FF4A7AAC" } } };
  });
}

function finishSheet(sheet, widths) {
  widths.forEach((w, i) => { if (w) sheet.getColumn(i + 1).width = w; });
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  for (let r = 2; r <= sheet.rowCount; r++) {
    if (r % 2 === 0) {
      sheet.getRow(r).eachCell({ includeEmpty: false }, cell => {
        if (!cell.fill?.fgColor) cell.fill = ALT_FILL;
      });
    }
  }
}

function getCoords(props, geometry) {
  const lat = props?.latitude ?? props?.lat ?? null;
  const lon = props?.longitude ?? props?.lon ?? null;
  if (lat != null && lon != null) return { latitude: lat, longitude: lon };
  if (!geometry) return { latitude: "", longitude: "" };
  if (geometry.type === "Point") return { latitude: geometry.coordinates[1], longitude: geometry.coordinates[0] };
  const ring = geometry.type === "Polygon" ? geometry.coordinates[0] : geometry.coordinates[0]?.[0] ?? [];
  if (!ring.length) return { latitude: "", longitude: "" };
  return {
    latitude: ring.reduce((sum, c) => sum + c[1], 0) / ring.length,
    longitude: ring.reduce((sum, c) => sum + c[0], 0) / ring.length,
  };
}

function makeFeatureLookup(geojson, idProp = "id") {
  return new Map((geojson?.features ?? []).map(feature => [
    String(Math.round(Number(feature.properties?.[idProp]))),
    feature,
  ]));
}

function partyColumns(partyIds, partyLookup, { includeSeats = false } = {}) {
  return partyIds.flatMap(pid => {
    const p = partyLookup[pid] ?? { name_en: pid, name_ka: pid };
    const label = `${p.name_en}\n${p.name_ka}`;
    const cols = [
      { key: `${pid}__votes`, header: `${label}\nVotes / ხმები` },
      { key: `${pid}__pct`, header: `${label}\n% / წილი`, pct: true },
    ];
    if (includeSeats) {
      cols.push({ key: `${pid}__seats_pr`, header: `${label}\nSeats PR / მანდატი` });
    }
    return cols;
  });
}

function addPartyValues(partyCols, wideRow) {
  return partyCols.map(col => {
    const value = wideRow[col.key];
    if (value == null || value === "NA") return "";
    return col.pct ? safePct(value) : value;
  });
}

function pivotLong(rows, idCol, partyIds) {
  const groups = new Map();
  for (const row of rows) {
    const id = String(row[idCol] ?? "");
    if (!groups.has(id)) {
      const base = { [idCol]: id };
      for (const col of TURNOUT_COLS) base[col] = null;
      groups.set(id, base);
    }
    const group = groups.get(id);
    for (const col of TURNOUT_COLS) {
      if (group[col] == null && row[col] != null) group[col] = row[col];
    }
    if (row.party_id && partyIds.includes(row.party_id)) {
      group[`${row.party_id}__votes`] = row.votes ?? null;
      group[`${row.party_id}__pct`] = row.vote_share ?? null;
    }
  }
  return [...groups.values()];
}

async function readRawResultMetadata() {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(RAW_RESULTS_FILE);
  const sheet = wb.worksheets[0];
  const districts = new Map();
  const precincts = new Map();

  for (let r = 2; r <= sheet.rowCount; r++) {
    const row = sheet.getRow(r).values;
    const rawDistrict = asText(row[1]);
    const precinctCode = asText(row[3]);
    if (!rawDistrict || !precinctCode) continue;
    const districtId = String(Number(rawDistrict));
    const stationMatch = precinctCode.match(/(\d+)$/);
    const stationNumber = stationMatch ? Number(stationMatch[1]) : null;
    if (!Number.isFinite(Number(districtId))) continue;

    const districtNameKa = asText(row[2]);
    const code = rawDistrict.padStart(2, "0");
    if (!districts.has(districtId)) districts.set(districtId, { districtId, districtCode: code, districtNameKa });

    if (stationNumber != null) {
      const precinctId = String(Number(districtId) * 1000 + stationNumber);
      precincts.set(precinctId, {
        precinctId,
        precinctCode,
        precinctStatus: asText(row[4]),
        districtId,
        districtCode: code,
        districtNameKa,
        isAnnulled: precinctId === ANNULLED_PRECINCT_ID,
      });
    }
  }

  return { districts, precincts };
}

function worksheetRows(sheet) {
  const headers = sheet.getRow(1).values.slice(1).map(asText);
  const rows = [];
  for (let r = 2; r <= sheet.rowCount; r++) {
    const row = sheet.getRow(r);
    if (!row.hasValues) continue;
    const obj = {};
    headers.forEach((header, i) => { obj[header] = row.getCell(i + 1).value; });
    rows.push(obj);
  }
  return rows;
}

async function readPartyWorkbook() {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(PARTY_LISTS_FILE);
  return {
    candidates: worksheetRows(wb.getWorksheet("Candidates")),
    elected: worksheetRows(wb.getWorksheet("Elected")),
    validation: worksheetRows(wb.getWorksheet("Validation")),
    duplicates: worksheetRows(wb.getWorksheet("Duplicates")),
  };
}

function buildDistrictInfo(rawDistricts, districtGeo) {
  const geoLookup = makeFeatureLookup(districtGeo);
  return function getDistrictInfo(id) {
    if (id === "national") {
      return {
        districtId: "national",
        districtCode: "national",
        districtNameEn: "National",
        districtNameKa: "ეროვნული",
      };
    }
    const raw = rawDistricts.get(String(id));
    const props = geoLookup.get(String(id))?.properties ?? {};
    return {
      districtId: String(id),
      districtCode: raw?.districtCode ?? districtCode(id),
      districtNameEn: props.name_en ?? (String(id) === "87" ? "Abroad" : String(id)),
      districtNameKa: props.name_ka ?? raw?.districtNameKa ?? "",
    };
  };
}

function buildDistrictSheet(wb, rows, partyIds, partyLookup, districtInfo) {
  const sheet = wb.addWorksheet("PR - Districts");
  const partyCols = partyColumns(partyIds, partyLookup, { includeSeats: true });
  const headers = [
    "District ID\nოლქის ID",
    "District Code\nოლქის კოდი",
    "District Name (EN)",
    "District Name (KA)\nოლქის სახელი",
    "Registered\nამომრჩეველი",
    "Voted\nმონაწილე",
    "Voted Noon\n12:00",
    "Voted 5pm\n17:00",
    "Main List\nძირითადი სია",
    "Special List\nსპეც. სია",
    "Turnout %\nაქტივობა %",
    "Noon %\n12:00 %",
    "5pm %\n17:00 %",
    "Invalid Ballots\nბათილი",
    "Invalid %\nბათილი %",
    ...partyCols.map(c => c.header),
  ];
  styleHeader(sheet.addRow(headers));

  const wide = pivotLong(rows, "district_id", partyIds)
    .sort((a, b) => {
      if (a.district_id === "national") return -1;
      if (b.district_id === "national") return 1;
      return Number(a.district_id) - Number(b.district_id);
    });

  for (const row of wide) {
    const d = districtInfo(row.district_id);
    const out = sheet.addRow([
      d.districtId,
      d.districtCode,
      d.districtNameEn,
      d.districtNameKa,
      row.registered ?? "",
      row.voted ?? "",
      row.voted_noon ?? "",
      row.voted_5pm ?? "",
      row.main_list ?? "",
      row.special_list ?? "",
      safePct(row.turnout_pct),
      safePct(row.noon_pct),
      safePct(row.five_pct),
      row.invalid_ballots ?? "",
      safePct(row.invalid_pct),
      ...addPartyValues(partyCols, row),
    ]);
    if (row.district_id === "national") out.font = { bold: true };
  }

  finishSheet(sheet, [14, 12, 24, 26, 12, 10, 10, 10, 12, 12, 10, 9, 9, 14, 10, ...partyCols.map(() => 16)]);
}

function buildPrecinctSheet(wb, rows, partyIds, partyLookup, districtInfo, precinctLookup, precinctGeo) {
  const sheet = wb.addWorksheet("PR - Precincts");
  const partyCols = partyColumns(partyIds, partyLookup);
  const precinctFeatures = makeFeatureLookup(precinctGeo);
  const headers = [
    "District ID\nოლქის ID",
    "District Code\nოლქის კოდი",
    "District Name (EN)",
    "District Name (KA)\nოლქის სახელი",
    "Precinct ID\nუბნის ID",
    "Precinct Code\nუბნის კოდი",
    "Precinct Status\nუბნის სტატუსი",
    "Annulled\nგაუქმებული",
    "Annulment Note\nშენიშვნა",
    "Precinct Name (KA)\nუბნის სახელი",
    "Latitude / განედი",
    "Longitude / გრძედი",
    "Registered\nამომრჩეველი",
    "Voted\nმონაწილე",
    "Voted Noon\n12:00",
    "Voted 5pm\n17:00",
    "Turnout %\nაქტივობა %",
    "Noon %\n12:00 %",
    "5pm %\n17:00 %",
    "Invalid Ballots\nბათილი",
    "Invalid %\nბათილი %",
    ...partyCols.map(c => c.header),
  ];
  styleHeader(sheet.addRow(headers));

  const wide = pivotLong(rows, "precinct_id", partyIds)
    .sort((a, b) => Number(a.precinct_id) - Number(b.precinct_id));

  for (const row of wide) {
    const pid = String(row.precinct_id);
    const raw = precinctLookup.get(pid) ?? {};
    const d = districtInfo(raw.districtId ?? row.district_id);
    const feature = precinctFeatures.get(pid);
    const props = feature?.properties ?? {};
    const { latitude, longitude } = getCoords(props, feature?.geometry);
    const isAnnulled = pid === ANNULLED_PRECINCT_ID || raw.isAnnulled === true;
    sheet.addRow([
      d.districtId,
      d.districtCode,
      d.districtNameEn,
      d.districtNameKa,
      pid,
      raw.precinctCode ?? "",
      raw.precinctStatus ?? "",
      isAnnulled ? "yes" : "no",
      isAnnulled ? "Annulled precinct: Marneuli district, precinct 69" : "",
      props.name_ka ?? props.address ?? "",
      coord(latitude),
      coord(longitude),
      row.registered ?? "",
      row.voted ?? "",
      row.voted_noon ?? "",
      row.voted_5pm ?? "",
      safePct(row.turnout_pct),
      safePct(row.noon_pct),
      safePct(row.five_pct),
      row.invalid_ballots ?? "",
      safePct(row.invalid_pct),
      ...addPartyValues(partyCols, row),
    ]);
  }

  finishSheet(sheet, [12, 12, 24, 26, 12, 13, 16, 10, 34, 34, 11, 11, 12, 10, 10, 10, 10, 9, 9, 14, 10, ...partyCols.map(() => 16)]);
}

function electedKeys(electedRows) {
  const keys = new Set();
  for (const row of electedRows) {
    const subject = asText(row.electoral_subject);
    const partyNumber = asNumber(subject.match(/^\d+/)?.[0]);
    const orderId = asNumber(row.order_id_in_list);
    if (partyNumber != null && orderId != null) keys.add(`${partyNumber}:${orderId}`);
  }
  return keys;
}

function buildPartyListsSheet(wb, rows, electedRows, partyLookup) {
  const sheet = wb.addWorksheet("Party Lists - Candidates");
  const elected = electedKeys(electedRows);
  const headers = [
    "Ballot Number",
    "Party ID",
    "Party Name (EN)",
    "Party Name (KA)",
    "Registered Party Name (KA)",
    "Partisanship",
    "List Order",
    "Record No.",
    "Candidate Name (KA)",
    "First Name (KA)",
    "Last Name (KA)",
    "Elected",
    "Source PDF",
    "Source Page",
    "Extraction Method",
    "PDF SHA-256",
  ];
  styleHeader(sheet.addRow(headers));

  rows
    .slice()
    .sort((a, b) => asNumber(a.party_number) - asNumber(b.party_number) || asNumber(a.order_id) - asNumber(b.order_id))
    .forEach(row => {
      const partyNumber = asNumber(row.party_number);
      const partyId = PARTY_BY_BALLOT.get(partyNumber) ?? "";
      const p = partyLookup[partyId] ?? { name_en: partyId, name_ka: partyId };
      const first = asText(row.name);
      const last = asText(row.last_name);
      const orderId = asNumber(row.order_id);
      sheet.addRow([
        partyNumber ?? "",
        partyId,
        p.name_en ?? "",
        p.name_ka ?? "",
        asText(row.party_name),
        asText(row.partisanship),
        orderId ?? "",
        asNumber(row.record_no) ?? "",
        `${first} ${last}`.trim(),
        first,
        last,
        elected.has(`${partyNumber}:${orderId}`) ? "yes" : "no",
        asText(row.source_pdf),
        asNumber(row.source_page) ?? "",
        asText(row.extraction_method),
        asText(row.pdf_sha256),
      ]);
    });

  finishSheet(sheet, [12, 20, 26, 28, 34, 34, 11, 10, 28, 18, 22, 10, 48, 12, 18, 34]);
}

function buildElectedSheet(wb, rows, partyLookup) {
  const sheet = wb.addWorksheet("Elected MPs");
  const headers = [
    "Ballot Number",
    "Party ID",
    "Party Name (EN)",
    "Party Name (KA)",
    "List Order",
    "Elected MP Name (KA)",
    "Electoral Subject",
    "Partisanship",
  ];
  styleHeader(sheet.addRow(headers));

  rows.forEach(row => {
    const subject = asText(row.electoral_subject);
    const partyNumber = asNumber(subject.match(/^\d+/)?.[0]);
    const partyId = PARTY_BY_BALLOT.get(partyNumber) ?? "";
    const p = partyLookup[partyId] ?? { name_en: partyId, name_ka: partyId };
    sheet.addRow([
      partyNumber ?? "",
      partyId,
      p.name_en ?? "",
      p.name_ka ?? "",
      asNumber(row.order_id_in_list) ?? "",
      asText(row.name),
      subject,
      asText(row.partisanship),
    ]);
  });

  finishSheet(sheet, [12, 20, 26, 28, 11, 28, 34, 42]);
}

function buildRawSheet(wb, sheetName, rows) {
  if (!rows.length) return;
  const sheet = wb.addWorksheet(sheetName);
  const headers = Object.keys(rows[0]);
  styleHeader(sheet.addRow(headers));
  for (const row of rows) sheet.addRow(headers.map(h => asText(row[h])));
  finishSheet(sheet, headers.map(h => Math.min(42, Math.max(12, h.length + 4))));
}

function buildMetadataSheet(wb, election, generatedAt) {
  const sheet = wb.addWorksheet("About - Metadata");
  sheet.getColumn(1).width = 28;
  sheet.getColumn(2).width = 88;
  const rows = [
    ["Archive", "Comprehensive Election Data Archive of Georgia (CEDAG)"],
    ["Website", "https://electionsdata.ge"],
    ["Author", "David Sichinava"],
    ["Election (EN)", election.name?.en ?? election.id],
    ["Election (KA)", election.name?.ka ?? ""],
    ["Election ID", election.id],
    ["Election Type", election.type],
    ["Election Date", election.date ?? ""],
    ["File Generated", generatedAt.toISOString()],
    ["Data Source", "Central Election Commission of Georgia (cesko.ge); party-list extraction workbook in data/raw/party_lists_2024_georgia_unified.xlsx"],
    ["Annulled Precinct", "District 22 (Marneuli), precinct 69, precinct_id 22069"],
    ["Citation (APA)", `Sichinava, D. (${generatedAt.getFullYear()}). Results of the ${election.name?.en ?? election.id}. Comprehensive Election Data Archive of Georgia (CEDAG). https://electionsdata.ge/${election.id}`],
    ["License", "Open data. Please cite CEDAG when using."],
  ];
  for (const [key, value] of rows) {
    const row = sheet.addRow([key, value]);
    row.getCell(1).font = { bold: true, size: 9 };
    row.getCell(2).font = { size: 9 };
    row.getCell(2).alignment = { wrapText: true };
  }
}

export async function generateParl2024Download({ generatedAt = new Date() } = {}) {
  const election = readElection("parl_2024");
  const partiesRaw = readParties();
  const partyLookup = buildPartyLookup(partiesRaw, election.parties ?? []);
  const partyIds = (election.parties ?? []).map(p => p.id).filter(Boolean);

  const districtRows = readCSV(resolveSrcPath(RESULTS_FILE));
  const precinctRows = readCSV(resolveSrcPath(PRECINCT_RESULTS_FILE));
  const districtGeo = readJSON(resolveSrcPath(DISTRICT_SHAPE_FILE));
  const precinctGeo = readJSON(resolveSrcPath(PRECINCT_SHAPE_FILE));
  const rawMeta = await readRawResultMetadata();
  const partyWorkbook = await readPartyWorkbook();
  const districtInfo = buildDistrictInfo(rawMeta.districts, districtGeo);

  const wb = new ExcelJS.Workbook();
  wb.creator = "CEDAG - Comprehensive Election Data Archive of Georgia";
  wb.created = generatedAt;
  wb.modified = generatedAt;

  buildDistrictSheet(wb, districtRows, partyIds, partyLookup, districtInfo);
  buildPrecinctSheet(wb, precinctRows, partyIds, partyLookup, districtInfo, rawMeta.precincts, precinctGeo);
  buildPartyListsSheet(wb, partyWorkbook.candidates, partyWorkbook.elected, partyLookup);
  buildElectedSheet(wb, partyWorkbook.elected, partyLookup);
  buildRawSheet(wb, "Party List Validation", partyWorkbook.validation);
  buildRawSheet(wb, "Duplicate Source PDFs", partyWorkbook.duplicates);
  buildMetadataSheet(wb, election, generatedAt);

  const outPath = path.join(OUT_DIR, PARL2024_DOWNLOAD_FILENAME);
  await wb.xlsx.writeFile(outPath);
  return downloadEntry(election, mainSubElection(), PARL2024_DOWNLOAD_FILENAME);
}
