# process_local2010.R
# Processes raw 2010 Georgian local election Excel into dashboard CSV files.
# Run from project root: Rscript src/loaders/process_local2010.R

suppressPackageStartupMessages({
  library(readxl)
  library(dplyr)
  library(tidyr)
  library(stringr)
  library(yaml)
})

EXCEL       <- "src/data/raw/2010_ადგილობრივი.xlsx"
SEATS_EXCEL <- "src/data/raw/seat_distribution_2010.xlsx"
OUT_RESULTS <- "src/data/results"
OUT_CANDS_YAML <- "src/data/config/candidates/local"
OUT_CANDS_CSV <- "src/data/candidates"

dir.create(OUT_RESULTS, showWarnings = FALSE, recursive = TRUE)
dir.create(OUT_CANDS_YAML, showWarnings = FALSE, recursive = TRUE)
dir.create(OUT_CANDS_CSV, showWarnings = FALSE, recursive = TRUE)

PARTY_MAP <- c(
  "2"  = "alliance_georgia_2010",
  "3"  = "industry_sakartvelo",
  "5"  = "unm",
  "6"  = "sports_union_2010",
  "7"  = "national_council_2010",
  "8"  = "radical_democrats_2008",
  "10" = "christian_democrats_2010",
  "12" = "our_country_2008",
  "14" = "future_georgia",
  "15" = "freedom_2010",
  "16" = "future_party_2010",
  "17" = "national_democratic_2010",
  "18" = "solidarity_2010",
  "19" = "veterans_patriots_2010",
  "21" = "tortladze_democratic_2010",
  "23" = "peoples_alliance_2010",
  "25" = "ivanishvili_peoples_democrats_2010"
)

to_selfgov <- function(d) as.integer(ifelse(d >= 1L & d <= 10L, 1L, d))
to_precinct_id <- function(d, p) as.integer(as.integer(d) * 1000L + as.integer(p))
party_id_for <- function(code) {
  out <- PARTY_MAP[as.character(code)]
  ifelse(is.na(out), paste0("party_", code), unname(out))
}

as_num <- function(x) suppressWarnings(as.numeric(str_replace_all(as.character(x), "[,[:space:]]+", "")))
safe_ratio <- function(num, den) {
  out <- num / den
  out[!is.finite(out) | is.na(out)] <- 0
  out
}

write_csv_utf8 <- function(df, path) {
  write.csv(df, path, row.names = FALSE, fileEncoding = "UTF-8", na = "")
  cat("  Written:", path, "\n")
}

read_raw <- function(sheet) {
  df <- read_excel(EXCEL, sheet = sheet, col_types = "text")
  df[, !str_detect(names(df), "^\\.\\.\\.|^Unnamed"), drop = FALSE]
}

vote_cols <- function(df, prefix) names(df)[str_detect(names(df), paste0("^", prefix, "_\\d+$"))]

party_names <- read_raw("party_names") %>%
  transmute(
    party_code = as.character(as.integer(as_num(party_id))),
    party_id = party_id_for(party_code),
    party_label_ka = str_squish(party_name)
  ) %>%
  distinct()

make_turnout <- function(df, district_col, precinct_col, id_col = NULL, major_col = NULL) {
  out <- df %>%
    mutate(
      district = as.integer(as_num(.data[[district_col]])),
      selfgov_id = to_selfgov(district),
      precinct_number = as.integer(as_num(.data[[precinct_col]])),
      precinct_id = if (!is.null(id_col)) as.integer(as_num(.data[[id_col]])) else to_precinct_id(district, precinct_number),
      main_list = as.integer(as_num(Number_of_voters)),
      special_list = as.integer(as_num(Special_voters)),
      registered = main_list + special_list,
      voted_noon = as.integer(as_num(turnout_12)),
      voted_5pm = as.integer(as_num(turnout_17)),
      voted = as.integer(as_num(turnout_final)),
      received_ballots = as.integer(as_num(received_ballots)),
      spoiled_ballots = as.integer(as_num(spoiled_ballots)),
      used_ballots = as.integer(as_num(used_ballots)),
      invalid_ballots = as.integer(as_num(annuled_ballots))
    )

  if (!is.null(major_col)) {
    out <- out %>% mutate(major_id = as.integer(as_num(.data[[major_col]])))
  }
  out
}

