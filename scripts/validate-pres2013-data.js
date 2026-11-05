import {readFileSync} from "node:fs";
import {execFileSync} from "node:child_process";
import {join} from "node:path";
import {csvParse} from "d3-dsv";
import {load} from "js-yaml";

const root = "src";
const read = path => readFileSync(join(root, path), "utf8");
const election = load(read("data/config/elections/presidential/pres_2013.yml"));
const subjects = new Set(election.candidates.map(candidate => candidate.id));
const counts = ["registered", "voted", "voted_noon", "voted_5pm", "main_list", "special_list", "invalid_ballots"];
const ratios = ["turnout_pct", "noon_pct", "five_pct", "invalid_pct"];
const validId = id => typeof id === "string" && id !== "" && id === id.trim() && !/^(NA|null)$/i.test(id);
const problems = [];

function check(condition, context, message) {
  if (!condition) problems.push(`${context}: ${message}`);
}

function readRows(path, required) {
  const rows = csvParse(read(path));
  const missing = required.filter(key => !rows.columns.includes(key));
  if (missing.length) throw new Error(`${path}: missing columns ${missing.join(", ")}`);
  if (!rows.length) throw new Error(`${path}: no data`);
  return rows;
}

function numeric(value, integer) {
  return /^(?:\d+)(?:\.\d+)?$/.test(value) && Number.isFinite(Number(value))
    && (!integer || Number.isSafeInteger(Number(value)));
}

for (const [unit, resultPath, turnoutPath, shapePath] of [
  ["district_id", election.files.pr_results, election.turnout.file, election.system.pr.shape_file],
  ["precinct_id", election.files.pr_precinct_results, election.turnout.precinct_file, election.system.pr.precinct_shape_file]
]) {
  const keys = unit === "district_id" ? [unit] : [unit, "district_id", "precinct_number"];
  const shared = [...keys, "district_name_ka", "district_name_en", ...counts, ...ratios];
  const turnout = readRows(turnoutPath, [...shared, "vote_type"]);
  const results = readRows(resultPath, [...shared, "party_id", "votes", "vote_share"]);
  const shape = shapePath.endsWith("_display.geojson")
    ? execFileSync(process.execPath, [join(root, shapePath + ".js")], {encoding: "utf8", maxBuffer: 32 * 1024 * 1024})
    : read(shapePath);
  const geo = new Set(JSON.parse(shape).features.map(feature => String(feature.properties.id)));
  const byUnit = new Map();
  let turnoutAboveOne = 0;
  for (const row of turnout) {
    const id = row[unit];
    const context = `${turnoutPath} [${id}]`;
    check(keys.every(key => validId(row[key])), context, "invalid geographic identifier");
    check(row.vote_type === "pr", context, "expected presidential ballot in the legacy pr slot");
    check(!byUnit.has(id), context, "duplicate turnout unit");
    for (const key of counts) check(numeric(row[key], true), context, `invalid ${key}`);
    for (const key of ratios) check(numeric(row[key], false), context, `invalid ${key}`);
    if (ratios.some(key => Number(row[key]) > 1)) turnoutAboveOne++;
    byUnit.set(id, row);
  }

  const byResult = new Set();
  const shares = new Map();
  for (const row of results) {
    const id = row[unit];
    const key = JSON.stringify([id, row.party_id]);
    const context = `${resultPath} [${key}]`;
    check(!byResult.has(key), context, "duplicate ballot subject in unit");
    byResult.add(key);
    check(subjects.has(row.party_id), context, "unknown ballot subject");
    check(numeric(row.votes, true), context, "invalid vote count");
    check(numeric(row.vote_share, false), context, "invalid vote share");
    const matchingTurnout = byUnit.get(id);
    check(Boolean(matchingTurnout), context, "no turnout row");
    if (matchingTurnout) {
      const differing = shared.filter(field => row[field] !== matchingTurnout[field]);
      check(!differing.length, context, `turnout join differs in ${differing.join(", ")}`);
    }
    shares.set(id, (shares.get(id) ?? 0) + Number(row.vote_share));
  }
  for (const id of byUnit.keys()) {
    check(shares.has(id), `${turnoutPath} [${id}]`, "no result rows");
  }

  console.log(JSON.stringify({
    level: unit === "district_id" ? "district" : "precinct",
    results: results.length,
    turnout: turnout.length,
    unitsWithoutGeometry: [...byUnit.keys()].filter(id => id !== "national" && !geo.has(id)).length,
    unitsWithTurnoutRatioAboveOne: turnoutAboveOne,
    unitsWithShareSumOutsideRounding: [...shares.values()].filter(sum => Math.abs(sum - 1) > subjects.size * 0.0000005).length
  }));
}

if (problems.length) {
  console.error(problems.slice(0, 20).join("\n"));
  console.error(`${problems.length} contract violation(s).`);
  process.exitCode = 1;
}
