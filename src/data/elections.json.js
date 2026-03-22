// Observable Framework data loader: elections.yml → elections.json
import { readFileSync } from "node:fs";
import { load } from "js-yaml";

const raw  = readFileSync("src/data/config/elections.yml", "utf8");
const data = load(raw);

// The YAML root key is "elections"
const elections = data?.elections ?? data;

process.stdout.write(JSON.stringify(elections, null, 2));
