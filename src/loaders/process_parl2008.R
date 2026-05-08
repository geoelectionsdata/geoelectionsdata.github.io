#!/usr/bin/env Rscript
# Processes raw precinct-level data for the 2008 Georgian parliamentary election.

suppressPackageStartupMessages({
  library(readxl)
  library(dplyr)
  library(tidyr)
  library(stringr)
})

args <- commandArgs(trailingOnly = TRUE)
args <- args[args != "--args"]

RAW_DIR <- Sys.getenv("RAW_DIR", unset = "src/data/raw")
OUT_RESULTS <- if (length(args) >= 1) args[[1]] else Sys.getenv("OUT_RESULTS", unset = "src/data/results")
OUT_TURNOUT <- Sys.getenv("OUT_TURNOUT", unset = "src/data/turnout")
OUT_CANDIDATES <- Sys.getenv("OUT_CANDIDATES", unset = "src/data/candidates")

RESULTS_FILE <- file.path(RAW_DIR, "2008_საპარლამენტო.xlsx")
PARTY_LISTS_FILE <- file.path(RAW_DIR, "party_lists_2008_georgia_unified.xlsx")
ELECTED_FILE <- file.path(RAW_DIR, "parl_elected_2008.xlsx")

PARTIES <- tibble(
  code = 1:12,
  party_id = c(
    "georgian_politics_2008",
    "republicans_2008",
    "right_alliance_2008",
    "labour",
    "unm",
    "sports_union_2008",
    "united_opposition_2008",
    "radical_democrats_2008",
    "christian_democratic_alliance_2008",
    "christian_democrats_2008",
    "traditionalists",
    "our_country_2008"
  )
)

PR_CODES <- PARTIES$code
SMD_CODES <- PARTIES$code

