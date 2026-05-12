/**
 * geo-registry.json.js — data loader
 * Walks all election YAMLs and emits a small manifest of non-precinct
 * GeoJSON files: { "data/shp/...geojson": "data/shp/...geojson", ... }.
 *
 * The client fetches the selected GeoJSON lazily. Keeping the actual geometry
 * out of this registry avoids downloading/parsing every district layer when
 * the elections page first opens.
 */

import { collectExistingPaths, isPrecinctPath } from "./config/registry-utils.js";

const registry = {};

for (const p of collectExistingPaths(p => p.endsWith(".geojson") && !isPrecinctPath(p))) {
  registry[p] = p;
}

process.stdout.write(JSON.stringify(registry));
