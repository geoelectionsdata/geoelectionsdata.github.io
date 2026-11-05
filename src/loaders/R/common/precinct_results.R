validate_ballot_keys <- function(votes, turnout, subject_col, unit_col) {
  subject_key <- c(unit_col, subject_col)
  if (anyDuplicated(turnout[unit_col])) stop("Duplicate turnout unit")
  if (anyDuplicated(votes[subject_key])) stop("Duplicate ballot subject in unit")
  if (nrow(dplyr::anti_join(votes, turnout, by = unit_col))) {
    stop("Ballot result without turnout")
  }
  invisible(NULL)
}

join_ballot_turnout <- function(votes, turnout, subject_col, unit_col) {
  validate_ballot_keys(votes, turnout, subject_col, unit_col)
  dplyr::left_join(votes, turnout, by = unit_col, relationship = "many-to-one")
}

# Keep the source denominator in the legacy view.
join_ballot_results <- function(votes, turnout, subject_col, safe_ratio, unit_col = "precinct_id") {
  measures <- c(
    unit_col, "totalVotes", "registered", "voted", "voted_noon", "voted_5pm",
    "turnout_pct", "noon_pct", "five_pct", "invalid_ballots", "invalid_pct"
  )
  measures <- c(measures, intersect(c("main_list", "special_list"), names(turnout)))
  joined <- join_ballot_turnout(votes, turnout[measures], subject_col, unit_col)
  joined$vote_share <- safe_ratio(joined$votes, joined$totalVotes)
  joined
}

join_precinct_results <- join_ballot_results

join_aggregated_party_results <- function(votes, turnout, unit_col, ratio, subject_cols = "party_id") {
  denominators <- votes |>
    dplyr::group_by(dplyr::across(dplyr::all_of(unit_col))) |>
    dplyr::summarise(totalVotes = sum(votes, na.rm = TRUE), .groups = "drop")
  turnout <- dplyr::left_join(turnout, denominators, by = unit_col, relationship = "one-to-one")
  join_ballot_results(votes, turnout, subject_cols, ratio, unit_col)
}

local_precinct_results <- function(rows, parent = "district", positive_only = FALSE) {
  unit <- c("precinct_id", parent)
  counts <- c("registered", "voted", "voted_noon", "voted_5pm", "invalid_ballots")
  votes <- rows |>
    dplyr::group_by(dplyr::across(dplyr::all_of(c(unit, "party_id")))) |>
    dplyr::summarise(votes = sum(votes, na.rm = TRUE), .groups = "drop")
  if (positive_only) votes <- dplyr::filter(votes, votes > 0)

  # Council SMD denominators are contest-specific; PR and mayor use precinct totals.
  denominator_key <- if (parent == "major_id") unit else "precinct_id"
  denominators <- votes |>
    dplyr::group_by(dplyr::across(dplyr::all_of(denominator_key))) |>
    dplyr::summarise(totalVotes = sum(votes), .groups = "drop")
  turnout <- rows |>
    dplyr::group_by(dplyr::across(dplyr::all_of(unit))) |>
    dplyr::summarise(dplyr::across(dplyr::all_of(counts), dplyr::first), .groups = "drop") |>
    dplyr::left_join(denominators, by = denominator_key, relationship = "many-to-one") |>
    dplyr::mutate(
      turnout_pct = round(voted / registered, 6),
      noon_pct = round(voted_noon / registered, 6),
      five_pct = round(voted_5pm / registered, 6),
      invalid_pct = round(invalid_ballots / voted, 6)
    )

  out <- join_precinct_results(votes, turnout, "party_id", function(votes, total) round(votes / total, 6), unit) |>
    dplyr::select(dplyr::all_of(unit), party_id, votes, vote_share,
                  registered, voted, voted_noon, voted_5pm,
                  turnout_pct, noon_pct, five_pct, invalid_ballots, invalid_pct)
  if (parent == "district") out <- dplyr::rename(out, district_id = district)
  if (parent == "major_id") out <- dplyr::rename(out, district_id = major_id)
  out
}
