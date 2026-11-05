source("src/loaders/R/common/precinct_results.R")

turnout <- data.frame(
  precinct_id = c("001", "001"), major_id = c("02", "03"),
  registered = c(20, 40), voted = c(10, 20), voted_noon = 2,
  voted_5pm = 8, turnout_pct = .5, noon_pct = .1, five_pct = .4,
  invalid_ballots = 0, invalid_pct = 0
)
votes <- data.frame(
  precinct_id = "001", major_id = c("02", "02", "03"),
  party_id = "initiative_group", party_num = c("11", "12", "11"),
  votes = c(3, 7, 4)
)
unit <- c("precinct_id", "major_id")
subject <- c("party_id", "party_num")
joined <- join_aggregated_party_results(votes, turnout, unit, `/`, subject)
stopifnot(
  identical(joined$precinct_id, votes$precinct_id),
  identical(joined$vote_share, c(.3, .7, 1)),
  identical(joined$registered, c(20, 20, 40))
)

expect_error <- function(expr, message) {
  error <- tryCatch({ force(expr); NULL }, error = identity)
  stopifnot(inherits(error, "error"), grepl(message, conditionMessage(error), fixed = TRUE))
}
expect_error(join_ballot_turnout(votes, turnout[c(1, 1, 2), ], subject, unit), "Duplicate turnout unit")
expect_error(join_ballot_turnout(votes[c(1, 1, 2, 3), ], turnout, subject, unit), "Duplicate ballot subject")
expect_error(join_ballot_turnout(votes, turnout[1, ], subject, unit), "Ballot result without turnout")
message("Shared ballot join checks passed.")
