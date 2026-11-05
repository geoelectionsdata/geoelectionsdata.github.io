const districtProfile = {weight: 0.5, fillOpacity: 0.85, emptyOpacity: 0.75, emptyStroke: "#bbb"};
const detailedProfile = {fillOpacity: 0.9, emptyOpacity: 0.6, emptyStroke: "#ccc"};

/** Polygon styles shared by district, council, selfgov and precinct layers. */
export function createPolygonStyles({interpolateRgb, isColor, partyColor, turnoutIntensity}) {
  const turnoutRamp = interpolateRgb("#fee2e2", "#b91c1c");

  function polygon(fillColor, profile) {
    return fillColor == null
      ? {fillColor: "#e0e0e0", fillOpacity: profile.emptyOpacity, color: profile.emptyStroke, weight: profile.weight}
      : {fillColor, fillOpacity: profile.fillOpacity, color: "#ffffff", weight: profile.weight};
  }

  function styleFor(profile) {
    return {
      turnout(row) {
        return polygon(row ? turnoutRamp(turnoutIntensity(row)) : null, profile);
      },
      result(winner, share) {
        if (!winner) return polygon(null, profile);
        const color = partyColor(winner.party_id);
        const fill = isColor(color) ? interpolateRgb("#f5f5f5", color)(0.4 + (share ?? 0.5) * 0.6) : "#ccc";
        return polygon(fill, profile);
      }
    };
  }

  return {district: styleFor(districtProfile), detailed: weight => styleFor({...detailedProfile, weight})};
}
