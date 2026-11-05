import {writePrecinctDisplay} from "../config/precinct-display.js";

writePrecinctDisplay(new URL("./pres2013_precinct.geojson", import.meta.url));
