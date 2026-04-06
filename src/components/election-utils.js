// ── D'Hondt seat allocation ────────────────────────────────────────────────
export function dhondtSeats(votesMap, totalSeats) {
  if (!totalSeats || votesMap.size === 0) return new Map();
  const qs = [];
  for (const [id, votes] of votesMap) {
    for (let s = 1; s <= totalSeats; s++) qs.push({id, q: votes / s});
  }
  qs.sort((a, b) => b.q - a.q);
  const seats = new Map();
  for (const {id} of qs.slice(0, totalSeats)) seats.set(id, (seats.get(id) ?? 0) + 1);
  return seats;
}

// ── Party lookup factory ───────────────────────────────────────────────────
// Returns getParty and partyColor bound to the current election and parties list.
// Call once per reactive election change: const { getParty, partyColor } = makePartyLookup(electionVal, parties);
export function makePartyLookup(electionVal, parties) {
  function getParty(partyId) {
    // For presidential elections, candidates are defined on the election itself
    const candidate = electionVal?.candidates?.find(c => c.id === partyId);
    if (candidate) {
      const partyRef = candidate.party ? parties.find(p => p.id === candidate.party) : null;
      const color = candidate.color ?? partyRef?.color ?? partyRef?.colors?.default ?? "#9E9E9E";
      return {id: partyId, name: candidate.name, color, colors: {default: color}};
    }
    const base = parties.find(p => p.id === partyId) ?? {
      id: partyId, name: {en: partyId, ka: partyId}, color: "#9E9E9E"
    };
    // Apply election-specific alias and color override from election YAML
    const elecParty = electionVal?.parties?.find(p => p.id === partyId);
    if (elecParty?.alias || elecParty?.color) {
      return {
        ...base,
        name:  elecParty.alias ?? base.name,
        color: elecParty.color ?? base.color ?? base.colors?.default
      };
    }
    return base;
  }

  function partyColor(partyId, elecId) {
    const p = getParty(partyId);
    // Support both new single-field (color) and legacy per-election dict (colors)
    return p.color ?? p.colors?.[elecId] ?? p.colors?.default ?? "#9E9E9E";
  }

  return { getParty, partyColor };
}

// ── Turnout helpers ────────────────────────────────────────────────────────
// Returns the raw fraction for a given turnout metric from a data row.
export function turnoutValue(td, metric) {
  if (!td) return 0;
  if (metric === "noon")    return td.noon_pct    ?? (td.voted_noon != null && td.registered > 0 ? td.voted_noon / td.registered : 0);
  if (metric === "5pm")     return td.five_pct    ?? (td.voted_5pm  != null && td.registered > 0 ? td.voted_5pm  / td.registered : 0);
  // For invalid: prefer pre-computed pct, fall back to computing from raw counts
  if (metric === "invalid") return td.invalid_pct ?? (td.invalid_ballots != null && td.voted > 0 ? td.invalid_ballots / td.voted : 0);
  return td.turnout_pct ?? 0;  // "final" default
}

// Normalizes turnoutValue to [0,1] relative to the expected max for the metric.
// invalidMax must be passed explicitly (computed dynamically from district data in elections.md).
export function turnoutNorm(td, metric, invalidMax) {
  const v = turnoutValue(td, metric);
  const max = metric === "invalid" ? invalidMax
            : metric === "noon"    ? 0.30
            : metric === "5pm"     ? 0.60
            : 1.0;
  return Math.min(1, v / max);
}

// ── Seat helpers ──────────────────────────────────────────────────────────
export function seatsFor(d, filter) {
  if (filter === "pr")    return d.seats_pr    ?? 0;
  if (filter === "smd")   return d.seats_smd   ?? 0;
  if (filter === "mayor") return d.seats_mayor ?? 0;
  return (d.seats_pr ?? 0) + (d.seats_smd ?? 0) + (d.seats_comp ?? 0);
}

export function partiesForFilter(parties, filter, elec) {
  return parties.filter(d => seatsFor(d, filter) > 0);
}
