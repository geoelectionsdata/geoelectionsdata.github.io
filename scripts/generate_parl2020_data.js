// scripts/generate_parl2020_data.js
// Generates CSV data files for the 2020 Georgian parliamentary elections.
//
// Usage: node scripts/generate_parl2020_data.js
//
// Sources:
//   src/data/raw/2020 პარლამენტი I ტური, საკრებულო, მერი.xlsx
//     Sheet 1 ("პროპორციული"): PR results by precinct
//     Sheet 2 ("მაჟორიტარული"): SMD results by precinct
//     Sheet 3 ("კანდიდატები"): candidate directory
//   src/data/raw/2020 მაჟორიტარული მეორე ტური.xlsx
//     Sheet 1: runoff results by precinct
//
// Outputs:
//   src/data/results/parl2020_pr.csv
//   src/data/results/parl2020_pr_precincts.csv
//   src/data/results/parl2020_smd.csv
//   src/data/results/parl2020_smd_precincts.csv
//   src/data/results/parl2020_smd_runoff.csv
//   src/data/results/parl2020_smd_runoff_precincts.csv

import ExcelJS from "exceljs";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const SRC  = path.join(ROOT, "src");

const PR_FILE      = path.join(SRC, "data", "raw", "2020 პარლამენტი I ტური, საკრებულო, მერი.xlsx");
const RUNOFF_FILE  = path.join(SRC, "data", "raw", "2020 მაჟორიტარული მეორე ტური.xlsx");

// ── Helpers ───────────────────────────────────────────────────────────────────
function n(v) { return (v == null || v === "") ? 0 : Number(v); }
function r4(v) { return Math.round(v * 10000) / 10000; }

function cellStr(cell) {
  const v = cell.value;
  if (v == null) return "";
  if (typeof v === "object" && v.richText) return v.richText.map(r => r.text).join("").trim();
  if (typeof v === "object" && v.formula != null) return String(v.result ?? "");
  return String(v).trim();
}
function cellNum(cell) {
  const v = cell.value;
  if (v == null || v === "") return 0;
  if (typeof v === "object" && v.formula != null) return Number(v.result ?? 0);
  if (typeof v === "object" && v.richText) return Number(v.richText.map(r => r.text).join("")) || 0;
  return Number(v) || 0;
}

function parsePrecinct(code) {
  // Format: "MM.DD.PP" (zero-padded strings)
  const parts = String(code).split(".");
  if (parts.length !== 3) return null;
  const MM = parseInt(parts[0], 10);  // majoritarian district (SMD)
  const DD = parseInt(parts[1], 10);  // CEC electoral district
  const PP = parseInt(parts[2], 10);  // precinct sequence
  if (isNaN(DD) || isNaN(PP)) return null;
  return { smd: MM, dd: DD, pp: PP, precinct_id: DD * 1000 + PP };
}

function toCSV(rows, cols) {
  const header = cols.join(",");
  const lines  = rows.map(row =>
    cols.map(c => {
      const v = row[c];
      if (v == null || v === "") return "";
      if (typeof v === "string" && (v.includes(",") || v.includes('"') || v.includes("\n")))
        return `"${v.replace(/"/g, '""')}"`;
      return String(v);
    }).join(",")
  );
  return [header, ...lines].join("\n") + "\n";
}

// ── Party ID normalization ────────────────────────────────────────────────────
const PARTY_NORM = {
  "european_goergia":  "european_georgia",
  "georgian_dream":    "gd",
  "apg":               "patriots",
  "labor":             "labour",
  "georgia":           "georgia_party",
  "workers":           "workers_socialist",
  "our_united_georgia":"our_georgia",
  "freedom_zviads_way":"freedom_gamsakhurdia",
  "independent_1":     "independent",
  "independent_9":     "independent",
  "independent_11":    "independent",
};
function norm(id) { return PARTY_NORM[id] || id; }

