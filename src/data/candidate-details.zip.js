import JSZip from "jszip";
import {basename} from "node:path";
import {buildCandidates} from "./config/candidates-build.js";
import {candidateDetailPath, candidateDetailPaths} from "../components/candidate-detail-paths.js";

const {clusters} = await buildCandidates();
const shards = new Map(candidateDetailPaths.map(path => [path, Object.create(null)]));
for (const cluster of clusters) {
  shards.get(candidateDetailPath(cluster.cluster_id))[cluster.cluster_id] = cluster.appearances;
}
const zip = new JSZip();
for (const [path, details] of shards) {
  zip.file(basename(path), JSON.stringify(details), {date: new Date("1980-01-01T00:00:00Z")});
}
process.stdout.write(await zip.generateAsync({type: "nodebuffer", compression: "DEFLATE"}));
