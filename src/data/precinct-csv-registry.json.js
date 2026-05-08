/**
 * precinct-csv-registry.json.js — data loader
 * Emits a tiny YAML-derived manifest for precinct CSV files. The selected
 * CSV asset is fetched and parsed lazily by the client when the user
 * activates the precinct map level.
 */

import { collectExistingPaths, isPrecinctPath } from "./config/registry-utils.js";

const registry = {};

for (const p of collectExistingPaths(p => p.endsWith(".csv") && isPrecinctPath(p))) {
  registry[p] = p;
}

process.stdout.write(JSON.stringify(registry));
