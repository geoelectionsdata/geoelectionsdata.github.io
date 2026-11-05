import {rmSync, statSync} from "node:fs";
import {join} from "node:path";
import {collectExistingPaths, SRC} from "../src/data/config/registry-utils.js";

const cache = join(SRC, ".observablehq", "cache");
const paths = collectExistingPaths("precinct-geometry");

// Observable tracks the loader file, not the YAML and data files it reads.
for (const name of ["elections", "index-featured", "csv-registry", "geo-registry", "turnout-registry", "precinct-csv-registry", "precinct-geo-registry"]) {
  rmSync(join(cache, "data", name + ".json"), {force: true});
}

for (const path of paths.filter(path => path.endsWith("_display.geojson"))) {
  const cached = join(cache, path);
  const cachedMtime = statSync(cached, {throwIfNoEntry: false})?.mtimeMs;
  if (cachedMtime === undefined) continue;
  const inputs = [path.replace(/_display\.geojson$/, ".geojson"), path + ".js", "data/config/precinct-display.js"];
  if (inputs.some(input => statSync(join(SRC, input)).mtimeMs > cachedMtime)) {
    rmSync(cached);
  }
}
