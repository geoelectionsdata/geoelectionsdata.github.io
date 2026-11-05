import {readFileSync} from "node:fs";

function roundCoordinates(value) {
  return Array.isArray(value)
    ? value.map(roundCoordinates)
    : typeof value === "number" ? Number(value.toFixed(8)) : value;
}

/** Round map coordinates without removing vertices or changing properties. */
export function writePrecinctDisplay(source) {
  const shape = JSON.parse(readFileSync(source, "utf8"));
  for (const {geometry} of shape.features) {
    if (!geometry || !["Polygon", "MultiPolygon"].includes(geometry.type)) {
      throw new Error(`Expected polygon geometry in ${source}`);
    }
    geometry.coordinates = roundCoordinates(geometry.coordinates);
  }
  process.stdout.write(JSON.stringify(shape));
}
