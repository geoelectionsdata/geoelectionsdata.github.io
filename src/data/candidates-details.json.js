// Detail map for the /candidates page: cluster_id → appearance[]. Fetched
// lazily by the page (only after the user opens a candidate detail card).
// See ./config/candidates-build.js for the heavy lifting.
import { buildCandidates } from "./config/candidates-build.js";

const built = await buildCandidates();

const details = {};
for (const c of built.clusters) {
  details[c.cluster_id] = c.appearances;
}

process.stdout.write(JSON.stringify(details));
