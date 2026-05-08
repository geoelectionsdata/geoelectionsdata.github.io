/**
 * precinct-geo-registry.json.js — data loader
 * Emits a small manifest of precinct GeoJSON files (paths containing "_precinct" or "_precincts").
 * The client fetches this manifest lazily, then fetches only the selected
 * GeoJSON file instead of downloading all precinct geometries at once.
 */

import { collectExistingPaths, isPrecinctPath } from "./config/registry-utils.js";

const registry = {};

for (const p of collectExistingPaths(p => p.endsWith(".geojson") && isPrecinctPath(p))) {
  registry[p] = p;
}

process.stdout.write(JSON.stringify(registry));
