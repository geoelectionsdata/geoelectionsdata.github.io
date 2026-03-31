#!/usr/bin/env Rscript
# scripts/process_parl2024.R
#
# Processes raw precinct-level data for the 2024 Georgian parliamentary elections.
# Run from project root: Rscript scripts/process_parl2024.R
#
# Input:
#   src/data/raw/2024.26.10 - პარლამენტი.xlsx
#
# Outputs (results + turnout combined, no seat/threshold calculation):
#   src/data/results/parl2024_pr.csv
#     district_id (1–84 + "national"), party_id, votes, vote_share,
#     registered, voted, voted_noon, voted_5pm, main_list, special_list, turnout_pct
#
#   src/data/results/parl2024_pr_precincts.csv
#     precinct_id (= district_num*1000 + precinct_num, matches GeoJSON 'id'),
#     district_id, party_id, votes, vote_share, registered, voted, turnout_pct

suppressPackageStartupMessages({
  library(readxl)
  library(dplyr)
  library(tidyr)
  library(stringr)
})

RAW_FILE <- "src/data/raw/2024.26.10 - პარლამენტი.xlsx"

# Maps ballot number (column prefix in Excel) -> canonical party_id in parties.yml
PARTY_MAP <- c(
  "3"  = "unity_development",    # საქართველოს ერთობისა და განვითარების პარტია
  "4"  = "coalition_for_change", # კოალიცია ცვლილებისთვის
  "5"  = "unity",                # ერთობა — ნაციონალური მოძრაობა
  "6"  = "european_democrats",   # ევროპელი დემოკრატები
  "8"  = "patriots",             # საქართველოს პატრიოტთა ალიანსი
  "9"  = "strong_georgia",       # ძლიერი საქართველო
  "10" = "labour",               # საქართველოს ლეიბორისტული პარტია
  "12" = "our_georgia",          # ჩვენი გაერთიანებული საქართველო
  "16" = "change_georgia",       # შეცვალე საქართველო
  "17" = "georgia_party",        # საქართველო
  "20" = "free_georgia",         # თავისუფალი საქართველო
  "21" = "tribuna",              # ტრიბუნა
  "23" = "chven",                # ჩვენ
  "25" = "gakharia",             # გახარია საქართველოსთვის
  "26" = "left_alliance",        # მემარცხენე ალიანსი
  "27" = "georgian_unity",       # ქართველ ერთობა
  "36" = "girchi",               # გირჩი
  "41" = "gd"                    # ქართული ოცნება
)

# ─────────────────────────────────────────────────────────────────────────────
# 1. READ RAW DATA
# ─────────────────────────────────────────────────────────────────────────────
cat("Reading:", RAW_FILE, "\n")
raw_names  <- names(read_excel(RAW_FILE, n_max = 0))
ballot_nums <- str_extract(raw_names[11:28], "^\\d+")

col_names <- c(
  "district_num", "district_name",
  "precinct_num", "precinct_status",
  "registered_main", "ballots_received",
  "registered_special",
  "voted_noon", "voted_5pm", "voted_total",
  paste0("p_", ballot_nums),
  "invalid_ballots"
)

raw <- read_excel(RAW_FILE, col_names = col_names, skip = 1) %>%
  mutate(
    district_num = as.integer(district_num),
    # precinct_num is a compound code like "00.01.07"; extract the trailing station number
    station_num  = suppressWarnings(as.integer(str_extract(precinct_num, "\\d+$"))),
    across(
      starts_with("p_") | c(registered_main, registered_special,
                             voted_noon, voted_5pm, voted_total,
                             invalid_ballots, ballots_received),
      ~ suppressWarnings(as.numeric(.x))
    )
  ) %>%
  filter(!is.na(district_num))   # drop blank/summary rows (same as original)

# ─────────────────────────────────────────────────────────────────────────────
# 2. RESHAPE TO LONG FORMAT & MAP PARTIES
# ─────────────────────────────────────────────────────────────────────────────
party_cols <- paste0("p_", ballot_nums)

long <- raw %>%
  pivot_longer(
    cols      = all_of(party_cols),
    names_to  = "col_name",
    values_to = "votes"
  ) %>%
  mutate(
    ballot_num = str_extract(col_name, "\\d+"),
    party_id   = PARTY_MAP[ballot_num],
    votes      = replace_na(votes, 0L),
    registered = registered_main + coalesce(registered_special, 0)
  ) %>%
  filter(!is.na(party_id))   # drop any unmapped ballot numbers

# De-duplicated station table for turnout (one row per polling station)
# precinct_id = district_num * 1000 + station_num  (matches GeoJSON 'id' field)
stations <- raw %>%
  filter(!is.na(station_num)) %>%          # only individual station rows
  mutate(
    precinct_id = district_num * 1000L + station_num,
    registered  = registered_main + coalesce(registered_special, 0)
  ) %>%
  distinct(district_num, precinct_num, .keep_all = TRUE)

# ─────────────────────────────────────────────────────────────────────────────
# 3. DISTRICT-LEVEL RESULTS + TURNOUT
# vote_share = party votes / total valid votes (sum of all party votes) per district
# ─────────────────────────────────────────────────────────────────────────────
district_votes <- long %>%
  group_by(district_id = as.character(district_num), party_id) %>%
  summarise(votes = sum(votes, na.rm = TRUE), .groups = "drop") %>%
  group_by(district_id) %>%
  mutate(vote_share = round(votes / sum(votes), 6)) %>%
  ungroup()

