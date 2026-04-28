#!/usr/bin/env Rscript
# src/loaders/process_adj2016.R
#
# Processes raw precinct-level data for the 2016 Adjara Supreme Council election.
# Run from project root:
#   Rscript src/loaders/process_adj2016.R

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

MAIN_FILE <- file.path(RAW_DIR, "აჭარა პირველი ტურის შედეგები - 2016 უბნების მიხედვით.xlsx")
RUNOFF_FILE <- file.path(RAW_DIR, "აჭარა მეორე ტურის შედეგები - 2016 უბნების მიხედვით.xlsx")
CANDIDATE_FILE <- file.path(RAW_DIR, "adjara_2016_party_lists_unified.xlsx")

SUM_COLS <- c(
  "main_list", "special_list", "voted_noon", "voted_5pm", "voted",
  "valid_ballots", "invalid_ballots", "totalVotes"
)

RATIO_COLS <- c("vote_share", "turnout_pct", "noon_pct", "five_pct", "invalid_pct")

BALLOT_PARTY_MAP <- c(
  "1" = "burchuladze",
  "3" = "burjanadze_democratic",
  "5" = "unm",
  "6" = "republicans_2016",
  "7" = "mechiauri_united",
  "8" = "patriots",
  "10" = "labour",
  "14" = "peace_georgia_2016",
  "16" = "united_communist_2016",
  "19" = "industry_sakartvelo",
  "23" = "chvenni_peoples",
  "26" = "national_forum",
  "27" = "free_democrats",
  "32" = "serve_georgia_2016",
  "41" = "gd"
)

VOTE_CODES <- as.integer(names(BALLOT_PARTY_MAP))
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
    precinct_id = smd * 1000000L + dd * 1000L + pp,
    precinct_key = if_else(valid, paste(smd, dd, pp, sep = "."), ""),
    valid_precinct = valid
  )
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

party_id_from_label <- function(label) {
  label <- cell_str(label)
  case_when(
    str_detect(label, "ბურჭულაძე") ~ "burchuladze",
    str_detect(label, "ბურჯანაძე|დემოკრატიული მოძრაობა") ~ "burjanadze_democratic",
    str_detect(label, "ნაციონალური მოძრაობა") ~ "unm",
    str_detect(label, "რესპუბლიკელები") ~ "republicans_2016",
    str_detect(label, "მეჭიაური") ~ "mechiauri_united",
    str_detect(label, "პატრიოტ") ~ "patriots",
    str_detect(label, "ლეიბორისტ") ~ "labour",
    str_detect(label, "მშვიდობისათვის") ~ "peace_georgia_2016",
    str_detect(label, "კომუნისტური") ~ "united_communist_2016",
    str_detect(label, "მრეწველ") ~ "industry_sakartvelo",
    str_detect(label, "ჩვენები|სახალხო") ~ "chvenni_peoples",
    str_detect(label, "ეროვნული ფორუმი") ~ "national_forum",
    str_detect(label, "თავისუფალი დემოკრატები|ალასანია") ~ "free_democrats",
    str_detect(label, "დუმბაძე|ვასაძე|ემსახურე") ~ "serve_georgia_2016",
    str_detect(label, "ქართული ოცნება") ~ "gd",
    TRUE ~ NA_character_
  )
}

