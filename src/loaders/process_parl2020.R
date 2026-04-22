#!/usr/bin/env Rscript
# src/loaders/process_parl2020.R
#
# Processes raw precinct-level data for the 2020 Georgian parliamentary election.
# Run from project root: Rscript src/loaders/process_parl2020.R
#
# Optional test output directory:
#   Rscript src/loaders/process_parl2020.R tmp/parl2020_r_test

suppressPackageStartupMessages({
  library(readxl)
  library(dplyr)
  library(tidyr)
  library(stringr)
})

args <- commandArgs(trailingOnly = TRUE)
args <- args[args != "--args"]
RAW_DIR <- Sys.getenv("RAW_DIR", unset = "src/data/raw")
OUT_DIR <- if (length(args) >= 1) args[[1]] else Sys.getenv("OUT_RESULTS", unset = "src/data/results")

SUM_COLS <- c(
  "main_list", "special_list", "voted_noon", "voted_5pm", "voted",
  "valid_ballots", "invalid_ballots", "totalVotes"
)

RATIO_COLS <- c("vote_share", "turnout_pct", "noon_pct", "five_pct", "invalid_pct")

PARTY_NORM <- c(
  european_goergia = "european_georgia",
  georgian_dream = "gd",
  apg = "patriots",
  labor = "labour",
  georgia = "georgia_party",
  workers = "workers_socialist",
  our_united_georgia = "our_georgia",
  freedom_zviads_way = "freedom_gamsakhurdia",
  independent_1 = "independent",
  independent_9 = "independent",
  independent_11 = "independent"
)

PR_PARTIES <- c(
  "whites", "european_georgia", "democratic_movement", "tribuna", "unm",
  "future_georgia", "mechiauri", "patriots", "greens", "labour",
  "workers_socialist", "free_georgia_movement", "reformer", "georgian_choice",
  "new_christian_democrats", "victorious_georgia", "industry_sakartvelo",
  "alliance", "georgia_party", "free_georgia", "new_force", "citizens",
  "free_democrats", "justice", "agmashenebeli", "roots", "change_georgia",
  "freedom_gamsakhurdia", "peoples_party", "ndp_2020", "social_justice_2020",
  "girchi", "gd", "reformators", "zviads_way", "georgian_idea",
  "national_democrats", "social_democrats_2020", "conservatives",
  "choice_homeland_2020", "georgian_troupe", "progressive_georgia",
  "veterans", "euroatlantic_vector", "traditionalists", "peoples_movement_2020",
  "georgian_march", "lelo", "motherland_2020", "development_party"
)

SMD_CODES <- c(
  1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 14, 17, 19, 20, 21, 23, 24, 25,
  26, 27, 28, 30, 31, 32, 36, 41, 43, 44, 45, 47, 49, 50, 51, 52, 53, 55,
  56, 60, 61, 62, 63
)

RUNOFF_CODES <- c(2, 5, 10, 24, 36, 41)
RUNOFF_PARTY_IDS <- c("european_georgia", "unm", "labour", "citizens", "girchi", "gd")

stopifnot(length(PR_PARTIES) == 50L, length(SMD_CODES) == 43L)

normalize_party <- function(id) {
  id <- as.character(id)
  out <- id
  idx <- match(id, names(PARTY_NORM))
  matched <- !is.na(idx)
  out[matched] <- unname(PARTY_NORM[idx[matched]])
  out
}

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

read_sheet <- function(path, sheet) {
  read_excel(path, sheet = sheet, col_names = FALSE, skip = 1, guess_max = 100000, .name_repair = "minimal")
}

