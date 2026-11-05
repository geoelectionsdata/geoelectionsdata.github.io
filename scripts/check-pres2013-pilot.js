import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {join} from "node:path";
import {csvParse} from "d3-dsv";

const [directory] = process.argv.slice(2);
if (!directory) throw new Error("Usage: node scripts/check-pres2013-pilot.js PILOT_DIRECTORY");
const read = path => csvParse(readFileSync(path, "utf8"));
const results = read(join(directory, "results.csv"));
const turnout = read(join(directory, "turnout.csv"));
const unitKey = row => JSON.stringify([row.election_id, row.sub_id, row.ballot, row.level, row.unit_id]);
const byUnit = new Map();
for (const row of turnout) {
  const key = unitKey(row);
  assert(!byUnit.has(key), `Duplicate turnout key: ${key}`);
  byUnit.set(key, row);
}

function legacyTurnout(row) {
  const {level, unit_id, ...values} = row;
  return {
    ...values,
    district_id: level === "national" ? "national" : row.district_id,
    precinct_id: level === "precinct" ? unit_id : "",
    vote_type: "pr",
    turnout_pct: row.turnout_pct || "0",
    noon_pct: row.noon_pct || "0",
    five_pct: row.five_pct || "0",
    invalid_pct: row.invalid_pct || "0",
  };
}

const subjectKeys = new Set();
const votesByUnit = new Map();
for (const row of results) {
  const key = unitKey(row);
  assert(byUnit.has(key), `Result has no matching turnout: ${key}`);
  const subjectKey = JSON.stringify([key, row.subject_id]);
  assert(!subjectKeys.has(subjectKey), `Duplicate result key: ${subjectKey}`);
  subjectKeys.add(subjectKey);
  const denominator = Number(row.valid_vote_denominator);
  assert(/^\d+$/.test(row.valid_vote_denominator) && Number.isSafeInteger(denominator), `Invalid denominator: ${key}`);
  if (denominator === 0) assert.equal(row.vote_share, "", `Undefined vote share: ${key}`);
  else assert(Math.abs(Number(row.vote_share) - Number(row.votes) / denominator) <= 0.000000500001, `Incorrect share: ${subjectKey}`);
  const total = votesByUnit.get(key) ?? {denominator, votes: 0};
  assert.equal(total.denominator, denominator, `Inconsistent denominator: ${key}`);
  total.votes += Number(row.votes);
  votesByUnit.set(key, total);
}

function compare(path, rows) {
  const expected = read(join("src/data", path));
  assert.equal(rows.length, expected.length, `${path}: row count`);
  for (const [i, row] of rows.entries()) {
    for (const col of expected.columns) {
      assert.equal(row[col], expected[i][col], `${path}: row ${i + 2}, column ${col}`);
    }
  }
  console.log(`${path}: all ${rows.length} rows match in order`);
}

for (const [precinct, suffix] of [[false, ""], [true, "_precincts"]]) {
  const atLevel = row => (row.level === "precinct") === precinct;
  compare(`turnout/pres2013${suffix}_turnout.csv`, turnout.filter(atLevel).map(legacyTurnout));
  compare(`results/pres2013${suffix}.csv`, results.filter(atLevel).map(row => ({
    ...legacyTurnout(byUnit.get(unitKey(row))),
    party_id: row.subject_id,
    votes: row.votes,
    vote_share: row.vote_share || "0",
  })));
}

console.log(`${[...votesByUnit.values()].filter(row => row.denominator !== row.votes).length} reporting units preserve a denominator different from the candidate vote sum.`);
