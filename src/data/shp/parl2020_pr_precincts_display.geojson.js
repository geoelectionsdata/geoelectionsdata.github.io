import {writePrecinctDisplay} from "../config/precinct-display.js";

writePrecinctDisplay(new URL("./parl2020_pr_precincts.geojson", import.meta.url));
