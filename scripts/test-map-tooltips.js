import assert from "node:assert/strict";
import {createMapHover, createMapTooltips} from "../src/components/map-tooltips.js";

let party = null;
let metric = "noon";
const tooltips = createMapTooltips({
  lang: "en",
  t: () => "",
  getParty: id => ({name: {en: id, ka: id}}),
  partyColor: () => "#123456",
  activePartyId: () => party,
  getTurnoutMetric: () => metric
});
const rows = [
  {party_id: "runner-up", votes: 9, vote_share: 0.1},
  {party_id: "winner", name_en: "A & B", votes: 1234, vote_share: 0.9}
];
const result = tooltips.buildResultTooltipFromRows("<Precinct>", rows);
assert.match(result, /&lt;Precinct&gt;/);
assert.match(result, /A &amp; B/);
assert.match(result, /1,234/);
assert.match(result, /90\.0%/);
party = "absent";
const filtered = tooltips.buildResultTooltipFromRows("Precinct", rows);
assert.match(filtered, /absent/);
assert.match(filtered, /0\.0%/);

const turnout = {registered: 2000, voted_noon: 1234, voted: 1500, invalid_ballots: 30};
tooltips.setLang("ka", key => key.endsWith(".count") ? "Localized count" : "");
const noon = tooltips.buildTurnoutTooltip("Precinct", turnout);
assert.match(noon, /Localized count/);
assert.match(noon, /1 234/);
assert.match(noon, /61\.7%/);
metric = "invalid";
assert.match(tooltips.buildTurnoutTooltip("Precinct", turnout), /2\.0%/);
console.log("Tooltip winner, filter, escaping, language and turnout checks passed.");

const hover = createMapHover();
function target(...initialClasses) {
  const classes = new Set(initialClasses);
  const classList = {add: name => classes.add(name), remove: name => classes.delete(name)};
  const element = {classList};
  return {
    classes,
    closed: 0,
    getElement: () => element,
    closeTooltip() { this.closed++; hover.leave(this); }
  };
}
const first = target("geda-selected");
const second = target();
hover.enter(first);
hover.enter(first);
hover.enter(second); // First never emits mouseout.
assert.deepEqual([...first.classes], ["geda-selected"]);
assert.equal(first.closed, 1);
hover.leave(first); // Late mouseout must not clear the new target.
assert.equal(second.classes.has("geda-hovered"), true);
hover.clear(); // Map move, click, or leave.
assert.equal(second.classes.size, 0);
assert.equal(second.closed, 1);
console.log("Single hover target and selection isolation checks passed.");