parse_precinct <- function(code) {
  code <- cell_str(code)
  parts <- str_split_fixed(code, "\\.", 3)
  smd <- suppressWarnings(as.integer(parts[, 1]))
  dd <- suppressWarnings(as.integer(parts[, 2]))
  pp <- suppressWarnings(as.integer(parts[, 3]))
  valid <- code != "" & parts[, 3] != "" & !is.na(dd) & !is.na(pp)

  tibble(
    parsed_smd = smd,
    dd = dd,
    pp = pp,
    precinct_id = dd * 1000L + pp,
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

raw_2020 <- list.files(RAW_DIR, pattern = "^2020.*\\.xlsx$", full.names = TRUE)
main_file <- raw_2020[str_detect(basename(raw_2020), " I ")]
runoff_file <- setdiff(raw_2020, main_file)

if (length(main_file) != 1L || length(runoff_file) != 1L) {
  stop(
    "Could not uniquely identify 2020 main and runoff workbooks in ",
    RAW_DIR,
    call. = FALSE
  )
}

cat("Reading:", main_file, "\n")
pr_raw <- read_sheet(main_file, 1)
smd_raw <- read_sheet(main_file, 2)
candidates_raw <- read_sheet(main_file, 3)

cat("Reading:", runoff_file, "\n")
runoff_raw <- read_sheet(runoff_file, 1)

candidate_lookup <- tibble(
  smd = as.integer(num_col(candidates_raw, 1)),
  code = as.integer(num_col(candidates_raw, 3)),
  first_ka = str_col(candidates_raw, 5),
  last_ka = str_col(candidates_raw, 6),
  raw_party_id = str_col(candidates_raw, 7)
) %>%
  filter(smd != 0, code != 0) %>%
  mutate(
    name_ka = str_squish(paste(first_ka, last_ka)),
    party_id = normalize_party(raw_party_id),
    candidate_order = row_number()
  ) %>%
  select(smd, code, party_id, name_ka, candidate_order)

party_by_code <- candidate_lookup %>%
  arrange(candidate_order) %>%
  group_by(code) %>%
  summarise(party_id = first(party_id), .groups = "drop")

cat(sprintf("Candidate lookup: %d entries\n", nrow(candidate_lookup)))

# PR, precinct and district outputs -----------------------------------------

pr_pc <- parse_precinct(str_col(pr_raw, 2))
pr_votes <- make_vote_wide(pr_raw, 10, PR_PARTIES)

pr_base <- bind_cols(
  pr_pc,
  tibble(
    main_list = num_col(pr_raw, 4),
    special_list = num_col(pr_raw, 5),
    voted_noon = num_col(pr_raw, 6),
    voted_5pm = num_col(pr_raw, 7),
    voted = num_col(pr_raw, 8),
    valid_ballots = num_col(pr_raw, 60),
    invalid_ballots = num_col(pr_raw, 61),
    totalVotes = rowSums(as.data.frame(pr_votes), na.rm = TRUE)
  )
) %>%
  filter(valid_precinct) %>%
  select(parsed_smd, dd, pp, precinct_id, all_of(SUM_COLS))

pr_valid_idx <- which(pr_pc$valid_precinct)
pr_long <- bind_cols(pr_base, pr_votes[pr_valid_idx, , drop = FALSE]) %>%
  pivot_longer(all_of(PR_PARTIES), names_to = "party_id", values_to = "votes")

cat(sprintf("PR precincts: %d\n", nrow(pr_base)))

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
  file.path(OUT_DIR, "parl2020_pr.csv"),
  PR_RESULT_COLS
)

pr_precinct <- pr_long %>%
  mutate(
    district_id = as.character(precinct_id),
    registered = main_list + special_list
  ) %>%
  add_metrics()

PR_PRECINCT_COLS <- c(
  "precinct_id", "district_id", "party_id", "votes", "vote_share",
  "registered", "voted", "voted_noon", "voted_5pm", "turnout_pct", "noon_pct", "five_pct",
  "invalid_ballots", "invalid_pct"
)

write_csv_like_js(
  pr_precinct,
  file.path(OUT_DIR, "parl2020_pr_precincts.csv"),
  PR_PRECINCT_COLS
)

# SMD, precinct and district outputs ----------------------------------------

smd_vote_cols <- paste0("code_", SMD_CODES)
smd_code_map <- tibble(
  vote_col = smd_vote_cols,
  code = SMD_CODES,
  code_order = seq_along(SMD_CODES)
)

smd_pc <- parse_precinct(str_col(smd_raw, 3))
smd_votes <- make_vote_wide(smd_raw, 10, smd_vote_cols)
smd_base_all <- bind_cols(
  smd_pc,
  tibble(
    smd = as.integer(num_col(smd_raw, 1)),
    main_list = num_col(smd_raw, 4),
    special_list = num_col(smd_raw, 5),
    voted_noon = num_col(smd_raw, 6),
    voted_5pm = num_col(smd_raw, 7),
    voted = num_col(smd_raw, 8),
    valid_ballots = num_col(smd_raw, 53),
    invalid_ballots = num_col(smd_raw, 54),
    totalVotes = rowSums(as.data.frame(smd_votes), na.rm = TRUE)
  )
)

smd_valid_idx <- which(smd_base_all$valid_precinct & smd_base_all$smd != 0)
smd_base <- smd_base_all[smd_valid_idx, ] %>%
  transmute(
    smd, dd, pp, precinct_id,
    main_list, special_list, voted_noon, voted_5pm, voted,
    valid_ballots, invalid_ballots, totalVotes
  )

smd_long <- bind_cols(smd_base, smd_votes[smd_valid_idx, , drop = FALSE]) %>%
  pivot_longer(all_of(smd_vote_cols), names_to = "vote_col", values_to = "votes") %>%
  left_join(smd_code_map, by = "vote_col")

cat(sprintf("SMD precincts: %d\n", nrow(smd_base)))

smd_national_totals <- sum_totals(smd_base)
smd_national_code_votes <- smd_long %>%
  group_by(code, code_order) %>%
  summarise(votes = sum(votes, na.rm = TRUE), .groups = "drop") %>%
  left_join(party_by_code, by = "code") %>%
  mutate(party_id = if_else(is.na(party_id) & votes != 0, "independent", party_id)) %>%
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
  file.path(OUT_DIR, "parl2020_smd.csv"),
  SMD_RESULT_COLS
)

