// Observable Framework data loader: per-election YAML files → elections.json
// Each file in src/data/config/elections/**/*.yml is one election object.
// Sort order: descending by date so the dropdown shows newest first.
import {loadElections} from "./config/registry-utils.js";

const elections = loadElections()
  .sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));

process.stdout.write(JSON.stringify(elections, null, 2));
