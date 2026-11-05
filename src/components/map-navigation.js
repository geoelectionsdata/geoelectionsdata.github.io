import L from "npm:leaflet";
import {GEORGIA_OUTLINE_SVG, TBILISI_OUTLINE_SVG, SHARE_ICON_SVG, CHECK_ICON_SVG} from "./icons.js";
import {geoId} from "./map-data.js";
import {councilSelfgovIdFromMajorId} from "./election-utils.js";

export function addMapNavigation({map, t, activeGeo, selfgovGeoData, councilDistrictGeoData, shareUrlForCurrentMap}) {
  // ── Zoom-to-country button (below +/−) ───────────────────────────────────
  function boundsForFeatures(geo, predicate) {
    const features = geo?.features?.filter(predicate) ?? [];
    if (features.length === 0) return null;
    const bounds = L.geoJSON({type: "FeatureCollection", features}).getBounds();
    return bounds.isValid() ? bounds : null;
  }

  function zoomToTbilisi() {
    const selfgovBounds = boundsForFeatures(selfgovGeoData, f => String(f.properties?.id) === "1");
    const districtBounds = boundsForFeatures(activeGeo, f => {
      const id = Number(geoId(f));
      return id >= 1 && id <= 10;
    });
    const councilBounds = boundsForFeatures(councilDistrictGeoData, f =>
      councilSelfgovIdFromMajorId(geoId(f)) === "1"
    );
    const bounds = selfgovBounds ?? districtBounds ?? councilBounds;
    if (bounds) map.fitBounds(bounds.pad(0.08), {maxZoom: 12});
    else map.setView([41.7151, 44.8271], 11);
  }

  const ZoomHomeControl = L.Control.extend({
    onAdd(map) {
      const container = L.DomUtil.create("div", "leaflet-bar leaflet-control");
      const btn = L.DomUtil.create("a", "", container);
      btn.href  = "#";
      const _label = t("elections.map.zoom_georgia");
      btn.title = _label;
      btn.setAttribute("role", "button");
      btn.setAttribute("aria-label", _label);
      btn.style.cssText = "display:flex;align-items:center;justify-content:center;width:26px;height:26px;color:#444;";
      btn.innerHTML = GEORGIA_OUTLINE_SVG;
      L.DomEvent.on(btn, "click", e => {
        L.DomEvent.preventDefault(e);
        map.setView([42.1, 43.0], 7);
      });
      const tbilisiBtn = L.DomUtil.create("a", "", container);
      tbilisiBtn.href = "#";
      const _tbilisiLabel = t("elections.map.zoom_tbilisi");
      tbilisiBtn.title = _tbilisiLabel;
      tbilisiBtn.setAttribute("role", "button");
      tbilisiBtn.setAttribute("aria-label", _tbilisiLabel);
      tbilisiBtn.style.cssText = "display:flex;align-items:center;justify-content:center;width:26px;height:26px;color:#444;text-decoration:none;";
      tbilisiBtn.innerHTML = TBILISI_OUTLINE_SVG;
      L.DomEvent.on(tbilisiBtn, "click", e => {
        L.DomEvent.preventDefault(e);
        zoomToTbilisi();
      });
      L.DomEvent.disableClickPropagation(container);
      return container;
    }
  });
  new ZoomHomeControl({ position: "topleft" }).addTo(map);

  // ── Share button (below Tbilisi zoom button, same gap as between controls) ─
  if (shareUrlForCurrentMap) {
    const ShareControl = L.Control.extend({
      onAdd() {
        const container = L.DomUtil.create("div", "leaflet-bar leaflet-control");
        const btn = L.DomUtil.create("a", "", container);
        btn.href = "#";
        const _label = t("elections.map.share_view");
        btn.title = _label;
        btn.setAttribute("role", "button");
        btn.setAttribute("aria-label", _label);
        btn.style.cssText = "display:flex;align-items:center;justify-content:center;width:26px;height:26px;color:#444;text-decoration:none;";
        btn.innerHTML = SHARE_ICON_SVG;
        L.DomEvent.on(btn, "click", async e => {
          L.DomEvent.preventDefault(e);
          const url = shareUrlForCurrentMap();
          try {
            await navigator.clipboard.writeText(url);
            btn.innerHTML = CHECK_ICON_SVG;
            btn.style.color = "#2d7d46";
            setTimeout(() => { btn.innerHTML = SHARE_ICON_SVG; btn.style.color = "#444"; }, 1200);
          } catch {
            window.prompt(_label, url);
          }
        });
        L.DomEvent.disableClickPropagation(container);
        return container;
      }
    });
    new ShareControl({ position: "topleft" }).addTo(map);
  }
}
