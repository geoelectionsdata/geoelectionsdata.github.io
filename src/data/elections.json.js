// Observable Framework data loader: per-election YAML files → elections.json
// Each file in src/data/config/elections/**/*.yml is one election object.
// Sort order: descending by date so the dropdown shows newest first.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { load } from "js-yaml";

const dir = "src/data/config/elections";

function collectYmlFiles(base) {
  const entries = readdirSync(base, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = join(base, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectYmlFiles(full));
    } else if (entry.name.endsWith(".yml")) {
      files.push(full);
    }
  }
  return files;
}

const elections = collectYmlFiles(dir)
  .map(f => load(readFileSync(f, "utf8")))
  .sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));

process.stdout.write(JSON.stringify(elections, null, 2));