read_result_long <- function(path, sheet, codes, layout) {
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
      voted_noon = 0,
      voted_5pm = 0,
      voted = num_col(body, layout$voted_col),
      invalid_ballots = num_col(body, layout$invalid_col),
      totalVotes = rowSums(as.data.frame(votes_wide), na.rm = TRUE),
      valid_ballots = totalVotes
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

candidate_lists_raw <- read_excel(CANDIDATE_FILE, sheet = "party lists", .name_repair = "minimal")
smd_candidates_raw <- read_excel(CANDIDATE_FILE, sheet = "majoritarian candidates", .name_repair = "minimal")
elected_raw <- read_excel(CANDIDATE_FILE, sheet = "elected", .name_repair = "minimal")

party_list_candidates <- candidate_lists_raw %>%
  mutate(
    party_id = party_id_from_label(party_list_name),
    order_id = as.integer(order_id),
    name_ka = str_squish(paste(first_name, last_name))
  ) %>%
  filter(!is.na(party_id))

candidate_lookup <- smd_candidates_raw %>%
  mutate(
    smd = as.integer(majoritarian_district_code),
    code = as.integer(party_number),
    party_id = unname(BALLOT_PARTY_MAP[as.character(code)]),
    name_ka = cell_str(candidate_name),
    candidate_order = row_number()
  ) %>%
  filter(!is.na(smd), !is.na(code), !is.na(party_id)) %>%
  select(smd, code, party_id, name_ka, candidate_order)

elected_members <- elected_raw %>%
  transmute(
    party_label = cell_str(Party),
    name_ka = cell_str(Name),
    mandate_type = str_to_lower(cell_str(Type)),
    district_id = cell_str(`SMD district`)
  ) %>%
  filter(party_label != "", name_ka != "") %>%
  mutate(
    party_id = party_id_from_label(party_label),
    elected_order = row_number()
  ) %>%
  select(elected_order, party_id, party_label, name_ka, mandate_type, district_id)

party_by_code <- candidate_lookup %>%
  arrange(candidate_order) %>%
  group_by(code) %>%
  summarise(party_id = first(party_id), .groups = "drop")

cat(sprintf(
  "Candidate lookup: %d SMD candidates, %d party-list candidates, %d elected rows\n",
  nrow(candidate_lookup), nrow(party_list_candidates), nrow(elected_members)
))

main_layout <- list(precinct_col = 1L, main_col = 2L, special_col = 3L, voted_col = 4L, invalid_col = 21L)
runoff_layout <- list(precinct_col = 1L, main_col = 2L, special_col = 3L, voted_col = 4L, invalid_col = 8L)

pr_long <- read_result_long(MAIN_FILE, 1L, VOTE_CODES, main_layout)
smd_long <- read_result_long(MAIN_FILE, 2L, VOTE_CODES, main_layout) %>%
  left_join(candidate_lookup %>% select(smd, code, party_id, name_ka), by = c("smd", "code"), suffix = c("", "_candidate")) %>%
  mutate(
    party_id = coalesce(party_id_candidate, party_id),
    name_ka = replace_na(name_ka, "")
  ) %>%
  select(-party_id_candidate)

runoff_long <- read_result_long(RUNOFF_FILE, 1L, RUNOFF_CODES, runoff_layout) %>%
  left_join(candidate_lookup %>% select(smd, code, name_ka), by = c("smd", "code")) %>%
  mutate(name_ka = replace_na(name_ka, ""))

cat(sprintf("PR precincts: %d\n", n_distinct(pr_long$precinct_key)))
cat(sprintf("SMD precincts: %d\n", n_distinct(smd_long$precinct_key)))
cat(sprintf("Runoff precincts: %d\n", n_distinct(runoff_long$precinct_key)))

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
  arrange(smd, dd, pp, code_order)

PR_RESULT_COLS <- c(
  "district_id", "party_id", "votes", "vote_share", "registered", "voted",
  "voted_noon", "voted_5pm", "main_list", "special_list",
  "turnout_pct", "noon_pct", "five_pct", "invalid_ballots", "invalid_pct"
)

PR_PRECINCT_COLS <- c(
  "precinct_id", "precinct_key", "district_id", "party_id", "votes", "vote_share",
  "registered", "voted", "voted_noon", "voted_5pm", "turnout_pct", "noon_pct", "five_pct",
  "invalid_ballots", "invalid_pct"
)

write_csv_like_js(bind_rows(pr_national, pr_district), file.path(OUT_RESULTS, "adj2016_pr.csv"), PR_RESULT_COLS)
write_csv_like_js(pr_precinct, file.path(OUT_RESULTS, "adj2016_pr_precincts.csv"), PR_PRECINCT_COLS)

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
  arrange(smd, dd, pp, code_order)

SMD_RESULT_COLS <- c(
  "district_id", "party_id", "name_ka", "votes", "vote_share", "registered", "voted",
  "voted_noon", "voted_5pm", "main_list", "special_list",
  "turnout_pct", "noon_pct", "five_pct", "invalid_ballots", "invalid_pct"
)

SMD_PRECINCT_COLS <- c(
  "precinct_id", "precinct_key", "district_id", "party_id", "name_ka", "votes", "vote_share",
  "registered", "voted", "voted_noon", "voted_5pm", "turnout_pct", "noon_pct", "five_pct",
  "invalid_ballots", "invalid_pct"
)

write_csv_like_js(bind_rows(smd_national, smd_district), file.path(OUT_RESULTS, "adj2016_smd.csv"), SMD_RESULT_COLS)
write_csv_like_js(smd_precinct, file.path(OUT_RESULTS, "adj2016_smd_precincts.csv"), SMD_PRECINCT_COLS)

# Runoff outputs ------------------------------------------------------------

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
  arrange(smd, dd, pp, code_order)

write_csv_like_js(bind_rows(runoff_national, runoff_district), file.path(OUT_RESULTS, "adj2016_smd_runoff.csv"), SMD_RESULT_COLS)
write_csv_like_js(runoff_precinct, file.path(OUT_RESULTS, "adj2016_smd_runoff_precincts.csv"), SMD_PRECINCT_COLS)

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
  arrange(smd, dd, pp) %>%
  transmute(
    precinct_id,
    precinct_key,
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
  "precinct_id", "precinct_key", "district_id", "registered", "voted", "turnout_pct",
  "voted_noon", "voted_5pm"
)

party_candidate_cols <- c(
  "party_id", "party_list_name", "order_id", "name_ka", "first_name", "last_name",
  "majoritarian_district_number", "majoritarian_district_name", "partisanship",
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
elected_cols <- c("elected_order", "party_id", "party_label", "name_ka", "mandate_type", "district_id")

write_csv_like_js(turnout_rows, file.path(OUT_TURNOUT, "adj2016_turnout.csv"), TURNOUT_COLS)
write_csv_like_js(precinct_turnout, file.path(OUT_TURNOUT, "adj2016_precincts_turnout.csv"), PRECINCT_TURNOUT_COLS)
write_csv_like_js(party_list_candidates, file.path(OUT_CANDIDATES, "adj2016_party_lists.csv"), party_candidate_cols)
write_csv_like_js(smd_candidate_rows, file.path(OUT_CANDIDATES, "adj2016_smd_candidates.csv"), smd_candidate_cols)
write_csv_like_js(elected_members, file.path(OUT_CANDIDATES, "adj2016_elected.csv"), elected_cols)

cat("\nDone.\n")
cat(sprintf("  PR: %d district rows, %d precinct rows\n", nrow(bind_rows(pr_national, pr_district)), nrow(pr_precinct)))
cat(sprintf("  SMD: %d district rows, %d precinct rows\n", nrow(bind_rows(smd_national, smd_district)), nrow(smd_precinct)))
cat(sprintf("  Runoff: %d district rows, %d precinct rows\n", nrow(bind_rows(runoff_national, runoff_district)), nrow(runoff_precinct)))
cat(sprintf("  Turnout: %d district rows, %d precinct rows\n", nrow(turnout_rows), nrow(precinct_turnout)))
cat(sprintf("  Candidates: %d party-list rows, %d SMD rows, %d elected rows\n", nrow(party_list_candidates), nrow(smd_candidate_rows), nrow(elected_members)))
