# process_local2021.R
# Processes raw 2021 Georgian local election Excel files into dashboard CSV files.
# Run from project root:
#   Rscript src/data/loaders/process_local2021.R
#
# Source files:
#   src/data/raw/7795_2021 საკრებულო მერი პირველი ტური.xlsx  (Round 1)
#   src/data/raw/7795_2021 საკრებულო, მერი მეორე ტური.xlsx   (Round 2 runoffs)
#   src/data/raw/local2021_elected_people.xlsx                (Elected persons list)
#
# Column structure (2021 differs from 2025 — no technology/ballots separation):
#
#   PR / Mayor R1 (no major_local):
#     1: district, 2: district_name, 3: precinct_code,
#     4: main_list, 5: special_list, 6: voted_noon, 7: voted_5pm,
#     8: voted, 9: ballots_received, 10+: party cols, -2: valid, -1: invalid
#     registered = main_list + special_list
#
#   Majoritarian (has major_local at col 3):
#     1: district, 2: district_name, 3: major_local, 4: precinct_code,
#     5: main_list, 6: special_list, 7: voted_noon, 8: voted_5pm,
#     9: voted, 10: ballots_received, 11+: party cols, -2: valid, -1: invalid
#
# Runoff note: some mayor and majoritarian contests had a second round.
# For those, the final result is the R2 data. For all others, R1 is final.
# Output CSVs include a `round` column: 1 = first round only, 2 = runoff.

suppressPackageStartupMessages({
  library(readxl)
  library(dplyr)
  library(tidyr)
  library(stringr)
  library(yaml)
})

# ── Paths ──────────────────────────────────────────────────────────────────
EXCEL_R1     <- "src/data/raw/7795_2021 საკრებულო მერი პირველი ტური.xlsx"
EXCEL_R2     <- "src/data/raw/7795_2021 საკრებულო, მერი მეორე ტური.xlsx"
ELECTED_PATH <- "src/data/raw/local2021_elected_people.xlsx"
OUT_RESULTS  <- "src/data/results"
OUT_CANDS    <- "src/data/config/candidates/local"
dir.create(OUT_RESULTS, showWarnings = FALSE, recursive = TRUE)
dir.create(OUT_CANDS,   showWarnings = FALSE, recursive = TRUE)

# ── Party map ──────────────────────────────────────────────────────────────
PARTY_MAP <- c(
  "1"  = "third_force",
  "2"  = "european_georgia",
  "3"  = "early_elections_coalition",
  "5"  = "unm",
  "6"  = "european_democrats",
  "7"  = "citizens",
  "8"  = "patriots",
  "9"  = "lelo",
  "10" = "labour",
  "12" = "law_justice",
  "13" = "georgia_party",
  "14" = "new_christian_democrats",
  "17" = "reformer",
  "18" = "georgian_group",
  "19" = "european_socialists",
  "21" = "progress_freedom",
  "22" = "development_party",
  "24" = "social_democrats",
  "25" = "gakharia",
  "26" = "free_choice",
  "29" = "social_justice",
  "30" = "workers_socialist",
  "31" = "nation_party",
  "32" = "droa",
  "34" = "left_alliance",
  "35" = "tribuna",
  "36" = "girchi",
  "37" = "free_georgia",
  "38" = "mechiauri_united",
  "39" = "freedom_gamsakhurdia",
  "40" = "face_plus",
  "41" = "gd",
  "42" = "democrats_alliance",
  "43" = "third_way",
  "44" = "peoples_party",
  "45" = "girchi_more_freedom",
  "48" = "for_people",
  "49" = "reformators",
  "50" = "greens_geo"
)

# ── Helpers ────────────────────────────────────────────────────────────────
to_selfgov <- function(d) as.integer(ifelse(d >= 1L & d <= 10L, 1L, d))
to_major_id <- function(d, m) as.integer(to_selfgov(d) * 100L + as.integer(m))

parse_precinct_id <- function(code) {
  # Codes are "DD.SS" (e.g. "01.01") — district.sequential
  parts <- str_split_fixed(as.character(code), fixed("."), 2)
  as.integer(parts[, 1]) * 1000L + as.integer(parts[, 2])
}

write_csv_utf8 <- function(df, path) {
  write.csv(df, path, row.names = FALSE, fileEncoding = "UTF-8")
  cat("  Written:", path, "\n")
}

