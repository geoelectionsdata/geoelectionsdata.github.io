#!/usr/bin/env Rscript
# Processes raw precinct-level data for the 2012 Georgian parliamentary election.

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

RESULTS_FILE <- file.path(RAW_DIR, "2012 პარლამენტი მაჟორიტარული პროპორციული.xlsx")
PARTY_LISTS_FILE <- file.path(RAW_DIR, "party_lists_2012_georgia_unified.xlsx")
ELECTED_FILE <- file.path(RAW_DIR, "elected_shemajamebeli_2012.xlsx")

SUM_COLS <- c(
  "main_list", "special_list", "voted_noon", "voted_5pm", "voted",
  "valid_ballots", "invalid_ballots", "totalVotes"
)

RATIO_COLS <- c("vote_share", "turnout_pct", "noon_pct", "five_pct", "invalid_pct")

BALLOT_PARTY_MAP <- c(
  "1" = "free_georgia",
  "4" = "ndp_2012",
  "5" = "unm",
  "9" = "fair_georgia_2012",
  "10" = "christian_democrats_2012",
  "17" = "peoples_movement_2012",
  "19" = "freedom_gamsakhurdia",
  "23" = "georgian_group",
  "24" = "new_rights_2012",
  "26" = "peoples_party",
  "30" = "kostava_society",
  "35" = "future_georgia",
  "36" = "workers_socialist",
  "38" = "labour",
  "40" = "sports_union_2012",
  "41" = "gd",
  "42" = "initiative_group"
)

PR_CODES <- c(1, 4, 5, 9, 10, 17, 19, 23, 24, 26, 30, 35, 36, 38, 40, 41)
SMD_CODES <- c(PR_CODES, 42)

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
    col_names = FALSE,
    skip = 1,
    guess_max = 100000,
    .name_repair = "minimal"
  )
}

make_vote_wide <- function(df, start_col, codes) {
  vals <- lapply(seq_along(codes), function(i) num_col(df, start_col + i - 1L))
  names(vals) <- paste0("code_", codes)
  as_tibble(vals, .name_repair = "minimal")
}

parse_district_code <- function(x) {
  suppressWarnings(as.integer(str_match(cell_str(x), "№\\s*(\\d+)")[, 2]))
}

parse_district_name <- function(x) {
  str_squish(str_remove(cell_str(x), "^№\\s*\\d+\\s*"))
}

