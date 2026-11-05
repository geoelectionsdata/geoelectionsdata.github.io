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

export function diskPath(p) { return join(SRC, p); }
export function fileExists(p) { return existsSync(diskPath(p)); }
const assetRoles = {
  shape_file: ["geometry"],
  selfgov_shape_file: ["geometry"],
  cartogram: ["geometry"],
  precinct_shape_file: ["precinct-geometry"],
  file: ["turnout"],
  precinct_file: ["turnout", "precinct-csv"],
  annulled_precincts: ["precinct-csv"],
  seats: ["results"],
};

export function collectExistingPaths(role) {
  const paths = new Set();
  for (const election of loadElections()) {
    function visit(value, field = "") {
      if (typeof value === "string" && /^data\/.*\.(csv|geojson)$/.test(value)) {
        const roles = Object.hasOwn(assetRoles, field) ? assetRoles[field]
          : /_precinct_results$/.test(field) ? ["precinct-csv"]
          : /(?:^|_)results$/.test(field) ? ["results"] : null;
        if (!roles) throw new Error(`${election.id}: undeclared asset role for ${field} (${value})`);
        const generated = roles.includes("precinct-geometry") && fileExists(`${value}.js`);
        if (!fileExists(value) && !generated) throw new Error(`${election.id}: missing ${field} asset: ${value}`);
        if (!role || roles.includes(role)) paths.add(value);
      } else if (value && typeof value === "object") {
        for (const [key, child] of Object.entries(value)) visit(child, key);
      }
    }
    visit(election);
  }
  return [...paths].sort();
}