# ── Core sheet reader ──────────────────────────────────────────────────────
# Reads any precinct-level sheet and returns long (precinct × party) tbl.
# has_major = TRUE for majoritarian sheets (extra major_local column at pos 3).
# For PR sheets, party col names look like "1  „party_name"";
# for SMD sheets, party col names are pure numeric strings like "1", "25".
# In both cases we detect them with regex ^\\d+ (starts with a digit,
# while metadata cols are all Georgian text).
read_sheet_long <- function(excel_path, sheet_name, has_major) {
  df <- read_excel(excel_path, sheet = sheet_name, col_names = TRUE)

  # Drop any fully-NA trailing cols
  df <- df[, colSums(is.na(df)) < nrow(df)]

  # Identify party columns: any col whose name STARTS with a digit
  is_party_col <- str_detect(names(df), "^\\d+")
  party_cols   <- names(df)[is_party_col]

  # Assign metadata column names (1-indexed in R)
  if (has_major) {
    # Majoritarian: 10 metadata cols before parties
    names(df)[1:10] <- c("district", "district_name", "major_local", "precinct_code",
                          "main_list", "special_list", "voted_noon", "voted_5pm",
                          "voted", "ballots_received")
  } else {
    # PR / Mayor: 9 metadata cols before parties
    names(df)[1:9]  <- c("district", "district_name", "precinct_code",
                          "main_list", "special_list", "voted_noon", "voted_5pm",
                          "voted", "ballots_received")
  }

  # The two columns AFTER the last party col are valid_ballots, invalid_ballots
  last_party_pos <- max(which(is_party_col))
  names(df)[last_party_pos + 1] <- "valid_ballots"
  names(df)[last_party_pos + 2] <- "invalid_ballots"

  # Re-detect party cols after renaming (same mask, but use refreshed names)
  party_cols2 <- names(df)[is_party_col]

  keep <- c("district", "precinct_code", "main_list", "special_list",
            "voted_noon", "voted_5pm", "voted", "invalid_ballots",
            if (has_major) "major_local" else NULL,
            party_cols2)

  df_sub <- df %>%
    select(all_of(keep)) %>%
    # Drop rows where district or precinct_code is NA (total/header rows)
    filter(!is.na(district), !is.na(precinct_code)) %>%
    mutate(
      district        = as.integer(district),
      selfgov_id      = to_selfgov(district),
      precinct_id     = parse_precinct_id(precinct_code),
      # registered = main list + special list
      registered      = as.integer(coalesce(main_list, 0)) +
                        as.integer(coalesce(special_list, 0)),
      main_list       = as.integer(coalesce(main_list, 0)),
      special_list    = as.integer(coalesce(special_list, 0)),
      voted_noon      = as.integer(coalesce(voted_noon, 0)),
      voted_5pm       = as.integer(coalesce(voted_5pm, 0)),
      voted           = as.integer(voted),
      invalid_ballots = as.integer(coalesce(invalid_ballots, 0))
    )

  if (has_major) {
    df_sub <- df_sub %>%
      mutate(
        major_local = as.integer(major_local),
        major_id    = to_major_id(district, major_local)
      )
  }

  # Pivot to long; extract leading number as party key
  df_sub %>%
    pivot_longer(cols = all_of(party_cols2), names_to = "party_col", values_to = "votes") %>%
    mutate(
      party_num = str_extract(party_col, "^\\d+"),
      party_id  = PARTY_MAP[party_num],
      votes     = as.integer(coalesce(votes, 0L))
    ) %>%
    filter(!is.na(party_id))
}

# ── District-level aggregation ─────────────────────────────────────────────
summarise_to_level <- function(df_long, group_var) {
  turnout_raw <- df_long %>%
    distinct(across(all_of(c(group_var, "precinct_id"))),
             registered, main_list, special_list,
             voted_noon, voted_5pm, voted, invalid_ballots)

  turnout_agg <- turnout_raw %>%
    group_by(across(all_of(group_var))) %>%
    summarise(
      registered      = sum(registered,      na.rm = TRUE),
      main_list       = sum(main_list,       na.rm = TRUE),
      special_list    = sum(special_list,    na.rm = TRUE),
      voted           = sum(voted,           na.rm = TRUE),
      voted_noon      = sum(voted_noon,      na.rm = TRUE),
      voted_5pm       = sum(voted_5pm,       na.rm = TRUE),
      invalid_ballots = sum(invalid_ballots, na.rm = TRUE),
      .groups = "drop"
    ) %>%
    mutate(
      turnout_pct = round(voted / registered,     6),
      noon_pct    = round(voted_noon / registered, 6),
      five_pct    = round(voted_5pm / registered,  6),
      invalid_pct = round(invalid_ballots / voted, 6)
    )

  party_agg <- df_long %>%
    group_by(across(all_of(c(group_var, "party_id")))) %>%
    summarise(votes = sum(votes, na.rm = TRUE), .groups = "drop")

  valid_totals <- party_agg %>%
    group_by(across(all_of(group_var))) %>%
    summarise(total_valid = sum(votes), .groups = "drop")

  party_agg %>%
    left_join(valid_totals, by = group_var) %>%
    left_join(turnout_agg,  by = group_var) %>%
    mutate(vote_share = round(votes / total_valid, 6)) %>%
    rename(district_id = all_of(group_var)) %>%
    select(district_id, party_id, votes, vote_share,
           registered, voted, voted_noon, voted_5pm,
           main_list, special_list, turnout_pct, noon_pct, five_pct,
           invalid_ballots, invalid_pct)
}

