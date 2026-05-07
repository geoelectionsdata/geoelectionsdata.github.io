#!/usr/bin/env Rscript
# Processes the 2008 Georgian presidential election.

suppressPackageStartupMessages({
  library(readxl)
  library(dplyr)
  library(tidyr)
  library(stringr)
})

RAW_DIR <- Sys.getenv("RAW_DIR", unset = "src/data/raw")
RES_DIR <- Sys.getenv("OUT_RESULTS", unset = "src/data/results")
TURN_DIR <- Sys.getenv("OUT_TURNOUT", unset = "src/data/turnout")
CAND_DIR <- Sys.getenv("OUT_CANDIDATES", unset = "src/data/candidates")

RAW_FILE <- file.path(RAW_DIR, "2008_საპრეზიდენტო.xlsx")

dir.create(RES_DIR, recursive = TRUE, showWarnings = FALSE)
dir.create(TURN_DIR, recursive = TRUE, showWarnings = FALSE)
dir.create(CAND_DIR, recursive = TRUE, showWarnings = FALSE)

CANDIDATES <- tibble(
  code = c(1, 2, 3, 4, 5, 6, 7),
  party_id = c(
    "gachechiladze",
    "patarkatsishvili",
    "gamkrelidze",
    "natelashvili",
    "saakashvili",
    "maisashvili",
    "sarishvili_chanturia"
  ),
  vote_col = c(
    "votes_gachechiladze_1",
    "votes_patarkatsishvili_2",
    "votes_gamkrelidze_3",
    "votes_natelashvili_4",
    "votes_saakashvili_5",
    "votes_maisashvili_6",
    "votes_sarishvili_chanturia_7"
  )
)

RATIO_COLS <- c("vote_share", "turnout_pct", "noon_pct", "five_pct", "invalid_pct")

cell_str <- function(x) {
  out <- as.character(x)
  out[is.na(out)] <- ""
  str_squish(out)
}

cell_num <- function(x) {
  out <- suppressWarnings(as.numeric(as.character(x)))
  out[is.na(out)] <- 0
  out
}

round6 <- function(x) {
  round(x, 6)
}

