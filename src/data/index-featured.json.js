// src/data/index-featured.json.js
// Pre-computes just the featured election data for the index page.
// Replaces loading the full geo-registry (12.9 MB) + csv-registry (110 MB).
// Output is ~1-2 MB for a single election.

import {existsSync, readFileSync} from "node:fs";
import {csvParse} from "d3-dsv";
import {diskPath, loadElections} from "./config/registry-utils.js";

// Priority order for the featured election. A stable choice keeps builds reproducible.
const FEATURED_IDS = ["parl_2024", "parl_1919", "pres_2018", "parl_2012"];

const allElections = loadElections().filter(e => e?.id);

// Filter to elections that have the required files
const featured = FEATURED_IDS
  .map(id => allElections.find(e => e.id === id))
  .find(e => {
    if (!e?.system?.pr?.shape_file || !e?.files?.pr_results) return false;
    return existsSync(diskPath(e.system.pr.shape_file)) && existsSync(diskPath(e.files.pr_results));
  });

if (!featured) {
  process.stdout.write(JSON.stringify({ error: "No featured elections available" }));
  process.exit(0);
}

// Load GeoJSON
const geo = JSON.parse(readFileSync(diskPath(featured.system.pr.shape_file), "utf8"));

// Load and parse CSV
const csv = csvParse(readFileSync(diskPath(featured.files.pr_results), "utf8"), row => ({
  ...row,
  votes: Number(row.votes),
  vote_share: Number(row.vote_share)
}));

process.stdout.write(JSON.stringify({
  electionId: featured.id,
  geo,
  csv,
}));
