import L from "npm:leaflet";
import {FULLSCREEN_ENTER_SVG, FULLSCREEN_EXIT_SVG, PANEL_MINIMIZE_SVG, PANEL_EXPAND_SVG} from "./icons.js";

const _fullscreenState = {active: false};

export function addFullscreenControl({map, mapContainer, t}) {
  // ── Fullscreen toggle ──────────────────────────────────────────────────
  // Pops the map's parent wrapper (.elections-main) into the browser's
  // fullscreen API — fullscreening the WRAPPER, not just mapContainer, so
  // the right-side results panel (a sibling of the map card) stays visible
  // and CSS (.elections-main:fullscreen > .results-panel) positions it as
  // an overlay in the top-right corner. Listens for `fullscreenchange` so
  // pressing Escape flips the icon back. Calls `map.invalidateSize()` after
  // each transition so Leaflet recomputes tile layout for the new viewport.
  const FullscreenControl = L.Control.extend({
    onAdd() {
      const control = this;
      const container = L.DomUtil.create("div", "leaflet-bar leaflet-control");
      const btn = L.DomUtil.create("a", "", container);
      btn.href = "#";
      btn.setAttribute("role", "button");
      btn.style.cssText = "display:flex;align-items:center;justify-content:center;width:26px;height:26px;color:#444;text-decoration:none;";
      let panelObserver = null;
      let panelObserverTarget = null;
      let panelObserverFrame = null;
      let zoomBoosted = false;
      let panelCollapsed = false;

      // Fullscreen target: the layout wrapper holding both map + panel.
      // Falls back to mapContainer when the wrapper isn't present.
      const fsTarget = () => mapContainer.closest(".elections-main") || document.querySelector(".elections-main") || mapContainer;
      const _fsEl = () => document.fullscreenElement || document.webkitFullscreenElement || null;
      const _isMapFs = () => {
        const target = fsTarget();
        const fsEl = _fsEl();
        return !!fsEl && (fsEl === target || target.contains(fsEl) || fsEl.contains(target));
      };
      const rememberStyle = el => {
        if (!el || el.dataset.mapFsStyle != null) return;
        el.dataset.mapFsStyle = el.getAttribute("style") ?? "";
      };
      const restoreStyle = el => {
        if (!el || el.dataset.mapFsStyle == null) return;
        const previous = el.dataset.mapFsStyle;
        if (previous) el.setAttribute("style", previous);
        else el.removeAttribute("style");
        delete el.dataset.mapFsStyle;
      };
      const setImportant = (el, prop, value) => el?.style?.setProperty(prop, value, "important");
      function scheduleFullscreenLayout() {
        if (panelObserverFrame != null) return;
        panelObserverFrame = requestAnimationFrame(() => {
          panelObserverFrame = null;
          if (_fullscreenState.active || _isMapFs()) applyFullscreenLayout(true);
        });
      }
      function watchFullscreenPanel(active) {
        if (!active) {
          if (panelObserver) panelObserver.disconnect();
          panelObserver = null;
          panelObserverTarget = null;
          if (panelObserverFrame != null) {
            cancelAnimationFrame(panelObserverFrame);
            panelObserverFrame = null;
          }
          return;
        }
        if (typeof MutationObserver === "undefined") return;
        const target = fsTarget();
        if (panelObserver && panelObserverTarget === target) return;
        if (panelObserver) panelObserver.disconnect();
        panelObserver = new MutationObserver(scheduleFullscreenLayout);
        panelObserver.observe(target, {childList: true});
        panelObserverTarget = target;
        control._panelObserver = panelObserver;
      }
      function decorateFullscreenPanel(panel, active) {
        if (!panel) return;
        panel.classList.toggle("results-panel-fullscreen", active);
        panel.classList.toggle("results-panel-collapsed", active && panelCollapsed);

        let toggle = panel.querySelector(":scope > .results-panel-toggle");
        if (!active) {
          if (toggle) toggle.remove();
          panel.classList.remove("results-panel-fullscreen", "results-panel-collapsed");
          return;
        }

        if (!toggle) {
          toggle = document.createElement("button");
          toggle.type = "button";
          toggle.className = "results-panel-toggle";
          toggle.addEventListener("click", e => {
            e.preventDefault();
            e.stopPropagation();
            panelCollapsed = !panelCollapsed;
            decorateFullscreenPanel(panel, true);
            applyFullscreenLayout(true);
          });
          L.DomEvent.disableClickPropagation(toggle);
          L.DomEvent.disableScrollPropagation(toggle);
          panel.prepend(toggle);
        }

        toggle.innerHTML = panelCollapsed ? PANEL_EXPAND_SVG : PANEL_MINIMIZE_SVG;
        const label = t(panelCollapsed ? "elections.map.expand_infobox" : "elections.map.minimize_infobox");
        toggle.title = label;
        toggle.setAttribute("aria-label", label);
      }
      function zoomForFullscreenEntry() {
        setTimeout(() => {
          if (!zoomBoosted) return;
          map.invalidateSize();
          const nextZoom = Math.min(map.getMaxZoom?.() ?? 19, map.getZoom() + 2);
          map.setZoom(nextZoom, {animate: true});
        }, 180);
      }
      function applyFullscreenLayout(active) {
        const target = fsTarget();
        const mapCard = mapContainer.closest(".card");
        const panel = target.querySelector(".results-panel");
        _fullscreenState.active = active;
        target.classList.toggle("map-fullscreen-active", active);
        watchFullscreenPanel(active);

        if (!active) {
          panelCollapsed = false;
          decorateFullscreenPanel(panel, false);
          [panel, mapContainer, mapCard, target].forEach(restoreStyle);
          return;
        }

        [target, mapCard, mapContainer, panel].forEach(rememberStyle);
        Object.entries({
          display: "block",
          position: "fixed",
          inset: "0",
          width: "100vw",
          height: "100vh",
          margin: "0",
          padding: "0",
          overflow: "hidden"
        }).forEach(([prop, value]) => setImportant(target, prop, value));

        Object.entries({
          position: "relative",
          width: "100vw",
          height: "100vh",
          margin: "0",
          padding: "0",
          overflow: "hidden",
          "border-radius": "0",
          "box-shadow": "none"
        }).forEach(([prop, value]) => setImportant(mapCard, prop, value));

        setImportant(mapContainer, "width", "100%");
        setImportant(mapContainer, "height", "100%");

        if (panel) {
          decorateFullscreenPanel(panel, true);
          Object.entries({
            position: "absolute",
            right: "16px",
            bottom: "16px",
            top: "auto",
            width: panelCollapsed ? "42px" : "340px",
            height: panelCollapsed ? "42px" : "auto",
            "min-height": "0",
            "max-width": "calc(100vw - 32px)",
            "max-height": panelCollapsed ? "42px" : "min(55vh, calc(100vh - 32px))",
            "overflow-y": panelCollapsed ? "hidden" : "auto",
            padding: panelCollapsed ? "6px" : "2.75rem 1.25rem 1.25rem",
            "z-index": "1000"
          }).forEach(([prop, value]) => setImportant(panel, prop, value));
        }
      }

      function syncIcon() {
        const fs = _isMapFs() || _fullscreenState.active;
        applyFullscreenLayout(fs);
        if (fs && !zoomBoosted) {
          zoomBoosted = true;
          zoomForFullscreenEntry();
        }
        btn.innerHTML = fs ? FULLSCREEN_EXIT_SVG : FULLSCREEN_ENTER_SVG;
        const label = t(fs ? "elections.map.exit_fullscreen" : "elections.map.enter_fullscreen");
        btn.title = label;
        btn.setAttribute("aria-label", label);
        // Give Leaflet a moment to settle into the new viewport then redraw tiles
        setTimeout(() => map.invalidateSize(), 120);
      }
      function handleFullscreenChange() {
        if (!_fsEl()) {
          zoomBoosted = false;
          applyFullscreenLayout(false);
        }
        syncIcon();
      }
      function leaveFullscreen() {
        zoomBoosted = false;
        const native = _isMapFs();
        applyFullscreenLayout(false);
        const exit = document.exitFullscreen || document.webkitExitFullscreen;
        if (native && exit) {
          const request = exit.call(document);
          request?.catch?.(syncIcon);
        } else {
          syncIcon();
        }
      }
      syncIcon();
      this._cleanupPanelObserver = () => watchFullscreenPanel(false);

      L.DomEvent.on(btn, "click", e => {
        L.DomEvent.preventDefault(e);
        if (_isMapFs() || _fullscreenState.active) {
          leaveFullscreen();
        } else {
          const target = fsTarget();
          const fn = target.requestFullscreen || target.webkitRequestFullscreen;
          applyFullscreenLayout(true);
          zoomBoosted = true;
          zoomForFullscreenEntry();
          const request = fn?.call(target);
          if (request?.catch) request.catch(() => {
            zoomBoosted = false;
            applyFullscreenLayout(false);
            syncIcon();
          });
          if (!fn) syncIcon();
        }
      });

      this._escapeListener = e => {
        if (e.key === "Escape" && (_fullscreenState.active || _isMapFs())) leaveFullscreen();
      };
      document.addEventListener("keydown", this._escapeListener);

      // Track changes (including Escape) — keep a ref so onRemove can detach.
      this._fsListener = handleFullscreenChange;
      document.addEventListener("fullscreenchange", this._fsListener);
      document.addEventListener("webkitfullscreenchange", this._fsListener);

      L.DomEvent.disableClickPropagation(container);
      return container;
    },
    onRemove() {
      if (this._cleanupPanelObserver) this._cleanupPanelObserver();
      else if (this._panelObserver) this._panelObserver.disconnect();
      if (this._escapeListener) document.removeEventListener("keydown", this._escapeListener);
      if (this._fsListener) {
        document.removeEventListener("fullscreenchange", this._fsListener);
        document.removeEventListener("webkitfullscreenchange", this._fsListener);
      }
    }
  });
  new FullscreenControl({ position: "topleft" }).addTo(map);
}
