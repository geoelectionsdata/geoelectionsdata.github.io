// scripts/generate_adj2024_data.js
// Generates CSV data files for the 2024 Adjara Supreme Council elections
// from the raw Excel file.
//
// Usage: node scripts/generate_adj2024_data.js
//
// Outputs:
//   src/data/results/adj2024_pr.csv
//   src/data/results/adj2024_pr_precincts.csv
//   src/data/turnout/adj2024_turnout.csv
//   src/data/turnout/adj2024_precincts_turnout.csv

import ExcelJS from "exceljs";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const SRC  = path.join(ROOT, "src");

const XLSX_FILE = path.join(SRC, "data", "raw", "adjara_2024_election_results.xlsx");

// ── Party mapping: column index (0-based within GT block) → party_id ─────────
const PARTIES = [
  { col: 0, id: "coalition_for_change" },  // Party 4
  { col: 1, id: "unity"                },  // Party 5
  { col: 2, id: "european_democrats"   },  // Party 6
  { col: 3, id: "patriots"             },  // Party 8
  { col: 4, id: "strong_georgia"       },  // Party 9
  { col: 5, id: "our_georgia"          },  // Party 12
  { col: 6, id: "free_georgia"         },  // Party 20
  { col: 7, id: "tribuna"              },  // Party 21
  { col: 8, id: "gakharia"             },  // Party 25
  { col: 9, id: "girchi"               },  // Party 36
  { col: 10, id: "gd"                  },  // Party 41
];

// GT vote columns start at column index 31 (0-based), i.e. col 32 in 1-based Excel
const GT_START_COL = 32; // 1-based Excel column for first GT party

function n(v) { return (v == null || v === "") ? 0 : Number(v); }
function r4(v) { return Math.round(v * 10000) / 10000; }

function toCSV(rows, cols) {
  const header = cols.join(",");
  const lines  = rows.map(row =>
    cols.map(c => {
      const v = row[c];
      if (v == null || v === "") return "";
      if (typeof v === "string" && (v.includes(",") || v.includes('"')))
        return `"${v.replace(/"/g, '""')}"`;
      return String(v);
    }).join(",")
  );
  return [header, ...lines].join("\n") + "\n";
}

// ── Read xlsx ─────────────────────────────────────────────────────────────────
const wb = new ExcelJS.Workbook();
await wb.xlsx.readFile(XLSX_FILE);
const ws = wb.worksheets[0];

// Collect raw precinct rows (skip rows 1-2 which are headers)
const precincts = [];
for (let r = 3; r <= ws.rowCount; r++) {
  const row = ws.getRow(r);
  const districtId = row.getCell(2).value;
  if (!districtId && districtId !== 0) continue;

  const precNo    = n(row.getCell(3).value);
  const registered = n(row.getCell(14).value);
  const special    = n(row.getCell(16).value);
  const noon       = n(row.getCell(17).value);
  const fivepm     = n(row.getCell(18).value);
  const voted      = n(row.getCell(19).value);
  const invalid    = n(row.getCell(20).value);

  // GT party votes (cols 32–42, 1-based)
  const gtVotes = PARTIES.map(p => n(row.getCell(GT_START_COL + p.col).value));
  const totalGT = gtVotes.reduce((s, v) => s + v, 0);

  precincts.push({
    district_id: Number(districtId),
    precinct_id: Number(districtId) * 1000 + precNo,
    registered, special, noon, fivepm, voted, invalid,
    main: registered - special,
    gtVotes, totalGT,
  });
}

// ── Aggregate by district ──────────────────────────────────────────────────────
function aggregate(rows) {
  const g = {};
  for (const p of rows) {
    const k = p.district_id;
    if (!g[k]) g[k] = { district_id: k, registered: 0, special: 0, main: 0, noon: 0, fivepm: 0, voted: 0, invalid: 0, gtVotes: PARTIES.map(() => 0), totalGT: 0 };
    g[k].registered += p.registered;
    g[k].special    += p.special;
    g[k].main       += p.main;
    g[k].noon       += p.noon;
    g[k].fivepm     += p.fivepm;
    g[k].voted      += p.voted;
    g[k].invalid    += p.invalid;
    p.gtVotes.forEach((v, i) => { g[k].gtVotes[i] += v; });
    g[k].totalGT    += p.totalGT;
  }
  return Object.values(g).sort((a, b) => a.district_id - b.district_id);
}

const byDistrict = aggregate(precincts);

// National aggregate
const national = byDistrict.reduce((acc, d) => {
  acc.registered += d.registered;
  acc.special    += d.special;
  acc.main       += d.main;
  acc.noon       += d.noon;
  acc.fivepm     += d.fivepm;
  acc.voted      += d.voted;
  acc.invalid    += d.invalid;
  d.gtVotes.forEach((v, i) => { acc.gtVotes[i] += v; });
  acc.totalGT    += d.totalGT;
  return acc;
}, { district_id: "national", registered: 0, special: 0, main: 0, noon: 0, fivepm: 0, voted: 0, invalid: 0, gtVotes: PARTIES.map(() => 0), totalGT: 0 });

