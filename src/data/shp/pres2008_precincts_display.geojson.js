import {writePrecinctDisplay} from "../config/precinct-display.js";

writePrecinctDisplay(new URL("./pres2008_precincts.geojson", import.meta.url));
