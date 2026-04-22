/**
 * registry-utils.js
 * Shared helpers for the geo/csv/turnout registry data loaders.
 */

import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { load } from "js-yaml";

export const SRC = "src";
export const YAML_DIR = join(SRC, "data/config/elections");

export function collectYmlFiles(base) {
  const result = [];
  for (const entry of readdirSync(base, { withFileTypes: true })) {
    const full = join(base, entry.name);
    if (entry.isDirectory()) result.push(...collectYmlFiles(full));
    else if (entry.name.endsWith(".yml")) result.push(full);
  }
  return result;
}

export function loadElections() {
  return collectYmlFiles(YAML_DIR).map(f => load(readFileSync(f, "utf8")));
}

/** Walk any JS value and collect strings that look like data file paths. */
export function collectPaths(obj, out = new Set()) {
  if (!obj) return out;
  if (typeof obj === "string") {
    if (obj.endsWith(".csv") || obj.endsWith(".geojson")) out.add(obj);
    return out;
  }
  if (Array.isArray(obj)) { obj.forEach(v => collectPaths(v, out)); return out; }
  if (typeof obj === "object") Object.values(obj).forEach(v => collectPaths(v, out));
  return out;
}

export function diskPath(p) { return join(SRC, p); }
export function fileExists(p) { return existsSync(diskPath(p)); }
export function readText(p) { return readFileSync(diskPath(p), "utf8"); }

export function collectExistingPaths(predicate = () => true) {
  const paths = new Set();
  for (const election of loadElections()) {
    for (const p of collectPaths(election)) {
      if (predicate(p) && fileExists(p)) paths.add(p);
    }
  }
  return [...paths].sort();
}
