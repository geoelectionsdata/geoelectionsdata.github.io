#!/usr/bin/env Rscript
# Processes the 2013 Georgian presidential election.

suppressPackageStartupMessages({
  library(readxl)
  library(dplyr)
  library(tidyr)
  library(stringr)
  library(jsonlite)
})

RAW_DIR <- Sys.getenv("RAW_DIR", unset = "src/data/raw")
RES_DIR <- Sys.getenv("OUT_RESULTS", unset = "src/data/results")
TURN_DIR <- Sys.getenv("OUT_TURNOUT", unset = "src/data/turnout")
CAND_DIR <- Sys.getenv("OUT_CANDIDATES", unset = "src/data/candidates")
SHP_DIR <- Sys.getenv("SHP_DIR", unset = "src/data/shp")

RAW_FILE <- file.path(RAW_DIR, "2013_საპრეზიდენტო.xlsx")
DISTRICT_GEOJSON <- file.path(SHP_DIR, "parl2024_pr.geojson")

dir.create(RES_DIR, recursive = TRUE, showWarnings = FALSE)
dir.create(TURN_DIR, recursive = TRUE, showWarnings = FALSE)
dir.create(CAND_DIR, recursive = TRUE, showWarnings = FALSE)

CANDIDATES <- tibble(
  code = c(1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 41),
  party_id = c(
    "tamaz_bibiluri",
    "giorgi_liluashvili_2013",
    "sergo_javakhidze",
    "koba_davitashvili",
    "bakradze",
    "akaki_asatiani_2013",
    "nino_chanishvili",
    "teimuraz_bobokhidze",
    "natelashvili",
    "giorgi_targamadze",
    "levan_chachua",
    "nestan_kirtadze",
    "giorgi_chikhladze",
    "nino_burjanadze",
    "zurab_kharatishvili",
    "mikheil_saluashvili",
    "kartlos_gharibashvili",
    "mamuka_chokhonelidze",
    "avtandil_margiani",
    "nugzar_avaliani",
    "mamuka_melikishvili",
    "teimuraz_mzhavia",
    "giorgi_margvelashvili"
  ),
  name_en = c(
    "Tamaz Bibiluri",
    "Giorgi Liluashvili",
    "Sergo Javakhidze",
    "Koba Davitashvili",
    "Davit Bakradze",
    "Akaki Asatiani",
    "Nino Chanishvili",
    "Teimuraz Bobokhidze",
    "Shalva Natelashvili",
    "Giorgi Targamadze",
    "Levan Chachua",
    "Nestan Kirtadze",
    "Giorgi Chikhladze",
    "Nino Burjanadze",
    "Zurab Kharatishvili",
    "Mikheil Saluashvili",
    "Kartlos Gharibashvili",
    "Mamuka Chokhonelidze",
    "Avtandil Margiani",
    "Nugzar Avaliani",
    "Mamuka Melikishvili",
    "Teimuraz Mzhavia",
    "Giorgi Margvelashvili"
  ),
  vote_col = paste0("candidate_", code)
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

safe_int <- function(x) {
  out <- suppressWarnings(as.integer(as.character(x)))
  out
}

safe_ratio <- function(num, den) {
  out <- rep(0, length(num))
  ok <- !is.na(den) & den > 0
  out[ok] <- round(num[ok] / den[ok], 6)
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

load_district_names <- function() {
  if (!file.exists(DISTRICT_GEOJSON)) {
    return(tibble(district_id = character(), district_name_ka = character(), district_name_en = character()))
  }
  geo <- fromJSON(DISTRICT_GEOJSON, simplifyVector = FALSE)
  props <- lapply(geo$features, `[[`, "properties")
  tibble(
    district_id = vapply(props, function(p) as.character(p$id %||% ""), character(1)),
    district_name_ka = vapply(props, function(p) cell_str(p$name_ka %||% ""), character(1)),
    district_name_en = vapply(props, function(p) cell_str(p$name_en %||% ""), character(1))
  ) %>%
    filter(district_id != "") %>%
    distinct(district_id, .keep_all = TRUE)
}

`%||%` <- function(x, y) {
  if (is.null(x) || length(x) == 0 || is.na(x)) y else x
}

raw_candidates <- read_excel(RAW_FILE, sheet = "candidates", guess_max = 100000, .name_repair = "unique") %>%
  transmute(
    code = as.integer(.data[["candidate_code"]]),
    name_ka = cell_str(.data[["candidate_name"]]),
    party_label_ka = cell_str(.data[["party"]])
  )

candidate_names <- CANDIDATES %>%
  left_join(raw_candidates, by = "code") %>%
  mutate(
    name_ka = coalesce(name_ka, name_en),
    party_label_ka = coalesce(party_label_ka, "")
  ) %>%
  arrange(code)

district_names <- load_district_names()

raw <- read_excel(RAW_FILE, sheet = "results", guess_max = 100000, .name_repair = "unique") %>%
  mutate(
    precinct_id = safe_int(.data[["id"]]),
    district_id = as.character(safe_int(.data[["district"]])),
    precinct_number = safe_int(.data[["precinct"]]),
    main_list = cell_num(.data[["voters_list"]]),
    special_list = cell_num(.data[["voters_special"]]),
    registered = main_list + special_list,
    voted_noon = cell_num(.data[["turnout_12"]]),
    voted_5pm = cell_num(.data[["turnout_17"]]),
    voted = cell_num(.data[["final_turnout"]]),
    invalid_ballots = cell_num(.data[["invalid_ballots"]]),
    candidate_vote_sum = rowSums(across(all_of(CANDIDATES$vote_col)), na.rm = TRUE),
    totalVotes = if_else(cell_num(.data[["valid_ballots"]]) > 0, cell_num(.data[["valid_ballots"]]), candidate_vote_sum),
    turnout_pct = safe_ratio(voted, registered),
    noon_pct = safe_ratio(voted_noon, registered),
    five_pct = safe_ratio(voted_5pm, registered),
    invalid_pct = safe_ratio(invalid_ballots, voted)
  ) %>%
  left_join(district_names, by = "district_id") %>%
  mutate(
    district_name_ka = coalesce(district_name_ka, ""),
    district_name_en = coalesce(district_name_en, "")
  ) %>%
  filter(!is.na(precinct_id), district_id != "NA")

precinct_long <- raw %>%
  select(
    precinct_id, district_id, district_name_ka, district_name_en, precinct_number,
    registered, voted, voted_noon, voted_5pm, main_list, special_list,
    turnout_pct, noon_pct, five_pct, invalid_ballots, invalid_pct, totalVotes,
    all_of(CANDIDATES$vote_col)
  ) %>%
  pivot_longer(all_of(CANDIDATES$vote_col), names_to = "vote_col", values_to = "votes") %>%
  left_join(CANDIDATES %>% select(party_id, vote_col), by = "vote_col") %>%
  mutate(vote_share = safe_ratio(votes, totalVotes)) %>%
  arrange(precinct_id, desc(votes))

district_totals <- raw %>%
  group_by(district_id, district_name_ka, district_name_en) %>%
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

national_totals <- district_totals %>%
  summarise(
    district_id = "national",
    district_name_ka = "საქართველო",
    district_name_en = "Georgia",
    registered = sum(registered, na.rm = TRUE),
    voted = sum(voted, na.rm = TRUE),
    voted_noon = sum(voted_noon, na.rm = TRUE),
    voted_5pm = sum(voted_5pm, na.rm = TRUE),
    main_list = sum(main_list, na.rm = TRUE),
    special_list = sum(special_list, na.rm = TRUE),
    invalid_ballots = sum(invalid_ballots, na.rm = TRUE),
    totalVotes = sum(totalVotes, na.rm = TRUE),
    across(all_of(CANDIDATES$vote_col), ~ sum(.x, na.rm = TRUE))
  ) %>%
  mutate(
    turnout_pct = safe_ratio(voted, registered),
    noon_pct = safe_ratio(voted_noon, registered),
    five_pct = safe_ratio(voted_5pm, registered),
    invalid_pct = safe_ratio(invalid_ballots, voted)
  )

district_long <- bind_rows(national_totals, district_totals) %>%
  pivot_longer(all_of(CANDIDATES$vote_col), names_to = "vote_col", values_to = "votes") %>%
  left_join(CANDIDATES %>% select(party_id, vote_col), by = "vote_col") %>%
  mutate(vote_share = safe_ratio(votes, totalVotes)) %>%
  arrange(if_else(district_id == "national", 0L, 1L), suppressWarnings(as.integer(district_id)), desc(votes))

turnout_district <- bind_rows(national_totals, district_totals) %>%
  transmute(
    district_id,
    vote_type = "pr",
    district_name_ka,
    district_name_en,
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
  arrange(if_else(district_id == "national", 0L, 1L), suppressWarnings(as.integer(district_id)))

turnout_precinct <- raw %>%
  transmute(
    precinct_id,
    district_id,
    vote_type = "pr",
    district_name_ka,
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
  "district_id", "district_name_ka", "district_name_en", "party_id", "votes", "vote_share",
  "registered", "voted", "voted_noon", "voted_5pm", "main_list", "special_list",
  "turnout_pct", "noon_pct", "five_pct", "invalid_ballots", "invalid_pct"
)

PRECINCT_COLS <- c(
  "precinct_id", "district_id", "district_name_ka", "district_name_en", "precinct_number",
  "party_id", "votes", "vote_share", "registered", "voted", "voted_noon", "voted_5pm",
  "main_list", "special_list", "turnout_pct", "noon_pct", "five_pct",
  "invalid_ballots", "invalid_pct"
)

TURNOUT_COLS <- c(
  "district_id", "vote_type", "district_name_ka", "district_name_en", "registered", "voted", "turnout_pct",
  "voted_noon", "voted_5pm", "main_list", "special_list", "noon_pct", "five_pct",
  "invalid_ballots", "invalid_pct"
)

TURNOUT_PRECINCT_COLS <- c(
  "precinct_id", "district_id", "vote_type", "district_name_ka", "district_name_en", "precinct_number",
  "registered", "voted", "turnout_pct", "voted_noon", "voted_5pm", "main_list",
  "special_list", "noon_pct", "five_pct", "invalid_ballots", "invalid_pct"
)

write_csv_like_js(district_long, file.path(RES_DIR, "pres2013.csv"), RESULT_COLS)
write_csv_like_js(precinct_long, file.path(RES_DIR, "pres2013_precincts.csv"), PRECINCT_COLS)
write_csv_like_js(turnout_district, file.path(TURN_DIR, "pres2013_turnout.csv"), TURNOUT_COLS)
write_csv_like_js(turnout_precinct, file.path(TURN_DIR, "pres2013_precincts_turnout.csv"), TURNOUT_PRECINCT_COLS)
write_csv_like_js(
  candidate_names,
  file.path(CAND_DIR, "pres2013_candidates.csv"),
  c("code", "party_id", "name_en", "name_ka", "party_label_ka", "vote_col")
)

message("Wrote 2013 presidential results, turnout, and candidate CSVs.")
