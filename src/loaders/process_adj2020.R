#!/usr/bin/env Rscript
# src/loaders/process_adj2020.R
#
# Processes raw precinct-level data for the 2020 Adjara Supreme Council election.
# Run from project root:
#   Rscript src/loaders/process_adj2020.R
#
# Optional test output root:
#   Rscript src/loaders/process_adj2020.R tmp/adj2020_r_test

suppressPackageStartupMessages({
  library(readxl)
  library(dplyr)
  library(tidyr)
  library(stringr)
})

args <- commandArgs(trailingOnly = TRUE)
args <- args[args != "--args"]

RAW_DIR <- Sys.getenv("RAW_DIR", unset = "src/data/raw")
ADJ_RAW_DIR <- file.path(RAW_DIR, "2020 აჭარა")
OUT_ROOT <- if (length(args) >= 1) args[[1]] else Sys.getenv("OUT_ROOT", unset = "src/data")
OUT_RESULTS <- Sys.getenv("OUT_RESULTS", unset = file.path(OUT_ROOT, "results"))
OUT_TURNOUT <- Sys.getenv("OUT_TURNOUT", unset = file.path(OUT_ROOT, "turnout"))
OUT_CANDIDATES <- Sys.getenv("OUT_CANDIDATES", unset = file.path(OUT_ROOT, "candidates"))

SUM_COLS <- c(
  "main_list", "special_list", "voted_noon", "voted_5pm", "voted",
  "valid_ballots", "invalid_ballots", "totalVotes"
)

RATIO_COLS <- c("vote_share", "turnout_pct", "noon_pct", "five_pct", "invalid_pct")

BALLOT_PARTY_MAP <- c(
  "2" = "european_georgia",
  "3" = "democratic_movement",
  "4" = "tribuna",
  "5" = "unm",
  "8" = "patriots",
  "10" = "labour",
  "14" = "georgian_choice",
  "17" = "victorious_georgia",
  "19" = "alliance",
  "21" = "free_georgia",
  "24" = "citizens",
  "26" = "justice",
  "27" = "agmashenebeli",
  "31" = "freedom_gamsakhurdia",
  "34" = "social_justice_2020",
  "36" = "girchi",
  "41" = "gd",
  "44" = "georgian_idea",
  "47" = "conservatives",
  "55" = "georgian_march",
  "56" = "lelo",
  "61" = "face_plus"
)

PARTY_LIST_NUMBER_MAP <- c(
  "1" = "face_plus",
  "2" = "patriots",
  "3" = "democratic_movement",
  "4" = "freedom_gamsakhurdia",
  "5" = "georgian_idea",
  "6" = "european_georgia",
  "7" = "georgian_march",
  "8" = "labour",
  "9" = "free_georgia",
  "10" = "agmashenebeli",
  "11" = "gd",
  "12" = "victorious_georgia",
  "13" = "tribuna",
  "14" = "social_justice_2020",
  "15" = "justice",
  "16" = "lelo",
  "17" = "alliance",
  "18" = "independent",
  "19" = "citizens",
  "20" = "unm",
  "21" = "georgian_choice",
  "22" = "girchi"
)

PR_CODES <- as.integer(names(BALLOT_PARTY_MAP))
PR_PARTIES <- unname(BALLOT_PARTY_MAP)
SMD_CODES <- c(2, 3, 4, 5, 8, 10, 14, 17, 19, 21, 24, 26, 27, 34, 41, 44, 47, 55, 56, 61)
RUNOFF_CODES <- c(5, 41)

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
  df <- df %>% mutate(across(any_of(RATIO_COLS), format_ratio))

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

read_raw_sheet <- function(path, sheet) {
  read_excel(path, sheet = sheet, col_names = FALSE, guess_max = 100000, .name_repair = "minimal")
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
    precinct_id = dd * 1000L + pp,
    precinct_key = code,
    valid_precinct = valid
  )
}

find_file <- function(pattern) {
  matches <- list.files(ADJ_RAW_DIR, pattern = pattern, full.names = TRUE)
  matches <- matches[!str_detect(basename(matches), "^~\\$")]
  if (length(matches) != 1L) {
    stop("Could not uniquely identify raw file for pattern: ", pattern, call. = FALSE)
  }
  matches[[1]]
}