add_national <- function(df) {
  df <- df %>% mutate(district_id = as.character(district_id))

  turn_nat <- df %>%
    distinct(district_id, .keep_all = TRUE) %>%
    summarise(
      registered      = sum(registered,      na.rm = TRUE),
      voted           = sum(voted,           na.rm = TRUE),
      voted_noon      = sum(voted_noon,      na.rm = TRUE),
      voted_5pm       = sum(voted_5pm,       na.rm = TRUE),
      main_list       = sum(main_list,       na.rm = TRUE),
      special_list    = sum(special_list,    na.rm = TRUE),
      invalid_ballots = sum(invalid_ballots, na.rm = TRUE)
    ) %>%
    mutate(
      turnout_pct = round(voted / registered, 6),
      noon_pct    = round(voted_noon / registered, 6),
      five_pct    = round(voted_5pm / registered, 6),
      invalid_pct = round(invalid_ballots / voted, 6)
    )

  votes_nat <- df %>%
    group_by(party_id) %>%
    summarise(votes = sum(votes), .groups = "drop")

  nat_rows <- votes_nat %>%
    mutate(
      district_id     = "national",
      vote_share      = round(votes / sum(votes), 6),
      registered      = turn_nat$registered,
      voted           = turn_nat$voted,
      voted_noon      = turn_nat$voted_noon,
      voted_5pm       = turn_nat$voted_5pm,
      main_list       = turn_nat$main_list,
      special_list    = turn_nat$special_list,
      turnout_pct     = turn_nat$turnout_pct,
      noon_pct        = turn_nat$noon_pct,
      five_pct        = turn_nat$five_pct,
      invalid_ballots = turn_nat$invalid_ballots,
      invalid_pct     = turn_nat$invalid_pct
    )

  extra_cols <- setdiff(names(df), names(nat_rows))
  for (col in extra_cols) nat_rows[[col]] <- NA_character_

  bind_rows(nat_rows[names(df)], df)
}

# ════════════════════════════════════════════════════════════════════════════
# 1. PROPORTIONAL (Sakrebulo PR) — Round 1 only
# ════════════════════════════════════════════════════════════════════════════
cat("Processing PR results...\n")
pr_long <- read_sheet_long(EXCEL_R1, "პროპორციული", has_major = FALSE)

pr_district <- summarise_to_level(pr_long, "district") %>% add_national()
write_csv_utf8(pr_district, file.path(OUT_RESULTS, "local2021_pr.csv"))

pr_selfgov <- summarise_to_level(pr_long, "selfgov_id") %>% add_national()
write_csv_utf8(pr_selfgov, file.path(OUT_RESULTS, "local2021_pr_selfgov.csv"))

pr_prec <- pr_long %>%
  group_by(precinct_id, district, party_id) %>%
  summarise(
    votes           = sum(votes, na.rm = TRUE),
    registered      = first(registered),
    voted           = first(voted),
    voted_noon      = first(voted_noon),
    voted_5pm       = first(voted_5pm),
    invalid_ballots = first(invalid_ballots),
    .groups = "drop"
  ) %>%
  group_by(precinct_id) %>%
  mutate(vote_share = round(votes / sum(votes), 6)) %>%
  ungroup() %>%
  mutate(
    turnout_pct = round(voted / registered, 6),
    noon_pct    = round(voted_noon / registered, 6),
    five_pct    = round(voted_5pm / registered, 6),
    invalid_pct = round(invalid_ballots / voted, 6)
  ) %>%
  rename(district_id = district) %>%
  select(precinct_id, district_id, party_id, votes, vote_share,
         registered, voted, voted_noon, voted_5pm,
         turnout_pct, noon_pct, five_pct, invalid_ballots, invalid_pct)
write_csv_utf8(pr_prec, file.path(OUT_RESULTS, "local2021_pr_precincts.csv"))

# ════════════════════════════════════════════════════════════════════════════
# 2. MAYOR (SMD) — merge R1 and R2; R2 units are the final result for runoffs
# ════════════════════════════════════════════════════════════════════════════
cat("Processing mayoral results...\n")

smd_r1_long <- read_sheet_long(EXCEL_R1, "მერი", has_major = FALSE)
smd_r2_long <- read_sheet_long(EXCEL_R2, "მერი", has_major = FALSE)

runoff_selfgovs <- unique(smd_r2_long$selfgov_id)
cat("  Mayor runoff self-gov IDs:", paste(sort(runoff_selfgovs), collapse = ", "), "\n")

smd_final_long <- bind_rows(
  smd_r1_long %>% filter(!selfgov_id %in% runoff_selfgovs),
  smd_r2_long
)

# Candidate lookups
# R1: district, district_name, cand_num, first_name, last_name, party_name
df_mc_r1 <- read_excel(EXCEL_R1, sheet = "მერობის კანდ.")
names(df_mc_r1) <- c("district", "district_name", "cand_num", "first_name", "last_name", "party_name")
mc_r1_lookup <- df_mc_r1 %>%
  mutate(
    selfgov_id = to_selfgov(as.integer(district)),
    party_id   = PARTY_MAP[as.character(cand_num)],
    name_ka    = paste(first_name, last_name)
  ) %>%
  filter(!is.na(party_id)) %>%
  select(selfgov_id, party_id, name_ka) %>%
  distinct()

