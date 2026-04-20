/**
 * precinct-geo-registry.json.js — data loader
 * Loads only precinct GeoJSON files (paths containing "_precincts").
 * Kept separate from geo-registry so it is fetched lazily by the client
 * only when the user activates the precinct map level.
 */

import { loadElections, collectPaths, fileExists, readText } from "./config/registry-utils.js";

const registry = {};

for (const election of loadElections()) {
  for (const p of collectPaths(election)) {
    if (!p.endsWith(".geojson")) continue;
    if (!p.includes("_precincts")) continue;
    if (registry[p] || !fileExists(p)) continue;
    registry[p] = JSON.parse(readText(p));
  }
}

process.stdout.write(JSON.stringify(registry));
