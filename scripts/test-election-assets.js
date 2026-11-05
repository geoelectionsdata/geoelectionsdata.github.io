import assert from "node:assert/strict";
import {csvParse, autoType} from "d3-dsv";
import {makeElectionCsvParser} from "../src/components/election-csv.js";
import {makeCsvManifestLoader, makeManifestLoader} from "../src/components/election-assets.js";

const manifestUrl = "/test/manifest.json";
let manifestReads = 0;
globalThis.fetch = async path => {
  assert.equal(path, manifestUrl);
  if (++manifestReads === 1) throw new Error("Temporary manifest failure");
  return new Response(JSON.stringify({a: "/a", alias: "/a", b: "/b", c: "/c"}));
};
const reads = [];
const load = makeManifestLoader(manifestUrl, {
  maxEntries: 2,
  read: async path => {
    reads.push(path);
    if (path === "/c" && reads.filter(p => p === path).length === 1) throw new Error("Temporary asset failure");
    return {path};
  }
});
assert.equal(await load(null), null);
assert.equal(manifestReads, 0);
await assert.rejects(load("a"), /manifest failure/);
const [a, alias] = await Promise.all([load("a"), load("alias")]);
assert.equal(a, alias);
assert.equal(manifestReads, 2);
await load("b");
assert.equal(await load("a"), a);
await assert.rejects(load("c"), /asset failure/);
assert.deepEqual(await load("c"), {path: "/c"});
assert.equal(await load("missing"), null);
await load("b");
assert.deepEqual(reads, ["/a", "/b", "/c", "/c", "/b"]);
assert.deepEqual(await makeCsvManifestLoader(null, () => { throw new Error("Unexpected parse"); })("a"), []);
const parse = makeElectionCsvParser({csvParse, autoType});
const rows = parse("precinct_key,votes,vote_share,name\n001,12,0.25,\"A, B\"\n1.20,0,0,C\n2020-01-01,1,1,D\n,2,,E");
assert.deepEqual(rows.columns, ["precinct_key", "votes", "vote_share", "name"]);
assert.deepEqual(Object.keys(rows[0]), rows.columns);
assert.deepEqual(rows.map(row => row.precinct_key), ["001", "1.20", "2020-01-01", null]);
assert.deepEqual(rows.map(row => row.votes), [12, 0, 1, 2]);
assert.deepEqual(rows.map(row => row.vote_share), [0.25, 0, 1, null]);
assert.equal(rows[0].name, "A, B");
assert.deepEqual(parse("district_id,precinct_id,selfgov_id,major_id,maj_id,electoral_district_id,MID,votes\n012,0012,01,2.10,003,012,990001,7")[0], {
  district_id: "012", precinct_id: "0012", selfgov_id: "01", major_id: "2.10",
  maj_id: "003", electoral_district_id: "012", MID: "990001", votes: 7
});
assert.deepEqual(parse("party_id,votes\n41,7"), csvParse("party_id,votes\n41,7", autoType));
console.log("Lazy manifest, retry, deduplication and eviction checks passed.");
