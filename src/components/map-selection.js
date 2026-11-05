const keyFor = (level, id) => `${level ?? ""}:${String(id ?? "")}`;

/** Manage registered selection targets without depending on Leaflet. */
export function createMapSelection({container, level = null, id = null, onChange}) {
  const targets = new Map();

  function update(nextLevel, nextId, updateUrl) {
    level = nextLevel || null;
    id = nextId == null ? null : String(nextId);
    onChange?.({level, id, updateUrl});

    container.querySelectorAll(".geda-selected").forEach(el => el.classList.remove("geda-selected"));
    const layer = level && id ? targets.get(keyFor(level, id))?.layer : null;
    const element = layer?.getElement?.();
    if (element?.classList) {
      element.classList.add("geda-selected");
      layer.bringToFront?.();
    }
  }

  return {
    get level() { return level; },
    get id() { return id; },
    register(level, id, handler, layer) {
      if (!level || id == null || typeof handler !== "function") return;
      const key = keyFor(level, id);
      targets.set(key, {handler, layer: layer ?? targets.get(key)?.layer});
    },
    apply(level, id, {updateUrl = true} = {}) {
      const target = targets.get(keyFor(level, id));
      if (!target) return false;
      target.handler();
      update(level, id, updateUrl);
      return true;
    },
    clear({updateUrl = true} = {}) {
      update(null, null, updateUrl);
    }
  };
}