party_id_from_label <- function(x) {
  label <- str_to_lower(cell_str(x))
  case_when(
    str_detect(label, "ქართული ოცნება") ~ "gd",
    str_detect(label, "ნაციონალური") ~ "unm",
    str_detect(label, "თავისუფალი საქართველო") ~ "free_georgia",
    str_detect(label, "ეროვნულ-დემოკრატ") ~ "ndp_2012",
    str_detect(label, "სამართლიანი") ~ "fair_georgia_2012",
    str_detect(label, "ქრისტიან") ~ "christian_democrats_2012",
    str_detect(label, "სახალხო მოძრაობა") ~ "peoples_movement_2012",
    str_detect(label, "ზვიად") ~ "freedom_gamsakhurdia",
    str_detect(label, "ქართული დასი") ~ "georgian_group",
    str_detect(label, "მემარჯვენ") ~ "new_rights_2012",
    str_detect(label, "სახალხო პარტია") ~ "peoples_party",
    str_detect(label, "კოსტავ") ~ "kostava_society",
    str_detect(label, "მომავალი") ~ "future_georgia",
    str_detect(label, "მშრომელ") ~ "workers_socialist",
    str_detect(label, "ლეიბორისტ") ~ "labour",
    str_detect(label, "სპორტსმენ") ~ "sports_union_2012",
    str_detect(label, "საინიციატივო") ~ "initiative_group",
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

build_base <- function(raw, invalid_col) {
  tibble(
    raw_district = str_col(raw, 1),
    electoral_district_id = parse_district_code(raw[[1]]),
    district_name_ka = parse_district_name(raw[[1]]),
    precinct_number = as.integer(num_col(raw, 2)),
    attached_precinct = str_col(raw, 3),
    main_list = num_col(raw, 4),
    special_list = num_col(raw, 5),
    voted_noon = num_col(raw, 6),
    voted_5pm = num_col(raw, 7),
    voted = num_col(raw, 8),
    invalid_ballots = num_col(raw, invalid_col)
  ) %>%
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

build_pr_outputs <- function(pr_raw) {
  vote_cols <- paste0("code_", PR_CODES)
  base <- build_base(pr_raw, invalid_col = 25)
  pr_wide <- aggregate_precinct_votes(base, make_vote_wide(pr_raw, 9, PR_CODES), vote_cols)

  pr_long <- pr_wide %>%
    pivot_longer(all_of(vote_cols), names_to = "code_col", values_to = "votes") %>%
    mutate(
      code = as.integer(str_remove(code_col, "^code_")),
      party_id = unname(BALLOT_PARTY_MAP[as.character(code)])
    )

  totals_national <- sum_totals(pr_wide)
  pr_national <- pr_long %>%
    group_by(party_id) %>%
    summarise(votes = sum(votes, na.rm = TRUE), .groups = "drop") %>%
    mutate(district_id = "national", district_name_ka = "ეროვნული") %>%
    bind_cols(totals_national[rep(1, nrow(.)), ]) %>%
    add_metrics()

  totals_district <- sum_totals(pr_wide, "electoral_district_id")
  pr_district <- pr_long %>%
    group_by(electoral_district_id, district_name_ka, party_id) %>%
    summarise(votes = sum(votes, na.rm = TRUE), .groups = "drop") %>%
    left_join(totals_district, by = "electoral_district_id") %>%
    mutate(district_id = as.character(electoral_district_id)) %>%
    add_metrics()

  pr_precinct <- pr_long %>%
    mutate(
      district_id = as.character(precinct_id),
      electoral_district_id = as.character(electoral_district_id)
    ) %>%
    add_metrics() %>%
    arrange(precinct_order, match(code, PR_CODES))

  turnout_district <- bind_rows(
    pr_wide %>%
      summarise(across(all_of(SUM_COLS), ~ sum(.x, na.rm = TRUE))) %>%
      mutate(district_id = "national", vote_type = "pr", district_name_ka = "ეროვნული"),
    pr_wide %>%
      group_by(electoral_district_id, district_name_ka) %>%
      summarise(across(all_of(SUM_COLS), ~ sum(.x, na.rm = TRUE)), .groups = "drop") %>%
      mutate(district_id = as.character(electoral_district_id), vote_type = "pr")
  ) %>%
    add_turnout_metrics() %>%
    arrange(if_else(district_id == "national", 0L, 1L), suppressWarnings(as.integer(district_id)))

  turnout_precinct <- pr_wide %>%
    mutate(
      district_id = as.character(precinct_id),
      electoral_district_id = as.character(electoral_district_id),
      vote_type = "pr"
    ) %>%
    add_turnout_metrics() %>%
    arrange(precinct_order)

  list(
    wide = pr_wide,
    national = pr_national,
    district = pr_district,
    precinct = pr_precinct,
    turnout_district = turnout_district,
    turnout_precinct = turnout_precinct
  )
}

build_candidate_lookup <- function() {
  read_excel(RESULTS_FILE, sheet = "majoritarebi", guess_max = 100000) %>%
    transmute(
      electoral_district_id = as.integer(.data[["ოლქის ნომერი"]]),
      presenter = cell_str(.data[["წარმდგენი"]]),
      ballot_code = as.integer(str_match(presenter, "^\\s*(\\d+)\\s*\\.")[, 2]),
      raw_vote_code = if_else(ballot_code == 99L, 42L, ballot_code),
      party_id = if_else(ballot_code == 99L, "initiative_group", unname(BALLOT_PARTY_MAP[as.character(ballot_code)])),
      first_name = cell_str(.data[["სახელი"]]),
      last_name = cell_str(.data[["გვარი"]]),
      name_ka = str_squish(paste(first_name, last_name))
    ) %>%
    filter(!is.na(electoral_district_id), !is.na(raw_vote_code), party_id != "unknown") %>%
    arrange(electoral_district_id, raw_vote_code, name_ka)
}

build_smd_outputs <- function(smd_raw, candidate_lookup) {
  vote_cols <- paste0("code_", SMD_CODES)
  base <- build_base(smd_raw, invalid_col = 26)
  smd_wide <- aggregate_precinct_votes(base, make_vote_wide(smd_raw, 9, SMD_CODES), vote_cols)

  smd_long <- smd_wide %>%
    pivot_longer(all_of(vote_cols), names_to = "code_col", values_to = "votes") %>%
    mutate(raw_vote_code = as.integer(str_remove(code_col, "^code_"))) %>%
    left_join(
      candidate_lookup %>% select(electoral_district_id, raw_vote_code, party_id, name_ka),
      by = c("electoral_district_id", "raw_vote_code")
    ) %>%
    filter(!is.na(party_id))

  totals_national <- sum_totals(smd_wide)
  smd_national <- smd_long %>%
    group_by(party_id) %>%
    summarise(votes = sum(votes, na.rm = TRUE), .groups = "drop") %>%
    mutate(district_id = "national", district_name_ka = "ეროვნული", name_ka = "") %>%
    bind_cols(totals_national[rep(1, nrow(.)), ]) %>%
    add_metrics()

  totals_district <- sum_totals(smd_wide, "electoral_district_id")
  smd_district <- smd_long %>%
    group_by(electoral_district_id, district_name_ka, party_id, name_ka) %>%
    summarise(votes = sum(votes, na.rm = TRUE), .groups = "drop") %>%
    left_join(totals_district, by = "electoral_district_id") %>%
    mutate(district_id = as.character(electoral_district_id)) %>%
    add_metrics()

  smd_precinct <- smd_long %>%
    filter(votes != 0 | !is.na(name_ka)) %>%
    mutate(
      district_id = as.character(precinct_id),
      electoral_district_id = as.character(electoral_district_id)
    ) %>%
    add_metrics() %>%
    arrange(precinct_order, raw_vote_code)

  list(
    wide = smd_wide,
    national = smd_national,
    district = smd_district,
    precinct = smd_precinct
  )
}

build_party_lists <- function() {
  read_excel(PARTY_LISTS_FILE, sheet = "party lists", guess_max = 100000) %>%
    transmute(
      party_id = party_id_from_label(party_name),
      party_label = cell_str(party_name),
      list_order = as.integer(order_id),
      first_name = cell_str(first_name),
      last_name = cell_str(last_name),
      name_ka = str_squish(paste(first_name, last_name)),
      smd_code = cell_str(smd_code),
      smd_name = cell_str(smd_name),
      birth_date = if_else(
        cell_str(birth_year) != "",
        paste(cell_str(birth_year), str_pad(cell_str(birth_month), 2, pad = "0"), str_pad(cell_str(birth_day), 2, pad = "0"), sep = "-"),
        ""
      ),
      address = cell_str(address),
      workplace = cell_str(workplace),
      position = cell_str(position),
      partisanship = cell_str(partisanship),
      gender = cell_str(gender),
      source_file = cell_str(source_file),
      source_page = cell_str(source_page)
    ) %>%
    arrange(match(party_id, unname(BALLOT_PARTY_MAP[as.character(PR_CODES)])), list_order)
}

build_smd_candidates <- function(candidate_lookup) {
  candidate_lookup %>%
    transmute(
      electoral_district_id = as.character(electoral_district_id),
      raw_vote_code = as.character(raw_vote_code),
      ballot_code = as.character(ballot_code),
      party_id,
      name_ka,
      first_name,
      last_name,
      presenter
    )
}

build_elected <- function() {
  read_excel(ELECTED_FILE, sheet = "elected representatives", guess_max = 100000) %>%
    transmute(
      election_type = cell_str(election_type),
      mandate_type = if_else(election_type == "pr", "party_list", "single_mandate_district"),
      party_id = party_id_from_label(party_name),
      party_label = cell_str(party_name),
      elected_order = as.integer(order_id),
      district_id = cell_str(district_code),
      district_name_ka = cell_str(district_name),
      first_name = cell_str(first_name),
      last_name = cell_str(last_name),
      name_ka = str_squish(paste(first_name, last_name))
    )
}

build_annulled_precincts <- function() {
  read_excel(ELECTED_FILE, sheet = "annulled precincts", guess_max = 100000) %>%
    transmute(
      order_id = as.integer(order_id),
      electoral_district_id = as.character(as.integer(district_code)),
      district_name_ka = cell_str(district_name),
      precinct_number = as.integer(precinct_no),
      precinct_id = as.character(as.integer(district_code) * 1000L + as.integer(precinct_no)),
      number_of_voters = as.integer(number_of_voters),
      reason = cell_str(reason)
    )
}

pr_raw <- read_raw_sheet("shedegebi2012_prop_ubn")
smd_raw <- read_raw_sheet("shedegebi2012_major_ubn")
candidate_lookup <- build_candidate_lookup()

pr <- build_pr_outputs(pr_raw)
smd <- build_smd_outputs(smd_raw, candidate_lookup)

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

write_csv_like_js(bind_rows(pr$national, pr$district), file.path(OUT_RESULTS, "parl2012_pr.csv"), PR_RESULT_COLS)
write_csv_like_js(pr$precinct, file.path(OUT_RESULTS, "parl2012_pr_precincts.csv"), PR_PRECINCT_COLS)
write_csv_like_js(bind_rows(smd$national, smd$district), file.path(OUT_RESULTS, "parl2012_smd.csv"), SMD_RESULT_COLS)
write_csv_like_js(smd$precinct, file.path(OUT_RESULTS, "parl2012_smd_precincts.csv"), SMD_PRECINCT_COLS)
write_csv_like_js(pr$turnout_district, file.path(OUT_TURNOUT, "parl2012_turnout.csv"), TURNOUT_COLS)
write_csv_like_js(pr$turnout_precinct, file.path(OUT_TURNOUT, "parl2012_precincts_turnout.csv"), TURNOUT_PRECINCT_COLS)

write_csv_like_js(
  build_party_lists(),
  file.path(OUT_CANDIDATES, "parl2012_party_lists.csv"),
  c(
    "party_id", "party_label", "list_order", "name_ka", "first_name", "last_name",
    "smd_code", "smd_name", "birth_date", "address", "workplace", "position",
    "partisanship", "gender", "source_file", "source_page"
  )
)

write_csv_like_js(
  build_smd_candidates(candidate_lookup),
  file.path(OUT_CANDIDATES, "parl2012_smd_candidates.csv"),
  c("electoral_district_id", "raw_vote_code", "ballot_code", "party_id", "name_ka", "first_name", "last_name", "presenter")
)

write_csv_like_js(
  build_elected(),
  file.path(OUT_CANDIDATES, "parl2012_elected.csv"),
  c("election_type", "mandate_type", "party_id", "party_label", "elected_order", "district_id", "district_name_ka", "name_ka", "first_name", "last_name")
)

write_csv_like_js(
  build_annulled_precincts(),
  file.path(OUT_CANDIDATES, "parl2012_annulled_precincts.csv"),
  c("order_id", "electoral_district_id", "district_name_ka", "precinct_number", "precinct_id", "number_of_voters", "reason")
)

message("Wrote 2012 parliamentary results, turnout, candidate, elected, and annulled-precinct CSVs.")
