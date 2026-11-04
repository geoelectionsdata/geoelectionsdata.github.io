import {readdirSync} from "node:fs";
import {join} from "node:path";

function check(directory) {
  const entries = readdirSync(directory, {withFileTypes: true});
  const files = new Set(entries.filter(entry => entry.isFile()).map(entry => entry.name));
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) check(path);
    else if (entry.name.endsWith(".json.js") && files.has(entry.name.slice(0, -3))) {
      console.error(`Static JSON shadows Observable loader: ${path.slice(0, -3)}`);
      process.exitCode = 1;
    }
  }
}

check("src/data");
