import {fetchJSONAsset, fetchTextAsset} from "./election-utils.js";

/** Load a manifest and its assets on demand, sharing pending reads. */
export function makeManifestLoader(registryUrl, {
  read = fetchJSONAsset,
  missing = () => null,
  maxEntries = Infinity
} = {}) {
  let manifest;
  const assets = new Map();
  return async function load(path) {
    if (!path || !registryUrl) return missing();
    manifest ??= fetchJSONAsset(registryUrl).catch(error => {
      manifest = undefined;
      throw error;
    });
    const assetPath = (await manifest)[path];
    if (!assetPath) return missing();

    let pending = assets.get(assetPath);
    if (pending) {
      assets.delete(assetPath);
    } else {
      pending = Promise.resolve().then(() => read(assetPath)).catch(error => {
        if (assets.get(assetPath) === pending) assets.delete(assetPath);
        throw error;
      });
    }
    assets.set(assetPath, pending);
    if (assets.size > maxEntries) assets.delete(assets.keys().next().value);
    return pending;
  };
}

export function makeCsvManifestLoader(registryUrl, parse, maxEntries) {
  return makeManifestLoader(registryUrl, {
    read: path => fetchTextAsset(path).then(parse),
    missing: () => [],
    maxEntries
  });
}
