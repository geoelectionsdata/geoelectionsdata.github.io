import {writePrecinctDisplay} from "../config/precinct-display.js";

writePrecinctDisplay(new URL("./parl2012_pr_precincts.geojson", import.meta.url));
