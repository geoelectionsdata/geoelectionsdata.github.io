import assert from "node:assert/strict";
import {createMapSelection} from "../src/components/map-selection.js";

const selectedClass = "geda-selected";
const classes = [new Set(), new Set()];
const elements = classes.map(set => ({classList: {
  add: name => set.add(name),
  remove: name => set.delete(name)
}}));
const changes = [];
const events = [];
const selection = createMapSelection({
  container: {querySelectorAll: () => elements.filter((_, i) => classes[i].has(selectedClass))},
  level: "precinct",
  id: "38.28.42",
  onChange: change => changes.push(change)
});
assert.equal(selection.apply(selection.level, selection.id, {updateUrl: false}), false);
assert.equal(changes.length, 0);
selection.register("precinct", "38.28.42", () => events.push("precinct"), {
  getElement: () => elements[0],
  bringToFront: () => events.push("highlight")
});
selection.register("district", 28, () => events.push("district"), {getElement: () => elements[1]});
assert.equal(selection.apply(selection.level, selection.id, {updateUrl: false}), true);
assert.deepEqual(changes[0], {level: "precinct", id: "38.28.42", updateUrl: false});
assert.deepEqual(events, ["precinct", "highlight"]);
assert.equal(classes[0].has(selectedClass), true);

assert.equal(selection.apply("district", "28"), true);
assert.deepEqual(changes[1], {level: "district", id: "28", updateUrl: true});
assert.equal(classes[0].has(selectedClass), false);
assert.equal(classes[1].has(selectedClass), true);
selection.clear();
assert.deepEqual(changes[2], {level: null, id: null, updateUrl: true});
assert.equal(classes[1].has(selectedClass), false);
assert.equal(selection.id, null);
console.log("Map selection, restoration, highlighting and clear checks passed.");
