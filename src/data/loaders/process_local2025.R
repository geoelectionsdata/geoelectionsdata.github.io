# process_local2025.R
# Processes raw 2025 Georgian local election Excel into dashboard CSV files.
# Run from project root: Rscript src/data/loaders/process_local2025.R

suppressPackageStartupMessages({
  library(readxl)
  library(dplyr)
  library(tidyr)
  library(stringr)
  library(yaml)
})

# ── Paths ──────────────────────────────────────────────────────────────────
EXCEL        <- "src/data/raw/2025.04.10 - საკრებულო და მერი.xlsx"
OUT_RESULTS  <- "src/data/results"
OUT_CANDS    <- "src/data/config/candidates/local"
dir.create(OUT_RESULTS, showWarnings = FALSE, recursive = TRUE)
dir.create(OUT_CANDS,   showWarnings = FALSE, recursive = TRUE)

# ── Party number → party_id ────────────────────────────────────────────────
PARTY_MAP <- c(
  "1"="mamuli_ena", "3"="conservatives_geo", "5"="our_georgia",
  "7"="free_georgia", "8"="patriots", "9"="strong_georgia",
  "11"="georgia_party", "12"="greens_geo", "14"="peoples_power",
  "25"="gakharia", "36"="girchi", "41"="gd",
  "42"="independent", "43"="independent"
)

# ── Helpers ────────────────────────────────────────────────────────────────
to_selfgov <- function(d) as.integer(ifelse(d >= 1L & d <= 10L, 1L, d))
to_major_id <- function(d, m) as.integer(to_selfgov(d) * 100L + as.integer(m))

parse_precinct_id <- function(code) {
  parts <- str_split_fixed(as.character(code), fixed("."), 3)
  as.integer(parts[,2]) * 1000L + as.integer(parts[,3])
}

# Read a sheet, rename first columns, return long (precinct × party) tbl
read_sheet_long <- function(sheet_name, has_major) {
  df <- read_excel(EXCEL, sheet = sheet_name, col_names = TRUE)
  # Drop unnamed trailing columns
  df <- df[, !str_detect(names(df), "^Unnamed|^\\.\\.\\.")]

  # Identify party columns: all-digit names, or "N. name" pattern
  is_party_col <- str_detect(names(df), "^\\d+\\.?\\s") | str_detect(names(df), "^\\d+$")
  party_cols   <- names(df)[is_party_col]

  # Fixed column positions at start
  if (has_major) {
    names(df)[1:10] <- c("district","district_name","major_local","precinct_code",
                          "technology","registered","ballots","special_list",
                          "voted_noon","voted_5pm")
    names(df)[11]   <- "voted"
  } else {
    names(df)[1:9]  <- c("district","district_name","precinct_code","technology",
                          "registered","ballots","special_list","voted_noon","voted_5pm")
    names(df)[10]   <- "voted"
  }

  # Last party col + 1 = invalid_ballots
  last_party_pos <- max(which(is_party_col))
  names(df)[last_party_pos + 1] <- "invalid_ballots"

  # Re-detect party cols after rename
  is_party_col2 <- str_detect(names(df), "^\\d+\\.?\\s") | str_detect(names(df), "^\\d+$")
  party_cols2   <- names(df)[is_party_col2]

  keep <- c("district","precinct_code","registered","special_list",
            "voted_noon","voted_5pm","voted","invalid_ballots",
            if (has_major) "major_local" else NULL,
            party_cols2)

  df_sub <- df %>%
    select(all_of(keep)) %>%
    mutate(
      district        = as.integer(district),
      selfgov_id      = to_selfgov(district),
      precinct_id     = parse_precinct_id(precinct_code),
      registered      = as.integer(registered),
      special_list    = as.integer(special_list),
      voted_noon      = as.integer(voted_noon),
      voted_5pm       = as.integer(voted_5pm),
      voted           = as.integer(voted),
      invalid_ballots = as.integer(invalid_ballots)
    )

  if (has_major) {
    df_sub <- df_sub %>%
      mutate(
        major_local = as.integer(major_local),
        major_id    = to_major_id(district, major_local)
      )
  }

  # Pivot to long
  df_long <- df_sub %>%
    pivot_longer(
      cols      = all_of(party_cols2),
      names_to  = "party_col",
      values_to = "votes"
    ) %>%
    mutate(
      party_num = str_extract(party_col, "^\\d+"),
      party_id  = PARTY_MAP[party_num],
      votes     = as.integer(coalesce(votes, 0L))
    )

  df_long
}