// ── PR parties: ordered as they appear in columns 10–59 (col 10 = index 0) ──
const PR_PARTIES = [
  "whites",           // ballot 1,  col 10
  "european_georgia", // ballot 2,  col 11 (normalized)
  "democratic_movement",// ballot 3, col 12
  "tribuna",          // ballot 4,  col 13
  "unm",              // ballot 5,  col 14
  "future_georgia",   // ballot 6,  col 15
  "mechiauri",        // ballot 7,  col 16
  "patriots",         // ballot 8,  col 17 (normalized from apg)
  "greens",           // ballot 9,  col 18
  "labour",           // ballot 10, col 19 (normalized from labor)
  "workers_socialist",// ballot 11, col 20 (normalized from workers)
  "free_georgia_movement", // ballot 12, col 21
  "reformer",         // ballot 13, col 22
  "georgian_choice",  // ballot 14, col 23
  "new_christian_democrats", // ballot 16, col 24
  "victorious_georgia",// ballot 17, col 25
  "industry_sakartvelo",// ballot 18, col 26
  "alliance",         // ballot 19, col 27
  "georgia_party",    // ballot 20, col 28 (normalized from georgia)
  "free_georgia",     // ballot 21, col 29
  "new_force",        // ballot 23, col 30
  "citizens",         // ballot 24, col 31
  "free_democrats",   // ballot 25, col 32
  "justice",          // ballot 26, col 33
  "agmashenebeli",    // ballot 27, col 34
  "roots",            // ballot 28, col 35
  "change_georgia",   // ballot 30, col 36
  "freedom_gamsakhurdia", // ballot 31, col 37 (normalized)
  "peoples_party",    // ballot 32, col 38
  "ndp_2020",         // ballot 33, col 39
  "social_justice_2020",// ballot 34, col 40
  "girchi",           // ballot 36, col 41
  "gd",               // ballot 41, col 42 (normalized)
  "reformators",      // ballot 42, col 43
  "zviads_way",       // ballot 43, col 44
  "georgian_idea",    // ballot 44, col 45
  "national_democrats",// ballot 45, col 46
  "social_democrats_2020",// ballot 46, col 47
  "conservatives",    // ballot 47, col 48
  "choice_homeland_2020",// ballot 48, col 49
  "georgian_troupe",  // ballot 49, col 50
  "progressive_georgia",// ballot 50, col 51
  "veterans",         // ballot 51, col 52
  "euroatlantic_vector",// ballot 52, col 53
  "traditionalists",  // ballot 53, col 54
  "peoples_movement_2020",// ballot 54, col 55
  "georgian_march",   // ballot 55, col 56
  "lelo",             // ballot 56, col 57
  "motherland_2020",  // ballot 57, col 58
  "development_party",// ballot 60, col 59
];
// Confirm count
if (PR_PARTIES.length !== 50) throw new Error(`Expected 50 PR parties, got ${PR_PARTIES.length}`);

// ── SMD ballot codes in column order (cols 10–52) ────────────────────────────
const SMD_CODES = [
  1,2,3,4,5,6,7,8,9,10,11,13,14,17,19,20,21,23,24,25,26,27,28,30,31,32,36,41,43,44,45,47,49,50,51,52,53,55,56,60,61,62,63
];
// Col 10 = SMD_CODES[0], col 11 = SMD_CODES[1], ...
if (SMD_CODES.length !== 43) throw new Error(`Expected 43 SMD codes, got ${SMD_CODES.length}`);

// ── Runoff ballot codes (cols 10–15) ─────────────────────────────────────────
const RUNOFF_CODES = [2, 5, 10, 24, 36, 41]; // as listed in header

// ── Load workbooks ────────────────────────────────────────────────────────────
console.log("Loading workbooks...");
const wb = new ExcelJS.Workbook();
await wb.xlsx.readFile(PR_FILE);
const wsPR  = wb.worksheets[0]; // Sheet 1: PR
const wsSMD = wb.worksheets[1]; // Sheet 2: SMD
const wsCnd = wb.worksheets[2]; // Sheet 3: Candidates

const wbR = new ExcelJS.Workbook();
await wbR.xlsx.readFile(RUNOFF_FILE);
const wsRun = wbR.worksheets[0]; // Sheet 1: Runoff

