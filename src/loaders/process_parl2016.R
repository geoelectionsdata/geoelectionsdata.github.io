#!/usr/bin/env Rscript
# src/loaders/process_parl2016.R
#
# Processes raw precinct-level data for the 2016 Georgian parliamentary election.
# Run from project root: Rscript src/loaders/process_parl2016.R
#
# Optional test output directory:
#   Rscript src/loaders/process_parl2016.R tmp/parl2016_r_test

suppressPackageStartupMessages({
  library(readxl)
  library(dplyr)
  library(tidyr)
  library(stringr)
  library(yaml)
  library(jsonlite)
})

args <- commandArgs(trailingOnly = TRUE)
args <- args[args != "--args"]
RAW_DIR <- Sys.getenv("RAW_DIR", unset = "src/data/raw")
OUT_DIR <- if (length(args) >= 1) args[[1]] else Sys.getenv("OUT_RESULTS", unset = "src/data/results")
PARTIES_FILE <- "src/data/config/parties.yml"
PRECINCT_SHAPE_FILE <- "src/data/shp/parl2016_pr_precincts.geojson"

SUM_COLS <- c(
  "main_list", "special_list", "voted_noon", "voted_5pm", "voted",
  "valid_ballots", "invalid_ballots", "totalVotes"
)

RATIO_COLS <- c("vote_share", "turnout_pct", "noon_pct", "five_pct", "invalid_pct")

BALLOT_PARTY_MAP <- c(
  "1" = "burchuladze",
  "2" = "progressive_democratic_2016",
  "3" = "burjanadze_democratic",
  "4" = "georgian_group",
  "5" = "unm",
  "6" = "republicans_2016",
  "7" = "mechiauri_united",
  "8" = "patriots",
  "10" = "labour",
  "11" = "peoples_power_2016",
  "12" = "communist_stalinist",
  "14" = "peace_georgia_2016",
  "15" = "workers_socialist",
  "16" = "united_communist_2016",
  "17" = "georgia_2016",
  "18" = "georgian_idea",
  "19" = "industry_sakartvelo",
  "22" = "kostava_society",
  "23" = "chvenni_peoples",
  "25" = "left_alliance_2016",
  "26" = "national_forum",
  "27" = "free_democrats",
  "28" = "zviads_way",
  "30" = "our_georgia_2016",
  "41" = "gd",
  "42" = "smd_only_42",
  "43" = "smd_only_43",
  "44" = "smd_only_44"
)

PR_CODES <- c(1, 2, 3, 4, 5, 6, 7, 8, 10, 11, 12, 14, 15, 16, 17, 18, 19, 22, 23, 25, 26, 27, 28, 30, 41)
SMD_CODES <- c(1, 2, 3, 4, 5, 6, 7, 8, 10, 12, 14, 15, 16, 17, 18, 19, 22, 23, 25, 26, 27, 28, 41, 42, 43, 44)
RUNOFF_CODES <- c(5, 19, 27, 41, 42, 43)

PR_PARTIES <- unname(BALLOT_PARTY_MAP[as.character(PR_CODES)])
SMD_PARTIES <- unname(BALLOT_PARTY_MAP[as.character(SMD_CODES)])
RUNOFF_PARTIES <- unname(BALLOT_PARTY_MAP[as.character(RUNOFF_CODES)])

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
  df <- df[, cols, drop = FALSE]
  df <- df %>%
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

read_sheet <- function(path, sheet, skip = 2) {
  read_excel(path, sheet = sheet, col_names = FALSE, skip = skip, guess_max = 100000, .name_repair = "minimal")
}

parse_precinct <- function(code) {
  code <- cell_str(code)
  parts <- str_split_fixed(code, "\\.", 3)
  smd <- suppressWarnings(as.integer(parts[, 1]))
  dd <- suppressWarnings(as.integer(parts[, 2]))
  pp <- suppressWarnings(as.integer(parts[, 3]))
  valid <- code != "" & parts[, 3] != "" & !is.na(smd) & !is.na(dd) & !is.na(pp)

  tibble(
    smd = smd,
    dd = dd,
    pp = pp,
    valid_precinct = valid
  )
}

