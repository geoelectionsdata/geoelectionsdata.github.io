#!/usr/bin/env Rscript
# src/loaders/process_adj2024.R
#
# Processes raw precinct-level data for the 2024 Adjara Supreme Council election.
# Run from project root:
#   Rscript src/loaders/process_adj2024.R
#
# Optional test output root:
#   Rscript src/loaders/process_adj2024.R tmp/adj2024_r_test

suppressPackageStartupMessages({
  library(readxl)
  library(dplyr)
  library(tidyr)
  library(stringr)
})

args <- commandArgs(trailingOnly = TRUE)
args <- args[args != "--args"]

RAW_DIR <- Sys.getenv("RAW_DIR", unset = "src/data/raw")
OUT_ROOT <- if (length(args) >= 1) args[[1]] else Sys.getenv("OUT_ROOT", unset = "src/data")
OUT_RESULTS <- Sys.getenv("OUT_RESULTS", unset = file.path(OUT_ROOT, "results"))
OUT_TURNOUT <- Sys.getenv("OUT_TURNOUT", unset = file.path(OUT_ROOT, "turnout"))

RAW_FILE <- file.path(RAW_DIR, "adjara_2024_election_results.xlsx")

SUM_COLS <- c(
  "registered", "special", "main", "noon", "fivepm", "voted", "invalid",
  "totalVotes"
)

RATIO_COLS <- c("vote_share", "turnout_pct", "noon_pct", "five_pct", "invalid_pct")

PARTIES <- tibble::tribble(
  ~col_offset, ~party_id,
  0L,          "coalition_for_change",
  1L,          "unity",
  2L,          "european_democrats",
  3L,          "patriots",
  4L,          "strong_georgia",
  5L,          "our_georgia",
  6L,          "free_georgia",
  7L,          "tribuna",
  8L,          "gakharia",
  9L,          "girchi",
  10L,         "gd"
)

GT_START_COL <- 32L

cell_str <- function(x) {
  out <- as.character(x)
  out[is.na(out)] <- ""
  trimws(out)
}

cell_num <- function(x) {
  out <- suppressWarnings(as.numeric(as.character(x)))
  out[is.na(out)] <- 0
  out
}

num_col <- function(df, col) {
  if (col > ncol(df)) return(rep(0, nrow(df)))
  cell_num(df[[col]])
}

str_col <- function(df, col) {
  if (col > ncol(df)) return(rep("", nrow(df)))
  cell_str(df[[col]])
}

round4 <- function(x) {
  floor(x * 10000 + 0.5) / 10000
}

safe_ratio <- function(num, den) {
  out <- rep(0, length(num))
  ok <- !is.na(den) & den > 0
  out[ok] <- round4(num[ok] / den[ok])
  out
}

format_ratio <- function(x) {
  out <- format(x, scientific = FALSE, trim = TRUE, digits = 15)
  out <- sub("\\.?0+$", "", out)
  out[out == "" | out == "-0"] <- "0"
  out[is.na(x)] <- ""
  out
}

escape_csv_field <- function(x) {
  out <- as.character(x)
  out[is.na(out)] <- ""
  needs_quote <- str_detect(out, "[,\"\r\n]")
  out[needs_quote] <- paste0("\"", str_replace_all(out[needs_quote], "\"", "\"\""), "\"")
  out
}

write_csv_like_js <- function(df, path, cols) {
  dir.create(dirname(path), recursive = TRUE, showWarnings = FALSE)
  df <- df[, cols, drop = FALSE] %>%
    mutate(across(any_of(RATIO_COLS), format_ratio))

  lines <- if (nrow(df) == 0) {
    character()
  } else {
    do.call(paste, c(lapply(df, escape_csv_field), sep = ","))
  }

  csv <- paste0(paste(c(paste(cols, collapse = ","), lines), collapse = "\n"), "\n")
  con <- file(path, open = "wb")
  on.exit(close(con), add = TRUE)
  writeBin(charToRaw(csv), con)
}

make_vote_wide <- function(df) {
  vals <- lapply(PARTIES$col_offset, function(offset) num_col(df, GT_START_COL + offset))
  names(vals) <- PARTIES$party_id
  as_tibble(vals, .name_repair = "minimal")
}

sum_totals <- function(df, group_cols = NULL) {
  if (is.null(group_cols)) {
    df %>% summarise(across(all_of(SUM_COLS), ~ sum(.x, na.rm = TRUE)))
  } else {
    df %>%
      group_by(across(all_of(group_cols))) %>%
      summarise(across(all_of(SUM_COLS), ~ sum(.x, na.rm = TRUE)), .groups = "drop")
  }
}

attach_metrics <- function(df) {
  df %>%
    mutate(
      vote_share = safe_ratio(votes, totalVotes),
      turnout_pct = safe_ratio(voted, registered),
      noon_pct = safe_ratio(noon, registered),
      five_pct = safe_ratio(fivepm, registered),
      invalid_pct = safe_ratio(invalid, voted)
    )
}

cat("Reading:", RAW_FILE, "\n")
raw <- read_excel(
  RAW_FILE,
  col_names = FALSE,
  skip = 2,
  guess_max = 100000,
  .name_repair = "minimal"
)