safe_ratio <- function(num, den) {
  out <- rep(0, length(num))
  ok <- !is.na(den) & den > 0
  out[ok] <- round6(num[ok] / den[ok])
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
  for (col in setdiff(cols, names(df))) df[[col]] <- ""
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

add_metrics <- function(df) {
  df %>%
    mutate(
      registered = total_voters,
      special_list = special_voters + additional_voters + transferred_voters,
      main_list = registered_voters_list,
      voted = final_turnout,
      voted_noon = turnout_12,
      voted_5pm = turnout_17,
      turnout_pct = safe_ratio(voted, registered),
      noon_pct = safe_ratio(voted_noon, registered),
      five_pct = safe_ratio(voted_5pm, registered),
      invalid_pct = safe_ratio(invalid_ballots, voted)
    )
}

raw <- read_excel(RAW_FILE, sheet = "data", guess_max = 100000) %>%
  mutate(
    precinct_id = as.integer(counted_prec_id),
    district_id = as.character(as.integer(district)),
    district_name_en = cell_str(district_name),
    precinct_number = as.integer(precinct),
    totalVotes = rowSums(across(all_of(CANDIDATES$vote_col)), na.rm = TRUE)
  ) %>%
  add_metrics()

candidate_names <- read_excel(RAW_FILE, sheet = "candidates", guess_max = 100000) %>%
  transmute(
    code = as.integer(code),
    name_ka = cell_str(name),
    party_label_ka = cell_str(party)
  ) %>%
  left_join(CANDIDATES, by = "code")

precinct_long <- raw %>%
  select(
    precinct_id, district_id, district_name_en, precinct_number,
    registered, voted, voted_noon, voted_5pm, main_list, special_list,
    turnout_pct, noon_pct, five_pct, invalid_ballots, invalid_pct, totalVotes,
    all_of(CANDIDATES$vote_col)
  ) %>%
  pivot_longer(all_of(CANDIDATES$vote_col), names_to = "vote_col", values_to = "votes") %>%
  left_join(CANDIDATES %>% select(party_id, vote_col), by = "vote_col") %>%
  mutate(vote_share = safe_ratio(votes, totalVotes)) %>%
  arrange(precinct_id, desc(votes))

district_totals <- raw %>%
  group_by(district_id, district_name_en) %>%
  summarise(
    registered = sum(registered, na.rm = TRUE),
    voted = sum(voted, na.rm = TRUE),
    voted_noon = sum(voted_noon, na.rm = TRUE),
    voted_5pm = sum(voted_5pm, na.rm = TRUE),
    main_list = sum(main_list, na.rm = TRUE),
    special_list = sum(special_list, na.rm = TRUE),
    invalid_ballots = sum(invalid_ballots, na.rm = TRUE),
    totalVotes = sum(totalVotes, na.rm = TRUE),
    across(all_of(CANDIDATES$vote_col), ~ sum(.x, na.rm = TRUE)),
    .groups = "drop"
  ) %>%
  mutate(
    turnout_pct = safe_ratio(voted, registered),
    noon_pct = safe_ratio(voted_noon, registered),
    five_pct = safe_ratio(voted_5pm, registered),
    invalid_pct = safe_ratio(invalid_ballots, voted)
  )

district_long <- district_totals %>%
  pivot_longer(all_of(CANDIDATES$vote_col), names_to = "vote_col", values_to = "votes") %>%
  left_join(CANDIDATES %>% select(party_id, vote_col), by = "vote_col") %>%
  mutate(vote_share = safe_ratio(votes, totalVotes)) %>%
  arrange(suppressWarnings(as.integer(district_id)), desc(votes))

turnout_district <- bind_rows(
  raw %>%
    summarise(
      registered = sum(registered, na.rm = TRUE),
      voted = sum(voted, na.rm = TRUE),
      voted_noon = sum(voted_noon, na.rm = TRUE),
      voted_5pm = sum(voted_5pm, na.rm = TRUE),
      main_list = sum(main_list, na.rm = TRUE),
      special_list = sum(special_list, na.rm = TRUE),
      invalid_ballots = sum(invalid_ballots, na.rm = TRUE)
    ) %>%
    mutate(district_id = "national", vote_type = "pr", district_name_en = "National"),
  district_totals %>%
    transmute(
      district_id, vote_type = "pr", district_name_en, registered, voted,
      voted_noon, voted_5pm, main_list, special_list, invalid_ballots
    )
) %>%
  mutate(
    turnout_pct = safe_ratio(voted, registered),
    noon_pct = safe_ratio(voted_noon, registered),
    five_pct = safe_ratio(voted_5pm, registered),
    invalid_pct = safe_ratio(invalid_ballots, voted)
  ) %>%
  arrange(if_else(district_id == "national", 0L, 1L), suppressWarnings(as.integer(district_id)))

turnout_precinct <- raw %>%
  transmute(
    precinct_id,
    district_id,
    vote_type = "pr",
    district_name_en,
    precinct_number,
    registered,
    voted,
    turnout_pct,
    voted_noon,
    voted_5pm,
    main_list,
    special_list,
    noon_pct,
    five_pct,
    invalid_ballots,
    invalid_pct
  ) %>%
  arrange(precinct_id)

RESULT_COLS <- c(
  "district_id", "district_name_en", "party_id", "votes", "vote_share", "registered", "voted",
  "voted_noon", "voted_5pm", "main_list", "special_list",
  "turnout_pct", "noon_pct", "five_pct", "invalid_ballots", "invalid_pct"
)

PRECINCT_COLS <- c(
  "precinct_id", "district_id", "district_name_en", "precinct_number", "party_id",
  "votes", "vote_share", "registered", "voted", "voted_noon", "voted_5pm",
  "main_list", "special_list", "turnout_pct", "noon_pct", "five_pct",
  "invalid_ballots", "invalid_pct"
)

TURNOUT_COLS <- c(
  "district_id", "vote_type", "district_name_en", "registered", "voted", "turnout_pct",
  "voted_noon", "voted_5pm", "main_list", "special_list", "noon_pct", "five_pct",
  "invalid_ballots", "invalid_pct"
)

TURNOUT_PRECINCT_COLS <- c(
  "precinct_id", "district_id", "vote_type", "district_name_en", "precinct_number",
  "registered", "voted", "turnout_pct", "voted_noon", "voted_5pm", "main_list",
  "special_list", "noon_pct", "five_pct", "invalid_ballots", "invalid_pct"
)

write_csv_like_js(district_long, file.path(RES_DIR, "pres2008.csv"), RESULT_COLS)
write_csv_like_js(precinct_long, file.path(RES_DIR, "pres2008_precincts.csv"), PRECINCT_COLS)
write_csv_like_js(turnout_district, file.path(TURN_DIR, "pres2008_turnout.csv"), TURNOUT_COLS)
write_csv_like_js(turnout_precinct, file.path(TURN_DIR, "pres2008_precincts_turnout.csv"), TURNOUT_PRECINCT_COLS)
write_csv_like_js(
  candidate_names,
  file.path(CAND_DIR, "pres2008_candidates.csv"),
  c("code", "party_id", "name_ka", "party_label_ka", "vote_col")
)

message("Wrote 2008 presidential results, turnout, and candidate CSVs.")
