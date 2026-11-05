/**
 * precinct-geo-registry.json.js — data loader
 * Emits a small manifest of GeoJSON files declared as precinct geometry.
 * The client fetches this manifest lazily, then fetches only the selected
 * GeoJSON file instead of downloading all precinct geometries at once.
 */

import { collectExistingPaths } from "./config/registry-utils.js";

const registry = {};

for (const p of collectExistingPaths("precinct-geometry")) {
  registry[p] = p;
}

process.stdout.write(JSON.stringify(registry));