votes_wide <- make_vote_wide(raw)

precincts <- bind_cols(
  tibble(
    row_order = seq_len(nrow(raw)),
    district_id = as.integer(num_col(raw, 2)),
    precinct_num = as.integer(num_col(raw, 3)),
    registered = num_col(raw, 14),
    special = num_col(raw, 16),
    noon = num_col(raw, 17),
    fivepm = num_col(raw, 18),
    voted = num_col(raw, 19),
    invalid = num_col(raw, 20)
  ),
  votes_wide
) %>%
  filter(str_col(raw, 2) != "") %>%
  mutate(
    precinct_id = district_id * 1000L + precinct_num,
    main = registered - special,
    totalVotes = rowSums(across(all_of(PARTIES$party_id)), na.rm = TRUE)
  )

cat(sprintf("Precincts: %d\n", nrow(precincts)))

party_long <- precincts %>%
  pivot_longer(all_of(PARTIES$party_id), names_to = "party_id", values_to = "votes") %>%
  mutate(party_order = match(party_id, PARTIES$party_id))

district_totals <- sum_totals(precincts, "district_id")

district_results <- party_long %>%
  group_by(district_id, party_id, party_order) %>%
  summarise(votes = sum(votes, na.rm = TRUE), .groups = "drop") %>%
  left_join(district_totals, by = "district_id") %>%
  attach_metrics() %>%
  arrange(district_id, party_order) %>%
  transmute(
    district_id = as.character(district_id),
    party_id,
    votes,
    vote_share,
    registered,
    voted,
    voted_noon = noon,
    voted_5pm = fivepm,
    main_list = main,
    special_list = special,
    turnout_pct,
    noon_pct,
    five_pct,
    invalid_ballots = invalid,
    invalid_pct
  )

precinct_results <- party_long %>%
  attach_metrics() %>%
  arrange(row_order, party_order) %>%
  transmute(
    precinct_id,
    district_id = as.character(precinct_id),
    party_id,
    votes,
    vote_share,
    registered,
    voted,
    voted_noon = noon,
    voted_5pm = fivepm,
    turnout_pct,
    noon_pct,
    five_pct,
    invalid_ballots = invalid,
    invalid_pct
  )

national_totals <- sum_totals(precincts)

turnout_rows <- bind_rows(
  national_totals %>% mutate(district_id = "national"),
  district_totals %>% mutate(district_id = as.character(district_id))
) %>%
  mutate(
    vote_type = "pr",
    turnout_pct = safe_ratio(voted, registered)
  ) %>%
  transmute(
    district_id,
    vote_type,
    registered,
    voted,
    turnout_pct,
    voted_noon = noon,
    voted_5pm = fivepm,
    main_list = main,
    special_list = special
  )

precinct_turnout <- precincts %>%
  mutate(turnout_pct = safe_ratio(voted, registered)) %>%
  arrange(row_order) %>%
  transmute(
    precinct_id,
    district_id = as.character(precinct_id),
    registered,
    voted,
    turnout_pct,
    voted_noon = noon,
    voted_5pm = fivepm
  )

RESULT_COLS <- c(
  "district_id", "party_id", "votes", "vote_share", "registered", "voted",
  "voted_noon", "voted_5pm", "main_list", "special_list",
  "turnout_pct", "noon_pct", "five_pct", "invalid_ballots", "invalid_pct"
)

PRECINCT_RESULT_COLS <- c(
  "precinct_id", "district_id", "party_id", "votes", "vote_share",
  "registered", "voted", "voted_noon", "voted_5pm",
  "turnout_pct", "noon_pct", "five_pct", "invalid_ballots", "invalid_pct"
)

TURNOUT_COLS <- c(
  "district_id", "vote_type", "registered", "voted", "turnout_pct",
  "voted_noon", "voted_5pm", "main_list", "special_list"
)

PRECINCT_TURNOUT_COLS <- c(
  "precinct_id", "district_id", "registered", "voted", "turnout_pct",
  "voted_noon", "voted_5pm"
)

write_csv_like_js(
  district_results,
  file.path(OUT_RESULTS, "adj2024_pr.csv"),
  RESULT_COLS
)

write_csv_like_js(
  precinct_results,
  file.path(OUT_RESULTS, "adj2024_pr_precincts.csv"),
  PRECINCT_RESULT_COLS
)

write_csv_like_js(
  turnout_rows,
  file.path(OUT_TURNOUT, "adj2024_turnout.csv"),
  TURNOUT_COLS
)

write_csv_like_js(
  precinct_turnout,
  file.path(OUT_TURNOUT, "adj2024_precincts_turnout.csv"),
  PRECINCT_TURNOUT_COLS
)

cat("\nDone.\n")
cat(sprintf("  District results: %d rows, %d districts\n", nrow(district_results), n_distinct(district_results$district_id)))
cat(sprintf("  Precinct results: %d rows, %d precincts\n", nrow(precinct_results), n_distinct(precinct_results$precinct_id)))
cat(sprintf("  Turnout rows: %d district rows, %d precinct rows\n", nrow(turnout_rows), nrow(precinct_turnout)))