read_votes_long <- function(sheet, prefix, district_col, precinct_col, id_col = NULL, major_col = NULL) {
  df <- read_raw(sheet)
  cols <- vote_cols(df, prefix)
  df <- df %>%
    mutate(across(all_of(cols), as_num))

  make_turnout(df, district_col, precinct_col, id_col, major_col) %>%
    select(
      district, selfgov_id, precinct_number, precinct_id,
      any_of("major_id"),
      registered, main_list, special_list, voted_noon, voted_5pm, voted,
      received_ballots, spoiled_ballots, used_ballots, invalid_ballots,
      all_of(cols)
    ) %>%
    pivot_longer(all_of(cols), names_to = "vote_col", values_to = "votes") %>%
    mutate(
      party_code = str_extract(vote_col, "\\d+$"),
      party_id = party_id_for(party_code),
      votes = as.integer(coalesce(votes, 0))
    ) %>%
    filter(!is.na(party_id))
}

summarise_to_level <- function(df_long, group_var) {
  turnout <- df_long %>%
    distinct(across(all_of(c(group_var, "precinct_id"))), .keep_all = TRUE) %>%
    group_by(across(all_of(group_var))) %>%
    summarise(
      registered = sum(registered, na.rm = TRUE),
      main_list = sum(main_list, na.rm = TRUE),
      special_list = sum(special_list, na.rm = TRUE),
      voted = sum(voted, na.rm = TRUE),
      voted_noon = sum(voted_noon, na.rm = TRUE),
      voted_5pm = sum(voted_5pm, na.rm = TRUE),
      invalid_ballots = sum(invalid_ballots, na.rm = TRUE),
      .groups = "drop"
    ) %>%
    mutate(
      turnout_pct = round(safe_ratio(voted, registered), 6),
      noon_pct = round(safe_ratio(voted_noon, registered), 6),
      five_pct = round(safe_ratio(voted_5pm, registered), 6),
      invalid_pct = round(safe_ratio(invalid_ballots, voted), 6)
    )

  party <- df_long %>%
    group_by(across(all_of(c(group_var, "party_id")))) %>%
    summarise(votes = sum(votes, na.rm = TRUE), .groups = "drop")

  totals <- party %>%
    group_by(across(all_of(group_var))) %>%
    summarise(total_valid = sum(votes, na.rm = TRUE), .groups = "drop")

  party %>%
    left_join(totals, by = group_var) %>%
    left_join(turnout, by = group_var) %>%
    mutate(vote_share = round(safe_ratio(votes, total_valid), 6)) %>%
    rename(district_id = all_of(group_var)) %>%
    select(
      district_id, party_id, votes, vote_share,
      registered, voted, voted_noon, voted_5pm,
      main_list, special_list, turnout_pct, noon_pct, five_pct,
      invalid_ballots, invalid_pct
    )
}

add_national <- function(df) {
  df <- df %>% mutate(district_id = as.character(district_id))

  turnout <- df %>%
    distinct(district_id, .keep_all = TRUE) %>%
    summarise(
      registered = sum(registered, na.rm = TRUE),
      voted = sum(voted, na.rm = TRUE),
      voted_noon = sum(voted_noon, na.rm = TRUE),
      voted_5pm = sum(voted_5pm, na.rm = TRUE),
      main_list = sum(main_list, na.rm = TRUE),
      special_list = sum(special_list, na.rm = TRUE),
      invalid_ballots = sum(invalid_ballots, na.rm = TRUE)
    ) %>%
    mutate(
      turnout_pct = round(safe_ratio(voted, registered), 6),
      noon_pct = round(safe_ratio(voted_noon, registered), 6),
      five_pct = round(safe_ratio(voted_5pm, registered), 6),
      invalid_pct = round(safe_ratio(invalid_ballots, voted), 6)
    )

  votes <- df %>%
    group_by(party_id) %>%
    summarise(votes = sum(votes, na.rm = TRUE), .groups = "drop")

  total_valid <- sum(votes$votes, na.rm = TRUE)
  nat <- votes %>%
    mutate(
      district_id = "national",
      vote_share = round(safe_ratio(votes, total_valid), 6),
      registered = turnout$registered,
      voted = turnout$voted,
      voted_noon = turnout$voted_noon,
      voted_5pm = turnout$voted_5pm,
      main_list = turnout$main_list,
      special_list = turnout$special_list,
      turnout_pct = turnout$turnout_pct,
      noon_pct = turnout$noon_pct,
      five_pct = turnout$five_pct,
      invalid_ballots = turnout$invalid_ballots,
      invalid_pct = turnout$invalid_pct
    )

  for (col in setdiff(names(df), names(nat))) nat[[col]] <- NA_character_
  bind_rows(nat[names(df)], df)
}