# R2: district, district_name, cand_num, LAST_name, FIRST_name, party_name (reversed!)
df_mc_r2 <- read_excel(EXCEL_R2, sheet = "მერობის კანდიდატები")
names(df_mc_r2) <- c("district", "district_name", "cand_num", "last_name", "first_name", "party_name")
mc_r2_lookup <- df_mc_r2 %>%
  mutate(
    selfgov_id = to_selfgov(as.integer(district)),
    party_id   = PARTY_MAP[as.character(cand_num)],
    name_ka    = paste(first_name, last_name)
  ) %>%
  filter(!is.na(party_id)) %>%
  select(selfgov_id, party_id, name_ka) %>%
  distinct()

# Merged: R2 takes priority for runoff units
mc_lookup <- bind_rows(
  mc_r2_lookup %>% mutate(src = "r2"),
  mc_r1_lookup %>% mutate(src = "r1")
) %>%
  distinct(selfgov_id, party_id, .keep_all = TRUE) %>%
  select(selfgov_id, party_id, name_ka)

smd_dist <- summarise_to_level(smd_final_long, "selfgov_id") %>%
  filter(votes > 0) %>%
  left_join(mc_lookup, by = c("district_id" = "selfgov_id", "party_id")) %>%
  mutate(name_ka = coalesce(name_ka, "")) %>%
  add_national() %>%
  mutate(
    name_ka = coalesce(name_ka, ""),
    # Add round AFTER add_national so district_id is already character
    # "national" -> as.integer = NA -> not in runoff_selfgovs -> round = 1
    round   = if_else(
      !is.na(suppressWarnings(as.integer(district_id))) &
        suppressWarnings(as.integer(district_id)) %in% runoff_selfgovs,
      2L, 1L
    )
  ) %>%
  select(district_id, party_id, name_ka, round, votes, vote_share,
         registered, voted, voted_noon, voted_5pm,
         main_list, special_list, turnout_pct, noon_pct, five_pct,
         invalid_ballots, invalid_pct)
write_csv_utf8(smd_dist, file.path(OUT_RESULTS, "local2021_smd.csv"))

# Expand Tbilisi (selfgov_id=1) across CEC districts 1–10 for the district map
tbilisi_expanded <- smd_dist %>%
  filter(district_id == "1") %>%
  crossing(tibble(new_did = as.character(2:10))) %>%
  mutate(district_id = new_did) %>%
  select(-new_did)

smd_districts <- smd_dist %>%
  filter(district_id != "national") %>%
  bind_rows(tbilisi_expanded) %>%
  bind_rows(filter(smd_dist, district_id == "national")) %>%
  arrange(district_id, party_id)
write_csv_utf8(smd_districts, file.path(OUT_RESULTS, "local2021_smd_districts.csv"))

# Mayor precincts
smd_prec <- smd_final_long %>%
  group_by(precinct_id, selfgov_id, party_id) %>%
  summarise(
    votes           = sum(votes, na.rm = TRUE),
    registered      = first(registered),
    voted           = first(voted),
    voted_noon      = first(voted_noon),
    voted_5pm       = first(voted_5pm),
    invalid_ballots = first(invalid_ballots),
    .groups = "drop"
  ) %>%
  filter(votes > 0) %>%
  group_by(precinct_id) %>%
  mutate(vote_share = round(votes / sum(votes), 6)) %>%
  ungroup() %>%
  mutate(
    turnout_pct = round(voted / registered, 6),
    noon_pct    = round(voted_noon / registered, 6),
    five_pct    = round(voted_5pm / registered, 6),
    invalid_pct = round(invalid_ballots / voted, 6)
  ) %>%
  select(precinct_id, selfgov_id, party_id, votes, vote_share,
         registered, voted, voted_noon, voted_5pm,
         turnout_pct, noon_pct, five_pct, invalid_ballots, invalid_pct)
write_csv_utf8(smd_prec, file.path(OUT_RESULTS, "local2021_smd_precincts.csv"))

# ── Mayor R2 only (runoff sub-election) ───────────────────────────────────
smd_r2_dist <- summarise_to_level(smd_r2_long, "selfgov_id") %>%
  filter(votes > 0) %>%
  left_join(mc_r2_lookup, by = c("district_id" = "selfgov_id", "party_id")) %>%
  mutate(name_ka = coalesce(name_ka, "")) %>%
  add_national() %>%
  mutate(name_ka = coalesce(name_ka, "")) %>%
  select(district_id, party_id, name_ka, votes, vote_share,
         registered, voted, voted_noon, voted_5pm,
         main_list, special_list, turnout_pct, noon_pct, five_pct,
         invalid_ballots, invalid_pct)
write_csv_utf8(smd_r2_dist, file.path(OUT_RESULTS, "local2021_r2_smd.csv"))

smd_r2_prec <- smd_r2_long %>%
  group_by(precinct_id, selfgov_id, party_id) %>%
  summarise(
    votes           = sum(votes, na.rm = TRUE),
    registered      = first(registered),
    voted           = first(voted),
    voted_noon      = first(voted_noon),
    voted_5pm       = first(voted_5pm),
    invalid_ballots = first(invalid_ballots),
    .groups = "drop"
  ) %>%
  filter(votes > 0) %>%
  group_by(precinct_id) %>%
  mutate(vote_share = round(votes / sum(votes), 6)) %>%
  ungroup() %>%
  mutate(
    turnout_pct = round(voted / registered, 6),
    noon_pct    = round(voted_noon / registered, 6),
    five_pct    = round(voted_5pm / registered, 6),
    invalid_pct = round(invalid_ballots / voted, 6)
  ) %>%
  select(precinct_id, selfgov_id, party_id, votes, vote_share,
         registered, voted, voted_noon, voted_5pm,
         turnout_pct, noon_pct, five_pct, invalid_ballots, invalid_pct)