// ── Build candidate lookup: Map<`${smd}_${code}`, {name_ka, party_id}> ────────
const candidateLookup = new Map();
for (let r = 2; r <= wsCnd.rowCount; r++) {
  const row  = wsCnd.getRow(r);
  const smd  = n(row.getCell(1).value);
  const code = n(row.getCell(3).value);
  const first_ka = cellStr(row.getCell(5));
  const last_ka  = cellStr(row.getCell(6));
  const raw_pid  = cellStr(row.getCell(7));
  if (!smd || !code) continue;
  const name_ka  = `${first_ka} ${last_ka}`.trim();
  const party_id = norm(raw_pid);
  candidateLookup.set(`${smd}_${code}`, { name_ka, party_id });
}
console.log(`Candidate lookup: ${candidateLookup.size} entries`);

// ── Parse PR sheet ────────────────────────────────────────────────────────────
// Col 1: description, Col 2: precinct "MM.DD.PP", Cols 4-8: turnout, Cols 10-59: votes, 60: valid, 61: invalid
const prPrecincts = [];
for (let r = 2; r <= wsPR.rowCount; r++) {
  const row  = wsPR.getRow(r);
  const code = cellStr(row.getCell(2));
  if (!code) continue;
  const pc = parsePrecinct(code);
  if (!pc) continue;

  const main_list   = n(row.getCell(4).value);
  const special_list= n(row.getCell(5).value);
  const voted_noon  = n(row.getCell(6).value);
  const voted_5pm   = n(row.getCell(7).value);
  const voted       = n(row.getCell(8).value);
  const valid_ballots = cellNum(row.getCell(60));
  const invalid_ballots = cellNum(row.getCell(61));

  const votes = PR_PARTIES.map((_, i) => cellNum(row.getCell(10 + i)));
  const totalVotes = votes.reduce((s, v) => s + v, 0);

  prPrecincts.push({
    ...pc,
    main_list, special_list, voted_noon, voted_5pm, voted,
    valid_ballots, invalid_ballots,
    votes, totalVotes,
  });
}
console.log(`PR precincts: ${prPrecincts.length}`);

// ── Aggregate PR by DD (domestic only, DD≠87) ─────────────────────────────────
function aggregatePR(rows) {
  const g = {};
  for (const p of rows) {
    const k = p.dd;
    if (!g[k]) g[k] = {
      dd: k, main_list: 0, special_list: 0, voted_noon: 0, voted_5pm: 0,
      voted: 0, valid_ballots: 0, invalid_ballots: 0,
      votes: PR_PARTIES.map(() => 0), totalVotes: 0,
    };
    g[k].main_list    += p.main_list;
    g[k].special_list += p.special_list;
    g[k].voted_noon   += p.voted_noon;
    g[k].voted_5pm    += p.voted_5pm;
    g[k].voted        += p.voted;
    g[k].valid_ballots += p.valid_ballots;
    g[k].invalid_ballots += p.invalid_ballots;
    p.votes.forEach((v, i) => { g[k].votes[i] += v; });
    g[k].totalVotes   += p.totalVotes;
  }
  return Object.values(g).sort((a, b) => a.dd - b.dd);
}

const prByDD = aggregatePR(prPrecincts.filter(p => p.dd !== 87));

// National = all precincts including abroad
const prNational = prPrecincts.reduce((acc, p) => {
  acc.main_list    += p.main_list;
  acc.special_list += p.special_list;
  acc.voted_noon   += p.voted_noon;
  acc.voted_5pm    += p.voted_5pm;
  acc.voted        += p.voted;
  acc.valid_ballots += p.valid_ballots;
  acc.invalid_ballots += p.invalid_ballots;
  p.votes.forEach((v, i) => { acc.votes[i] += v; });
  acc.totalVotes   += p.totalVotes;
  return acc;
}, { main_list: 0, special_list: 0, voted_noon: 0, voted_5pm: 0, voted: 0, valid_ballots: 0, invalid_ballots: 0, votes: PR_PARTIES.map(() => 0), totalVotes: 0 });

