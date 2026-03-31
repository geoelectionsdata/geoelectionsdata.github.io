/**
 * turnout-registry.json.js — data loader
 * Walks all election YAMLs, loads every turnout CSV file that exists on disk,
 * parses it with d3-dsv autoType, and outputs a combined JSON:
 * { "data/turnout/...csv": [ {col: val, ...}, ... ], ... }
 *
 * Observable Framework caches this output and invalidates it when source files change.
 */

import { csvParse, autoType } from "d3-dsv";
import { loadElections, collectPaths, fileExists, readText } from "./config/registry-utils.js";

const registry = {};

for (const election of loadElections()) {
  for (const p of collectPaths(election)) {
    if (!p.startsWith("data/turnout/")) continue;
    if (registry[p] || !fileExists(p)) continue;
    registry[p] = csvParse(readText(p), autoType);
  }
}

process.stdout.write(JSON.stringify(registry));