summarise_precinct <- function(df_long, parent_var) {
  df_long %>%
    group_by(precinct_id, across(all_of(parent_var)), party_id) %>%
    summarise(
      votes = sum(votes, na.rm = TRUE),
      registered = first(registered),
      voted = first(voted),
      voted_noon = first(voted_noon),
      voted_5pm = first(voted_5pm),
      invalid_ballots = first(invalid_ballots),
      .groups = "drop"
    ) %>%
    group_by(precinct_id, across(all_of(parent_var))) %>%
    mutate(vote_share = round(safe_ratio(votes, sum(votes, na.rm = TRUE)), 6)) %>%
    ungroup() %>%
    mutate(
      turnout_pct = round(safe_ratio(voted, registered), 6),
      noon_pct = round(safe_ratio(voted_noon, registered), 6),
      five_pct = round(safe_ratio(voted_5pm, registered), 6),
      invalid_pct = round(safe_ratio(invalid_ballots, voted), 6)
    ) %>%
    rename(district_id = all_of(parent_var)) %>%
    select(
      precinct_id, district_id, party_id, votes, vote_share,
      registered, voted, voted_noon, voted_5pm,
      turnout_pct, noon_pct, five_pct, invalid_ballots, invalid_pct
    )
}

cat("Processing 2010 Sakrebulo PR results...\n")
pr_long <- read_votes_long("proportional", "party", "District", "Precinct", id_col = "id")

pr_district <- summarise_to_level(pr_long, "district") %>% add_national()
write_csv_utf8(pr_district, file.path(OUT_RESULTS, "local2010_pr.csv"))

pr_selfgov <- summarise_to_level(pr_long, "selfgov_id") %>% add_national()
write_csv_utf8(pr_selfgov, file.path(OUT_RESULTS, "local2010_pr_selfgov.csv"))

pr_prec <- summarise_precinct(pr_long, "district")
write_csv_utf8(pr_prec, file.path(OUT_RESULTS, "local2010_pr_precincts.csv"))

cat("Processing 2010 Tbilisi mayor results...\n")
mayor_long <- read_votes_long("tbilisi_mayor", "cand", "District", "Precinct")

mayor_candidates <- read_raw("mayor_candidates") %>%
  transmute(
    selfgov_id = to_selfgov(as.integer(as_num(self_gov_district))),
    party_code = as.character(as.integer(as_num(party_code))),
    party_id = party_id_for(party_code),
    first_name = str_squish(first_name),
    last_name = str_squish(last_name),
    name_ka = str_squish(paste(first_name, last_name))
  ) %>%
  left_join(party_names, by = c("party_code", "party_id")) %>%
  distinct()

mayor_results <- summarise_to_level(mayor_long, "selfgov_id") %>%
  filter(votes > 0) %>%
  left_join(mayor_candidates %>% select(selfgov_id, party_id, name_ka), by = c("district_id" = "selfgov_id", "party_id")) %>%
  mutate(name_ka = coalesce(name_ka, "")) %>%
  add_national() %>%
  mutate(name_ka = coalesce(name_ka, "")) %>%
  select(
    district_id, party_id, name_ka, votes, vote_share,
    registered, voted, voted_noon, voted_5pm,
    main_list, special_list, turnout_pct, noon_pct, five_pct,
    invalid_ballots, invalid_pct
  )
write_csv_utf8(mayor_results, file.path(OUT_RESULTS, "local2010_smd.csv"))

