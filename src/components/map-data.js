export function geoId(feature) {
  const p = feature?.properties ?? {};
  return String(p.major_id ?? p.maj_id ?? p.MID ?? p.id ?? p.selfgov_id ?? p.self_gov_id);
}

// Returns the full human-readable feature name for panels and tooltips.
// Handles majoritarian GeoJSON (district_name_en + N + major) where name_en/name_ka are absent.
export function getFeatureName(feature, l = "en") {
  const p = feature?.properties ?? {};
  const majorNum = p.major ?? p.majoritarian_district ?? (p.maj_id != null ? Number(p.maj_id) % 100 : null);
  if (l === "ka" && p.name_ka) return p.name_ka;
  if (p.name_en) return p.name_en;
  if (l === "ka" && p.district_name_ka != null && p.major != null) return `${p.district_name_ka} N${p.major}`;
  if (p.district_name_en != null && p.major != null) return `${p.district_name_en} N${p.major}`;
  if (l === "ka" && p.district_name_ka) return p.district_name_ka;
  if (p.district_name_en) return p.district_name_en;
  if (l === "ka" && p.district_ka != null && majorNum != null) return `${p.district_ka} N${majorNum}`;
  if (p.district_en != null && majorNum != null) return `${p.district_en} N${majorNum}`;
  if (l === "ka" && p.district_ka) return p.district_ka;
  if (p.district_en) return p.district_en;
  return null;
}

// Returns just the base district name (without N+major) for precinct title building,
// so precinct titles read "Mtatsminda N{precinct_num}" not "Mtatsminda N1 N{precinct_num}".
export function getDistrictBaseName(feature, l = "en") {
  const p = feature?.properties ?? {};
  if (l === "ka" && p.name_ka) return p.name_ka;
  if (p.name_en) return p.name_en;
  if (l === "ka" && p.district_name_ka) return p.district_name_ka;
  if (p.district_name_en) return p.district_name_en;
  if (l === "ka" && p.district_ka) return p.district_ka;
  if (p.district_en) return p.district_en;
  return null;
}

// ── Helper: build winner/share/turnout lookups from a results array ──
// When turnoutArr is empty, extracts inline turnout from resultsArr if available.
export function buildLookups(resultsArr, turnoutArr) {
  const winnerMap  = new Map();
  const shareMap   = new Map();
  const turnoutMap = new Map();
  const byDistrict = new Map();
  for (const row of resultsArr) {
    const id = String(row.district_id);
    if (!byDistrict.has(id)) byDistrict.set(id, []);
    byDistrict.get(id).push(row);
  }
  for (const [did, rows] of byDistrict) {
    const winner = rows.reduce((a, b) => (b.vote_share > a.vote_share ? b : a));
    winnerMap.set(did, winner);
    let maximum;
    for (const {vote_share: share} of rows) {
      if (share != null && share >= share && (maximum === undefined || share > maximum)) maximum = share;
    }
    shareMap.set(did, maximum);
    // If no separate turnout array, extract inline turnout from the first result row
    if (turnoutArr.length === 0 && rows[0]?.registered != null) {
      const td = {...rows[0]};
      if (td.turnout_pct == null && td.registered > 0) td.turnout_pct = td.voted / td.registered;
      if (td.invalid_pct == null && td.voted > 0 && td.invalid_ballots != null) td.invalid_pct = td.invalid_ballots / td.voted;
      if (td.noon_pct    == null && td.registered > 0 && td.voted_noon != null) td.noon_pct    = td.voted_noon / td.registered;
      if (td.five_pct    == null && td.registered > 0 && td.voted_5pm  != null) td.five_pct    = td.voted_5pm  / td.registered;
      turnoutMap.set(did, td);
    }
  }
  for (const row of turnoutArr) {
    const id = String(row.district_id);
    if (!turnoutMap.has(id)) turnoutMap.set(id, row);
  }
  return {winnerMap, shareMap, turnoutMap};
}

export function addShare(shareMap, areaId, partyId, voteShare) {
  const key = String(areaId);
  if (!shareMap.has(key)) shareMap.set(key, new Map());
  const shares = shareMap.get(key);
  shares.set(partyId, (shares.get(partyId) ?? 0) + (Number(voteShare) || 0));
}
