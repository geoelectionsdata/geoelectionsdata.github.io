#!/usr/bin/env Rscript
# Processes raw precinct-level data for the 2008 Adjara Supreme Council election.

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
OUT_CANDIDATES <- Sys.getenv("OUT_CANDIDATES", unset = file.path(OUT_ROOT, "candidates"))

RESULTS_FILE <- file.path(RAW_DIR, "adjara_2008_results.xlsx")
CANDIDATE_FILE <- file.path(RAW_DIR, "adjara_2008_candidates.xlsx")

PARTIES <- tibble(
  code = 1:8,
  vote_col = c(
    "ertiani_komuisturi_partia",
    "kartuli_dasi",
    "mretsveloba_mgs",
    "chven_tviton",
    "unm",
    "conservatives",
    "kartuli_politika",
    "christian_democrats"
  ),
  party_id = c(
    "adj2008_united_communist",
    "adj2008_kartuli_dasi",
    "industry_sakartvelo",
    "adj2008_chven_tviton",
    "unm",
    "conservatives",
    "adj2008_georgian_politics",
    "christian_democrats_2008"
  )
)

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

sum_totals <- function(df, group_cols = NULL) {
  if (is.null(group_cols)) {
    df %>% summarise(across(all_of(SUM_COLS), ~ sum(.x, na.rm = TRUE)))
  } else {
    df %>%
      group_by(across(all_of(group_cols))) %>%
      summarise(across(all_of(SUM_COLS), ~ sum(.x, na.rm = TRUE)), .groups = "drop")
  }
}