batumi_file <- function(round = c("first", "runoff")) {
  round <- match.arg(round)
  files <- list.files(ADJ_RAW_DIR, pattern = "\\.xlsx$", full.names = TRUE)
  files <- files[
    !str_detect(basename(files), "^~\\$") &
      !str_detect(basename(files), "adjara_2020_candidates") &
      !str_detect(basename(files), "^(2020\\s+29|80|83|84|შუახევი)")
  ]
  sheet_counts <- vapply(files, function(path) length(excel_sheets(path)), integer(1))
  matches <- if (round == "first") files[sheet_counts == 2L] else files[sheet_counts == 1L]
  if (length(matches) != 1L) {
    stop("Could not uniquely identify Batumi ", round, " workbook", call. = FALSE)
  }
  matches[[1]]
}

vote_col_map <- function(header_row, codes) {
  header <- cell_str(unlist(header_row, use.names = FALSE))
  parsed_codes <- suppressWarnings(as.integer(str_match(header, "^\\s*(?:vote_)?\\s*(\\d+)")[, 2]))
  tibble(
    code = codes,
    vote_col = paste0("code_", codes),
    party_id = unname(BALLOT_PARTY_MAP[as.character(codes)]),
    code_order = seq_along(codes),
    source_col = vapply(codes, function(code) {
      idx <- which(parsed_codes == code)
      if (length(idx) == 0) NA_integer_ else idx[[1]]
    }, integer(1))
  )
}

