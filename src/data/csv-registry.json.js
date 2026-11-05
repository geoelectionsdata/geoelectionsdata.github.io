/**
 * csv-registry.json.js - data loader
 * Emits a small YAML-derived manifest for non-precinct result CSV files.
 * The selected CSV asset is fetched and parsed lazily by the page instead
 * of bundling every election result into one large JSON payload.
 */

import { collectExistingPaths } from "./config/registry-utils.js";

const registry = {};

for (const p of collectExistingPaths("results")) {
  registry[p] = p;
}

process.stdout.write(JSON.stringify(registry));