# Build a district-level summary from long data
# group_var: the grouping column (district / selfgov_id / major_id)
# Returns: district_id, party_id, votes, vote_share, turnout cols
summarise_to_level <- function(df_long, group_var) {
  # Turnout: one row per (group_var × precinct_id) to avoid double-counting
  turnout_raw <- df_long %>%
    distinct(across(all_of(c(group_var, "precinct_id"))),
             registered, special_list, voted_noon, voted_5pm, voted, invalid_ballots)

  turnout_agg <- turnout_raw %>%
    group_by(across(all_of(group_var))) %>%
    summarise(
      registered      = sum(registered,      na.rm = TRUE),
      main_list       = sum(registered - special_list, na.rm = TRUE),
      special_list    = sum(special_list,    na.rm = TRUE),
      voted           = sum(voted,           na.rm = TRUE),
      voted_noon      = sum(voted_noon,      na.rm = TRUE),
      voted_5pm       = sum(voted_5pm,       na.rm = TRUE),
      invalid_ballots = sum(invalid_ballots, na.rm = TRUE),
      .groups = "drop"
    ) %>%
    mutate(
      turnout_pct = round(voted / registered,      6),
      noon_pct    = round(voted_noon / registered,  6),
      five_pct    = round(voted_5pm / registered,   6),
      invalid_pct = round(invalid_ballots / voted,  6)
    )

  # Party votes
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

# Add "national" aggregate row
add_national <- function(df) {
  # Coerce district_id to character for consistent binding
  df <- df %>% mutate(district_id = as.character(district_id))
  # Turnout aggregation at national level (each district_id row has same turnout)
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

  total_valid_nat <- sum(votes_nat$votes)

  nat_rows <- votes_nat %>%
    mutate(
      district_id     = "national",
      vote_share      = round(votes / total_valid_nat, 6),
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

  # Add any extra columns present in df but missing from nat_rows
  extra_cols <- setdiff(names(df), names(nat_rows))
  for (col in extra_cols) nat_rows[[col]] <- NA_character_

  bind_rows(nat_rows[names(df)], df)
}

write_csv_utf8 <- function(df, path) {
  write.csv(df, path, row.names = FALSE, fileEncoding = "UTF-8")
  cat("  Written:", path, "\n")
}

# ── 1. Proportional (Sakrebulo PR) ─────────────────────────────────────────
cat("Processing PR results...\n")
pr_long <- read_sheet_long("პროპორციული", has_major = FALSE)

pr_district <- summarise_to_level(pr_long, "district") %>%
  add_national()
write_csv_utf8(pr_district, file.path(OUT_RESULTS, "local2025_pr.csv"))

pr_selfgov <- summarise_to_level(pr_long, "selfgov_id") %>%
  add_national()
write_csv_utf8(pr_selfgov, file.path(OUT_RESULTS, "local2025_pr_selfgov.csv"))

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
write_csv_utf8(pr_prec, file.path(OUT_RESULTS, "local2025_pr_precincts.csv"))

# ── 2. Mayoral (SMD by self-governing unit) ────────────────────────────────
cat("Processing mayoral results...\n")
smd_long <- read_sheet_long("მერი", has_major = FALSE)

# Candidate name lookup
df_mc <- read_excel(EXCEL, sheet = "მერობის კანდიდატები")
names(df_mc) <- c("district","district_name","cand_num","first_name","last_name","party_name")
mc_lookup <- df_mc %>%
  mutate(
    selfgov_id = to_selfgov(as.integer(district)),
    party_id   = PARTY_MAP[as.character(cand_num)],
    name_ka    = paste(first_name, last_name)
  ) %>%
  filter(!is.na(party_id)) %>%
  select(selfgov_id, party_id, name_ka) %>%
  distinct()

smd_dist <- summarise_to_level(smd_long, "selfgov_id") %>%
  filter(votes > 0) %>%
  left_join(mc_lookup, by = c("district_id" = "selfgov_id", "party_id")) %>%
  mutate(name_ka = coalesce(name_ka, "")) %>%
  add_national() %>%
  mutate(name_ka = coalesce(name_ka, "")) %>%
  select(district_id, party_id, name_ka, votes, vote_share,
         registered, voted, voted_noon, voted_5pm,
         main_list, special_list, turnout_pct, noon_pct, five_pct,
         invalid_ballots, invalid_pct)
write_csv_utf8(smd_dist, file.path(OUT_RESULTS, "local2025_smd.csv"))

smd_prec <- smd_long %>%
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
write_csv_utf8(smd_prec, file.path(OUT_RESULTS, "local2025_smd_precincts.csv"))

# ── 3. Majoritarian (Sakrebulo SMD) ───────────────────────────────────────
cat("Processing majoritarian results...\n")
maj_long <- read_sheet_long("მაჟორიტარული", has_major = TRUE)

# Candidate lookup
df_majc <- read_excel(EXCEL, sheet = "მაჟორიტარი კანდიდატები")
names(df_majc) <- c("district","district_name","major_code","cand_num",
                     "first_name","last_name","party_name")
majc_lookup <- df_majc %>%
  mutate(
    district   = as.integer(district),
    # major_code: "D.LL" or "DD.LL" — last digits after dot = local_sequential
    major_local = as.integer(str_extract(as.character(major_code), "\\d+$")),
    major_id    = to_major_id(district, major_local),
    party_id    = PARTY_MAP[as.character(cand_num)],
    name_ka     = paste(first_name, last_name)
  ) %>%
  filter(!is.na(party_id)) %>%
  select(major_id, party_id, name_ka) %>%
  distinct()

# District-level majoritarian
maj_agg <- maj_long %>%
  group_by(major_id) %>%
  mutate(total_prec = n_distinct(precinct_id)) %>%
  ungroup()

turn_maj <- maj_long %>%
  distinct(major_id, precinct_id, .keep_all = TRUE) %>%
  group_by(major_id) %>%
  summarise(
    registered      = sum(registered,      na.rm = TRUE),
    main_list       = sum(registered - special_list, na.rm = TRUE),
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

party_maj <- maj_long %>%
  group_by(major_id, party_id) %>%
  summarise(votes = sum(votes, na.rm = TRUE), .groups = "drop") %>%
  filter(votes > 0)

valid_maj <- party_maj %>%
  group_by(major_id) %>%
  summarise(total_valid = sum(votes), .groups = "drop")

maj_dist <- party_maj %>%
  left_join(valid_maj, by = "major_id") %>%
  left_join(turn_maj,  by = "major_id") %>%
  mutate(vote_share = round(votes / total_valid, 6)) %>%
  left_join(majc_lookup, by = c("major_id", "party_id")) %>%
  mutate(name_ka = coalesce(name_ka, "")) %>%
  rename(district_id = major_id) %>%
  select(district_id, party_id, name_ka, votes, vote_share,
         registered, voted, voted_noon, voted_5pm,
         main_list, special_list, turnout_pct, noon_pct, five_pct,
         invalid_ballots, invalid_pct)

# National for majoritarian
turn_nat_maj <- turn_maj %>%
  summarise(across(c(registered,voted,voted_noon,voted_5pm,
                     main_list,special_list,invalid_ballots), sum))
turn_nat_maj <- turn_nat_maj %>%
  mutate(
    turnout_pct = round(voted/registered,6),
    noon_pct    = round(voted_noon/registered,6),
    five_pct    = round(voted_5pm/registered,6),
    invalid_pct = round(invalid_ballots/voted,6)
  )

nat_maj <- party_maj %>%
  group_by(party_id) %>%
  summarise(votes = sum(votes), .groups = "drop") %>%
  mutate(
    district_id     = "national",
    name_ka         = "",
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

maj_dist  <- maj_dist  %>% mutate(district_id = as.character(district_id))
maj_nat   <- nat_maj   %>% mutate(district_id = as.character(district_id))
maj_final <- bind_rows(maj_nat, maj_dist)
write_csv_utf8(maj_final, file.path(OUT_RESULTS, "local2025_council_smd.csv"))

# Majoritarian precincts
maj_prec <- maj_long %>%
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
write_csv_utf8(maj_prec, file.path(OUT_RESULTS, "local2025_council_smd_precincts.csv"))

# ── 4. Candidate YAML ──────────────────────────────────────────────────────
cat("Building candidate YAML...\n")

mayor_yaml <- lapply(seq_len(nrow(df_mc)), function(i) {
  r <- df_mc[i, ]
  sg <- to_selfgov(as.integer(r$district))
  pid <- PARTY_MAP[as.character(r$cand_num)]
  if (is.na(pid)) pid <- "independent"
  cid <- paste0(pid, "_mayor_", sg)
  setNames(list(list(
    name_ka       = paste(r$first_name, r$last_name),
    election_type = "mayor",
    selfgov_id    = as.integer(sg),
    party         = pid
  )), cid)
})
mayor_yaml_named <- do.call(c, mayor_yaml)

maj_yaml <- lapply(seq_len(nrow(df_majc)), function(i) {
  r <- df_majc[i, ]
  d   <- as.integer(r$district)
  ml  <- as.integer(str_extract(as.character(r$major_code), "\\d+$"))
  mid <- to_major_id(d, ml)
  pid <- PARTY_MAP[as.character(r$cand_num)]
  if (is.na(pid)) pid <- "independent"
  cid <- paste0(pid, "_maj_", mid)
  setNames(list(list(
    name_ka               = paste(r$first_name, r$last_name),
    election_type         = "sakrebulo_smd",
    selfgov_id            = as.integer(to_selfgov(d)),
    electoral_district_id = d,
    major_id              = as.integer(mid),
    party                 = pid
  )), cid)
})
maj_yaml_named <- do.call(c, maj_yaml)

write_yaml(
  list(candidates = c(mayor_yaml_named, maj_yaml_named)),
  file.path(OUT_CANDS, "local_2025.yml"),
  unicode = TRUE
)
cat("  Written:", file.path(OUT_CANDS, "local_2025.yml"), "\n")

cat("\nDone!\n")

# ── 4. Seat composition from elected-people list ──────────────────────────
cat("Processing seat composition from elected list...\n")
ELECTED_PATH <- "src/data/raw/local2025_elected_people.csv"
if (file.exists(ELECTED_PATH)) {
  PARTY_NAME_MAP_SEATS <- c(
    "ქართული ოცნება"                             = "gd",
    "ძლიერი საქართველო-ლელო"                    = "strong_georgia",
    "გირჩი"                                       = "girchi",
    "\u201eგახარია საქართველოსთვის\u201c"        = "gakharia",
    "\u201eკონსერვატორები საქართველოსთვის\u201c" = "conservatives_geo",
    "\u201eსაქართველოს პატრიოტთა ალიანსი\u201c"  = "patriots",
    "\u201eთავისუფალი საქართველო\u201c"          = "free_georgia",
    "\u10d3\u10d0\u10db\u10dd\u10e3\u10d9\u10d8\u10d3\u10d4\u10d1\u10d4\u10da\u10d8" = "independent"
  )

  elected_raw <- read.csv(ELECTED_PATH, fileEncoding = "UTF-8",
                          stringsAsFactors = FALSE, check.names = FALSE) %>%
    as_tibble()

  elected <- elected_raw %>%
    filter(vote_type %in% c("sakrebulo pr", "sakrebulo smd")) %>%
    mutate(
      selfgov_id = as.integer(self_governing_unit),
      party_id   = PARTY_NAME_MAP_SEATS[trimws(candidate_political_party)]
    ) %>%
    filter(!is.na(party_id))

  seats_pr_unit <- elected %>%
    filter(vote_type == "sakrebulo pr") %>%
    group_by(selfgov_id, party_id) %>%
    summarise(seats_pr = n(), .groups = "drop")

  seats_smd_unit <- elected %>%
    filter(vote_type == "sakrebulo smd") %>%
    group_by(selfgov_id, party_id) %>%
    summarise(seats_smd = n(), .groups = "drop")

  seats_by_unit <- full_join(seats_pr_unit, seats_smd_unit,
                              by = c("selfgov_id", "party_id")) %>%
    mutate(
      seats_pr  = as.integer(coalesce(seats_pr,  0L)),
      seats_smd = as.integer(coalesce(seats_smd, 0L)),
      selfgov_id = as.character(selfgov_id)
    )

  seats_national <- seats_by_unit %>%
    group_by(party_id) %>%
    summarise(
      seats_pr  = sum(seats_pr),
      seats_smd = sum(seats_smd),
      .groups = "drop"
    ) %>%
    mutate(selfgov_id = "national") %>%
    select(selfgov_id, party_id, seats_pr, seats_smd)

  seats_final <- bind_rows(seats_national, seats_by_unit) %>%
    select(selfgov_id, party_id, seats_pr, seats_smd)

  write_csv_utf8(seats_final, file.path(OUT_RESULTS, "local2025_seats.csv"))
  cat("  Total PR seats:",  sum(seats_national$seats_pr),  "\n")
  cat("  Total SMD seats:", sum(seats_national$seats_smd), "\n")
} else {
  cat("  Skipped: elected list not found at", ELECTED_PATH, "\n")
}
