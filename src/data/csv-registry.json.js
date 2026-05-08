/**
 * csv-registry.json.js - data loader
 * Emits a small YAML-derived manifest for non-precinct result CSV files.
 * The selected CSV asset is fetched and parsed lazily by the page instead
 * of bundling every election result into one large JSON payload.
 */

import { collectExistingPaths, isPrecinctPath } from "./config/registry-utils.js";

const registry = {};

for (const p of collectExistingPaths(p =>
  p.endsWith(".csv") &&
  !p.startsWith("data/turnout/") &&
  !isPrecinctPath(p)
)) {
  registry[p] = p;
}

process.stdout.write(JSON.stringify(registry));