write_csv_utf8(smd_r2_prec, file.path(OUT_RESULTS, "local2021_r2_smd_precincts.csv"))

# Mayor R2 district expansion: expand Tbilisi (selfgov=1) across CEC districts 1–10
smd_r2_tbilisi <- smd_r2_dist %>%
  filter(district_id == "1") %>%
  crossing(tibble(new_did = as.character(2:10))) %>%
  mutate(district_id = new_did) %>%
  select(-new_did)
smd_r2_districts <- smd_r2_dist %>%
  filter(district_id != "national") %>%
  bind_rows(smd_r2_tbilisi) %>%
  bind_rows(filter(smd_r2_dist, district_id == "national")) %>%
  arrange(district_id, party_id)
write_csv_utf8(smd_r2_districts, file.path(OUT_RESULTS, "local2021_r2_smd_districts.csv"))

# ════════════════════════════════════════════════════════════════════════════
# 3. MAJORITARIAN (Sakrebulo SMD) — merge R1 and R2
# ════════════════════════════════════════════════════════════════════════════
cat("Processing majoritarian results...\n")

maj_r1_long <- read_sheet_long(EXCEL_R1, "მაჟორიტარული", has_major = TRUE)
maj_r2_long <- read_sheet_long(EXCEL_R2, "მაჟორიტარული", has_major = TRUE)

runoff_major_ids <- unique(maj_r2_long$major_id)
cat("  Majoritarian runoff districts:", length(runoff_major_ids), "\n")

maj_final_long <- bind_rows(
  maj_r1_long %>% filter(!major_id %in% runoff_major_ids),
  maj_r2_long
)

# Candidate lookups
# R1: district, district_name, major_code, cand_num, first_name, last_name, party_name
df_majc_r1 <- read_excel(EXCEL_R1, sheet = "მაჟორიტარი კანდ.")
names(df_majc_r1) <- c("district", "district_name", "major_code", "cand_num",
                        "first_name", "last_name", "party_name")
majc_r1_lookup <- df_majc_r1 %>%
  mutate(
    district    = as.integer(district),
    major_local = as.integer(str_extract(as.character(major_code), "\\d+$")),
    major_id    = to_major_id(district, major_local),
    party_id    = PARTY_MAP[as.character(cand_num)],
    name_ka     = paste(first_name, last_name)
  ) %>%
  filter(!is.na(party_id)) %>%
  select(major_id, party_id, name_ka) %>%
  distinct()

# R2: district, district_name, major_code, cand_num, LAST_name, FIRST_name, party_name
df_majc_r2 <- read_excel(EXCEL_R2, sheet = "მაჟორ. კანდიდატები")
names(df_majc_r2) <- c("district", "district_name", "major_code", "cand_num",
                        "last_name", "first_name", "party_name")
majc_r2_lookup <- df_majc_r2 %>%
  mutate(
    district    = as.integer(district),
    major_local = as.integer(str_extract(as.character(major_code), "\\d+$")),
    major_id    = to_major_id(district, major_local),
    party_id    = PARTY_MAP[as.character(cand_num)],
    name_ka     = paste(first_name, last_name)
  ) %>%
  filter(!is.na(party_id)) %>%
  select(major_id, party_id, name_ka) %>%
  distinct()

majc_lookup <- bind_rows(
  majc_r2_lookup %>% mutate(src = "r2"),
  majc_r1_lookup %>% mutate(src = "r1")
) %>%
  distinct(major_id, party_id, .keep_all = TRUE) %>%
  select(major_id, party_id, name_ka)

# Aggregate by major_id
turn_maj <- maj_final_long %>%
  distinct(major_id, precinct_id, .keep_all = TRUE) %>%
  group_by(major_id) %>%
  summarise(
    registered      = sum(registered,      na.rm = TRUE),
    main_list       = sum(main_list,       na.rm = TRUE),
    special_list    = sum(special_list,    na.rm = TRUE),
    voted           = sum(voted,           na.rm = TRUE),
    voted_noon      = sum(voted_noon,      na.rm = TRUE),
    voted_5pm       = sum(voted_5pm,       na.rm = TRUE),
    invalid_ballots = sum(invalid_ballots, na.rm = TRUE),
    .groups = "drop"
  ) %>%
  mutate(
    turnout_pct = round(voted / registered, 6),
    noon_pct    = round(voted_noon / registered, 6),
    five_pct    = round(voted_5pm / registered, 6),
    invalid_pct = round(invalid_ballots / voted, 6)
  )

party_maj <- maj_final_long %>%
  group_by(major_id, party_id) %>%
  summarise(votes = sum(votes, na.rm = TRUE), .groups = "drop") %>%
  filter(votes > 0)