// ── Write PR district-level CSV ───────────────────────────────────────────────
function makePRResultRows(distRows, national) {
  const rows = [];
  // Helper to push one district's party rows
  function pushDistrict(district_id, d) {
    const reg = d.main_list + d.special_list;
    const total = d.totalVotes || 1;
    for (let i = 0; i < PR_PARTIES.length; i++) {
      rows.push({
        district_id,
        party_id:       PR_PARTIES[i],
        votes:          d.votes[i],
        vote_share:     r4(d.votes[i] / total),
        registered:     reg,
        voted:          d.voted,
        voted_noon:     d.voted_noon,
        voted_5pm:      d.voted_5pm,
        main_list:      d.main_list,
        special_list:   d.special_list,
        turnout_pct:    reg > 0 ? r4(d.voted / reg) : 0,
        noon_pct:       reg > 0 ? r4(d.voted_noon / reg) : 0,
        five_pct:       reg > 0 ? r4(d.voted_5pm  / reg) : 0,
        invalid_ballots: d.invalid_ballots,
        invalid_pct:    d.voted > 0 ? r4(d.invalid_ballots / d.voted) : 0,
      });
    }
  }
  pushDistrict("national", national);
  for (const d of distRows) pushDistrict(d.dd, d);
  return rows;
}

const PR_RESULT_COLS = [
  "district_id","party_id","votes","vote_share","registered","voted",
  "voted_noon","voted_5pm","main_list","special_list",
  "turnout_pct","noon_pct","five_pct","invalid_ballots","invalid_pct",
];

const prResultRows = makePRResultRows(prByDD, prNational);
fs.writeFileSync(
  path.join(SRC, "data", "results", "parl2020_pr.csv"),
  toCSV(prResultRows, PR_RESULT_COLS)
);
console.log(`✓ parl2020_pr.csv: ${prByDD.length} districts × ${PR_PARTIES.length} parties = ${prByDD.length * PR_PARTIES.length} rows (+national)`);

// ── Write PR precinct-level CSV ───────────────────────────────────────────────
const PR_PREC_COLS = [
  "precinct_id","district_id","party_id","votes","vote_share","registered","voted",
  "voted_noon","voted_5pm","turnout_pct","noon_pct","five_pct","invalid_ballots","invalid_pct",
];
const prPrecinctRows = [];
for (const p of prPrecincts) {
  const reg   = p.main_list + p.special_list;
  const total = p.totalVotes || 1;
  for (let i = 0; i < PR_PARTIES.length; i++) {
    prPrecinctRows.push({
      precinct_id:  p.precinct_id,
      district_id:  p.precinct_id,  // polygon convention: district_id = precinct_id
      party_id:     PR_PARTIES[i],
      votes:        p.votes[i],
      vote_share:   r4(p.votes[i] / total),
      registered:   reg,
      voted:        p.voted,
      voted_noon:   p.voted_noon,
      voted_5pm:    p.voted_5pm,
      turnout_pct:  reg > 0 ? r4(p.voted / reg) : 0,
      noon_pct:     reg > 0 ? r4(p.voted_noon / reg) : 0,
      five_pct:     reg > 0 ? r4(p.voted_5pm  / reg) : 0,
      invalid_ballots: p.invalid_ballots,
      invalid_pct:  p.voted > 0 ? r4(p.invalid_ballots / p.voted) : 0,
    });
  }
}
fs.writeFileSync(
  path.join(SRC, "data", "results", "parl2020_pr_precincts.csv"),
  toCSV(prPrecinctRows, PR_PREC_COLS)
);
console.log(`✓ parl2020_pr_precincts.csv: ${prPrecincts.length} precincts × ${PR_PARTIES.length} parties = ${prPrecinctRows.length} rows`);

// ── Parse SMD sheet ───────────────────────────────────────────────────────────
// Col 1: smd_id, Col 2: dd, Col 3: precinct, Col 4-8: turnout, Cols 10-52: votes, 53: valid, 54: invalid
const smdPrecincts = [];
for (let r = 2; r <= wsSMD.rowCount; r++) {
  const row  = wsSMD.getRow(r);
  const smd  = n(row.getCell(1).value);
  const dd   = n(row.getCell(2).value);
  const code = cellStr(row.getCell(3));
  if (!smd || !code) continue;
  const pc = parsePrecinct(code);
  if (!pc) continue;

  const main_list    = n(row.getCell(4).value);
  const special_list = n(row.getCell(5).value);
  const voted_noon   = n(row.getCell(6).value);
  const voted_5pm    = n(row.getCell(7).value);
  const voted        = n(row.getCell(8).value);
  const valid_ballots   = cellNum(row.getCell(53));
  const invalid_ballots = cellNum(row.getCell(54));

  // Votes for each candidate code
  const votes = SMD_CODES.map((_, i) => cellNum(row.getCell(10 + i)));
  const totalVotes = votes.reduce((s, v) => s + v, 0);

  smdPrecincts.push({
    smd, dd: pc.dd, pp: pc.pp, precinct_id: pc.precinct_id,
    main_list, special_list, voted_noon, voted_5pm, voted,
    valid_ballots, invalid_ballots, votes, totalVotes,
  });
}
console.log(`SMD precincts: ${smdPrecincts.length}`);

