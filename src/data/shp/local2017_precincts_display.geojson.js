import {writePrecinctDisplay} from "../config/precinct-display.js";

writePrecinctDisplay(new URL("./local2017_precincts.geojson", import.meta.url));
