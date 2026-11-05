import assert from "node:assert/strict";
import {createPolygonStyles} from "../src/components/map-styles.js";

let metric = "turnout";
const styles = createPolygonStyles({
  interpolateRgb: (from, to) => value => `${from}:${to}:${value}`,
  isColor: value => value.startsWith("#"),
  partyColor: id => id === "valid" ? "#123456" : "invalid",
  turnoutIntensity: row => row[metric],
});
const detailed = styles.detailed(0.8);
assert.deepEqual(styles.district.result(null), {fillColor: "#e0e0e0", fillOpacity: 0.75, color: "#bbb", weight: 0.5});
assert.deepEqual(detailed.turnout(null), {fillColor: "#e0e0e0", fillOpacity: 0.6, color: "#ccc", weight: 0.8});
assert.deepEqual(detailed.result({party_id: "valid"}, 0), {fillColor: "#f5f5f5:#123456:0.4", fillOpacity: 0.9, color: "#ffffff", weight: 0.8});
assert.equal(styles.district.result({party_id: "invalid"}, 1).fillColor, "#ccc");
const turnout = {turnout: 0.6, invalid: 0.2};
assert.equal(detailed.turnout(turnout).fillColor, "#fee2e2:#b91c1c:0.6");
metric = "invalid";
assert.equal(detailed.turnout(turnout).fillColor, "#fee2e2:#b91c1c:0.2");
console.log("Polygon style profiles and live turnout metric checks passed.");