// ── Aggregate SMD by district (smd_id) ───────────────────────────────────────
function aggregateSMD(rows) {
  const g = {};
  for (const p of rows) {
    const k = p.smd;
    if (!g[k]) g[k] = {
      smd: k, main_list: 0, special_list: 0, voted_noon: 0, voted_5pm: 0,
      voted: 0, valid_ballots: 0, invalid_ballots: 0,
      votes: SMD_CODES.map(() => 0), totalVotes: 0,
    };
    g[k].main_list    += p.main_list;
    g[k].special_list += p.special_list;
    g[k].voted_noon   += p.voted_noon;
    g[k].voted_5pm    += p.voted_5pm;
    g[k].voted        += p.voted;
    g[k].valid_ballots += p.valid_ballots;
    g[k].invalid_ballots += p.invalid_ballots;
    p.votes.forEach((v, i) => { g[k].votes[i] += v; });
    g[k].totalVotes   += p.totalVotes;
  }
  return Object.values(g).sort((a, b) => a.smd - b.smd);
}

const smdByDistrict = aggregateSMD(smdPrecincts);

const smdNational = smdPrecincts.reduce((acc, p) => {
  acc.main_list    += p.main_list;
  acc.special_list += p.special_list;
  acc.voted_noon   += p.voted_noon;
  acc.voted_5pm    += p.voted_5pm;
  acc.voted        += p.voted;
  acc.valid_ballots += p.valid_ballots;
  acc.invalid_ballots += p.invalid_ballots;
  p.votes.forEach((v, i) => { acc.votes[i] += v; });
  acc.totalVotes   += p.totalVotes;
  return acc;
}, { main_list: 0, special_list: 0, voted_noon: 0, voted_5pm: 0, voted: 0, valid_ballots: 0, invalid_ballots: 0, votes: SMD_CODES.map(() => 0), totalVotes: 0 });

// ── Write SMD district-level CSV ──────────────────────────────────────────────
const SMD_RESULT_COLS = [
  "district_id","party_id","name_ka","votes","vote_share","registered","voted",
  "voted_noon","voted_5pm","main_list","special_list",
  "turnout_pct","noon_pct","five_pct","invalid_ballots","invalid_pct",
];

