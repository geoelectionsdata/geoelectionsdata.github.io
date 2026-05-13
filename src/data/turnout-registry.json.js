/**
 * turnout-registry.json.js — data loader
 * Walks all election YAMLs and emits a tiny manifest of turnout CSV paths:
 * { "data/turnout/...csv": "data/turnout/...csv", ... }.
 *
 * The dashboard fetches the selected turnout CSV lazily. Keeping the actual
 * row data out of this registry avoids downloading every election's turnout
 * (~7.5 MB) on first page load.
 */

import { collectExistingPaths } from "./config/registry-utils.js";

const registry = {};

for (const p of collectExistingPaths(p => p.startsWith("data/turnout/") && p.endsWith(".csv"))) {
  registry[p] = p;
}

process.stdout.write(JSON.stringify(registry));
