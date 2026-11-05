import {writePrecinctDisplay} from "../config/precinct-display.js";

writePrecinctDisplay(new URL("./adj2008_pr_precincts.geojson", import.meta.url));