function makeSMDResultRows(distRows, national) {
  const rows = [];

  function pushDistrict(district_id, d, smd_id) {
    const reg   = d.main_list + d.special_list;
    const total = d.totalVotes || 1;
    // For national row: collect all unique party_ids across all districts, grouped by party
    // (multiple candidates from same party in different SMDs)
    if (district_id === "national") {
      // Aggregate votes by party across all SMDs
      const partyTotals = {};
      for (let i = 0; i < SMD_CODES.length; i++) {
        // Walk all districts to find party for this code
        // Use any district's candidate lookup for the party (party is same for same code)
        // Find the party_id from the candidate lookup (try SMD 1 first, then any)
        const anyKey = [...candidateLookup.keys()].find(k => k.endsWith(`_${SMD_CODES[i]}`));
        if (!anyKey && d.votes[i] === 0) continue;
        let pid = "independent";
        if (anyKey) pid = candidateLookup.get(anyKey).party_id;
        if (!partyTotals[pid]) partyTotals[pid] = 0;
        partyTotals[pid] += d.votes[i];
      }
      const natTotal = Object.values(partyTotals).reduce((s, v) => s + v, 0) || 1;
      for (const [pid, pvotes] of Object.entries(partyTotals)) {
        rows.push({
          district_id: "national",
          party_id: pid,
          name_ka: null,
          votes:          pvotes,
          vote_share:     r4(pvotes / natTotal),
          registered:     reg,
          voted:          d.voted,
          voted_noon:     d.voted_noon,
          voted_5pm:      d.voted_5pm,
          main_list:      d.main_list,
          special_list:   d.special_list,
          turnout_pct:    reg > 0 ? r4(d.voted / reg) : 0,
          noon_pct:       reg > 0 ? r4(d.voted_noon / reg) : 0,
          five_pct:       reg > 0 ? r4(d.voted_5pm  / reg) : 0,
          invalid_ballots: d.invalid_ballots,
          invalid_pct:    d.voted > 0 ? r4(d.invalid_ballots / d.voted) : 0,
        });
      }
      return;
    }

    // District-level: one row per candidate
    const total_dist = d.totalVotes || 1;
    const reg_dist   = d.main_list + d.special_list;
    for (let i = 0; i < SMD_CODES.length; i++) {
      if (d.votes[i] === 0) continue; // skip zero-vote candidates for this SMD
      const code = SMD_CODES[i];
      const key  = `${smd_id}_${code}`;
      const cand = candidateLookup.get(key);
      if (!cand) continue; // candidate not in this SMD
      rows.push({
        district_id,
        party_id:       cand.party_id,
        name_ka: cand.name_ka,
        votes:          d.votes[i],
        vote_share:     r4(d.votes[i] / total_dist),
        registered:     reg_dist,
        voted:          d.voted,
        voted_noon:     d.voted_noon,
        voted_5pm:      d.voted_5pm,
        main_list:      d.main_list,
        special_list:   d.special_list,
        turnout_pct:    reg_dist > 0 ? r4(d.voted / reg_dist) : 0,
        noon_pct:       reg_dist > 0 ? r4(d.voted_noon / reg_dist) : 0,
        five_pct:       reg_dist > 0 ? r4(d.voted_5pm  / reg_dist) : 0,
        invalid_ballots: d.invalid_ballots,
        invalid_pct:    d.voted > 0 ? r4(d.invalid_ballots / d.voted) : 0,
      });
    }
  }

  pushDistrict("national", smdNational, null);
  for (const d of distRows) pushDistrict(d.smd, d, d.smd);
  return rows;
}

const smdResultRows = makeSMDResultRows(smdByDistrict, smdNational);
fs.writeFileSync(
  path.join(SRC, "data", "results", "parl2020_smd.csv"),
  toCSV(smdResultRows, SMD_RESULT_COLS)
);
console.log(`✓ parl2020_smd.csv: ${smdByDistrict.length} SMDs, ${smdResultRows.length} rows`);

// ── Write SMD precinct-level CSV ──────────────────────────────────────────────
const SMD_PREC_COLS = [
  "precinct_id","district_id","party_id","name_ka","votes","vote_share","registered","voted",
  "voted_noon","voted_5pm","turnout_pct","noon_pct","five_pct","invalid_ballots","invalid_pct",
];

const smdPrecinctRows = [];
for (const p of smdPrecincts) {
  const reg   = p.main_list + p.special_list;
  const total = p.totalVotes || 1;
  for (let i = 0; i < SMD_CODES.length; i++) {
    if (p.votes[i] === 0) continue;
    const code = SMD_CODES[i];
    const key  = `${p.smd}_${code}`;
    const cand = candidateLookup.get(key);
    if (!cand) continue;
    smdPrecinctRows.push({
      precinct_id:      p.precinct_id,
      district_id:      p.precinct_id,  // polygon convention
      party_id:         cand.party_id,
      name_ka: cand.name_ka,
      votes:            p.votes[i],
      vote_share:       r4(p.votes[i] / total),
      registered:       reg,
      voted:            p.voted,
      voted_noon:       p.voted_noon,
      voted_5pm:        p.voted_5pm,
      turnout_pct:      reg > 0 ? r4(p.voted / reg) : 0,
      noon_pct:         reg > 0 ? r4(p.voted_noon / reg) : 0,
      five_pct:         reg > 0 ? r4(p.voted_5pm  / reg) : 0,
      invalid_ballots:  p.invalid_ballots,
      invalid_pct:      p.voted > 0 ? r4(p.invalid_ballots / p.voted) : 0,
    });
  }
}
fs.writeFileSync(
  path.join(SRC, "data", "results", "parl2020_smd_precincts.csv"),
  toCSV(smdPrecinctRows, SMD_PREC_COLS)
);
console.log(`✓ parl2020_smd_precincts.csv: ${smdPrecincts.length} precincts, ${smdPrecinctRows.length} rows`);

