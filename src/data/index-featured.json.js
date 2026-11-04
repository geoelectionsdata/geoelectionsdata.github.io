// src/data/index-featured.json.js
// Pre-computes just the featured election data for the index page.
// Replaces loading the full geo-registry (12.9 MB) + csv-registry (110 MB).
// Output is ~1-2 MB for a single election.

import fs   from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
import {csvParse} from "d3-dsv";

const SRC          = path.join(process.cwd(), "src");
const ELECTIONS_DIR = path.join(SRC, "data", "config", "elections");

// Priority order for the featured election. A stable choice keeps builds reproducible.
const FEATURED_IDS = ["parl_2024", "parl_1919", "pres_2018", "parl_2012"];

function collectYmlFiles(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...collectYmlFiles(p));
    else if (/\.ya?ml$/i.test(e.name)) out.push(p);
  }
  return out;
}

const allElections = collectYmlFiles(ELECTIONS_DIR)
  .map(f => { try { return yaml.load(fs.readFileSync(f, "utf8")); } catch { return null; } })
  .filter(e => e?.id);

// Filter to elections that have the required files
const pool = FEATURED_IDS
  .map(id => allElections.find(e => e.id === id))
  .filter(e => {
    if (!e?.system?.pr?.shape_file || !e?.files?.pr_results) return false;
    const geoPath = path.join(SRC, e.system.pr.shape_file);
    const csvPath = path.join(SRC, e.files.pr_results);
    return fs.existsSync(geoPath) && fs.existsSync(csvPath);
  });

if (!pool.length) {
  process.stdout.write(JSON.stringify({ error: "No featured elections available" }));
  process.exit(0);
}

const featured = pool[0];

// Load GeoJSON
const geoPath = path.join(SRC, featured.system.pr.shape_file);
const geo = JSON.parse(fs.readFileSync(geoPath, "utf8"));

// Load and parse CSV
const csvPath = path.join(SRC, featured.files.pr_results);
const csv = csvParse(fs.readFileSync(csvPath, "utf8"), row => ({
  ...row,
  votes: Number(row.votes),
  vote_share: Number(row.vote_share)
}));

process.stdout.write(JSON.stringify({
  electionId: featured.id,
  geo,
  csv,
}));