// ── Build result rows (long format: one row per district+party) ───────────────
function makeResultRows(distRows) {
  const rows = [];
  for (const d of distRows) {
    const total = d.totalGT || 1;
    for (const [i, p] of PARTIES.entries()) {
      rows.push({
        district_id:     d.district_id,
        party_id:        p.id,
        votes:           d.gtVotes[i],
        vote_share:      r4(d.gtVotes[i] / total),
        registered:      d.registered,
        voted:           d.voted,
        voted_noon:      d.noon,
        voted_5pm:       d.fivepm,
        main_list:       d.main,
        special_list:    d.special,
        turnout_pct:     d.registered > 0 ? r4(d.voted / d.registered) : 0,
        noon_pct:        d.registered > 0 ? r4(d.noon   / d.registered) : 0,
        five_pct:        d.registered > 0 ? r4(d.fivepm / d.registered) : 0,
        invalid_ballots: d.invalid,
        invalid_pct:     d.voted > 0 ? r4(d.invalid / d.voted) : 0,
      });
    }
  }
  return rows;
}

const RESULT_COLS = ["district_id","party_id","votes","vote_share","registered","voted",
  "voted_noon","voted_5pm","main_list","special_list","turnout_pct","noon_pct","five_pct",
  "invalid_ballots","invalid_pct"];

// NOTE: For polygon-precinct elections (Adjara), district_id in the precinct CSV must equal
// the precinct_id (e.g. 79001), not the parent district (79). The election-map.js buildLookups()
// function groups results by district_id to key the winnerMap/turnoutMap, and makeLayerStyle
// looks up features by geoId() = feature.properties.id = precinct_id. They must match.
const PRECINCT_RESULT_COLS = ["precinct_id","district_id","party_id","votes","vote_share",
  "registered","voted","voted_noon","voted_5pm","turnout_pct","noon_pct","five_pct",
  "invalid_ballots","invalid_pct"];

// District-level results
const districtResults = makeResultRows(byDistrict);
fs.writeFileSync(
  path.join(SRC, "data", "results", "adj2024_pr.csv"),
  toCSV(districtResults, RESULT_COLS)
);
console.log("✓ adj2024_pr.csv", byDistrict.length, "districts ×", PARTIES.length, "parties =", districtResults.length, "rows");

// Precinct-level results
// district_id = precinct_id (not parent district) — see note above.
const precinctResultRows = [];
for (const p of precincts) {
  const total = p.totalGT || 1;
  for (const [i, party] of PARTIES.entries()) {
    precinctResultRows.push({
      precinct_id:     p.precinct_id,
      district_id:     p.precinct_id,   // = precinct_id — must match GeoJSON feature.properties.id
      party_id:        party.id,
      votes:           p.gtVotes[i],
      vote_share:      r4(p.gtVotes[i] / total),
      registered:      p.registered,
      voted:           p.voted,
      voted_noon:      p.noon,
      voted_5pm:       p.fivepm,
      turnout_pct:     p.registered > 0 ? r4(p.voted / p.registered) : 0,
      noon_pct:        p.registered > 0 ? r4(p.noon   / p.registered) : 0,
      five_pct:        p.registered > 0 ? r4(p.fivepm / p.registered) : 0,
      invalid_ballots: p.invalid,
      invalid_pct:     p.voted > 0 ? r4(p.invalid / p.voted) : 0,
    });
  }
}
fs.writeFileSync(
  path.join(SRC, "data", "results", "adj2024_pr_precincts.csv"),
  toCSV(precinctResultRows, PRECINCT_RESULT_COLS)
);
console.log("✓ adj2024_pr_precincts.csv", precincts.length, "precincts ×", PARTIES.length, "parties =", precinctResultRows.length, "rows");

// ── Turnout CSVs ───────────────────────────────────────────────────────────────
const TURNOUT_COLS = ["district_id","vote_type","registered","voted","turnout_pct","voted_noon","voted_5pm","main_list","special_list"];

function turnoutRow(d, district_id) {
  const reg = d.registered || 1;
  return {
    district_id:  district_id ?? d.district_id,
    vote_type:    "pr",
    registered:   d.registered,
    voted:        d.voted,
    turnout_pct:  r4(d.voted / reg),
    voted_noon:   d.noon,
    voted_5pm:    d.fivepm,
    main_list:    d.main,
    special_list: d.special,
  };
}

const turnoutRows = [
  turnoutRow(national, "national"),
  ...byDistrict.map(d => turnoutRow(d)),
];
fs.writeFileSync(
  path.join(SRC, "data", "turnout", "adj2024_turnout.csv"),
  toCSV(turnoutRows, TURNOUT_COLS)
);
console.log("✓ adj2024_turnout.csv", turnoutRows.length, "rows");

// Precinct-level turnout
// district_id = precinct_id — same convention as precinctResults, for buildLookups() keying.
const PREC_TURNOUT_COLS = ["precinct_id","district_id","registered","voted","turnout_pct","voted_noon","voted_5pm"];
const precinctTurnoutRows = precincts.map(p => ({
  precinct_id:  p.precinct_id,
  district_id:  p.precinct_id,  // = precinct_id — matches GeoJSON feature.properties.id
  registered:   p.registered,
  voted:        p.voted,
  turnout_pct:  p.registered > 0 ? r4(p.voted / p.registered) : 0,
  voted_noon:   p.noon,
  voted_5pm:    p.fivepm,
}));
fs.writeFileSync(
  path.join(SRC, "data", "turnout", "adj2024_precincts_turnout.csv"),
  toCSV(precinctTurnoutRows, PREC_TURNOUT_COLS)
);
console.log("✓ adj2024_precincts_turnout.csv", precinctTurnoutRows.length, "rows");
