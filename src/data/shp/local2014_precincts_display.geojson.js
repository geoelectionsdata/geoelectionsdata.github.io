import {writePrecinctDisplay} from "../config/precinct-display.js";

writePrecinctDisplay(new URL("./local2014_precincts.geojson", import.meta.url));
