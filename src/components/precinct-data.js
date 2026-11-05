export function precinctStationId(feature) {
  const raw = feature?.properties?.id ?? feature?.properties?.precinct_id;
  return stationKey(raw);
}

function stationKey(value) {
  return value == null ? null : String(value).trim() || null;
}

function precinctKeyPart(value) {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? String(Math.round(n)) : String(value);
}

export function precinctExactKey(feature) {
  const p = feature?.properties ?? {};
  if (p.precinct_key != null && String(p.precinct_key).trim() !== "") return String(p.precinct_key).trim();
  const smd = precinctKeyPart(p.MID ?? p.M_District ?? p.smd ?? p.major_id ?? p.maj_id);
  const dd  = precinctKeyPart(p.District ?? p.district ?? p.district_id);
  const pp  = precinctKeyPart(p.Precinct ?? p.precinct ?? p.precinct_number);
  if (smd && dd && pp) return `${smd}.${dd}.${pp}`;
  return precinctStationId(feature);
}

export function precinctResultKey(row) {
  const key = row?.precinct_key;
  if (key != null && String(key).trim() !== "") return String(key).trim();
  return stationKey(row?.precinct_id);
}

export function precinctStationNumber(feature) {
  const p = feature?.properties ?? {};
  const raw = p.precinct ?? p.Precinct ?? p.precinct_number ?? p.id;
  return raw == null ? null : Math.round(Number(raw)) % 1000;
}

export function precinctRawDistrict(feature) {
  const p = feature?.properties ?? {};
  return p.district ?? p.district_id ?? p.District;
}

export function precinctMajorDistrict(feature) {
  const p = feature?.properties ?? {};
  return precinctKeyPart(p.MID ?? p.M_District ?? p.smd ?? p.major_id ?? p.maj_id);
}

/** Index once when a precinct file loads; interactions only read one unit. */
export function indexPrecinctResults(rows, {councilSmd = false} = {}) {
  const byUnit = new Map();
  const turnoutByUnit = new Map();
  const majorByStation = new Map();
  const winnerByUnit = new Map();
  const maxShareByUnit = new Map();
  const partySharesByUnit = new Map();
  const hasTurnout = rows[0]?.registered != null;
  let usesExactKeys = false;
  for (const row of rows) {
    const key = precinctResultKey(row);
    if (key == null) continue;
    if (row.precinct_key != null && String(row.precinct_key).trim() !== "") usesExactKeys = true;
    if (!byUnit.has(key)) byUnit.set(key, []);
    byUnit.get(key).push(row);
    if (hasTurnout && !turnoutByUnit.has(key)) turnoutByUnit.set(key, row);
    if (councilSmd) {
      const station = stationKey(row.precinct_id);
      if (station != null && !majorByStation.has(station)) majorByStation.set(station, String(row.district_id));
    }
    if (!winnerByUnit.has(key) || row.vote_share > winnerByUnit.get(key).vote_share) winnerByUnit.set(key, row);
    const share = row.vote_share;
    if (share != null && share >= share && (!maxShareByUnit.has(key) || share > maxShareByUnit.get(key))) {
      maxShareByUnit.set(key, share);
    }
    if (!partySharesByUnit.has(key)) partySharesByUnit.set(key, new Map());
    const shares = partySharesByUnit.get(key);
    shares.set(row.party_id, (shares.get(row.party_id) ?? 0) + (Number(share) || 0));
  }
  return {byUnit, turnoutByUnit, majorByStation, winnerByUnit, maxShareByUnit, partySharesByUnit, usesExactKeys};
}