valid_maj <- party_maj %>%
  group_by(major_id) %>%
  summarise(total_valid = sum(votes), .groups = "drop")

maj_dist <- party_maj %>%
  left_join(valid_maj,   by = "major_id") %>%
  left_join(turn_maj,    by = "major_id") %>%
  mutate(vote_share = round(votes / total_valid, 6)) %>%
  left_join(majc_lookup, by = c("major_id", "party_id")) %>%
  mutate(
    name_ka = coalesce(name_ka, ""),
    round   = if_else(major_id %in% runoff_major_ids, 2L, 1L)
  ) %>%
  rename(district_id = major_id) %>%
  select(district_id, party_id, name_ka, round, votes, vote_share,
         registered, voted, voted_noon, voted_5pm,
         main_list, special_list, turnout_pct, noon_pct, five_pct,
         invalid_ballots, invalid_pct)

turn_nat_maj <- turn_maj %>%
  summarise(across(c(registered, voted, voted_noon, voted_5pm,
                     main_list, special_list, invalid_ballots), sum)) %>%
  mutate(
    turnout_pct = round(voted / registered, 6),
    noon_pct    = round(voted_noon / registered, 6),
    five_pct    = round(voted_5pm / registered, 6),
    invalid_pct = round(invalid_ballots / voted, 6)
  )

nat_maj <- party_maj %>%
  group_by(party_id) %>%
  summarise(votes = sum(votes), .groups = "drop") %>%
  mutate(
    district_id     = "national",
    name_ka         = "",
    round           = 1L,
    vote_share      = round(votes / sum(votes), 6),
    registered      = turn_nat_maj$registered,
    voted           = turn_nat_maj$voted,
    voted_noon      = turn_nat_maj$voted_noon,
    voted_5pm       = turn_nat_maj$voted_5pm,
    main_list       = turn_nat_maj$main_list,
    special_list    = turn_nat_maj$special_list,
    turnout_pct     = turn_nat_maj$turnout_pct,
    noon_pct        = turn_nat_maj$noon_pct,
    five_pct        = turn_nat_maj$five_pct,
    invalid_ballots = turn_nat_maj$invalid_ballots,
    invalid_pct     = turn_nat_maj$invalid_pct
  ) %>%
  select(names(maj_dist))

maj_dist      <- maj_dist %>% mutate(district_id = as.character(district_id))
maj_final_out <- bind_rows(nat_maj, maj_dist)
write_csv_utf8(maj_final_out, file.path(OUT_RESULTS, "local2021_council_smd.csv"))

# Majoritarian precincts
maj_prec <- maj_final_long %>%
  group_by(precinct_id, major_id, party_id) %>%
  summarise(
    votes           = sum(votes, na.rm = TRUE),
    registered      = first(registered),
    voted           = first(voted),
    voted_noon      = first(voted_noon),
    voted_5pm       = first(voted_5pm),
    invalid_ballots = first(invalid_ballots),
    .groups = "drop"
  ) %>%
  filter(votes > 0) %>%
  group_by(precinct_id, major_id) %>%
  mutate(vote_share = round(votes / sum(votes), 6)) %>%
  ungroup() %>%
  mutate(
    turnout_pct = round(voted / registered, 6),
    noon_pct    = round(voted_noon / registered, 6),
    five_pct    = round(voted_5pm / registered, 6),
    invalid_pct = round(invalid_ballots / voted, 6)
  ) %>%
  rename(district_id = major_id) %>%
  select(precinct_id, district_id, party_id, votes, vote_share,
         registered, voted, voted_noon, voted_5pm,
         turnout_pct, noon_pct, five_pct, invalid_ballots, invalid_pct)
write_csv_utf8(maj_prec, file.path(OUT_RESULTS, "local2021_council_smd_precincts.csv"))

# ── Majoritarian R2 only (runoff sub-election) ────────────────────────────
turn_maj_r2 <- maj_r2_long %>%
  distinct(major_id, precinct_id, .keep_all = TRUE) %>%
  group_by(major_id) %>%
  summarise(
    registered      = sum(registered,      na.rm = TRUE),
    main_list       = sum(main_list,       na.rm = TRUE),
    special_list    = sum(special_list,    na.rm = TRUE),
    voted           = sum(voted,           na.rm = TRUE),
    voted_noon      = sum(voted_noon,      na.rm = TRUE),
    voted_5pm       = sum(voted_5pm,       na.rm = TRUE),
    invalid_ballots = sum(invalid_ballots, na.rm = TRUE),
    .groups = "drop"
  ) %>%
  mutate(
    turnout_pct = round(voted / registered, 6),
    noon_pct    = round(voted_noon / registered, 6),
    five_pct    = round(voted_5pm / registered, 6),
    invalid_pct = round(invalid_ballots / voted, 6)
  )

party_maj_r2 <- maj_r2_long %>%
  group_by(major_id, party_id) %>%
  summarise(votes = sum(votes, na.rm = TRUE), .groups = "drop") %>%
  filter(votes > 0)

valid_maj_r2 <- party_maj_r2 %>%
  group_by(major_id) %>%
  summarise(total_valid = sum(votes), .groups = "drop")