// ── Parse runoff sheet ────────────────────────────────────────────────────────
// Col 1: smd_id, Col 2: dd, Col 3: precinct, Col 4-8: turnout,
// Cols 10-15: votes for ballot codes [2,5,10,24,36,41], Col 16: valid (formula), Col 17: invalid
const runoffPrecincts = [];
for (let r = 2; r <= wsRun.rowCount; r++) {
  const row  = wsRun.getRow(r);
  const smd  = n(row.getCell(1).value);
  const code = cellStr(row.getCell(3));
  if (!smd || !code) continue;
  const pc = parsePrecinct(code);
  if (!pc) continue;

  const main_list    = n(row.getCell(4).value);
  const special_list = n(row.getCell(5).value);
  const voted_noon   = n(row.getCell(6).value);
  const voted_5pm    = n(row.getCell(7).value);
  const voted        = n(row.getCell(8).value);
  // Col 16 is a formula: SUM(J:O), must use .result
  const cell16 = row.getCell(16);
  const valid_ballots = (cell16.value && typeof cell16.value === "object" && cell16.value.formula != null)
    ? Number(cell16.value.result ?? 0)
    : cellNum(cell16);
  const invalid_ballots = cellNum(row.getCell(17));

  const votes = RUNOFF_CODES.map((_, i) => cellNum(row.getCell(10 + i)));
  const totalVotes = votes.reduce((s, v) => s + v, 0);

  runoffPrecincts.push({
    smd, dd: pc.dd, pp: pc.pp, precinct_id: pc.precinct_id,
    main_list, special_list, voted_noon, voted_5pm, voted,
    valid_ballots, invalid_ballots, votes, totalVotes,
  });
}
console.log(`Runoff precincts: ${runoffPrecincts.length}`);

// ── Aggregate runoff by SMD ───────────────────────────────────────────────────
const runoffBySMD = {};
for (const p of runoffPrecincts) {
  const k = p.smd;
  if (!runoffBySMD[k]) runoffBySMD[k] = {
    smd: k, main_list: 0, special_list: 0, voted_noon: 0, voted_5pm: 0,
    voted: 0, valid_ballots: 0, invalid_ballots: 0,
    votes: RUNOFF_CODES.map(() => 0), totalVotes: 0,
  };
  const d = runoffBySMD[k];
  d.main_list    += p.main_list;
  d.special_list += p.special_list;
  d.voted_noon   += p.voted_noon;
  d.voted_5pm    += p.voted_5pm;
  d.voted        += p.voted;
  d.valid_ballots += p.valid_ballots;
  d.invalid_ballots += p.invalid_ballots;
  p.votes.forEach((v, i) => { d.votes[i] += v; });
  d.totalVotes   += p.totalVotes;
}
const runoffSMDs = Object.values(runoffBySMD).sort((a, b) => a.smd - b.smd);

const runoffNational = runoffPrecincts.reduce((acc, p) => {
  acc.main_list    += p.main_list;
  acc.special_list += p.special_list;
  acc.voted_noon   += p.voted_noon;
  acc.voted_5pm    += p.voted_5pm;
  acc.voted        += p.voted;
  acc.valid_ballots += p.valid_ballots;
  acc.invalid_ballots += p.invalid_ballots;
  p.votes.forEach((v, i) => { acc.votes[i] += v; });
  acc.totalVotes   += p.totalVotes;
  return acc;
}, { main_list: 0, special_list: 0, voted_noon: 0, voted_5pm: 0, voted: 0, valid_ballots: 0, invalid_ballots: 0, votes: RUNOFF_CODES.map(() => 0), totalVotes: 0 });

// ── Runoff party IDs (from normalization of ballot codes 2,5,10,24,36,41) ─────
const RUNOFF_PARTY_IDS = ["european_georgia", "unm", "labour", "citizens", "girchi", "gd"];

// ── Write runoff district-level CSV ──────────────────────────────────────────
const RUNOFF_RESULT_COLS = [
  "district_id","party_id","name_ka","votes","vote_share","registered","voted",
  "voted_noon","voted_5pm","main_list","special_list",
  "turnout_pct","noon_pct","five_pct","invalid_ballots","invalid_pct",
];

