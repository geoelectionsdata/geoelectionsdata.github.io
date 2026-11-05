# Dashboard data contract

## Scope

The first pilot is `pres_2013`. Its existing CSVs, GeoJSON, YAML paths and
download sheets are the compatibility baseline. This specification does not
change those files. Other elections remain on their current formats until
explicitly migrated. Declare a contract version and asset roles in election
configuration when the pilot starts consuming normalized output.

## Shared rules

- CSV files use UTF-8 and a header row. IDs are opaque strings: preserve leading
  zeros and punctuation. Empty, literal `NA`, and literal `null` are not IDs.
- Scope units to a geometry set and a level. A precinct can have electoral
  district, self-government and SMD parents; ingest supplies those links
  explicitly. Do not reconstruct them from a universal numeric formula.
- Scope a ballot subject to election, sub-election, ballot and contest.
  `subject_id` identifies the choice on the ballot. `party_id` is optional
  affiliation; it is not a candidate identity. Ballot numbers are contest-local.
- Counts are nonnegative integers. Ratios are fractions, not percentages.
  An empty measure means unavailable; zero means known zero. Missing
  denominators produce empty ratios in normalized data. Preserve original
  published values separately when their interpretation differs.
- Retain source references and distinguish reported, derived and corrected
  values. A reproducible correction belongs in a versioned input, not in an
  untracked hand edit to generated data. Curated rosters must be declared
  before any regeneration replaces them.

| Asset role | Row grain | Contract |
|---|---|---|
| Geography | Geometry set + level + unit ID | Unique feature ID, bilingual names when available, explicit parent IDs. Geometry absence is tracked separately from missing results. |
| Results | Contest + level + unit + subject | Votes, valid-vote denominator and share. Keep reported totals separately from sums of available records. |
| Turnout | Contest + level + unit | Registered, voted, invalid, and available snapshots. Final and snapshot turnout divide by registered; invalid share divides by voted unless the source specifies another denominator. |
| Candidates | Contest + subject or list position | Candidate identity distinct from affiliation, roster labels, ballot number or list position, and elected status when known. |
| Seats | Election + sub-election + unit + subject + category | Seat count with provenance for reported versus computed allocation. |

## 2013 compatibility baseline

The YAML `pr` slot is a routing label for the presidential ballot, not a
proportional contest. The legacy results field `party_id` points to the
election's candidate IDs and is the input for `subject_id`, not affiliation.
Precinct results and turnout join to `properties.id` in
`pres2013_precinct.geojson`; district assets join to `properties.id` in
`parl2024_pr.geojson`. `national` is a separate aggregation level encoded
in the district files, never a shape ID or a district to sum again.

The current R loader sums the main and special lists for registered voters,
uses a positive reported valid-ballot count as the vote-share denominator,
and otherwise uses the sum of candidate votes. It rounds ratios to six places
and currently encodes a zero-denominator ratio as zero. Preserve that behavior
in the compatibility view. Do not replace the reported denominator to force
shares to sum to one: the source mixes preliminary and final data. National and
district rows are derived by the existing loader; keep their values stable.

For this baseline, missing geometry, turnout ratios above one and incomplete
vote-share sums are diagnostics. Duplicate result or turnout keys, invalid
IDs, unknown ballot subjects, missing turnout joins, inconsistent repeated
turnout fields, and malformed numeric values are errors.

Run `node scripts/validate-pres2013-data.js` for a read-only baseline check.
The pilot must compare the normalized adapter output with these four files
and check the affected map and workbook before changing any public asset path.

## Run the normalized pilot

```sh
Rscript src/loaders/process_pres2013.R --pilot tmp/pres2013-pilot
node scripts/check-pres2013-pilot.js tmp/pres2013-pilot
```

Use a new output directory. Pilot mode writes only `results.csv` and
`turnout.csv` there; it does not change the current dashboard files. Both
tables carry the same contest and unit key. Results carry `subject_id` and
the exact valid-vote denominator used by R, while turnout and unit details
appear once per unit. The checker joins them and compares every field in the
four legacy views, including row order and the legacy zero for undefined ratios.

The default R run now generates those same legacy views from the normalized
tables in memory. The map and workbook both read the resulting CSVs through
their existing YAML paths. Normalized pilot files are not shipped to the
browser, and the default run does not write a second copy of the data.

## Shared loader checks

The migrated R loaders validate ballot-subject uniqueness, turnout-unit
uniqueness, and turnout coverage before joining results. A unit key can
include a contest ID or a source-row identifier when the public precinct
code alone is not unique. Candidate ballots may need a composite subject
key. Each loader still owns its source denominator, turnout definitions,
and compatibility column order; the shared join does not infer any of
those rules.

Run `Rscript scripts/test-ballot-results.R` for the shared join checks.
CI copies the common R helpers into its scratch tree, regenerates data
there, and compares the outputs before building from the checkout.

## Asset roles and 2016 precincts

The registry uses YAML fields to determine asset roles: `precinct_shape_file`
declares precinct geometry, `*_precinct_results` declares precinct results,
and turnout uses `file` and `precinct_file` in its block. Paths remain
relative to `src`. A declared CSV or GeoJSON that is missing fails the build
with election and field context. Use null or omit the field for an intentionally
unavailable asset. The public manifests still contain paths only.

For parliamentary 2016, `precinct_key` is the source tuple `MID.district.precinct`.
The legacy geometry `id` is not unique and must not be used as the results
join key. Keep reporting units without polygons in the results and downloads;
the map renders only the exact keys present in both inputs.