mayor_districts <- mayor_results %>%
  filter(district_id == "1") %>%
  crossing(tibble(new_did = as.character(1:10))) %>%
  mutate(district_id = new_did) %>%
  select(-new_did) %>%
  bind_rows(filter(mayor_results, district_id == "national")) %>%
  arrange(district_id, party_id)
write_csv_utf8(mayor_districts, file.path(OUT_RESULTS, "local2010_smd_districts.csv"))

mayor_prec <- mayor_long %>%
  group_by(precinct_id, selfgov_id, party_id) %>%
  summarise(
    votes = sum(votes, na.rm = TRUE),
    registered = first(registered),
    voted = first(voted),
    voted_noon = first(voted_noon),
    voted_5pm = first(voted_5pm),
    invalid_ballots = first(invalid_ballots),
    .groups = "drop"
  ) %>%
  filter(votes > 0) %>%
  group_by(precinct_id) %>%
  mutate(vote_share = round(safe_ratio(votes, sum(votes, na.rm = TRUE)), 6)) %>%
  ungroup() %>%
  mutate(
    turnout_pct = round(safe_ratio(voted, registered), 6),
    noon_pct = round(safe_ratio(voted_noon, registered), 6),
    five_pct = round(safe_ratio(voted_5pm, registered), 6),
    invalid_pct = round(safe_ratio(invalid_ballots, voted), 6)
  ) %>%
  select(
    precinct_id, selfgov_id, party_id, votes, vote_share,
    registered, voted, voted_noon, voted_5pm,
    turnout_pct, noon_pct, five_pct, invalid_ballots, invalid_pct
  )
write_csv_utf8(mayor_prec, file.path(OUT_RESULTS, "local2010_smd_precincts.csv"))

write_csv_utf8(
  mayor_candidates %>%
    select(selfgov_id, party_code, party_id, party_label_ka, name_ka, first_name, last_name),
  file.path(OUT_CANDS_CSV, "local2010_mayor_candidates.csv")
)

cat("Processing 2010 Sakrebulo SMD results...\n")
maj_long <- read_votes_long(
  "majoritarian_results", "cand",
  "district", "precinct",
  id_col = "id",
  major_col = "maj_id"
)

majoritarian_candidates <- read_raw("majoritarian_candidates") %>%
  transmute(
    major_id = as.integer(as_num(maj_id)),
    electoral_district_id = as.integer(as_num(electoral_district)),
    selfgov_id = as.integer(as_num(self_gov_district)),
    majoritarian_district = as.integer(as_num(majoritarian_district)),
    party_code = as.character(as.integer(as_num(party_code))),
    party_id = party_id_for(party_code),
    first_name = str_squish(first_name),
    last_name = str_squish(last_name),
    name_ka = str_squish(paste(first_name, last_name))
  ) %>%
  left_join(party_names, by = c("party_code", "party_id")) %>%
  distinct()

maj_dist <- summarise_to_level(maj_long, "major_id") %>%
  filter(votes > 0) %>%
  left_join(
    majoritarian_candidates %>% select(major_id, party_id, name_ka),
    by = c("district_id" = "major_id", "party_id")
  ) %>%
  mutate(name_ka = coalesce(name_ka, "")) %>%
  add_national() %>%
  mutate(name_ka = coalesce(name_ka, "")) %>%
  select(
    district_id, party_id, name_ka, votes, vote_share,
    registered, voted, voted_noon, voted_5pm,
    main_list, special_list, turnout_pct, noon_pct, five_pct,
    invalid_ballots, invalid_pct
  )
write_csv_utf8(maj_dist, file.path(OUT_RESULTS, "local2010_council_smd.csv"))

maj_prec <- summarise_precinct(maj_long, "major_id") %>% filter(votes > 0)
write_csv_utf8(maj_prec, file.path(OUT_RESULTS, "local2010_council_smd_precincts.csv"))

write_csv_utf8(
  majoritarian_candidates %>%
    select(
      major_id, electoral_district_id, selfgov_id, majoritarian_district,
      party_code, party_id, party_label_ka, name_ka, first_name, last_name
    ),
  file.path(OUT_CANDS_CSV, "local2010_smd_candidates.csv")
)

