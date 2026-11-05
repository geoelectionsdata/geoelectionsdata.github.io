const shardCount = 64;
const shardName = index => index.toString(16).padStart(2, "0") + ".json";
const directory = "data/candidate-details";

export const candidateDetailPaths = Array.from({length: shardCount}, (_, index) => `${directory}/${shardName(index)}`);

/** Map an opaque candidate ID to the same detail asset in the build and browser. */
export function candidateDetailPath(id) {
  let hash = 2166136261;
  for (let i = 0; i < id.length; i++) hash = Math.imul(hash ^ id.charCodeAt(i), 16777619);
  return candidateDetailPaths[(hash >>> 0) % shardCount];
}
