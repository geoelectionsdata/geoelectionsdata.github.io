import {writePrecinctDisplay} from "../config/precinct-display.js";

writePrecinctDisplay(new URL("./local2010_precincts.geojson", import.meta.url));
