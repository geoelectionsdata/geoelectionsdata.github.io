/**
 * generate-registry.js
 *
 * Reads all per-election YAML files, collects every data file path they reference,
 * and regenerates the _allGeo / _csvUrls / _turnoutUrls blocks in src/elections.md.
 *
 * Usage:
 *   node scripts/generate-registry.js
 *
 * Only files that exist on disk are registered. Files referenced in YAMLs but not
 * yet created will be printed as warnings and skipped — the page won't crash.
 *
 * Re-run this script any time you add a new election YAML or new data files.
 */

import { readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { load } from "js-yaml";

const ROOT        = "src";
const YAML_DIR    = join(ROOT, "data/config/elections");
const ELECTIONS_MD = join(ROOT, "elections.md");
const START_MARKER = "// AUTO-GENERATED:START";
const END_MARKER   = "// AUTO-GENERATED:END";

// ── Collect all YAML files recursively ───────────────────────────────────────

function collectYmlFiles(base) {
  const result = [];
  for (const entry of readdirSync(base, { withFileTypes: true })) {
    const full = join(base, entry.name);
    if (entry.isDirectory()) result.push(...collectYmlFiles(full));
    else if (entry.name.endsWith(".yml")) result.push(full);
  }
  return result;
}

// ── Walk any JS value to find file paths (strings ending in .csv / .geojson) ─

function collectPaths(obj, out = new Set()) {
  if (obj === null || obj === undefined) return out;
  if (typeof obj === "string") {
    if (obj.endsWith(".csv") || obj.endsWith(".geojson")) out.add(obj);
    return out;
  }
  if (Array.isArray(obj)) { obj.forEach(v => collectPaths(v, out)); return out; }
  if (typeof obj === "object") { Object.values(obj).forEach(v => collectPaths(v, out)); }
  return out;
}

// ── Load elections ────────────────────────────────────────────────────────────

const elections = collectYmlFiles(YAML_DIR).map(f => load(readFileSync(f, "utf8")));

// ── Classify paths ────────────────────────────────────────────────────────────

const geoPaths     = new Set();
const csvPaths     = new Set();
const turnoutPaths = new Set();
const missing      = [];

for (const election of elections) {
  for (const p of collectPaths(election)) {
    if (!existsSync(join(ROOT, p))) {
      missing.push(`${election.id}: ${p}`);
      continue;
    }
    if (p.endsWith(".geojson"))        geoPaths.add(p);
    else if (p.startsWith("data/turnout/")) turnoutPaths.add(p);
    else                               csvPaths.add(p);
  }
}

if (missing.length > 0) {
  console.warn("\n⚠  Skipped (file not on disk yet):");
  missing.forEach(m => console.warn("   " + m));
  console.warn("   Create these files and re-run to register them.\n");
}

// ── Generate code blocks ──────────────────────────────────────────────────────

function makeBlock(varName, paths, method) {
  const sorted = [...paths].sort();
  const maxLen = sorted.reduce((m, p) => Math.max(m, p.length), 0);
  const lines = sorted.map(p => {
    const pad = " ".repeat(maxLen - p.length);
    return `  "${p}":${pad} await FileAttachment("${p}").${method}(),`;
  });
  return `const ${varName} = {\n${lines.join("\n")}\n};`;
}

const generated = [
  `${START_MARKER} — do not edit manually, run: node scripts/generate-registry.js`,
  `// ── GeoJSON: pre-loaded via FileAttachment (Observable Framework's /_file/ system)`,
  `// ── CSVs: URL-only registration — data fetched on demand when election is selected`,
  makeBlock("_allGeo",      geoPaths,     "json"),
  "",
  makeBlock("_csvUrls",     csvPaths,     "url"),
  "",
  makeBlock("_turnoutUrls", turnoutPaths, "url"),
  END_MARKER,
].join("\n");

// ── Replace block in elections.md ─────────────────────────────────────────────

const md = readFileSync(ELECTIONS_MD, "utf8");
const si = md.indexOf(START_MARKER);
const ei = md.indexOf(END_MARKER);

if (si === -1 || ei === -1) {
  console.error(
    `ERROR: Could not find AUTO-GENERATED markers in ${ELECTIONS_MD}.\n` +
    `Add these lines around the _allGeo/_csvUrls/_turnoutUrls blocks:\n` +
    `  ${START_MARKER}\n  ...\n  ${END_MARKER}`
  );
  process.exit(1);
}

const newMd = md.slice(0, si) + generated + md.slice(ei + END_MARKER.length);
writeFileSync(ELECTIONS_MD, newMd);

console.log(`✓ Updated ${ELECTIONS_MD}`);
console.log(`  _allGeo:      ${geoPaths.size} GeoJSON files`);
console.log(`  _csvUrls:     ${csvPaths.size} CSV result files`);
console.log(`  _turnoutUrls: ${turnoutPaths.size} turnout CSV files`);