SUM_COLS <- c(
  "main_list", "special_list", "voted_noon", "voted_5pm", "voted",
  "valid_ballots", "invalid_ballots", "totalVotes"
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

read_raw_sheet <- function(sheet) {
  read_excel(
    RESULTS_FILE,
    sheet = sheet,
    guess_max = 100000,
    .name_repair = "unique"
  )
}

make_vote_wide <- function(df, value_cols, codes) {
  vals <- lapply(value_cols, function(col) num_col(df, col))
  names(vals) <- paste0("code_", codes)
  as_tibble(vals, .name_repair = "minimal")
}

party_id_from_label <- function(x) {
  label <- str_to_lower(cell_str(x))
  case_when(
    str_detect(label, "ქართული პოლიტიკა") ~ "georgian_politics_2008",
    str_detect(label, "რესპუბლიკური") ~ "republicans_2008",
    str_detect(label, "მემარჯვენე ალიანსი|თოფაძე") ~ "right_alliance_2008",
    str_detect(label, "ლეიბორისტ") ~ "labour",
    str_detect(label, "ნაციონალური მოძრაობა") ~ "unm",
    str_detect(label, "სპორტსმენ") ~ "sports_union_2008",
    str_detect(label, "გაერთიანებული ოპოზიცია|ეროვნული საბჭო") ~ "united_opposition_2008",
    str_detect(label, "რადიკალ-დემოკრატ") ~ "radical_democrats_2008",
    str_detect(label, "ქრისტიანულ-დემოკრატიული ალიანსი|ქდა") ~ "christian_democratic_alliance_2008",
    str_detect(label, "გიორგი თარგამაძე|ქრისტიან-დემოკრატები") ~ "christian_democrats_2008",
    str_detect(label, "ტრადიციონალისტ") ~ "traditionalists",
    str_detect(label, "ჩვენი ქვეყანა") ~ "our_country_2008",
    TRUE ~ "unknown"
  )
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

add_turnout_metrics <- function(df) {
  df %>%
    mutate(
      registered = main_list + special_list,
      turnout_pct = safe_ratio(voted, registered),
      noon_pct = safe_ratio(voted_noon, registered),
      five_pct = safe_ratio(voted_5pm, registered),
      invalid_pct = safe_ratio(invalid_ballots, voted)
    )
}

district_names_from_pr <- function(pr_raw) {
  pr_raw %>%
    transmute(
      electoral_district_id = as.integer(num_col(pr_raw, 1)),
      district_name_ka = str_col(pr_raw, 2)
    ) %>%
    filter(!is.na(electoral_district_id), district_name_ka != "") %>%
    distinct(electoral_district_id, .keep_all = TRUE)
}

build_pr_base <- function(pr_raw, smd_raw) {
  smd_turnout <- smd_raw %>%
    transmute(
      electoral_district_id = as.integer(num_col(smd_raw, 1)),
      precinct_number = as.integer(num_col(smd_raw, 2)),
      voted_noon = num_col(smd_raw, 5),
      voted_5pm = num_col(smd_raw, 6)
    ) %>%
    filter(!is.na(electoral_district_id), !is.na(precinct_number))

  pr_raw %>%
    transmute(
      electoral_district_id = as.integer(num_col(pr_raw, 1)),
      district_name_ka = str_col(pr_raw, 2),
      precinct_number = as.integer(num_col(pr_raw, 3)),
      main_list = num_col(pr_raw, 4),
      special_list = num_col(pr_raw, 5),
      voted = num_col(pr_raw, 6),
      invalid_ballots = num_col(pr_raw, 8)
    ) %>%
    left_join(smd_turnout, by = c("electoral_district_id", "precinct_number")) %>%
    mutate(
      voted_noon = coalesce(voted_noon, 0),
      voted_5pm = coalesce(voted_5pm, 0)
    ) %>%
    filter(!is.na(electoral_district_id), !is.na(precinct_number), precinct_number > 0) %>%
    mutate(
      precinct_id = electoral_district_id * 1000L + precinct_number,
      precinct_key = paste(electoral_district_id, precinct_number, sep = "."),
      district_id = as.character(electoral_district_id),
      precinct_order = row_number()
    )
}

build_smd_base <- function(smd_raw, district_names) {
  smd_raw %>%
    transmute(
      electoral_district_id = as.integer(num_col(smd_raw, 1)),
      precinct_number = as.integer(num_col(smd_raw, 2)),
      main_list = num_col(smd_raw, 3),
      special_list = num_col(smd_raw, 4),
      voted_noon = num_col(smd_raw, 5),
      voted_5pm = num_col(smd_raw, 6),
      voted = num_col(smd_raw, 7),
      invalid_ballots = num_col(smd_raw, 11)
    ) %>%
    left_join(district_names, by = "electoral_district_id") %>%
    mutate(district_name_ka = coalesce(district_name_ka, "")) %>%
    filter(!is.na(electoral_district_id), !is.na(precinct_number), precinct_number > 0) %>%
    mutate(
      precinct_id = electoral_district_id * 1000L + precinct_number,
      precinct_key = paste(electoral_district_id, precinct_number, sep = "."),
      district_id = as.character(electoral_district_id),
      precinct_order = row_number()
    )
}

aggregate_precinct_votes <- function(base, votes_wide, vote_cols) {
  bind_cols(base, votes_wide) %>%
    mutate(
      valid_ballots = rowSums(across(all_of(vote_cols)), na.rm = TRUE),
      totalVotes = valid_ballots
    ) %>%
    group_by(precinct_id, precinct_key, electoral_district_id, district_name_ka, precinct_number) %>%
    summarise(
      across(all_of(SUM_COLS), ~ sum(.x, na.rm = TRUE)),
      across(all_of(vote_cols), ~ sum(.x, na.rm = TRUE)),
      precinct_order = min(precinct_order),
      .groups = "drop"
    )
}

build_vote_outputs <- function(wide, codes, vote_type, candidate_lookup = NULL) {
  vote_cols <- paste0("code_", codes)
  long <- wide %>%
    pivot_longer(all_of(vote_cols), names_to = "code_col", values_to = "votes") %>%
    mutate(
      raw_vote_code = as.integer(str_remove(code_col, "^code_")),
      party_id = unname(PARTIES$party_id[match(raw_vote_code, PARTIES$code)])
    )

  if (!is.null(candidate_lookup)) {
    long <- long %>%
      left_join(
        candidate_lookup %>% select(electoral_district_id, raw_vote_code, party_id, name_ka),
        by = c("electoral_district_id", "raw_vote_code", "party_id")
      ) %>%
      filter(!is.na(name_ka))
  }

  totals_national <- sum_totals(wide)
  national <- long %>%
    group_by(party_id) %>%
    summarise(votes = sum(votes, na.rm = TRUE), .groups = "drop") %>%
    mutate(district_id = "national", district_name_ka = "ეროვნული", name_ka = "") %>%
    bind_cols(totals_national[rep(1, nrow(.)), ]) %>%
    add_metrics()

  totals_district <- sum_totals(wide, "electoral_district_id")
  district_groups <- if (is.null(candidate_lookup)) {
    c("electoral_district_id", "district_name_ka", "party_id")
  } else {
    c("electoral_district_id", "district_name_ka", "party_id", "name_ka")
  }
  district <- long %>%
    group_by(across(all_of(district_groups))) %>%
    summarise(votes = sum(votes, na.rm = TRUE), .groups = "drop") %>%
    left_join(totals_district, by = "electoral_district_id") %>%
    mutate(district_id = as.character(electoral_district_id)) %>%
    add_metrics()

  precinct <- long %>%
    mutate(
      district_id = as.character(precinct_id),
      electoral_district_id = as.character(electoral_district_id)
    ) %>%
    add_metrics() %>%
    arrange(precinct_order, raw_vote_code)

  turnout_district <- bind_rows(
    wide %>%
      summarise(across(all_of(SUM_COLS), ~ sum(.x, na.rm = TRUE))) %>%
      mutate(district_id = "national", vote_type = vote_type, district_name_ka = "ეროვნული"),
    wide %>%
      group_by(electoral_district_id, district_name_ka) %>%
      summarise(across(all_of(SUM_COLS), ~ sum(.x, na.rm = TRUE)), .groups = "drop") %>%
      mutate(district_id = as.character(electoral_district_id), vote_type = vote_type)
  ) %>%
    add_turnout_metrics() %>%
    arrange(if_else(district_id == "national", 0L, 1L), suppressWarnings(as.integer(district_id)))

  turnout_precinct <- wide %>%
    mutate(
      district_id = as.character(precinct_id),
      electoral_district_id = as.character(electoral_district_id),
      vote_type = vote_type
    ) %>%
    add_turnout_metrics() %>%
    arrange(precinct_order)

  list(
    national = national,
    district = district,
    precinct = precinct,
    turnout_district = turnout_district,
    turnout_precinct = turnout_precinct
  )
}

build_candidate_lookup <- function() {
  read_excel(RESULTS_FILE, sheet = "candidates", guess_max = 100000, .name_repair = "unique") %>%
    transmute(
      electoral_district_id = as.integer(.data[["district"]]),
      raw_vote_code = as.integer(.data[["candidate_number"]]),
      party_id = unname(PARTIES$party_id[match(raw_vote_code, PARTIES$code)]),
      first_name = cell_str(.data[["first_name"]]),
      last_name = cell_str(.data[["last_name"]]),
      name_ka = str_squish(paste(first_name, last_name)),
      party_label = cell_str(.data[["party"]])
    ) %>%
    filter(!is.na(electoral_district_id), !is.na(raw_vote_code), !is.na(party_id), name_ka != "") %>%
    arrange(electoral_district_id, raw_vote_code, name_ka)
}

build_party_lists <- function() {
  read_excel(PARTY_LISTS_FILE, sheet = "party lists", guess_max = 100000, .name_repair = "unique") %>%
    transmute(
      party_id = party_id_from_label(.data[["party_name"]]),
      party_label = cell_str(.data[["party_name"]]),
      list_order = as.integer(.data[["order_id"]]),
      first_name = cell_str(.data[["first_name"]]),
      last_name = cell_str(.data[["last_name"]]),
      name_ka = str_squish(paste(first_name, last_name)),
      birth_date = if_else(
        cell_str(.data[["dob_year"]]) != "",
        paste(
          str_pad(cell_str(.data[["dob_year"]]), 2, pad = "0"),
          str_pad(cell_str(.data[["dob_month"]]), 2, pad = "0"),
          str_pad(cell_str(.data[["dob_day"]]), 2, pad = "0"),
          sep = "-"
        ),
        ""
      ),
      profession = cell_str(.data[["profession"]]),
      employment_status = cell_str(.data[["employment_status"]]),
      partisanship = cell_str(.data[["partisanship"]]),
      source_page = cell_str(.data[["source_page"]])
    ) %>%
    arrange(match(party_id, PARTIES$party_id), list_order)
}

build_smd_candidates <- function(candidate_lookup) {
  candidate_lookup %>%
    transmute(
      electoral_district_id = as.character(electoral_district_id),
      raw_vote_code = as.character(raw_vote_code),
      party_id,
      name_ka,
      first_name,
      last_name,
      party_label
    )
}

build_elected <- function() {
  read_excel(ELECTED_FILE, sheet = "elected representatives", guess_max = 100000, .name_repair = "unique") %>%
    transmute(
      election_type = cell_str(.data[["election_type"]]),
      mandate_type = if_else(election_type == "pr", "party_list", "single_mandate_district"),
      party_id = party_id_from_label(.data[["party_name"]]),
      party_label = cell_str(.data[["party_name"]]),
      elected_order = as.integer(.data[["order_id"]]),
      district_id = cell_str(.data[["district_code"]]),
      district_name_ka = cell_str(.data[["district_name"]]),
      first_name = cell_str(.data[["first_name"]]),
      last_name = cell_str(.data[["last_name"]]),
      name_ka = str_squish(paste(first_name, last_name))
    )
}

build_annulled_precincts <- function() {
  read_excel(ELECTED_FILE, sheet = "annulled precincts", guess_max = 100000, .name_repair = "unique") %>%
    transmute(
      order_id = as.integer(.data[["order_id"]]),
      electoral_district_id = as.character(as.integer(.data[["district_code"]])),
      district_name_ka = cell_str(.data[["district_name"]]),
      precinct_number = as.integer(.data[["precinct_no"]]),
      precinct_id = as.character(as.integer(.data[["district_code"]]) * 1000L + as.integer(.data[["precinct_no"]])),
      number_of_voters = as.integer(.data[["voters"]]),
      reason = cell_str(.data[["reason"]])
    )
}

pr_raw <- read_raw_sheet("2008 პროპორციული")
smd_raw <- read_raw_sheet("2008 მაჟორიტარული")
district_names <- district_names_from_pr(pr_raw)
candidate_lookup <- build_candidate_lookup()

pr_vote_cols <- seq(9, 31, by = 2)
smd_vote_cols <- 12:23

pr_wide <- aggregate_precinct_votes(
  build_pr_base(pr_raw, smd_raw),
  make_vote_wide(pr_raw, pr_vote_cols, PR_CODES),
  paste0("code_", PR_CODES)
)
smd_wide <- aggregate_precinct_votes(
  build_smd_base(smd_raw, district_names),
  make_vote_wide(smd_raw, smd_vote_cols, SMD_CODES),
  paste0("code_", SMD_CODES)
)

pr <- build_vote_outputs(pr_wide, PR_CODES, "pr")
smd <- build_vote_outputs(smd_wide, SMD_CODES, "smd", candidate_lookup)

PR_RESULT_COLS <- c(
  "district_id", "district_name_ka", "party_id", "votes", "vote_share", "registered", "voted",
  "voted_noon", "voted_5pm", "main_list", "special_list",
  "turnout_pct", "noon_pct", "five_pct", "invalid_ballots", "invalid_pct"
)

PR_PRECINCT_COLS <- c(
  "precinct_id", "district_id", "electoral_district_id", "district_name_ka", "precinct_number",
  "party_id", "votes", "vote_share", "registered", "voted",
  "voted_noon", "voted_5pm", "turnout_pct", "noon_pct", "five_pct", "invalid_ballots", "invalid_pct"
)

SMD_RESULT_COLS <- c(
  "district_id", "district_name_ka", "party_id", "name_ka", "votes", "vote_share", "registered", "voted",
  "voted_noon", "voted_5pm", "main_list", "special_list",
  "turnout_pct", "noon_pct", "five_pct", "invalid_ballots", "invalid_pct"
)

SMD_PRECINCT_COLS <- c(
  "precinct_id", "district_id", "electoral_district_id", "district_name_ka", "precinct_number",
  "party_id", "name_ka", "votes", "vote_share", "registered", "voted",
  "voted_noon", "voted_5pm", "turnout_pct", "noon_pct", "five_pct", "invalid_ballots", "invalid_pct"
)

TURNOUT_COLS <- c(
  "district_id", "vote_type", "district_name_ka", "registered", "voted", "turnout_pct",
  "voted_noon", "voted_5pm", "main_list", "special_list", "noon_pct", "five_pct",
  "invalid_ballots", "invalid_pct"
)

TURNOUT_PRECINCT_COLS <- c(
  "precinct_id", "district_id", "electoral_district_id", "vote_type", "district_name_ka",
  "precinct_number", "registered", "voted", "turnout_pct", "voted_noon", "voted_5pm",
  "main_list", "special_list", "noon_pct", "five_pct", "invalid_ballots", "invalid_pct"
)

write_csv_like_js(bind_rows(pr$national, pr$district), file.path(OUT_RESULTS, "parl2008_pr.csv"), PR_RESULT_COLS)
write_csv_like_js(pr$precinct, file.path(OUT_RESULTS, "parl2008_pr_precincts.csv"), PR_PRECINCT_COLS)
write_csv_like_js(bind_rows(smd$national, smd$district), file.path(OUT_RESULTS, "parl2008_smd.csv"), SMD_RESULT_COLS)
write_csv_like_js(smd$precinct, file.path(OUT_RESULTS, "parl2008_smd_precincts.csv"), SMD_PRECINCT_COLS)
write_csv_like_js(bind_rows(pr$turnout_district, smd$turnout_district), file.path(OUT_TURNOUT, "parl2008_turnout.csv"), TURNOUT_COLS)
write_csv_like_js(bind_rows(pr$turnout_precinct, smd$turnout_precinct), file.path(OUT_TURNOUT, "parl2008_precincts_turnout.csv"), TURNOUT_PRECINCT_COLS)

write_csv_like_js(
  build_party_lists(),
  file.path(OUT_CANDIDATES, "parl2008_party_lists.csv"),
  c(
    "party_id", "party_label", "list_order", "name_ka", "first_name", "last_name",
    "birth_date", "profession", "employment_status", "partisanship", "source_page"
  )
)

write_csv_like_js(
  build_smd_candidates(candidate_lookup),
  file.path(OUT_CANDIDATES, "parl2008_smd_candidates.csv"),
  c("electoral_district_id", "raw_vote_code", "party_id", "name_ka", "first_name", "last_name", "party_label")
)

write_csv_like_js(
  build_elected(),
  file.path(OUT_CANDIDATES, "parl2008_elected.csv"),
  c("election_type", "mandate_type", "party_id", "party_label", "elected_order", "district_id", "district_name_ka", "name_ka", "first_name", "last_name")
)

write_csv_like_js(
  build_annulled_precincts(),
  file.path(OUT_CANDIDATES, "parl2008_annulled_precincts.csv"),
  c("order_id", "electoral_district_id", "district_name_ka", "precinct_number", "precinct_id", "number_of_voters", "reason")
)

message("Wrote 2008 parliamentary results, turnout, candidate, elected, and annulled-precinct CSVs.")
