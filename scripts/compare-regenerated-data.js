// Usage: node scripts/compare-regenerated-data.js [--check] <regenerated data dir> [baseline data dir]
import {readdirSync, readFileSync, statSync} from "node:fs";
import {join, resolve} from "node:path";
import {csvParseRows} from "d3-dsv";

const args = process.argv.slice(2);
const check = args[0] === "--check";
if (check) args.shift();
const [directory, baselineDirectory = "src/data"] = args;
if (!directory) {
  console.error("Usage: node scripts/compare-regenerated-data.js [--check] <regenerated data dir> [baseline data dir]");
  process.exit(2);
}
const baseline = resolve(baselineDirectory);
const regenerated = resolve(directory);
if (baseline === regenerated) throw new Error("Pass a separate regenerated data directory.");

function files(root, relative) {
  return readdirSync(join(root, relative), {withFileTypes: true}).flatMap(entry => {
    const path = `${relative}/${entry.name}`;
    if (entry.isDirectory()) return files(root, path);
    return statSync(join(root, path)).isFile() ? [path] : [];
  });
}

function classify(before, after, path) {
  if (!before) return "added";
  if (!after) return "removed";
  if (before.equals(after)) return "identical";
  if (!path.endsWith(".csv")) return "changed";
  const parse = bytes => csvParseRows(bytes.toString("utf8").replace(/^\uFEFF/, ""));
  const [oldHeader, ...oldRows] = parse(before);
  const [newHeader, ...newRows] = parse(after);
  if (JSON.stringify(oldHeader) !== JSON.stringify(newHeader)) return "header changed";
  if (oldRows.length !== newRows.length) return `row count ${oldRows.length} -> ${newRows.length}`;
  const a = oldRows.map(row => JSON.stringify(row));
  const b = newRows.map(row => JSON.stringify(row));
  if (a.every((row, i) => row === b[i])) return "CSV formatting only";
  a.sort();
  b.sort();
  return a.every((row, i) => row === b[i]) ? "row order only" : "values changed";
}

const dirs = ["results", "turnout", "candidates", "config", "shp"];
const before = new Set(dirs.flatMap(dir => files(baseline, dir)));
const after = new Set(dirs.flatMap(dir => files(regenerated, dir)));
const counts = new Map();
// Temporary exceptions for legacy outputs that no dashboard or download reads.
// Only additions are exempt: a change to a checked-in file still fails.
const legacyAdditions = new Set([
  "candidates/adj2008_party_lists.csv",
  "candidates/adj2008_smd_candidates.csv",
  "candidates/adj2016_elected.csv",
  "candidates/adj2016_party_lists.csv",
  "candidates/adj2016_smd_candidates.csv",
  "candidates/adj2020_elected.csv",
  "candidates/adj2020_party_lists.csv",
  "candidates/adj2020_smd_candidates.csv",
  "candidates/local2010_mayor_candidates.csv",
  "candidates/local2010_smd_candidates.csv",
  "candidates/parl2008_elected.csv",
  "candidates/parl2008_party_lists.csv",
  "candidates/parl2008_smd_candidates.csv",
  "candidates/parl2012_elected.csv",
  "candidates/parl2012_party_lists.csv",
  "candidates/parl2012_smd_candidates.csv",
  "candidates/pres2008_candidates.csv",
  "candidates/pres2013_candidates.csv",
  "config/candidates/local/local_2010.yml",
  "config/candidates/local/local_2021.yml",
  "config/candidates/local/local_2025.yml",
]);
let unexpected = 0;
for (const path of [...new Set([...before, ...after])].sort()) {
  const status = classify(
    before.has(path) && readFileSync(join(baseline, path)),
    after.has(path) && readFileSync(join(regenerated, path)),
    path
  );
  const category = status.startsWith("row count ") ? "row count changed" : status;
  counts.set(category, (counts.get(category) ?? 0) + 1);
  if (status !== "identical") console.log(`${status}\t${path}`);
  if (status !== "identical" && !(status === "added" && legacyAdditions.has(path))) unexpected++;
}
console.log(JSON.stringify(Object.fromEntries(counts)));
if (check && unexpected > 0) {
  console.error(`Regeneration check failed: ${unexpected} unexpected difference(s).`);
  process.exitCode = 1;
}
