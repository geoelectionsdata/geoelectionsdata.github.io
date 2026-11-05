import assert from "node:assert/strict";
import {execFileSync} from "node:child_process";
import {readFileSync} from "node:fs";
import {gzipSync} from "node:zlib";
import {precinctExactKey} from "../src/components/precinct-data.js";
import {collectExistingPaths} from "../src/data/config/registry-utils.js";

for (const asset of collectExistingPaths("precinct-geometry").filter(path => path.endsWith("_display.geojson"))) {
  checkDisplay(`src/${asset.slice(0, -"_display.geojson".length)}`);
}

function checkDisplay(path) {
  const source = readFileSync(`${path}.geojson`);
  const display = execFileSync(process.execPath, [`${path}_display.geojson.js`], {maxBuffer: 32 * 1024 * 1024});
  const original = JSON.parse(source);
  const compact = JSON.parse(display);
  assert.equal(compact.features.length, original.features.length);
  const rings = geometry => geometry.type === "Polygon" ? geometry.coordinates : geometry.coordinates.flat();
  let maxDelta = 0;
  let vertices = 0;
  for (const [i, feature] of original.features.entries()) {
    const output = compact.features[i];
    assert.deepEqual(output.properties, feature.properties);
    assert.equal(precinctExactKey(output), precinctExactKey(feature));
    assert.equal(output.geometry.type, feature.geometry.type);
    const before = rings(feature.geometry), after = rings(output.geometry);
    assert.equal(before.length, after.length);
    for (const [j, ring] of before.entries()) {
      const rounded = after[j];
      assert.equal(rounded.length, ring.length);
      assert.deepEqual(rounded[0], rounded.at(-1));
      assert.equal(new Set(rounded.map(p => p.join(","))).size, new Set(ring.map(p => p.join(","))).size);
      for (const [k, point] of ring.entries()) {
        maxDelta = Math.max(maxDelta, Math.hypot(...point.map((n, axis) => rounded[k][axis] - n)));
        vertices++;
      }
    }
  }
  assert.ok(maxDelta <= Math.SQRT2 * 0.000000005001);
  console.log(JSON.stringify({
    path, features: original.features.length, vertices, maxDeltaDegrees: maxDelta,
    sourceBytes: source.length, displayBytes: display.length,
    sourceGzipBytes: gzipSync(source).length, displayGzipBytes: gzipSync(display).length
  }));
}