maj_r2_dist <- party_maj_r2 %>%
  left_join(valid_maj_r2,   by = "major_id") %>%
  left_join(turn_maj_r2,    by = "major_id") %>%
  mutate(vote_share = round(votes / total_valid, 6)) %>%
  left_join(majc_lookup, by = c("major_id", "party_id")) %>%
  mutate(name_ka = coalesce(name_ka, "")) %>%
  rename(district_id = major_id) %>%
  select(district_id, party_id, name_ka, votes, vote_share,
         registered, voted, voted_noon, voted_5pm,
         main_list, special_list, turnout_pct, noon_pct, five_pct,
         invalid_ballots, invalid_pct)

turn_nat_maj_r2 <- turn_maj_r2 %>%
  summarise(across(c(registered, voted, voted_noon, voted_5pm,
                     main_list, special_list, invalid_ballots), sum)) %>%
  mutate(
    turnout_pct = round(voted / registered, 6),
    noon_pct    = round(voted_noon / registered, 6),
    five_pct    = round(voted_5pm / registered, 6),
    invalid_pct = round(invalid_ballots / voted, 6)
  )

nat_maj_r2 <- party_maj_r2 %>%
  group_by(party_id) %>%
  summarise(votes = sum(votes), .groups = "drop") %>%
  mutate(
    district_id     = "national",
    name_ka         = "",
    vote_share      = round(votes / sum(votes), 6),
    registered      = turn_nat_maj_r2$registered,
    voted           = turn_nat_maj_r2$voted,
    voted_noon      = turn_nat_maj_r2$voted_noon,
    voted_5pm       = turn_nat_maj_r2$voted_5pm,
    main_list       = turn_nat_maj_r2$main_list,
    special_list    = turn_nat_maj_r2$special_list,
    turnout_pct     = turn_nat_maj_r2$turnout_pct,
    noon_pct        = turn_nat_maj_r2$noon_pct,
    five_pct        = turn_nat_maj_r2$five_pct,
    invalid_ballots = turn_nat_maj_r2$invalid_ballots,
    invalid_pct     = turn_nat_maj_r2$invalid_pct
  ) %>%
  select(names(maj_r2_dist))

maj_r2_dist    <- maj_r2_dist %>% mutate(district_id = as.character(district_id))
maj_r2_final   <- bind_rows(nat_maj_r2, maj_r2_dist)
write_csv_utf8(maj_r2_final, file.path(OUT_RESULTS, "local2021_r2_council_smd.csv"))

maj_r2_prec <- maj_r2_long %>%
  group_by(precinct_id, major_id, party_id) %>%
  summarise(
    votes           = sum(votes, na.rm = TRUE),
    registered      = first(registered),
    voted           = first(voted),
    voted_noon      = first(voted_noon),
    voted_5pm       = first(voted_5pm),
    invalid_ballots = first(invalid_ballots),
    .groups = "drop"
  ) %>%
  filter(votes > 0) %>%
  group_by(precinct_id, major_id) %>%
  mutate(vote_share = round(votes / sum(votes), 6)) %>%
  ungroup() %>%
  mutate(
    turnout_pct = round(voted / registered, 6),
    noon_pct    = round(voted_noon / registered, 6),
    five_pct    = round(voted_5pm / registered, 6),
    invalid_pct = round(invalid_ballots / voted, 6)
  ) %>%
  rename(district_id = major_id) %>%
  select(precinct_id, district_id, party_id, votes, vote_share,
         registered, voted, voted_noon, voted_5pm,
         turnout_pct, noon_pct, five_pct, invalid_ballots, invalid_pct)
write_csv_utf8(maj_r2_prec, file.path(OUT_RESULTS, "local2021_r2_council_smd_precincts.csv"))

# ════════════════════════════════════════════════════════════════════════════
# 4. CANDIDATE YAML
# ════════════════════════════════════════════════════════════════════════════
cat("Building candidate YAML...\n")

all_mc <- bind_rows(
  df_mc_r1 %>% mutate(src = "r1", district = as.character(district),
    selfgov_id = to_selfgov(as.integer(district)),
    party_id   = PARTY_MAP[as.character(cand_num)],
    name_ka    = paste(first_name, last_name)
  ),
  df_mc_r2 %>% mutate(src = "r2", district = as.character(district),
    selfgov_id = to_selfgov(as.integer(district)),
    party_id   = PARTY_MAP[as.character(cand_num)],
    name_ka    = paste(first_name, last_name)
  )
) %>%
  filter(!is.na(party_id)) %>%
  arrange(selfgov_id, party_id, desc(src)) %>%
  distinct(selfgov_id, party_id, .keep_all = TRUE)

mayor_yaml <- lapply(seq_len(nrow(all_mc)), function(i) {
  r   <- all_mc[i, ]
  sg  <- r$selfgov_id
  pid <- r$party_id
  cid <- paste0(pid, "_mayor_", sg)
  setNames(list(list(
    name_ka       = r$name_ka,
    election_type = "mayor",
    selfgov_id    = as.integer(sg),
    party         = pid
  )), cid)
})
mayor_yaml_named <- do.call(c, mayor_yaml)

