export function createMapLegend({viewMode, partyColor, interpolateRgb, winnerByDistrict, passed, getLang, translate, getMetric, invalidMax}) {
  return function buildLegendHTML(activePartyId, legendMinVal, legendMaxVal) {
    if (viewMode === "turnout" || activePartyId) {
      const fromColor  = activePartyId ? "#f5f5f5" : "#fee2e2";
      const toColor    = activePartyId ? partyColor(activePartyId) : "#b91c1c";
      const stops      = [0, 0.25, 0.5, 0.75, 1.0];
      const stopColors = stops.map(s => interpolateRgb(fromColor, toColor)(s));
      const gradCss    = `linear-gradient(to right, ${stopColors.join(", ")})`;

      let minLabel, maxLabel;
      if (activePartyId) {
        // Show actual min/max vote-share values for this party across districts
        const minPct = legendMinVal != null ? `${(legendMinVal * 100).toFixed(1)}%` : "0%";
        const maxPct = legendMaxVal != null ? `${(legendMaxVal * 100).toFixed(1)}%` : "—";
        minLabel = minPct;
        maxLabel = maxPct;
      } else {
        // Turnout metric: show 0 and realistic ceiling
        minLabel = "0%";
        maxLabel = getMetric() === "invalid" ? `${(invalidMax * 100).toFixed(0)}%`
                 : getMetric() === "noon"    ? "30%"
                 : getMetric() === "5pm"     ? "60%"
                 : "100%";
      }
      const labels = ["", "", "", "", ""];
      labels[0] = minLabel;
      labels[4] = maxLabel;

      const metricLabel = !activePartyId && viewMode === "turnout"
        ? `<div style="font-size:0.62rem;color:#555;font-weight:600;margin-bottom:3px;">${translate("elections.turnout.metric." + getMetric()) || getMetric()}</div>`
        : "";
      return `<div style="min-width:140px;">${metricLabel}
        <div style="display:flex;justify-content:space-between;font-size:0.65rem;color:#555;margin-bottom:2px;">
          ${labels.map(l => `<span>${l}</span>`).join("")}
        </div>
        <div style="height:10px;border-radius:2px;background:${gradCss};"></div>
      </div>`;
    } else {
      const _mapWinnerIds  = new Set([...winnerByDistrict.values()].map(w => w.party_id));
      const _legendParties = passed.filter(p => _mapWinnerIds.has(p.party_id));
      // Long party names wrap inside the legend's max-width (240px). The dot
      // sticks to the top of the wrapped block so the layout reads like a
      // bulleted list rather than a vertically-centred floating swatch.
      return `<div style="display:flex;flex-direction:column;gap:4px;">
        ${_legendParties.map(p => {
          const name = p.party?.name?.[getLang()] || p.party_id;
          return `<div style="display:flex;align-items:flex-start;gap:5px;">
            <span style="width:9px;height:9px;border-radius:2px;background:${p.color};display:inline-block;flex-shrink:0;margin-top:3px;"></span>
            <span style="font-size:0.65rem;color:#333;line-height:1.3;word-break:break-word;">${name}</span>
          </div>`;
        }).join("")}
      </div>`;
    }
  }
}