district_turnout <- stations %>%
  group_by(district_id = as.character(district_num)) %>%
  summarise(
    registered   = sum(registered,               na.rm = TRUE),
    voted        = sum(voted_total,               na.rm = TRUE),
    voted_noon   = sum(voted_noon,                na.rm = TRUE),
    voted_5pm    = sum(voted_5pm,                 na.rm = TRUE),
    main_list    = sum(registered_main,           na.rm = TRUE),
    special_list = sum(coalesce(registered_special, 0), na.rm = TRUE),
    .groups = "drop"
  ) %>%
  mutate(turnout_pct = round(voted / registered, 6))

district_out <- district_votes %>%
  left_join(district_turnout, by = "district_id") %>%
  arrange(as.integer(district_id), desc(votes))

# ─────────────────────────────────────────────────────────────────────────────
# 4. NATIONAL AGGREGATE ROWS  (district_id = "national")
# ─────────────────────────────────────────────────────────────────────────────
national_totals <- stations %>%
  summarise(
    registered   = sum(registered,               na.rm = TRUE),
    voted        = sum(voted_total,               na.rm = TRUE),
    voted_noon   = sum(voted_noon,                na.rm = TRUE),
    voted_5pm    = sum(voted_5pm,                 na.rm = TRUE),
    main_list    = sum(registered_main,           na.rm = TRUE),
    special_list = sum(coalesce(registered_special, 0), na.rm = TRUE)
  ) %>%
  mutate(turnout_pct = round(voted / registered, 6))

national_out <- long %>%
  group_by(party_id) %>%
  summarise(votes = sum(votes, na.rm = TRUE), .groups = "drop") %>%
  mutate(
    district_id = "national",
    vote_share  = round(votes / sum(votes), 6),
    registered   = national_totals$registered,
    voted        = national_totals$voted,
    voted_noon   = national_totals$voted_noon,
    voted_5pm    = national_totals$voted_5pm,
    main_list    = national_totals$main_list,
    special_list = national_totals$special_list,
    turnout_pct  = national_totals$turnout_pct
  ) %>%
  arrange(desc(votes)) %>%
  select(district_id, party_id, votes, vote_share,
         registered, voted, voted_noon, voted_5pm, main_list, special_list, turnout_pct)

district_out_all <- bind_rows(
  district_out %>%
    select(district_id, party_id, votes, vote_share,
           registered, voted, voted_noon, voted_5pm, main_list, special_list, turnout_pct),
  national_out
)

# ─────────────────────────────────────────────────────────────────────────────
# 5. PRECINCT-LEVEL RESULTS + TURNOUT
# precinct_id = district_num * 1000 + precinct_num  (matches GeoJSON 'id' field)
# district_id = CEC district number (matches GeoJSON 'district_id' field)
# ─────────────────────────────────────────────────────────────────────────────
precinct_votes <- long %>%
  filter(!is.na(station_num)) %>%
  group_by(
    precinct_id = district_num * 1000L + station_num,
    district_id = as.character(district_num),
    party_id
  ) %>%
  summarise(votes = sum(votes, na.rm = TRUE), .groups = "drop") %>%
  group_by(precinct_id) %>%
  mutate(vote_share = round(votes / sum(votes), 6)) %>%
  ungroup()

precinct_turnout <- stations %>%
  transmute(
    precinct_id  = precinct_id,
    registered   = registered,
    voted        = voted_total,
    turnout_pct  = round(voted_total / registered, 6)
  )

precinct_out <- precinct_votes %>%
  left_join(precinct_turnout, by = "precinct_id") %>%
  arrange(precinct_id, desc(votes)) %>%
  select(precinct_id, district_id, party_id, votes, vote_share,
         registered, voted, turnout_pct)

# ─────────────────────────────────────────────────────────────────────────────
# 6. WRITE OUTPUTS
# ─────────────────────────────────────────────────────────────────────────────
dir.create("src/data/results", showWarnings = FALSE, recursive = TRUE)

write.csv(district_out_all, "src/data/results/parl2024_pr.csv",
          row.names = FALSE, fileEncoding = "UTF-8")
write.csv(precinct_out,     "src/data/results/parl2024_pr_precincts.csv",
          row.names = FALSE, fileEncoding = "UTF-8")

cat("\nDone.\n")
cat(sprintf("  District results: %d rows, %d districts\n",
            nrow(district_out), n_distinct(district_out$district_id)))
cat(sprintf("  Precinct results: %d rows, %d precincts\n",
            nrow(precinct_out), n_distinct(precinct_out$precinct_id)))
cat(sprintf("\n  National turnout: %.1f%%  (%s / %s)\n",
            national_totals$turnout_pct * 100,
            format(national_totals$voted,      big.mark = ","),
            format(national_totals$registered, big.mark = ",")))
cat(sprintf("  National GD share: %.1f%%  (%s votes)\n",
            national_out$vote_share[national_out$party_id == "gd"] * 100,
            format(national_out$votes[national_out$party_id == "gd"], big.mark = ",")))