smd_precinct <- smd_long %>%
  left_join(candidate_lookup %>% select(smd, code, party_id, name_ka), by = c("smd", "code")) %>%
  filter(votes != 0, !is.na(party_id)) %>%
  mutate(district_id = as.character(precinct_id)) %>%
  add_metrics()

SMD_PRECINCT_COLS <- c(
  "precinct_id", "district_id", "party_id", "name_ka", "votes", "vote_share", "registered", "voted",
  "voted_noon", "voted_5pm", "turnout_pct", "noon_pct", "five_pct", "invalid_ballots", "invalid_pct"
)

write_csv_like_js(
  smd_precinct,
  file.path(OUT_DIR, "parl2020_smd_precincts.csv"),
  SMD_PRECINCT_COLS
)

# SMD runoff, precinct and district outputs ---------------------------------

runoff_vote_cols <- paste0("code_", RUNOFF_CODES)
runoff_code_map <- tibble(
  vote_col = runoff_vote_cols,
  code = RUNOFF_CODES,
  code_order = seq_along(RUNOFF_CODES),
  party_id = RUNOFF_PARTY_IDS
)

runoff_pc <- parse_precinct(str_col(runoff_raw, 3))
runoff_votes <- make_vote_wide(runoff_raw, 10, runoff_vote_cols)
runoff_base_all <- bind_cols(
  runoff_pc,
  tibble(
    smd = as.integer(num_col(runoff_raw, 1)),
    main_list = num_col(runoff_raw, 4),
    special_list = num_col(runoff_raw, 5),
    voted_noon = num_col(runoff_raw, 6),
    voted_5pm = num_col(runoff_raw, 7),
    voted = num_col(runoff_raw, 8),
    valid_ballots = num_col(runoff_raw, 16),
    invalid_ballots = num_col(runoff_raw, 17),
    totalVotes = rowSums(as.data.frame(runoff_votes), na.rm = TRUE)
  )
)

runoff_valid_idx <- which(runoff_base_all$valid_precinct & runoff_base_all$smd != 0)
runoff_base <- runoff_base_all[runoff_valid_idx, ] %>%
  transmute(
    smd, dd, pp, precinct_id,
    main_list, special_list, voted_noon, voted_5pm, voted,
    valid_ballots, invalid_ballots, totalVotes
  )

runoff_long <- bind_cols(runoff_base, runoff_votes[runoff_valid_idx, , drop = FALSE]) %>%
  pivot_longer(all_of(runoff_vote_cols), names_to = "vote_col", values_to = "votes") %>%
  left_join(runoff_code_map, by = "vote_col")

cat(sprintf("Runoff precincts: %d\n", nrow(runoff_base)))

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
  file.path(OUT_DIR, "parl2020_smd_runoff.csv"),
  RUNOFF_RESULT_COLS
)

runoff_precinct <- runoff_long %>%
  filter(votes != 0) %>%
  left_join(candidate_lookup %>% select(smd, code, name_ka), by = c("smd", "code")) %>%
  mutate(
    district_id = as.character(precinct_id),
    name_ka = replace_na(name_ka, "")
  ) %>%
  add_metrics()

RUNOFF_PRECINCT_COLS <- SMD_PRECINCT_COLS

write_csv_like_js(
  runoff_precinct,
  file.path(OUT_DIR, "parl2020_smd_runoff_precincts.csv"),
  RUNOFF_PRECINCT_COLS
)

cat("\nDone.\n")
cat(sprintf("  PR: %d district rows, %d precinct rows\n", nrow(bind_rows(pr_national, pr_district)), nrow(pr_precinct)))
cat(sprintf("  SMD: %d district rows, %d precinct rows\n", nrow(bind_rows(smd_national, smd_district)), nrow(smd_precinct)))
cat(sprintf("  Runoff: %d district rows, %d precinct rows\n", nrow(bind_rows(runoff_national, runoff_district)), nrow(runoff_precinct)))
