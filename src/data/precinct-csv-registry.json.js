/**
 * precinct-csv-registry.json.js — data loader
 * Loads only precinct results CSV files (paths containing "_precincts").
 * Kept separate from csv-registry so it is fetched lazily by the client
 * only when the user activates the precinct map level.
 */

import { csvParse, autoType } from "d3-dsv";
import { loadElections, collectPaths, fileExists, readText } from "./config/registry-utils.js";

const registry = {};

for (const election of loadElections()) {
  for (const p of collectPaths(election)) {
    if (!p.endsWith(".csv")) continue;
    if (!p.includes("_precincts")) continue;
    if (registry[p] || !fileExists(p)) continue;
    registry[p] = csvParse(readText(p), autoType);
  }
}

process.stdout.write(JSON.stringify(registry));
