import {maplibreGL} from "npm:@maplibre/maplibre-gl-leaflet@0.1.4";
import {setWorkerUrl} from "npm:maplibre-gl@6.16.0";

// Observable serves the worker as a separate asset under the site's base path.
setWorkerUrl(import.meta.resolve("npm:maplibre-gl@6.16.0/dist/maplibre-gl-worker.mjs"));

const style = "https://tiles.openfreemap.org/styles/positron";
const attribution = '<a href="https://openfreemap.org/">OpenFreeMap</a> &copy; <a href="https://openmaptiles.org/">OpenMapTiles</a> &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

/** Add a fresh background layer to an existing Leaflet map. */
export function addBasemap(map) {
  const layer = maplibreGL({style, attributionControl: false, interactive: false});
  layer.getAttribution = () => attribution;
  return layer.addTo(map);
}
