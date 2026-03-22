// Observable Framework data loader: parties.yml → parties.json
import { readFileSync } from "node:fs";
import { load } from "js-yaml";

const raw  = readFileSync("src/data/config/parties.yml", "utf8");
const data = load(raw);

const parties = data?.parties ?? data;

process.stdout.write(JSON.stringify(parties, null, 2));