all_majc <- bind_rows(
  df_majc_r1 %>% mutate(src = "r1",
    district    = as.integer(district),
    major_local = as.integer(str_extract(as.character(major_code), "\\d+$")),
    major_id    = to_major_id(district, major_local),
    party_id    = PARTY_MAP[as.character(cand_num)],
    name_ka     = paste(first_name, last_name)
  ),
  df_majc_r2 %>% mutate(src = "r2",
    district    = as.integer(district),
    major_local = as.integer(str_extract(as.character(major_code), "\\d+$")),
    major_id    = to_major_id(district, major_local),
    party_id    = PARTY_MAP[as.character(cand_num)],
    name_ka     = paste(first_name, last_name)
  )
) %>%
  filter(!is.na(party_id)) %>%
  arrange(major_id, party_id, desc(src)) %>%
  distinct(major_id, party_id, .keep_all = TRUE)

maj_yaml <- lapply(seq_len(nrow(all_majc)), function(i) {
  r   <- all_majc[i, ]
  mid <- r$major_id
  pid <- r$party_id
  d   <- r$district
  cid <- paste0(pid, "_maj_", mid)
  setNames(list(list(
    name_ka               = r$name_ka,
    election_type         = "sakrebulo_smd",
    selfgov_id            = as.integer(to_selfgov(d)),
    electoral_district_id = as.integer(d),
    major_id              = as.integer(mid),
    party                 = pid
  )), cid)
})
maj_yaml_named <- do.call(c, maj_yaml)

write_yaml(
  list(candidates = c(mayor_yaml_named, maj_yaml_named)),
  file.path(OUT_CANDS, "local_2021.yml"),
  unicode = TRUE
)
cat("  Written:", file.path(OUT_CANDS, "local_2021.yml"), "\n")

# ════════════════════════════════════════════════════════════════════════════
# 5. SEATS from elected people list
# ════════════════════════════════════════════════════════════════════════════
cat("Processing seat composition from elected list...\n")

if (file.exists(ELECTED_PATH)) {
  elected_raw <- read_excel(ELECTED_PATH)

  # Columns: self_governing_unit, vote_type, candidate_name,
  #           candidate_political_party, majoritarian_district_id
  elected <- elected_raw %>%
    select(selfgov_id = 1, vote_type = 2, candidate_name = 3,
           party_raw = 4) %>%
    mutate(
      selfgov_id = as.integer(selfgov_id),
      vote_type  = str_to_lower(trimws(as.character(vote_type))),
      party_raw  = trimws(as.character(party_raw)),
      # Extract leading number: "41. ქართული ოცნება" → "41"
      party_num  = str_extract(party_raw, "^\\d+"),
      party_id   = if_else(
        is.na(party_num),
        "independent",   # "დამოუკიდებელი" has no number prefix
        PARTY_MAP[party_num]
      )
    ) %>%
    filter(!is.na(party_id))

  cat("  Vote types:", paste(unique(elected$vote_type), collapse=", "), "\n")
  cat("  Total elected:", nrow(elected), "\n")

  seats_pr <- elected %>%
    filter(vote_type == "sakrebulo pr") %>%
    group_by(selfgov_id, party_id) %>% summarise(seats_pr = n(), .groups = "drop")

  seats_smd <- elected %>%
    filter(vote_type == "sakrebulo smd") %>%
    group_by(selfgov_id, party_id) %>% summarise(seats_smd = n(), .groups = "drop")

  seats_mayor <- elected %>%
    filter(vote_type == "mayor") %>%
    group_by(selfgov_id, party_id) %>% summarise(seats_mayor = n(), .groups = "drop")

  seats_by_unit <- seats_pr %>%
    full_join(seats_smd,   by = c("selfgov_id", "party_id")) %>%
    full_join(seats_mayor, by = c("selfgov_id", "party_id")) %>%
    mutate(
      seats_pr    = as.integer(coalesce(seats_pr,    0L)),
      seats_smd   = as.integer(coalesce(seats_smd,   0L)),
      seats_mayor = as.integer(coalesce(seats_mayor, 0L)),
      selfgov_id  = as.character(selfgov_id)
    )

  seats_national <- seats_by_unit %>%
    group_by(party_id) %>%
    summarise(
      seats_pr    = sum(seats_pr),
      seats_smd   = sum(seats_smd),
      seats_mayor = sum(seats_mayor),
      .groups = "drop"
    ) %>%
    mutate(selfgov_id = "national") %>%
    select(selfgov_id, party_id, seats_pr, seats_smd, seats_mayor)

  seats_final <- bind_rows(seats_national, seats_by_unit) %>%
    select(selfgov_id, party_id, seats_pr, seats_smd, seats_mayor)

  write_csv_utf8(seats_final, file.path(OUT_RESULTS, "local2021_seats.csv"))
  cat("  Total PR seats:",    sum(seats_national$seats_pr),    "\n")
  cat("  Total SMD seats:",   sum(seats_national$seats_smd),   "\n")
  cat("  Total Mayor seats:", sum(seats_national$seats_mayor), "\n")
} else {
  cat("  Skipped: elected list not found at", ELECTED_PATH, "\n")
}

cat("\nDone!\n")
