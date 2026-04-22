/**
 * precinct-geo-registry.json.js — data loader
 * Emits a small manifest of precinct GeoJSON files (paths containing "_precincts").
 * The client fetches this manifest lazily, then fetches only the selected
 * GeoJSON file instead of downloading all precinct geometries at once.
 */

import { collectExistingPaths } from "./config/registry-utils.js";

const registry = {};

for (const p of collectExistingPaths(p => p.endsWith(".geojson") && p.includes("_precincts"))) {
  registry[p] = p;
}

process.stdout.write(JSON.stringify(registry));
