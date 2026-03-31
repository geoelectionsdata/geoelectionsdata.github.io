/**
 * geo-registry.json.js — data loader
 * Walks all election YAMLs, loads every GeoJSON file that exists on disk,
 * and outputs a combined JSON object: { "data/shp/...geojson": <GeoJSON>, ... }
 *
 * Observable Framework caches this output; it is invalidated automatically
 * when any source file changes. No manual FileAttachment registration needed.
 */

import { loadElections, collectPaths, fileExists, readText } from "./config/registry-utils.js";

const registry = {};

for (const election of loadElections()) {
  for (const p of collectPaths(election)) {
    if (!p.endsWith(".geojson")) continue;
    if (registry[p] || !fileExists(p)) continue;
    registry[p] = JSON.parse(readText(p));
  }
}

process.stdout.write(JSON.stringify(registry));
