// Slim search index for the /candidates page. Excludes the per-cluster
// `appearances` arrays — those live in candidates-details.json (fetched
// lazily on the page). See ./config/candidates-build.js for the heavy lifting.
//
// Compact field names (one letter to shrink the payload):
//   c  = cluster_id
//   f  = first_name
//   l  = last_name
//   p  = latest_party_id (most recent)
//   ps = all party_ids the candidate ran for (most-recent first)
//   pl = election-specific party labels not covered by the global registry
//   y  = latest_year
//   a  = appearance summaries: [{e: election_id, v: vote_type}, …]
//   n  = appearance count
//   v  = non-canonical name variants (only when distinct from "first last")
import { buildCandidates } from "./config/candidates-build.js";

const built = await buildCandidates();

const slim = {
  generated_at: built.generated_at,
  elections: built.elections,
  parties: built.parties,
  clusters: built.clusters.map(c => {
    const canonical = `${c.first_name} ${c.last_name}`.trim();
    const variants = (c.name_variants || []).filter(v => v && v !== canonical);
    const obj = {
      c: c.cluster_id,
      f: c.first_name,
      l: c.last_name,
      p: c.latest_party_id,
      ps: c.parties,
      y: c.latest_year,
      a: c.appearances_summary,
      n: c.appearance_count
    };
    if (c.party_labels?.length) {
      obj.pl = c.party_labels.map(p => ({i: p.id, k: p.name_ka, e: p.name_en}));
    }
    if (variants.length) obj.v = variants;
    return obj;
  }),
  stats: {
    election_count: built.elections.length,
    cluster_count: built.clusters.length,
    appearance_count: built.appearance_count
  }
};

process.stdout.write(JSON.stringify(slim));
