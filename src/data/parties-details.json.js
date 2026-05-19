// Detail map for the /parties page: lineage_id → appearance[]. Fetched
// lazily by the page (only after the user opens the first party detail row).
import { buildParties } from "./config/parties-build.js";

const built = await buildParties();

const details = {};
for (const l of built.lineages) {
  details[l.lineage_id] = l.appearances;
}

process.stdout.write(JSON.stringify(details));