make_vote_wide <- function(body, col_map) {
  vals <- lapply(col_map$source_col, function(col) {
    if (is.na(col)) rep(0, nrow(body)) else num_col(body, col)
  })
  names(vals) <- col_map$vote_col
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

read_result_long <- function(path, sheet, layout, codes) {
  cat("Reading:", basename(path), "sheet", sheet, "\n")
  raw <- read_raw_sheet(path, sheet)
  header <- raw[1, , drop = FALSE]
  body <- raw[-1, , drop = FALSE]
  col_map <- vote_col_map(header, codes)
  votes_wide <- make_vote_wide(body, col_map)
  parsed <- parse_precinct(str_col(body, layout$precinct_col))

  base_all <- bind_cols(
    parsed,
    tibble(
      main_list = num_col(body, layout$main_col),
      special_list = num_col(body, layout$special_col),
      voted_noon = num_col(body, layout$noon_col),
      voted_5pm = num_col(body, layout$five_col),
      voted = num_col(body, layout$voted_col),
      valid_ballots = num_col(body, layout$valid_col),
      invalid_ballots = num_col(body, layout$invalid_col),
      totalVotes = rowSums(as.data.frame(votes_wide), na.rm = TRUE)
    )
  )

  valid_idx <- which(base_all$valid_precinct)
  base <- base_all[valid_idx, ] %>%
    select(smd, dd, pp, precinct_id, precinct_key, all_of(SUM_COLS))

  bind_cols(base, votes_wide[valid_idx, , drop = FALSE]) %>%
    pivot_longer(all_of(col_map$vote_col), names_to = "vote_col", values_to = "votes") %>%
    left_join(col_map %>% select(vote_col, code, code_order, party_id), by = "vote_col") %>%
    filter(!is.na(party_id))
}

candidate_file <- file.path(ADJ_RAW_DIR, "adjara_2020_candidates_unified.xlsx")
party_list_candidates_raw <- read_excel(candidate_file, sheet = "party lists", .name_repair = "minimal")
smd_candidates_raw <- read_excel(candidate_file, sheet = "SMD candidates", .name_repair = "minimal")
elected_raw <- read_excel(candidate_file, sheet = "elected", .name_repair = "minimal")

party_list_candidates <- party_list_candidates_raw %>%
  mutate(
    party_number = as.integer(party_number),
    order_id = as.integer(order_id),
    party_id = unname(PARTY_LIST_NUMBER_MAP[as.character(party_number)]),
    name_ka = str_squish(paste(first_name, last_name))
  ) %>%
  filter(!is.na(party_id))

elected_members <- elected_raw %>%
  transmute(
    party_label = cell_str(Party),
    last_name = cell_str(`Last name`),
    first_name = cell_str(`First name`),
    elected_as = cell_str(`Elected as`)
  ) %>%
  filter(party_label != "", first_name != "", last_name != "") %>%
  mutate(
    party_id = case_when(
      str_detect(party_label, "ნაციონალური მოძრაობა") ~ "unm",
      str_detect(party_label, "ქართული ოცნება") ~ "gd",
      TRUE ~ NA_character_
    ),
    name_ka = str_squish(paste(first_name, last_name)),
    mandate_type = case_when(
      str_detect(elected_as, "^SMD") ~ "smd",
      TRUE ~ "pr"
    ),
    district_id = str_match(elected_as, "SMD,\\s*(\\d+)")[, 2],
    elected_order = row_number()
  ) %>%
  select(elected_order, party_id, party_label, name_ka, first_name, last_name, mandate_type, district_id)

candidate_lookup <- smd_candidates_raw %>%
  mutate(
    smd = as.integer(district_number),
    code = as.integer(party_number),
    party_id = unname(BALLOT_PARTY_MAP[as.character(code)]),
    name_ka = str_squish(paste(first_name, last_name)),
    candidate_order = row_number()
  ) %>%
  filter(!is.na(smd), !is.na(code), !is.na(party_id)) %>%
  select(smd, code, party_id, name_ka, candidate_order)

party_by_code <- candidate_lookup %>%
  arrange(candidate_order) %>%
  group_by(code) %>%
  summarise(party_id = first(party_id), .groups = "drop")

cat(sprintf("Candidate lookup: %d SMD candidates, %d party-list candidates\n", nrow(candidate_lookup), nrow(party_list_candidates)))

compact_no_attached <- list(precinct_col = 1L, main_col = 2L, special_col = 3L, noon_col = 4L, five_col = 5L, voted_col = 6L)
batumi_first <- list(precinct_col = 1L, main_col = 3L, special_col = 4L, noon_col = 5L, five_col = 6L, voted_col = 7L)
district_attached <- list(precinct_col = 3L, main_col = 5L, special_col = 6L, noon_col = 7L, five_col = 8L, voted_col = 9L)
runoff_district <- list(precinct_col = 3L, main_col = 4L, special_col = 5L, noon_col = 6L, five_col = 7L, voted_col = 8L)
batumi_runoff <- list(precinct_col = 1L, main_col = 3L, special_col = 4L, noon_col = 5L, five_col = 6L, voted_col = 7L)

batumi_first_file <- batumi_file("first")
batumi_runoff_file <- batumi_file("runoff")

pr_specs <- list(
  list(file = batumi_first_file, sheet = 1L, layout = c(batumi_first, list(valid_col = 31L, invalid_col = 32L))),
  list(file = find_file("29-ქობულეთი.*\\.xlsx$"), sheet = 1L, layout = c(compact_no_attached, list(valid_col = 30L, invalid_col = 31L))),
  list(file = find_file("^80-ქედა.*1.*\\.xlsx$"), sheet = 1L, layout = c(district_attached, list(valid_col = 61L, invalid_col = 62L))),
  list(file = find_file("^შუახევი.*პირველი.*\\.xlsx$"), sheet = 1L, layout = c(district_attached, list(valid_col = 33L, invalid_col = 34L))),
  list(file = find_file("^83-.*1.*\\.xlsx$"), sheet = 1L, layout = c(district_attached, list(valid_col = 33L, invalid_col = 34L))),
  list(file = find_file("^84 ხულო.*1.*\\.xlsx$"), sheet = 3L, layout = c(compact_no_attached, list(valid_col = 30L, invalid_col = 31L)))
)

smd_specs <- list(
  list(file = batumi_first_file, sheet = 2L, layout = c(compact_no_attached, list(valid_col = 27L, invalid_col = 28L))),
  list(file = find_file("29-ქობულეთი.*\\.xlsx$"), sheet = 2L, layout = c(compact_no_attached, list(valid_col = 21L, invalid_col = 22L))),
  list(file = find_file("^80-ქედა.*1.*\\.xlsx$"), sheet = 2L, layout = c(district_attached, list(valid_col = 25L, invalid_col = 26L))),
  list(file = find_file("^შუახევი.*პირველი.*\\.xlsx$"), sheet = 2L, layout = c(district_attached, list(valid_col = 25L, invalid_col = 26L))),
  list(file = find_file("^83-.*1.*\\.xlsx$"), sheet = 2L, layout = c(district_attached, list(valid_col = 25L, invalid_col = 26L))),
  list(file = find_file("^84 ხულო.*1.*\\.xlsx$"), sheet = 2L, layout = c(compact_no_attached, list(valid_col = 22L, invalid_col = 23L)))
)

runoff_specs <- list(
  list(file = batumi_runoff_file, sheet = 1L, layout = c(batumi_runoff, list(valid_col = 12L, invalid_col = 11L))),
  list(file = find_file("^80.*მეორე.*\\.xlsx$"), sheet = 1L, layout = c(runoff_district, list(valid_col = 12L, invalid_col = 13L))),
  list(file = find_file("^შუახევი.*მეორე.*\\.xlsx$"), sheet = 1L, layout = c(runoff_district, list(valid_col = 12L, invalid_col = 13L))),
  list(file = find_file("^83-.*მე-2.*\\.xlsx$"), sheet = 1L, layout = c(runoff_district, list(valid_col = 12L, invalid_col = 13L))),
  list(file = find_file("^84.*მეორე.*\\.xlsx$"), sheet = 1L, layout = c(runoff_district, list(valid_col = 12L, invalid_col = 13L)))
)

pr_long <- bind_rows(lapply(pr_specs, function(spec) {
  read_result_long(spec$file, spec$sheet, spec$layout, PR_CODES)
}))

smd_long <- bind_rows(lapply(smd_specs, function(spec) {
  read_result_long(spec$file, spec$sheet, spec$layout, SMD_CODES)
})) %>%
  left_join(candidate_lookup %>% select(smd, code, party_id, name_ka), by = c("smd", "code"), suffix = c("", "_candidate")) %>%
  mutate(
    party_id = coalesce(party_id_candidate, party_id),
    name_ka = replace_na(name_ka, "")
  ) %>%
  select(-party_id_candidate)

runoff_long <- bind_rows(lapply(runoff_specs, function(spec) {
  read_result_long(spec$file, spec$sheet, spec$layout, RUNOFF_CODES)
})) %>%
  left_join(candidate_lookup %>% select(smd, code, name_ka), by = c("smd", "code")) %>%
  mutate(name_ka = replace_na(name_ka, ""))

cat(sprintf("PR precinct rows: %d (%d unique precincts)\n", nrow(distinct(pr_long, precinct_id)), n_distinct(pr_long$precinct_id)))
cat(sprintf("SMD precinct rows: %d (%d unique precincts)\n", nrow(distinct(smd_long, precinct_id)), n_distinct(smd_long$precinct_id)))
cat(sprintf("Runoff precinct rows: %d (%d unique precincts)\n", nrow(distinct(runoff_long, precinct_id)), n_distinct(runoff_long$precinct_id)))

# PR outputs ----------------------------------------------------------------

pr_base <- pr_long %>%
  distinct(smd, dd, pp, precinct_id, precinct_key, across(all_of(SUM_COLS)))

pr_national_totals <- sum_totals(pr_base)
pr_national <- pr_long %>%
  group_by(party_id, code_order) %>%
  summarise(votes = sum(votes, na.rm = TRUE), .groups = "drop") %>%
  mutate(district_id = "national") %>%
  attach_totals(pr_national_totals) %>%
  add_metrics() %>%
  arrange(code_order)

pr_district_totals <- sum_totals(pr_base, "dd")
pr_district <- pr_long %>%
  group_by(dd, party_id, code_order) %>%
  summarise(votes = sum(votes, na.rm = TRUE), .groups = "drop") %>%
  left_join(pr_district_totals, by = "dd") %>%
  mutate(district_id = as.character(dd)) %>%
  add_metrics() %>%
  arrange(dd, code_order)

pr_precinct <- pr_long %>%
  mutate(district_id = as.character(precinct_id)) %>%
  add_metrics() %>%
  arrange(precinct_id, code_order)

PR_RESULT_COLS <- c(
  "district_id", "party_id", "votes", "vote_share", "registered", "voted",
  "voted_noon", "voted_5pm", "main_list", "special_list",
  "turnout_pct", "noon_pct", "five_pct", "invalid_ballots", "invalid_pct"
)

PR_PRECINCT_COLS <- c(
  "precinct_id", "district_id", "party_id", "votes", "vote_share",
  "registered", "voted", "voted_noon", "voted_5pm", "turnout_pct", "noon_pct", "five_pct",
  "invalid_ballots", "invalid_pct"
)

write_csv_like_js(bind_rows(pr_national, pr_district), file.path(OUT_RESULTS, "adj2020_pr.csv"), PR_RESULT_COLS)
write_csv_like_js(pr_precinct, file.path(OUT_RESULTS, "adj2020_pr_precincts.csv"), PR_PRECINCT_COLS)

# SMD outputs ---------------------------------------------------------------

smd_base <- smd_long %>%
  distinct(smd, dd, pp, precinct_id, precinct_key, across(all_of(SUM_COLS)))

smd_national_totals <- sum_totals(smd_base)
smd_national <- smd_long %>%
  group_by(code, code_order) %>%
  summarise(votes = sum(votes, na.rm = TRUE), .groups = "drop") %>%
  left_join(party_by_code, by = "code") %>%
  filter(!is.na(party_id), votes != 0) %>%
  group_by(party_id) %>%
  summarise(votes = sum(votes, na.rm = TRUE), code_order = min(code_order), .groups = "drop") %>%
  mutate(district_id = "national", name_ka = "") %>%
  attach_totals(smd_national_totals) %>%
  mutate(totalVotes = sum(votes, na.rm = TRUE)) %>%
  add_metrics() %>%
  arrange(code_order)

smd_district_totals <- sum_totals(smd_base, "smd")
smd_district <- smd_long %>%
  filter(votes != 0, !is.na(party_id)) %>%
  group_by(smd, code, code_order, party_id, name_ka) %>%
  summarise(votes = sum(votes, na.rm = TRUE), .groups = "drop") %>%
  left_join(smd_district_totals, by = "smd") %>%
  mutate(district_id = as.character(smd)) %>%
  add_metrics() %>%
  arrange(smd, code_order)

smd_precinct <- smd_long %>%
  filter(votes != 0, !is.na(party_id)) %>%
  mutate(district_id = as.character(precinct_id)) %>%
  add_metrics() %>%
  arrange(precinct_id, code_order)

SMD_RESULT_COLS <- c(
  "district_id", "party_id", "name_ka", "votes", "vote_share", "registered", "voted",
  "voted_noon", "voted_5pm", "main_list", "special_list",
  "turnout_pct", "noon_pct", "five_pct", "invalid_ballots", "invalid_pct"
)

SMD_PRECINCT_COLS <- c(
  "precinct_id", "district_id", "party_id", "name_ka", "votes", "vote_share",
  "registered", "voted", "voted_noon", "voted_5pm", "turnout_pct", "noon_pct", "five_pct",
  "invalid_ballots", "invalid_pct"
)

write_csv_like_js(bind_rows(smd_national, smd_district), file.path(OUT_RESULTS, "adj2020_smd.csv"), SMD_RESULT_COLS)
write_csv_like_js(smd_precinct, file.path(OUT_RESULTS, "adj2020_smd_precincts.csv"), SMD_PRECINCT_COLS)

# SMD runoff outputs --------------------------------------------------------

runoff_base <- runoff_long %>%
  distinct(smd, dd, pp, precinct_id, precinct_key, across(all_of(SUM_COLS)))

runoff_national_totals <- sum_totals(runoff_base)
runoff_national <- runoff_long %>%
  group_by(code, code_order, party_id) %>%
  summarise(votes = sum(votes, na.rm = TRUE), .groups = "drop") %>%
  filter(votes != 0) %>%
  mutate(district_id = "national", name_ka = "") %>%
  attach_totals(runoff_national_totals) %>%
  add_metrics() %>%
  arrange(code_order)

runoff_district_totals <- sum_totals(runoff_base, "smd")
runoff_district <- runoff_long %>%
  filter(votes != 0) %>%
  group_by(smd, code, code_order, party_id, name_ka) %>%
  summarise(votes = sum(votes, na.rm = TRUE), .groups = "drop") %>%
  left_join(runoff_district_totals, by = "smd") %>%
  mutate(district_id = as.character(smd)) %>%
  add_metrics() %>%
  arrange(smd, code_order)

runoff_precinct <- runoff_long %>%
  filter(votes != 0) %>%
  mutate(district_id = as.character(precinct_id)) %>%
  add_metrics() %>%
  arrange(precinct_id, code_order)

write_csv_like_js(bind_rows(runoff_national, runoff_district), file.path(OUT_RESULTS, "adj2020_smd_runoff.csv"), SMD_RESULT_COLS)
write_csv_like_js(runoff_precinct, file.path(OUT_RESULTS, "adj2020_smd_runoff_precincts.csv"), SMD_PRECINCT_COLS)

# Turnout and candidate outputs --------------------------------------------

turnout_rows <- bind_rows(
  pr_national_totals %>% mutate(district_id = "national"),
  pr_district_totals %>% mutate(district_id = as.character(dd)) %>% select(-dd)
) %>%
  mutate(vote_type = "pr", registered = main_list + special_list, turnout_pct = safe_ratio(voted, registered)) %>%
  transmute(
    district_id,
    vote_type,
    registered,
    voted,
    turnout_pct,
    voted_noon,
    voted_5pm,
    main_list,
    special_list
  )

precinct_turnout <- pr_base %>%
  mutate(registered = main_list + special_list, turnout_pct = safe_ratio(voted, registered)) %>%
  arrange(precinct_id) %>%
  transmute(
    precinct_id,
    district_id = as.character(precinct_id),
    registered,
    voted,
    turnout_pct,
    voted_noon,
    voted_5pm
  )

TURNOUT_COLS <- c(
  "district_id", "vote_type", "registered", "voted", "turnout_pct",
  "voted_noon", "voted_5pm", "main_list", "special_list"
)

PRECINCT_TURNOUT_COLS <- c(
  "precinct_id", "district_id", "registered", "voted", "turnout_pct",
  "voted_noon", "voted_5pm"
)

write_csv_like_js(turnout_rows, file.path(OUT_TURNOUT, "adj2020_turnout.csv"), TURNOUT_COLS)
write_csv_like_js(precinct_turnout, file.path(OUT_TURNOUT, "adj2020_precincts_turnout.csv"), PRECINCT_TURNOUT_COLS)

party_candidate_cols <- c(
  "party_id", "party_number", "party_list_name", "order_id", "name_ka",
  "first_name", "last_name", "smd_district_number", "partisanship",
  "source_pdf", "source_page", "pdf_sha256"
)

smd_candidate_rows <- candidate_lookup %>%
  transmute(
    district_id = smd,
    ballot_number = code,
    party_id,
    name_ka,
    candidate_order
  )

smd_candidate_cols <- c("district_id", "ballot_number", "party_id", "name_ka", "candidate_order")
elected_cols <- c("elected_order", "party_id", "party_label", "name_ka", "first_name", "last_name", "mandate_type", "district_id")

write_csv_like_js(party_list_candidates, file.path(OUT_CANDIDATES, "adj2020_party_lists.csv"), party_candidate_cols)
write_csv_like_js(smd_candidate_rows, file.path(OUT_CANDIDATES, "adj2020_smd_candidates.csv"), smd_candidate_cols)
write_csv_like_js(elected_members, file.path(OUT_CANDIDATES, "adj2020_elected.csv"), elected_cols)

missing_pr_districts <- setdiff(c(79L, 80L, 81L, 82L, 83L, 84L), sort(unique(pr_base$dd)))
if (length(missing_pr_districts) > 0) {
  warning("No PR raw rows found for Adjara district(s): ", paste(missing_pr_districts, collapse = ", "), call. = FALSE)
}

cat("\nDone.\n")
cat(sprintf("  PR: %d district rows, %d precinct rows\n", nrow(bind_rows(pr_national, pr_district)), nrow(pr_precinct)))
cat(sprintf("  SMD: %d district rows, %d precinct rows\n", nrow(bind_rows(smd_national, smd_district)), nrow(smd_precinct)))
cat(sprintf("  Runoff: %d district rows, %d precinct rows\n", nrow(bind_rows(runoff_national, runoff_district)), nrow(runoff_precinct)))
cat(sprintf("  Turnout: %d district rows, %d precinct rows\n", nrow(turnout_rows), nrow(precinct_turnout)))
cat(sprintf("  Candidates: %d party-list rows, %d SMD rows, %d elected rows\n", nrow(party_list_candidates), nrow(smd_candidate_rows), nrow(elected_members)))