function makeRunoffResultRows(distRows, national) {
  const rows = [];

  function pushRunoffDistrict(district_id, d, smd_id) {
    const reg   = d.main_list + d.special_list;
    const total = d.totalVotes || 1;
    for (let i = 0; i < RUNOFF_CODES.length; i++) {
      if (d.votes[i] === 0) continue; // skip candidates not in this runoff
      const code = RUNOFF_CODES[i];
      const pid  = RUNOFF_PARTY_IDS[i];
      let name_ka = null;
      if (smd_id) {
        const cand = candidateLookup.get(`${smd_id}_${code}`);
        if (cand) name_ka = cand.name_ka;
      }
      rows.push({
        district_id,
        party_id:       pid,
        name_ka: name_ka,
        votes:          d.votes[i],
        vote_share:     r4(d.votes[i] / total),
        registered:     reg,
        voted:          d.voted,
        voted_noon:     d.voted_noon,
        voted_5pm:      d.voted_5pm,
        main_list:      d.main_list,
        special_list:   d.special_list,
        turnout_pct:    reg > 0 ? r4(d.voted / reg) : 0,
        noon_pct:       reg > 0 ? r4(d.voted_noon / reg) : 0,
        five_pct:       reg > 0 ? r4(d.voted_5pm  / reg) : 0,
        invalid_ballots: d.invalid_ballots,
        invalid_pct:    d.voted > 0 ? r4(d.invalid_ballots / d.voted) : 0,
      });
    }
  }

  pushRunoffDistrict("national", national, null);
  for (const d of distRows) pushRunoffDistrict(d.smd, d, d.smd);
  return rows;
}

const runoffResultRows = makeRunoffResultRows(runoffSMDs, runoffNational);
fs.writeFileSync(
  path.join(SRC, "data", "results", "parl2020_smd_runoff.csv"),
  toCSV(runoffResultRows, RUNOFF_RESULT_COLS)
);
console.log(`✓ parl2020_smd_runoff.csv: ${runoffSMDs.length} SMDs, ${runoffResultRows.length} rows`);

// ── Write runoff precinct-level CSV ──────────────────────────────────────────
const RUNOFF_PREC_COLS = [
  "precinct_id","district_id","party_id","name_ka","votes","vote_share","registered","voted",
  "voted_noon","voted_5pm","turnout_pct","noon_pct","five_pct","invalid_ballots","invalid_pct",
];

const runoffPrecinctRows = [];
for (const p of runoffPrecincts) {
  const reg   = p.main_list + p.special_list;
  const total = p.totalVotes || 1;
  for (let i = 0; i < RUNOFF_CODES.length; i++) {
    if (p.votes[i] === 0) continue;
    const code = RUNOFF_CODES[i];
    const pid  = RUNOFF_PARTY_IDS[i];
    const cand = candidateLookup.get(`${p.smd}_${code}`);
    const name_ka = cand ? cand.name_ka : null;
    runoffPrecinctRows.push({
      precinct_id:      p.precinct_id,
      district_id:      p.precinct_id,  // polygon convention
      party_id:         pid,
      name_ka: name_ka,
      votes:            p.votes[i],
      vote_share:       r4(p.votes[i] / total),
      registered:       reg,
      voted:            p.voted,
      voted_noon:       p.voted_noon,
      voted_5pm:        p.voted_5pm,
      turnout_pct:      reg > 0 ? r4(p.voted / reg) : 0,
      noon_pct:         reg > 0 ? r4(p.voted_noon / reg) : 0,
      five_pct:         reg > 0 ? r4(p.voted_5pm  / reg) : 0,
      invalid_ballots:  p.invalid_ballots,
      invalid_pct:      p.voted > 0 ? r4(p.invalid_ballots / p.voted) : 0,
    });
  }
}
fs.writeFileSync(
  path.join(SRC, "data", "results", "parl2020_smd_runoff_precincts.csv"),
  toCSV(runoffPrecinctRows, RUNOFF_PREC_COLS)
);
console.log(`✓ parl2020_smd_runoff_precincts.csv: ${runoffPrecincts.length} precincts, ${runoffPrecinctRows.length} rows`);

console.log("\nDone.");