attach_totals <- function(df, totals) {
  for (col in SUM_COLS) df[[col]] <- totals[[col]][[1]]
  df
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

party_id_from_code <- function(code) {
  unname(PARTIES$party_id[match(as.integer(code), PARTIES$code)])
}

party_id_from_label <- function(label) {
  label <- str_to_lower(cell_str(label))
  case_when(
    str_detect(label, "კომუნისტ") ~ "adj2008_united_communist",
    str_detect(label, "ქართული დასი") ~ "adj2008_kartuli_dasi",
    str_detect(label, "მრეწველ") ~ "industry_sakartvelo",
    str_detect(label, "ჩვენ თვითონ") ~ "adj2008_chven_tviton",
    str_detect(label, "ნაციონალური მოძრაობა") ~ "unm",
    str_detect(label, "კონსერვატიული") ~ "conservatives",
    str_detect(label, "ქართული პოლიტიკა") ~ "adj2008_georgian_politics",
    str_detect(label, "ქრისტიან") ~ "christian_democrats_2008",
    TRUE ~ NA_character_
  )
}

district_names <- tibble(
  electoral_district_id = c(79L, 80L, 81L, 82L, 83L, 84L),
  district_name_ka = c("ბათუმი", "ქედა", "ქობულეთი", "შუახევი", "ხელვაჩაური", "ხულო")
)

read_result_sheet <- function(sheet) {
  raw <- read_excel(RESULTS_FILE, sheet = sheet, guess_max = 100000, .name_repair = "unique")

  base <- raw %>%
    transmute(
      electoral_district_id = as.integer(.data[["olq"]]),
      precinct_number = as.integer(.data[["ubani"]]),
      main_list = cell_num(.data[["amom_ert"]]),
      special_list = cell_num(.data[["amom_spec"]]),
      voted_noon = cell_num(.data[["aqtiv12"]]),
      voted_5pm = cell_num(.data[["aqtiv17"]]),
      voted = cell_num(.data[["monac"]]),
      invalid_ballots = cell_num(.data[["biul_bat"]])
    ) %>%
    left_join(district_names, by = "electoral_district_id") %>%
    filter(!is.na(electoral_district_id), !is.na(precinct_number), precinct_number > 0) %>%
    mutate(
      precinct_id = electoral_district_id * 1000L + precinct_number,
      precinct_key = as.character(precinct_id),
      district_id = as.character(electoral_district_id),
      precinct_order = row_number()
    )

  votes_wide <- as_tibble(
    setNames(
      lapply(PARTIES$vote_col, function(col) cell_num(raw[[col]])),
      paste0("code_", PARTIES$code)
    ),
    .name_repair = "minimal"
  )

  bind_cols(base, votes_wide) %>%
    mutate(
      valid_ballots = rowSums(across(starts_with("code_")), na.rm = TRUE),
      totalVotes = valid_ballots
    )
}

build_vote_outputs <- function(wide, vote_type, candidate_lookup = NULL) {
  vote_cols <- paste0("code_", PARTIES$code)

  long <- wide %>%
    pivot_longer(all_of(vote_cols), names_to = "vote_col", values_to = "votes") %>%
    mutate(
      code = as.integer(str_remove(vote_col, "^code_")),
      code_order = match(code, PARTIES$code),
      party_id = party_id_from_code(code)
    )

  if (!is.null(candidate_lookup)) {
    long <- long %>%
      left_join(candidate_lookup, by = c("electoral_district_id", "code")) %>%
      mutate(
        name_ka = coalesce(name_ka, ""),
        first_name = coalesce(first_name, ""),
        last_name = coalesce(last_name, ""),
        party_label = coalesce(party_label, "")
      )
  } else {
    long <- long %>%
      mutate(name_ka = "", first_name = "", last_name = "", party_label = "")
  }

  base <- wide %>%
    distinct(
      precinct_id, precinct_key, electoral_district_id, district_name_ka,
      precinct_number, across(all_of(SUM_COLS))
    )

  national_totals <- sum_totals(base)
  district_totals <- sum_totals(base, "electoral_district_id")

  national_groups <- if (is.null(candidate_lookup)) c("party_id", "code_order") else c("party_id")
  national <- long %>%
    group_by(across(all_of(national_groups))) %>%
    summarise(
      votes = sum(votes, na.rm = TRUE),
      code_order = min(code_order, na.rm = TRUE),
      .groups = "drop"
    ) %>%
    filter(vote_type == "pr" | votes != 0) %>%
    mutate(district_id = "national", district_name_ka = "აჭარა", name_ka = "") %>%
    attach_totals(national_totals) %>%
    add_metrics() %>%
    arrange(code_order)

  district_groups <- if (is.null(candidate_lookup)) {
    c("electoral_district_id", "district_name_ka", "party_id", "code_order")
  } else {
    c("electoral_district_id", "district_name_ka", "party_id", "name_ka", "first_name", "last_name", "party_label", "code_order")
  }
  district <- long %>%
    filter(vote_type == "pr" | votes != 0) %>%
    group_by(across(all_of(district_groups))) %>%
    summarise(votes = sum(votes, na.rm = TRUE), .groups = "drop") %>%
    left_join(district_totals, by = "electoral_district_id") %>%
    mutate(district_id = as.character(electoral_district_id)) %>%
    add_metrics() %>%
    arrange(electoral_district_id, code_order)

  precinct <- long %>%
    filter(vote_type == "pr" | votes != 0) %>%
    mutate(
      district_id = as.character(precinct_id),
      electoral_district_id = as.character(electoral_district_id)
    ) %>%
    add_metrics() %>%
    arrange(precinct_order, code_order)

  turnout_district <- bind_rows(
    national_totals %>%
      mutate(district_id = "national", vote_type = vote_type, district_name_ka = "აჭარა"),
    district_totals %>%
      left_join(district_names, by = "electoral_district_id") %>%
      mutate(district_id = as.character(electoral_district_id), vote_type = vote_type)
  ) %>%
    mutate(
      registered = main_list + special_list,
      turnout_pct = safe_ratio(voted, registered),
      noon_pct = safe_ratio(voted_noon, registered),
      five_pct = safe_ratio(voted_5pm, registered),
      invalid_pct = safe_ratio(invalid_ballots, voted)
    ) %>%
    arrange(if_else(district_id == "national", 0L, 1L), suppressWarnings(as.integer(district_id)))

  turnout_precinct <- base %>%
    mutate(
      district_id = as.character(precinct_id),
      electoral_district_id = as.character(electoral_district_id),
      vote_type = vote_type,
      registered = main_list + special_list,
      turnout_pct = safe_ratio(voted, registered),
      noon_pct = safe_ratio(voted_noon, registered),
      five_pct = safe_ratio(voted_5pm, registered),
      invalid_pct = safe_ratio(invalid_ballots, voted)
    ) %>%
    arrange(precinct_id)

  list(
    national = national,
    district = district,
    precinct = precinct,
    turnout_district = turnout_district,
    turnout_precinct = turnout_precinct
  )
}

build_smd_candidates <- function() {
  read_excel(CANDIDATE_FILE, sheet = "smd", guess_max = 100000, .name_repair = "unique") %>%
    transmute(
      electoral_district_id = as.integer(.data[["district_id"]]),
      district_name_ka = cell_str(.data[["district_name"]]),
      code = as.integer(.data[["id"]]),
      ballot_number = code,
      party_id = party_id_from_code(code),
      party_label = cell_str(.data[["party_name"]]),
      last_name = cell_str(.data[["last_name"]]),
      first_name = cell_str(.data[["first_name"]]),
      name_ka = str_squish(paste(first_name, last_name))
    ) %>%
    filter(!is.na(electoral_district_id), !is.na(code), !is.na(party_id), name_ka != "") %>%
    group_by(electoral_district_id, code) %>%
    slice(1) %>%
    ungroup() %>%
    arrange(electoral_district_id, code) %>%
    mutate(candidate_order = row_number())
}

build_party_lists <- function() {
  read_excel(CANDIDATE_FILE, sheet = "party_lists", guess_max = 100000, .name_repair = "unique") %>%
    transmute(
      party_id = party_id_from_label(.data[["party_name"]]),
      party_list_name = cell_str(.data[["party_name"]]),
      order_id = as.integer(.data[["order_id"]]),
      last_name = cell_str(.data[["last_name"]]),
      first_name = cell_str(.data[["first_name"]]),
      name_ka = str_squish(paste(first_name, last_name)),
      birth_date = if_else(
        !is.na(.data[["year"]]),
        paste(
          str_pad(as.integer(.data[["year"]]), 4, pad = "0"),
          str_pad(as.integer(.data[["month"]]), 2, pad = "0"),
          str_pad(as.integer(.data[["day"]]), 2, pad = "0"),
          sep = "-"
        ),
        ""
      ),
      education = cell_str(.data[["education"]]),
      workplace = cell_str(.data[["workplace"]]),
      partisanship = cell_str(.data[["partisanship"]])
    ) %>%
    filter(!is.na(party_id), name_ka != "") %>%
    arrange(match(party_id, PARTIES$party_id), order_id)
}

pr_wide <- read_result_sheet("proportional")
smd_wide <- read_result_sheet("majoritarian")
smd_candidates <- build_smd_candidates()

pr <- build_vote_outputs(pr_wide, "pr")
smd <- build_vote_outputs(
  smd_wide,
  "smd",
  smd_candidates %>%
    select(electoral_district_id, code, name_ka, first_name, last_name, party_label)
)

PR_RESULT_COLS <- c(
  "district_id", "district_name_ka", "party_id", "votes", "vote_share", "registered", "voted",
  "voted_noon", "voted_5pm", "main_list", "special_list",
  "turnout_pct", "noon_pct", "five_pct", "invalid_ballots", "invalid_pct"
)

PR_PRECINCT_COLS <- c(
  "precinct_id", "precinct_key", "district_id", "electoral_district_id", "district_name_ka", "precinct_number",
  "party_id", "votes", "vote_share", "registered", "voted",
  "voted_noon", "voted_5pm", "turnout_pct", "noon_pct", "five_pct", "invalid_ballots", "invalid_pct"
)

SMD_RESULT_COLS <- c(
  "district_id", "district_name_ka", "party_id", "name_ka", "votes", "vote_share", "registered", "voted",
  "voted_noon", "voted_5pm", "main_list", "special_list",
  "turnout_pct", "noon_pct", "five_pct", "invalid_ballots", "invalid_pct"
)

SMD_PRECINCT_COLS <- c(
  "precinct_id", "precinct_key", "district_id", "electoral_district_id", "district_name_ka", "precinct_number",
  "party_id", "name_ka", "votes", "vote_share", "registered", "voted",
  "voted_noon", "voted_5pm", "turnout_pct", "noon_pct", "five_pct", "invalid_ballots", "invalid_pct"
)

TURNOUT_COLS <- c(
  "district_id", "vote_type", "district_name_ka", "registered", "voted", "turnout_pct",
  "voted_noon", "voted_5pm", "main_list", "special_list", "noon_pct", "five_pct",
  "invalid_ballots", "invalid_pct"
)

TURNOUT_PRECINCT_COLS <- c(
  "precinct_id", "precinct_key", "district_id", "electoral_district_id", "vote_type", "district_name_ka",
  "precinct_number", "registered", "voted", "turnout_pct", "voted_noon", "voted_5pm",
  "main_list", "special_list", "noon_pct", "five_pct", "invalid_ballots", "invalid_pct"
)

SMD_CANDIDATE_COLS <- c(
  "electoral_district_id", "district_name_ka", "ballot_number", "party_id",
  "party_label", "name_ka", "first_name", "last_name", "candidate_order"
)

PARTY_LIST_COLS <- c(
  "party_id", "party_list_name", "order_id", "name_ka", "first_name", "last_name",
  "birth_date", "education", "workplace", "partisanship"
)

write_csv_like_js(bind_rows(pr$national, pr$district), file.path(OUT_RESULTS, "adj2008_pr.csv"), PR_RESULT_COLS)
write_csv_like_js(pr$precinct, file.path(OUT_RESULTS, "adj2008_pr_precincts.csv"), PR_PRECINCT_COLS)
write_csv_like_js(bind_rows(smd$national, smd$district), file.path(OUT_RESULTS, "adj2008_smd.csv"), SMD_RESULT_COLS)
write_csv_like_js(smd$precinct, file.path(OUT_RESULTS, "adj2008_smd_precincts.csv"), SMD_PRECINCT_COLS)
write_csv_like_js(bind_rows(pr$turnout_district, smd$turnout_district), file.path(OUT_TURNOUT, "adj2008_turnout.csv"), TURNOUT_COLS)
write_csv_like_js(bind_rows(pr$turnout_precinct, smd$turnout_precinct), file.path(OUT_TURNOUT, "adj2008_precincts_turnout.csv"), TURNOUT_PRECINCT_COLS)
write_csv_like_js(build_party_lists(), file.path(OUT_CANDIDATES, "adj2008_party_lists.csv"), PARTY_LIST_COLS)
write_csv_like_js(
  smd_candidates %>% select(all_of(SMD_CANDIDATE_COLS)),
  file.path(OUT_CANDIDATES, "adj2008_smd_candidates.csv"),
  SMD_CANDIDATE_COLS
)

cat("\nDone.\n")
cat(sprintf("  PR: %d district rows, %d precinct rows\n", nrow(bind_rows(pr$national, pr$district)), nrow(pr$precinct)))
cat(sprintf("  SMD: %d district rows, %d precinct rows\n", nrow(bind_rows(smd$national, smd$district)), nrow(smd$precinct)))
cat(sprintf("  Turnout: %d district rows, %d precinct rows\n", nrow(bind_rows(pr$turnout_district, smd$turnout_district)), nrow(bind_rows(pr$turnout_precinct, smd$turnout_precinct))))
cat(sprintf("  Candidates: %d party-list rows, %d SMD rows\n", nrow(build_party_lists()), nrow(smd_candidates)))