make_vote_wide <- function(df, start_col, names_out) {
  vals <- lapply(seq_along(names_out), function(i) num_col(df, start_col + i - 1L))
  names(vals) <- names_out
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

add_metrics <- function(df) {
  df %>%
    mutate(
      registered = main_list + special_list,
      vote_share = safe_ratio(votes, totalVotes),
      turnout_pct = safe_ratio(voted, registered),
      noon_pct = safe_ratio(voted_noon, registered),
      five_pct = safe_ratio(voted_5pm, registered),
      invalid_pct = safe_ratio(invalid_ballots, voted)
    )
}

attach_totals <- function(df, totals) {
  for (col in SUM_COLS) df[[col]] <- totals[[col]][[1]]
  df
}

find_raw_file <- function(kind) {
  files <- list.files(RAW_DIR, pattern = "^2016.*\\.xlsx$", full.names = TRUE)
  matches <- files[str_detect(basename(files), kind)]
  if (length(matches) != 1L) stop("Could not uniquely identify 2016 ", kind, " workbook in ", RAW_DIR, call. = FALSE)
  matches[[1]]
}

validate_party_ids <- function() {
  registry <- yaml::read_yaml(PARTIES_FILE)
  party_ids <- vapply(registry$parties, function(p) if (is.null(p$id)) "" else as.character(p$id), character(1))
  required <- unique(c(PR_PARTIES, SMD_PARTIES, RUNOFF_PARTIES))
  missing <- setdiff(required, party_ids)
  if (length(missing) > 0) {
    stop("2016 loader refers to party IDs missing from parties.yml: ", paste(missing, collapse = ", "), call. = FALSE)
  }
}

load_precinct_shape_lookup <- function(path) {
  geo <- jsonlite::fromJSON(path, simplifyDataFrame = FALSE)
  rows <- lapply(geo$features, function(feature) {
    props <- feature$properties
    tibble(
      smd = as.integer(props$MID),
      dd = as.integer(props$District),
      pp = as.integer(props$Precinct),
      shape_id = as.integer(round(as.numeric(props$id)))
    )
  })

  bind_rows(rows) %>%
    filter(!is.na(smd), !is.na(dd), !is.na(pp), !is.na(shape_id)) %>%
    group_by(smd, dd, pp) %>%
    summarise(shape_id = first(shape_id), .groups = "drop")
}

add_precinct_ids <- function(base, shape_lookup) {
  base %>%
    left_join(shape_lookup, by = c("smd", "dd", "pp")) %>%
    mutate(
      precinct_id = coalesce(shape_id, smd * 100000L + dd * 1000L + pp)
    ) %>%
    select(-shape_id)
}

aggregate_precincts <- function(base, votes, vote_cols) {
  bind_cols(base, votes) %>%
    group_by(precinct_id, smd, dd) %>%
    summarise(
      precinct_order = min(row_order, na.rm = TRUE),
      across(all_of(c(SUM_COLS, vote_cols)), ~ sum(.x, na.rm = TRUE)),
      .groups = "drop"
    )
}

validate_party_ids()
shape_lookup <- load_precinct_shape_lookup(PRECINCT_SHAPE_FILE)

first_round_file <- find_raw_file("პირველი")
runoff_file <- find_raw_file("მეორე")

cat("Reading:", first_round_file, "\n")
pr_raw <- read_sheet(first_round_file, 1, skip = 2)
smd_raw <- read_sheet(first_round_file, 2, skip = 2)
candidates_raw <- read_sheet(first_round_file, 3, skip = 2)

cat("Reading:", runoff_file, "\n")
runoff_raw <- read_sheet(runoff_file, 1, skip = 2)

candidate_lookup <- tibble(
  smd = as.integer(num_col(candidates_raw, 5)),
  code = as.integer(num_col(candidates_raw, 6)),
  presenter = str_col(candidates_raw, 7),
  first_ka = str_col(candidates_raw, 8),
  last_ka = str_col(candidates_raw, 9)
) %>%
  filter(smd != 0, code != 0) %>%
  mutate(
    party_id = unname(BALLOT_PARTY_MAP[as.character(code)]),
    name_ka = str_squish(paste(first_ka, last_ka)),
    candidate_order = row_number()
  ) %>%
  filter(!is.na(party_id), name_ka != "") %>%
  distinct(smd, code, party_id, name_ka, .keep_all = TRUE) %>%
  group_by(smd, code) %>%
  slice(1) %>%
  ungroup() %>%
  select(smd, code, party_id, name_ka, candidate_order)

party_by_code <- candidate_lookup %>%
  arrange(candidate_order) %>%
  group_by(code) %>%
  summarise(party_id = first(party_id), .groups = "drop")

cat(sprintf("Candidate lookup: %d entries\n", nrow(candidate_lookup)))

# PR, precinct and district outputs -----------------------------------------

pr_vote_cols <- paste0("code_", PR_CODES)
pr_pc <- parse_precinct(str_col(pr_raw, 2))
pr_votes <- make_vote_wide(pr_raw, 9, pr_vote_cols)

pr_base_all <- bind_cols(
  pr_pc,
  tibble(
    row_order = seq_len(nrow(pr_raw)),
    main_list = num_col(pr_raw, 3),
    special_list = num_col(pr_raw, 4),
    voted_noon = num_col(pr_raw, 5),
    voted_5pm = num_col(pr_raw, 6),
    voted = num_col(pr_raw, 7),
    invalid_ballots = num_col(pr_raw, 34),
    totalVotes = rowSums(as.data.frame(pr_votes), na.rm = TRUE)
  )
) %>%
  mutate(valid_ballots = totalVotes) %>%
  filter(valid_precinct) %>%
  add_precinct_ids(shape_lookup) %>%
  select(row_order, smd, dd, pp, precinct_id, all_of(SUM_COLS))

pr_valid_idx <- which(pr_pc$valid_precinct)
pr_base <- aggregate_precincts(pr_base_all, pr_votes[pr_valid_idx, , drop = FALSE], pr_vote_cols)

pr_long <- pr_base %>%
  pivot_longer(all_of(pr_vote_cols), names_to = "vote_col", values_to = "votes") %>%
  mutate(
    code = as.integer(str_remove(vote_col, "^code_")),
    party_id = unname(BALLOT_PARTY_MAP[as.character(code)])
  )

cat(sprintf("PR precinct groups: %d\n", nrow(pr_base)))

pr_national_totals <- sum_totals(pr_base)
pr_national <- pr_long %>%
  group_by(party_id) %>%
  summarise(votes = sum(votes, na.rm = TRUE), .groups = "drop") %>%
  mutate(district_id = "national") %>%
  attach_totals(pr_national_totals) %>%
  add_metrics() %>%
  arrange(match(party_id, PR_PARTIES))

pr_district_totals <- pr_base %>%
  filter(dd != 87) %>%
  sum_totals("dd")

pr_district <- pr_long %>%
  filter(dd != 87) %>%
  group_by(dd, party_id) %>%
  summarise(votes = sum(votes, na.rm = TRUE), .groups = "drop") %>%
  left_join(pr_district_totals, by = "dd") %>%
  mutate(district_id = as.character(dd)) %>%
  add_metrics() %>%
  arrange(dd, match(party_id, PR_PARTIES))

PR_RESULT_COLS <- c(
  "district_id", "party_id", "votes", "vote_share", "registered", "voted",
  "voted_noon", "voted_5pm", "main_list", "special_list",
  "turnout_pct", "noon_pct", "five_pct", "invalid_ballots", "invalid_pct"
)

write_csv_like_js(
  bind_rows(pr_national, pr_district),
  file.path(OUT_DIR, "parl2016_pr.csv"),
  PR_RESULT_COLS
)

pr_precinct <- pr_long %>%
  mutate(district_id = as.character(precinct_id)) %>%
  add_metrics() %>%
  arrange(precinct_order, match(party_id, PR_PARTIES))

PR_PRECINCT_COLS <- c(
  "precinct_id", "district_id", "party_id", "votes", "vote_share", "registered", "voted",
  "voted_noon", "voted_5pm", "turnout_pct", "noon_pct", "five_pct", "invalid_ballots", "invalid_pct"
)

write_csv_like_js(
  pr_precinct,
  file.path(OUT_DIR, "parl2016_pr_precincts.csv"),
  PR_PRECINCT_COLS
)

# SMD, precinct and district outputs ----------------------------------------

smd_vote_cols <- paste0("code_", SMD_CODES)
smd_code_map <- tibble(
  vote_col = smd_vote_cols,
  code = SMD_CODES,
  code_order = seq_along(SMD_CODES)
)

smd_pc <- parse_precinct(str_col(smd_raw, 2))
smd_votes <- make_vote_wide(smd_raw, 9, smd_vote_cols)

smd_base_all <- bind_cols(
  smd_pc,
  tibble(
    row_order = seq_len(nrow(smd_raw)),
    main_list = num_col(smd_raw, 3),
    special_list = num_col(smd_raw, 4),
    voted_noon = num_col(smd_raw, 5),
    voted_5pm = num_col(smd_raw, 6),
    voted = num_col(smd_raw, 7),
    invalid_ballots = num_col(smd_raw, 35),
    totalVotes = rowSums(as.data.frame(smd_votes), na.rm = TRUE)
  )
) %>%
  mutate(valid_ballots = totalVotes) %>%
  filter(valid_precinct) %>%
  add_precinct_ids(shape_lookup) %>%
  select(row_order, smd, dd, pp, precinct_id, all_of(SUM_COLS))

smd_valid_idx <- which(smd_pc$valid_precinct)
smd_base <- aggregate_precincts(smd_base_all, smd_votes[smd_valid_idx, , drop = FALSE], smd_vote_cols)

smd_long <- smd_base %>%
  pivot_longer(all_of(smd_vote_cols), names_to = "vote_col", values_to = "votes") %>%
  left_join(smd_code_map, by = "vote_col")

cat(sprintf("SMD precinct groups: %d\n", nrow(smd_base)))

smd_national_totals <- sum_totals(smd_base)
smd_national_code_votes <- smd_long %>%
  group_by(code, code_order) %>%
  summarise(votes = sum(votes, na.rm = TRUE), .groups = "drop") %>%
  left_join(party_by_code, by = "code") %>%
  filter(!is.na(party_id))

smd_national <- smd_national_code_votes %>%
  group_by(party_id) %>%
  summarise(votes = sum(votes, na.rm = TRUE), code_order = min(code_order), .groups = "drop") %>%
  mutate(
    district_id = "national",
    name_ka = ""
  ) %>%
  attach_totals(smd_national_totals) %>%
  mutate(totalVotes = sum(votes, na.rm = TRUE)) %>%
  add_metrics() %>%
  arrange(code_order)

smd_district_totals <- sum_totals(smd_base, "smd")

smd_district <- smd_long %>%
  left_join(candidate_lookup %>% select(smd, code, party_id, name_ka), by = c("smd", "code")) %>%
  filter(votes != 0, !is.na(party_id)) %>%
  group_by(smd, code, code_order, party_id, name_ka) %>%
  summarise(votes = sum(votes, na.rm = TRUE), .groups = "drop") %>%
  left_join(smd_district_totals, by = "smd") %>%
  mutate(district_id = as.character(smd)) %>%
  add_metrics() %>%
  arrange(smd, code_order)

SMD_RESULT_COLS <- c(
  "district_id", "party_id", "name_ka", "votes", "vote_share", "registered", "voted",
  "voted_noon", "voted_5pm", "main_list", "special_list",
  "turnout_pct", "noon_pct", "five_pct", "invalid_ballots", "invalid_pct"
)

write_csv_like_js(
  bind_rows(smd_national, smd_district),
  file.path(OUT_DIR, "parl2016_smd.csv"),
  SMD_RESULT_COLS
)

smd_precinct <- smd_long %>%
  left_join(candidate_lookup %>% select(smd, code, party_id, name_ka), by = c("smd", "code")) %>%
  filter(votes != 0, !is.na(party_id)) %>%
  mutate(district_id = as.character(precinct_id)) %>%
  add_metrics() %>%
  arrange(precinct_order, code_order)

SMD_PRECINCT_COLS <- c(
  "precinct_id", "district_id", "party_id", "name_ka", "votes", "vote_share", "registered", "voted",
  "voted_noon", "voted_5pm", "turnout_pct", "noon_pct", "five_pct", "invalid_ballots", "invalid_pct"
)

write_csv_like_js(
  smd_precinct,
  file.path(OUT_DIR, "parl2016_smd_precincts.csv"),
  SMD_PRECINCT_COLS
)

# SMD runoff, precinct and district outputs ---------------------------------

runoff_vote_cols <- paste0("code_", RUNOFF_CODES)
runoff_code_map <- tibble(
  vote_col = runoff_vote_cols,
  code = RUNOFF_CODES,
  code_order = seq_along(RUNOFF_CODES),
  party_id = RUNOFF_PARTIES
)

runoff_pc <- parse_precinct(str_col(runoff_raw, 2))
runoff_votes <- make_vote_wide(runoff_raw, 9, runoff_vote_cols)

runoff_base_all <- bind_cols(
  runoff_pc,
  tibble(
    row_order = seq_len(nrow(runoff_raw)),
    main_list = num_col(runoff_raw, 3),
    special_list = num_col(runoff_raw, 4),
    voted_noon = num_col(runoff_raw, 5),
    voted_5pm = num_col(runoff_raw, 6),
    voted = num_col(runoff_raw, 7),
    invalid_ballots = num_col(runoff_raw, 15),
    totalVotes = rowSums(as.data.frame(runoff_votes), na.rm = TRUE)
  )
) %>%
  mutate(valid_ballots = totalVotes) %>%
  filter(valid_precinct) %>%
  add_precinct_ids(shape_lookup) %>%
  select(row_order, smd, dd, pp, precinct_id, all_of(SUM_COLS))

runoff_valid_idx <- which(runoff_pc$valid_precinct)
runoff_base <- aggregate_precincts(runoff_base_all, runoff_votes[runoff_valid_idx, , drop = FALSE], runoff_vote_cols)

runoff_long <- runoff_base %>%
  pivot_longer(all_of(runoff_vote_cols), names_to = "vote_col", values_to = "votes") %>%
  left_join(runoff_code_map, by = "vote_col")

cat(sprintf("Runoff precinct groups: %d\n", nrow(runoff_base)))

runoff_national_totals <- sum_totals(runoff_base)
runoff_national <- runoff_long %>%
  group_by(code, code_order, party_id) %>%
  summarise(votes = sum(votes, na.rm = TRUE), .groups = "drop") %>%
  filter(votes != 0) %>%
  mutate(
    district_id = "national",
    name_ka = ""
  ) %>%
  attach_totals(runoff_national_totals) %>%
  add_metrics() %>%
  arrange(code_order)

runoff_district_totals <- sum_totals(runoff_base, "smd")

runoff_district <- runoff_long %>%
  filter(votes != 0) %>%
  group_by(smd, code, code_order, party_id) %>%
  summarise(votes = sum(votes, na.rm = TRUE), .groups = "drop") %>%
  left_join(candidate_lookup %>% select(smd, code, name_ka), by = c("smd", "code")) %>%
  left_join(runoff_district_totals, by = "smd") %>%
  mutate(
    district_id = as.character(smd),
    name_ka = replace_na(name_ka, "")
  ) %>%
  add_metrics() %>%
  arrange(smd, code_order)

RUNOFF_RESULT_COLS <- SMD_RESULT_COLS

write_csv_like_js(
  bind_rows(runoff_national, runoff_district),
  file.path(OUT_DIR, "parl2016_smd_runoff.csv"),
  RUNOFF_RESULT_COLS
)

runoff_precinct <- runoff_long %>%
  filter(votes != 0) %>%
  left_join(candidate_lookup %>% select(smd, code, name_ka), by = c("smd", "code")) %>%
  mutate(
    district_id = as.character(precinct_id),
    name_ka = replace_na(name_ka, "")
  ) %>%
  add_metrics() %>%
  arrange(precinct_order, code_order)

RUNOFF_PRECINCT_COLS <- SMD_PRECINCT_COLS

write_csv_like_js(
  runoff_precinct,
  file.path(OUT_DIR, "parl2016_smd_runoff_precincts.csv"),
  RUNOFF_PRECINCT_COLS
)

cat("\nDone.\n")
cat(sprintf("  PR: %d district rows, %d precinct rows\n", nrow(bind_rows(pr_national, pr_district)), nrow(pr_precinct)))
cat(sprintf("  SMD: %d district rows, %d precinct rows\n", nrow(bind_rows(smd_national, smd_district)), nrow(smd_precinct)))
cat(sprintf("  Runoff: %d district rows, %d precinct rows\n", nrow(bind_rows(runoff_national, runoff_district)), nrow(runoff_precinct)))
