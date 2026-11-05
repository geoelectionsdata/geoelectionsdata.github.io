const geographicIds = new Set([
  "district_id", "electoral_district_id", "selfgov_id", "major_id", "maj_id",
  "MID", "precinct_id", "precinct_key"
]);

// Preserve geographic identity while retaining legacy typing for other columns.
export function makeElectionCsvParser({csvParse, autoType}) {
  return text => {
    let fields;
    return csvParse(text, (row, _index, columns) => {
      fields ??= columns.filter(field => geographicIds.has(field));
      if (!fields.length) return autoType(row);
      const ids = fields.map(field => {
        const value = row[field];
        row[field] = "";
        return value.trim() === "" ? null : value;
      });
      const typed = autoType(row);
      fields.forEach((field, i) => { typed[field] = ids[i]; });
      return typed;
    });
  };
}