cat("Processing 2010 Sakrebulo seat composition...\n")
seat_sheet <- function(sheet, value_name) {
  read_excel(SEATS_EXCEL, sheet = sheet, col_types = "text") %>%
    mutate(selfgov_id = as.character(as.integer(as_num(self_gov_district)))) %>%
    select(selfgov_id, starts_with("party_")) %>%
    pivot_longer(starts_with("party_"), names_to = "party_col", values_to = value_name) %>%
    mutate(
      party_code = str_extract(party_col, "\\d+$"),
      party_id = party_id_for(party_code),
      !!value_name := as.integer(coalesce(as_num(.data[[value_name]]), 0))
    ) %>%
    select(selfgov_id, party_id, all_of(value_name)) %>%
  group_by(selfgov_id, party_id) %>%
  summarise(across(all_of(value_name), \(x) sum(x, na.rm = TRUE)), .groups = "drop")
}

seats_pr <- seat_sheet("proportional", "seats_pr")
seats_smd <- seat_sheet("majoritarian", "seats_smd")
seat_rows <- full_join(seats_pr, seats_smd, by = c("selfgov_id", "party_id")) %>%
  mutate(
    seats_pr = coalesce(seats_pr, 0L),
    seats_smd = coalesce(seats_smd, 0L)
  )

mayor_winner <- mayor_results %>%
  filter(district_id == "1") %>%
  arrange(desc(votes)) %>%
  slice(1) %>%
  pull(party_id)

seat_rows <- bind_rows(
  seat_rows,
  tibble(selfgov_id = "1", party_id = mayor_winner, seats_pr = 0L, seats_smd = 0L)
) %>%
  group_by(selfgov_id, party_id) %>%
  summarise(
    seats_pr = sum(seats_pr, na.rm = TRUE),
    seats_smd = sum(seats_smd, na.rm = TRUE),
    .groups = "drop"
  ) %>%
  mutate(seats_mayor = ifelse(selfgov_id == "1" & party_id == mayor_winner, 1L, 0L))

seat_national <- seat_rows %>%
  group_by(party_id) %>%
  summarise(
    seats_pr = sum(seats_pr, na.rm = TRUE),
    seats_smd = sum(seats_smd, na.rm = TRUE),
    seats_mayor = sum(seats_mayor, na.rm = TRUE),
    .groups = "drop"
  ) %>%
  mutate(selfgov_id = "national")

seats <- bind_rows(seat_national, seat_rows) %>%
  arrange(desc(selfgov_id == "national"), suppressWarnings(as.integer(selfgov_id)), party_id) %>%
  select(selfgov_id, party_id, seats_pr, seats_smd, seats_mayor)
write_csv_utf8(seats, file.path(OUT_RESULTS, "local2010_seats.csv"))

cat("Building 2010 candidate YAML...\n")
mayor_yaml <- lapply(seq_len(nrow(mayor_candidates)), function(i) {
  r <- mayor_candidates[i, ]
  cid <- paste0(r$party_id, "_mayor_", r$selfgov_id)
  setNames(list(list(
    name_ka = r$name_ka,
    election_type = "mayor",
    selfgov_id = as.integer(r$selfgov_id),
    party = r$party_id
  )), cid)
})

maj_yaml <- lapply(seq_len(nrow(majoritarian_candidates)), function(i) {
  r <- majoritarian_candidates[i, ]
  cid <- paste0(r$party_id, "_maj_", r$major_id)
  setNames(list(list(
    name_ka = r$name_ka,
    election_type = "sakrebulo_smd",
    selfgov_id = as.integer(r$selfgov_id),
    electoral_district_id = as.integer(r$electoral_district_id),
    major_id = as.integer(r$major_id),
    party = r$party_id
  )), cid)
})

write_yaml(
  list(candidates = c(do.call(c, mayor_yaml), do.call(c, maj_yaml))),
  file.path(OUT_CANDS_YAML, "local_2010.yml"),
  unicode = TRUE
)
cat("  Written:", file.path(OUT_CANDS_YAML, "local_2010.yml"), "\n")

cat("\nDone!\n")
