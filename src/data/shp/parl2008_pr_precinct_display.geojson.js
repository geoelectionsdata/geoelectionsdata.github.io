import {writePrecinctDisplay} from "../config/precinct-display.js";

writePrecinctDisplay(new URL("./parl2008_pr_precinct.geojson", import.meta.url));
