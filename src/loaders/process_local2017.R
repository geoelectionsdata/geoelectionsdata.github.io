# process_local2017.R
# Processes raw 2017 Georgian local election files into dashboard CSV/YAML files.
# Run from project root:
#   Rscript src/loaders/process_local2017.R
#
# Source files:
#   src/data/raw/2017  საკრებულო, მერი I ტური.xlsx   (Round 1 results)
#   src/data/raw/2017 მერი II ტური.xlsx               (Round 2 mayor runoffs)
#   src/data/raw/adg_2017_candidates_unified.xlsx      (Candidate lists)
#
# Column structure (2017):
#   All sheets have alternating vote / "%" column pairs for parties.
#   "%" columns are automatically skipped (don't start with a digit).
#
#   Non-majoritarian (PR / Mayor):
#     1: district_label (merged), 2: district (numeric id),
#     3: precinct_code, 4: main_list, 5: special_list,
#     6: voted_noon, 7: voted_5pm, 8: voted, 9: ballots_received,
#     10+: party cols (alternating vote / %), ..., -2: valid, -1: invalid
#
#   Majoritarian:
#     1: district_label (merged), 2: district (numeric id),
#     3: major_label, 4: major_local, 5: precinct_code,
#     6: main_list, 7: special_list, 8: voted_noon, 9: voted_5pm,
#     10: voted, 11: ballots_received,
#     12+: party cols (alternating vote / %), ..., -2: valid, -1: invalid
#
#   Mayor R1 is split across two sheets:
#     "მერი ქალაქი I ტური"  — city self-governing units
#     "მერი თემი I ტური"    — community self-governing units
#   Mayor R2 has one sheet: "მერი II ტური"
#
#   No Sakrebulo majoritarian runoffs in 2017 (mayors only).
#
# Initiative groups:
#   Candidates running under "საინიციატივო ჯგუფი" (initiative group) are mapped
#   to the `initiative_group` party_id. Their ballot numbers are detected
#   dynamically from the candidates file. Multiple initiative-group candidates
#   in the same district each get a unique YAML entry. Mayoral outputs also keep
#   party_num so candidate names can be shown while colors still aggregate under
#   `initiative_group`.

suppressPackageStartupMessages({
  library(readxl)
  library(dplyr)
  library(tidyr)
  library(stringr)
  library(yaml)
  library(jsonlite)
})

# ── Paths ──────────────────────────────────────────────────────────────────
EXCEL_R1   <- "src/data/raw/2017  საკრებულო, მერი I ტური.xlsx"
EXCEL_R2   <- "src/data/raw/2017 მერი II ტური.xlsx"
CANDS_PATH <- "src/data/raw/adg_2017_candidates_unified.xlsx"
PRECINCT_GEO <- "src/data/shp/local2017_precincts.geojson"
OUT_RESULTS <- "src/data/results"
OUT_CANDS   <- "src/data/config/candidates/local"
dir.create(OUT_RESULTS, showWarnings = FALSE, recursive = TRUE)
dir.create(OUT_CANDS,   showWarnings = FALSE, recursive = TRUE)

# ── Static party ballot-number → party_id map ──────────────────────────────
# Numbers come from the PR sheet column headers.
# Initiative-group ballot numbers are added dynamically below.
PARTY_MAP_STATIC <- c(
  "1"  = "burchuladze",               # მოძრ. სახელმწ. ხალხისთვის
  "2"  = "european_georgia",          # ბაქრაძე, უგულავა – ევრ. საქ.
  "3"  = "burjanadze_democratic",     # ლ.ლ., კ.კ. – დემ. მოძ.–თავ. საქ.
  "5"  = "unm",                       # ერთიანი ნაციონ. მოძ.
  "6"  = "republicans_2016",          # რესპ. პარტია
  "7"  = "mechiauri",                 # თ. მეჭიაური ერთ. საქ.
  "8"  = "patriots",                  # დ.თ-მ., ი.ი. – პატრ. ალ.
  "9"  = "left_alliance",             # მემარცხ. ალიანსი
  "10" = "labour",                    # შ.ნ. – ლეიბ. პარტ.
  "11" = "national_democrats",        # ეროვნ. დემ. მოძ.
  "14" = "unity_development",         # საქ. ერთ. განვ. პარტ.
  "15" = "workers_socialist",         # მშრ. სოც. პარტ.
  "17" = "georgia_2016",              # საქართველო
  "18" = "traditionalists",           # ტრადიციონ.
  "20" = "free_democrats",            # შენ. მოძ. (Alasania / Free Democrats)
  "23" = "new_christian_democrats",   # ახ. ქრ.-დემ.
  "27" = "vashadze_2017",             # გ. ვაშაძე – ერთობა ახ. საქ.
  "28" = "zviads_way",                # ზვ. გზა-უფ. სახ.
  "31" = "freedom_gamsakhurdia",      # თავ. – ზვ. გ. გზა
  "34" = "mamuli_ena",                # მამ. ორდ. „სამშობლო"
  "37" = "communist_stalinist",       # სოც. საქ. – კომ.
  "38" = "peoples_power_2016",        # სახ. – ხ. ერთ.
  "39" = "progressive_democratic_2016", # პრ.-დემ. მოძ.
  "41" = "gd"                         # ქართ. ოცნება
)

# ── Dynamically extend PARTY_MAP with initiative-group ballot numbers ──────
# Reads candidate ballot numbers whose endorsing_party contains "საინიციატივო ჯგუფი".
# Any such ballot that is not already in PARTY_MAP_STATIC gets mapped to
# `initiative_group`, so their votes aggregate together in results.
cat("Building dynamic party map from candidates file...\n")

raw_mayor_candidates <- read_excel(CANDS_PATH, sheet = "mayoral candidates")
raw_major_candidates <- read_excel(CANDS_PATH, sheet = "majoritarian candidates")

# Column positions: mayoral(3=cand_num, 4=party), majoritarian(5=cand_num, 6=party)
.tmp_ballots <- bind_rows(
  raw_mayor_candidates %>% select(candidate_number = 3, endorsing_party = 4),
  raw_major_candidates %>% select(candidate_number = 5, endorsing_party = 6)
) %>%
  filter(str_detect(coalesce(as.character(endorsing_party), ""), "საინიციატივო ჯგუფი")) %>%
  pull(candidate_number) %>%
  unique() %>%
  na.omit() %>%
  as.character()

# Only add those not already covered by named parties
.new_ballots <- setdiff(.tmp_ballots, names(PARTY_MAP_STATIC))
cat("  Initiative-group ballot numbers:", length(.new_ballots), "\n")

PARTY_MAP <- c(
  PARTY_MAP_STATIC,
  setNames(rep("initiative_group", length(.new_ballots)), .new_ballots)
)
rm(.tmp_ballots, .new_ballots)

# ── Helpers ────────────────────────────────────────────────────────────────
to_selfgov   <- function(d) as.integer(ifelse(!is.na(d) & d >= 1L & d <= 10L, 1L, d))
to_major_id  <- function(d, major, local = 0L) {
  base <- ifelse(!is.na(d) & d >= 1L & d <= 10L, 99L, as.integer(d))
  as.integer(base * 10000L + as.integer(major) * 100L + as.integer(local))
}

value_or_na <- function(x) {
  if (is.null(x) || length(x) == 0L) NA_real_ else suppressWarnings(as.numeric(x[[1]]))
}

read_precinct_join_lookup <- function(path) {
  geo <- jsonlite::fromJSON(path, simplifyVector = FALSE)
  props <- lapply(geo$features, `[[`, "properties")
  tibble(
    precinct_id = as.integer(round(vapply(props, function(p) value_or_na(p$id), numeric(1)))),
    precinct_number = as.integer(round(vapply(props, function(p) value_or_na(p$Precinct), numeric(1)))),
    district_id_geo = as.integer(round(vapply(props, function(p) value_or_na(p$District), numeric(1)))),
    selfgov_id_geo = as.integer(round(vapply(props, function(p) value_or_na(p$Mayor), numeric(1)))),
    major_id_geo = as.integer(round(vapply(props, function(p) value_or_na(p$MID), numeric(1))))
  ) %>%
    mutate(selfgov_id_geo = if_else(selfgov_id_geo == 99L, 1L, selfgov_id_geo)) %>%
    distinct(precinct_id, .keep_all = TRUE)
}

precinct_join_lookup <- read_precinct_join_lookup(PRECINCT_GEO)

parse_precinct_id <- function(code, district = NA_integer_) {
  # Two formats exist in 2017 files:
  #   "DD.SSS"  — e.g. "29.001" (R1 sheets): district * 1000 + sequential
  #   plain int — e.g. 1, 2, 3  (R2 sheet) : use district column * 1000 + sequential
  code_str <- as.character(code)
  has_dot  <- str_detect(code_str, "\\.")
  parts    <- str_split_fixed(code_str, fixed("."), 2)
  from_dot <- as.integer(parts[, 1]) * 1000L + suppressWarnings(as.integer(parts[, 2]))
  from_int <- as.integer(district)   * 1000L + suppressWarnings(as.integer(code_str))
  dplyr::if_else(has_dot, from_dot, from_int)
}

write_csv_utf8 <- function(df, path) {
  write.csv(df, path, row.names = FALSE, fileEncoding = "UTF-8")
  cat("  Written:", path, "\n")
}

# ── Core sheet reader ──────────────────────────────────────────────────────
read_sheet_long <- function(excel_path, sheet_name, has_major) {
  df <- read_excel(excel_path, sheet = sheet_name, col_names = TRUE)
  df <- df[, colSums(is.na(df)) < nrow(df)]

  # Normalise column order: ensure col 1 = district label (text), col 2 = district id (numeric).
  # Some files (e.g. R2 mayor) have them swapped: col 1 = numeric id, col 2 = name.
  if (is.numeric(df[[1]]) && !is.numeric(df[[2]])) {
    df <- df[, c(2L, 1L, seq_len(ncol(df))[-c(1L, 2L)])]
  }

  is_party_col <- str_detect(names(df), "^\\d+")
  party_cols   <- names(df)[is_party_col]

  if (has_major) {
    names(df)[1:11] <- c("district_label", "district", "major_label", "major_local",
                         "precinct_code", "main_list", "special_list",
                         "voted_noon", "voted_5pm", "voted", "ballots_received")
  } else {
    names(df)[1:9]  <- c("district_label", "district", "precinct_code",
                         "main_list", "special_list",
                         "voted_noon", "voted_5pm", "voted", "ballots_received")
  }

  for (i in seq_along(names(df))) {
    if (str_detect(names(df)[i], "ნამდვ")) names(df)[i] <- "valid_ballots"
    if (str_detect(names(df)[i], "ბათ"))   names(df)[i] <- "invalid_ballots"
  }

  is_party_col2 <- str_detect(names(df), "^\\d+")
  party_cols2   <- names(df)[is_party_col2]

  keep <- c("district", "precinct_code", "main_list", "special_list",
            "voted_noon", "voted_5pm", "voted", "invalid_ballots",
            if (has_major) c("major_label", "major_local") else NULL,
            party_cols2)

  df_sub <- df %>%
    select(all_of(keep)) %>%
    filter(!is.na(district), !is.na(precinct_code)) %>%
    mutate(
      district        = as.integer(district),
      selfgov_id      = to_selfgov(district),
      precinct_id     = parse_precinct_id(precinct_code, district),
    ) %>%
    filter(!is.na(precinct_id), !is.na(district)) %>%
    mutate(
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
        major_label = as.integer(major_label),
        major_local = as.integer(major_local),
        major_id_fallback = to_major_id(district, major_label, major_local)
      ) %>%
      left_join(
        precinct_join_lookup %>% select(precinct_id, major_id_geo),
        by = "precinct_id"
      ) %>%
      mutate(
        major_id = coalesce(major_id_geo, major_id_fallback)
      ) %>%
      select(-major_id_geo, -major_id_fallback)
  }

  df_sub %>%
    pivot_longer(cols = all_of(party_cols2), names_to = "party_col", values_to = "votes") %>%
    mutate(
      party_num = str_extract(party_col, "^\\d+"),
      party_id  = PARTY_MAP[party_num],
      votes     = as.integer(coalesce(votes, 0L))
    ) %>%
    filter(!is.na(party_id))
}

# ── District-level aggregation helpers ────────────────────────────────────
summarise_to_level <- function(df_long, group_var, vote_vars = "party_id") {
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
      turnout_pct = round(voted / registered,      6),
      noon_pct    = round(voted_noon / registered, 6),
      five_pct    = round(voted_5pm / registered,  6),
      invalid_pct = round(invalid_ballots / voted, 6)
    )

  party_agg <- df_long %>%
    group_by(across(all_of(c(group_var, vote_vars)))) %>%
    summarise(votes = sum(votes, na.rm = TRUE), .groups = "drop")

  valid_totals <- party_agg %>%
    group_by(across(all_of(group_var))) %>%
    summarise(total_valid = sum(votes), .groups = "drop")

  party_agg %>%
    left_join(valid_totals, by = group_var) %>%
    left_join(turnout_agg,  by = group_var) %>%
    mutate(vote_share = round(votes / total_valid, 6)) %>%
    rename(district_id = all_of(group_var)) %>%
    select(district_id, all_of(vote_vars), votes, vote_share,
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

summarise_mayor_results <- function(df_long, group_var, candidate_lookup) {
  lookup <- candidate_lookup %>%
    mutate(
      selfgov_id = as.character(selfgov_id),
      party_num = as.character(party_num)
    )

  local_rows <- summarise_to_level(df_long, group_var, c("party_num", "party_id")) %>%
    filter(votes > 0) %>%
    mutate(
      district_id = as.character(district_id),
      party_num = as.character(party_num)
    ) %>%
    left_join(lookup, by = c("district_id" = "selfgov_id", "party_id", "party_num")) %>%
    mutate(name_ka = coalesce(name_ka, ""))

  national_rows <- summarise_to_level(df_long, group_var) %>%
    filter(votes > 0) %>%
    add_national() %>%
    filter(district_id == "national") %>%
    mutate(party_num = "", name_ka = "")

  bind_rows(national_rows, local_rows) %>%
    select(district_id, party_id, party_num, name_ka, votes, vote_share,
           registered, voted, voted_noon, voted_5pm,
           main_list, special_list, turnout_pct, noon_pct, five_pct,
           invalid_ballots, invalid_pct)
}

summarise_mayor_precincts <- function(df_long, candidate_lookup) {
  lookup <- candidate_lookup %>%
    mutate(
      selfgov_id = as.integer(selfgov_id),
      party_num = as.character(party_num)
    )

  df_long %>%
    group_by(precinct_id, selfgov_id, party_num, party_id) %>%
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
      party_num = as.character(party_num),
      turnout_pct = round(voted / registered, 6),
      noon_pct    = round(voted_noon / registered, 6),
      five_pct    = round(voted_5pm / registered, 6),
      invalid_pct = round(invalid_ballots / voted, 6)
    ) %>%
    left_join(lookup, by = c("selfgov_id", "party_id", "party_num")) %>%
    mutate(name_ka = coalesce(name_ka, "")) %>%
    select(precinct_id, selfgov_id, party_id, party_num, name_ka, votes, vote_share,
           registered, voted, voted_noon, voted_5pm,
           turnout_pct, noon_pct, five_pct, invalid_ballots, invalid_pct)
}

# ── Party-name → party_id (for candidates file, uses Georgian text) ────────
party_id_from_name <- function(name_vec) {
  n <- str_replace_all(name_vec, "[„\"]", "")
  n <- str_replace_all(n, "^საარჩევნო ბლოკი\\s*", "")
  n <- str_trim(n)
  case_when(
    str_detect(n, "ქართული ოცნება")              ~ "gd",
    str_detect(n, "ერთიანი ნაციონალური")          ~ "unm",
    str_detect(n, "ბაქრაძე")                      ~ "european_georgia",
    str_detect(n, "პატრიოტთა ალიანსი")            ~ "patriots",
    str_detect(n, "ლეიბორისტული")                 ~ "labour",
    str_detect(n, "რესპუბლიკური")                 ~ "republicans_2016",
    str_detect(n, "მეჭიაური")                     ~ "mechiauri",
    str_detect(n, "ლორთქიფანიძე")                 ~ "burjanadze_democratic",
    str_detect(n, "ეროვნულ.?დემოკრ")              ~ "national_democrats",
    str_detect(n, "ახალი ქრისტიან")               ~ "new_christian_democrats",
    str_detect(n, "შენების")                      ~ "free_democrats",
    str_detect(n, "ვაშაძე")                       ~ "vashadze_2017",
    str_detect(n, "ტრადიციონალისტები")            ~ "traditionalists",
    str_detect(n, "პროგრ.*დემოკრ")                ~ "progressive_democratic_2016",
    str_detect(n, "სახალხო.*ხალხ")                ~ "peoples_power_2016",
    str_detect(n, "ზვიადის გზა")                  ~ "zviads_way",
    str_detect(n, "გამსახურდიას გზა")              ~ "freedom_gamsakhurdia",
    str_detect(n, "მემარცხენე ალიანსი")           ~ "left_alliance",
    str_detect(n, "მამულიშვილთა")                 ~ "mamuli_ena",
    str_detect(n, "სოციალისტური საქართველო")      ~ "communist_stalinist",
    str_detect(n, "მშრომელთა სოციალ")             ~ "workers_socialist",
    str_detect(n, "ერთობისა და განვ")              ~ "unity_development",
    str_detect(n, "სახელმწიფო ხალხ")              ~ "burchuladze",
    str_detect(n, "კოსტავა")                      ~ "kostava_society",
    str_detect(n, "^საქართველო$")                 ~ "georgia_2016",
    str_detect(n, "საინიციატივო ჯგ")              ~ "initiative_group",
    TRUE                                           ~ NA_character_
  )
}

# ════════════════════════════════════════════════════════════════════════════
# 1. CANDIDATES YAML
# ════════════════════════════════════════════════════════════════════════════
cat("Building candidate YAML...\n")

# ── 1a. Mayor candidates ───────────────────────────────────────────────────
df_mc <- raw_mayor_candidates
names(df_mc) <- c("district_number", "district_name", "candidate_number",
                  "endorsing_party", "name", "last_name", "source_page", "source_pdf")

df_mc <- df_mc %>%
  mutate(
    district_number  = suppressWarnings(as.integer(district_number)),
    candidate_number = as.integer(candidate_number),
    district_number  = if_else(
      is.na(district_number) & str_detect(coalesce(district_name, ""), "თბილის"),
      1L, district_number
    ),
    selfgov_id = to_selfgov(district_number),
    party_id   = party_id_from_name(as.character(endorsing_party)),
    name_ka    = paste(str_trim(coalesce(name, "")), str_trim(coalesce(last_name, "")))
  ) %>%
  filter(!is.na(party_id), !is.na(selfgov_id))

# For regular parties: keep one candidate per (selfgov_id, party_id).
# For initiative groups: keep ALL candidates (each is a different person);
# their ballot number makes the YAML key unique.
mc_regular <- df_mc %>%
  filter(party_id != "initiative_group") %>%
  arrange(selfgov_id, party_id) %>%
  distinct(selfgov_id, party_id, .keep_all = TRUE) %>%
  mutate(yaml_key = paste0(party_id, "_mayor_", selfgov_id))

mc_indie <- df_mc %>%
  filter(party_id == "initiative_group") %>%
  arrange(selfgov_id, candidate_number) %>%
  mutate(yaml_key = paste0("initiative_", candidate_number, "_mayor_", selfgov_id))

mc <- bind_rows(mc_regular, mc_indie) %>% arrange(selfgov_id, yaml_key)

cat("  Mayor candidates — named parties:", nrow(mc_regular),
    "| initiative groups:", nrow(mc_indie), "\n")

# ── 1b. Majoritarian candidates ────────────────────────────────────────────
df_majc <- raw_major_candidates
names(df_majc) <- c("record_id", "district_number", "district_name",
                    "majoritarian_district", "candidate_number",
                    "endorsing_party", "name", "last_name",
                    "source_page", "source_pdf")

df_majc <- df_majc %>%
  mutate(
    district_number      = suppressWarnings(as.integer(district_number)),
    majoritarian_district = suppressWarnings(as.integer(majoritarian_district)),
    candidate_number     = as.integer(candidate_number),
    selfgov_id  = to_selfgov(district_number),
    major_id    = to_major_id(district_number, majoritarian_district),
    party_id    = party_id_from_name(as.character(endorsing_party)),
    name_ka     = paste(str_trim(coalesce(name, "")), str_trim(coalesce(last_name, "")))
  ) %>%
  filter(!is.na(party_id), !is.na(major_id))

majc_regular <- df_majc %>%
  filter(party_id != "initiative_group") %>%
  arrange(major_id, party_id) %>%
  distinct(major_id, party_id, .keep_all = TRUE) %>%
  mutate(yaml_key = paste0(party_id, "_maj_", major_id))

majc_indie <- df_majc %>%
  filter(party_id == "initiative_group") %>%
  arrange(major_id, candidate_number) %>%
  mutate(yaml_key = paste0("initiative_", candidate_number, "_maj_", major_id))

majc <- bind_rows(majc_regular, majc_indie) %>% arrange(major_id, yaml_key)

cat("  Majoritarian candidates — named parties:", nrow(majc_regular),
    "| initiative groups:", nrow(majc_indie), "\n")

# ── 1c. Write YAML ─────────────────────────────────────────────────────────
mayor_yaml <- lapply(seq_len(nrow(mc)), function(i) {
  r   <- mc[i, ]
  pid <- r$party_id
  sg  <- r$selfgov_id
  setNames(list(list(
    name_ka       = r$name_ka,
    election_type = "mayor",
    selfgov_id    = as.integer(sg),
    party         = pid
  )), r$yaml_key)
})

maj_yaml <- lapply(seq_len(nrow(majc)), function(i) {
  r   <- majc[i, ]
  pid <- r$party_id
  setNames(list(list(
    name_ka               = r$name_ka,
    election_type         = "sakrebulo_smd",
    selfgov_id            = as.integer(r$selfgov_id),
    electoral_district_id = as.integer(r$district_number),
    major_id              = as.integer(r$major_id),
    party                 = pid
  )), r$yaml_key)
})

out_cands <- file.path(OUT_CANDS, "local_2017.yml")
write_yaml(
  list(candidates = c(do.call(c, mayor_yaml), do.call(c, maj_yaml))),
  out_cands,
  unicode = TRUE
)
cat("  Written:", out_cands, "\n")

# Lookup tables reused by results sections
mc_lookup   <- mc %>%
                        mutate(party_num = as.character(candidate_number)) %>%
                        select(selfgov_id, party_id, party_num, name_ka)
majc_lookup <- majc %>% filter(party_id != "initiative_group") %>%
                        select(major_id, party_id, name_ka)

# ════════════════════════════════════════════════════════════════════════════
# 2. PROPORTIONAL (Sakrebulo PR) — Round 1 only
# ════════════════════════════════════════════════════════════════════════════
cat("Processing PR results...\n")
pr_long <- read_sheet_long(EXCEL_R1, "პროპორციული", has_major = FALSE)

pr_district <- summarise_to_level(pr_long, "district") %>% add_national()
write_csv_utf8(pr_district, file.path(OUT_RESULTS, "local2017_pr.csv"))

pr_selfgov <- summarise_to_level(pr_long, "selfgov_id") %>% add_national()
write_csv_utf8(pr_selfgov, file.path(OUT_RESULTS, "local2017_pr_selfgov.csv"))

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
write_csv_utf8(pr_prec, file.path(OUT_RESULTS, "local2017_pr_precincts.csv"))

# ════════════════════════════════════════════════════════════════════════════
# 3. MAYOR (SMD) — merge city + community R1; apply R2 runoffs
# ════════════════════════════════════════════════════════════════════════════
cat("Processing mayoral results...\n")

smd_city_long <- read_sheet_long(EXCEL_R1, "მერი ქალაქი I ტური", has_major = FALSE)
smd_comm_long <- read_sheet_long(EXCEL_R1, "მერი თემი I ტური",   has_major = FALSE)
smd_r1_long   <- bind_rows(smd_city_long, smd_comm_long)
smd_r2_long   <- read_sheet_long(EXCEL_R2, "მერი II ტური",       has_major = FALSE)

runoff_selfgovs <- unique(smd_r2_long$selfgov_id)
cat("  Mayor runoff self-gov IDs:", paste(sort(runoff_selfgovs), collapse = ", "), "\n")

smd_final_long <- bind_rows(
  smd_r1_long %>% filter(!selfgov_id %in% runoff_selfgovs),
  smd_r2_long
)

smd_dist <- summarise_mayor_results(smd_final_long, "selfgov_id", mc_lookup) %>%
  mutate(
    round   = if_else(
      !is.na(suppressWarnings(as.integer(district_id))) &
        suppressWarnings(as.integer(district_id)) %in% runoff_selfgovs,
      2L, 1L
    )
  ) %>%
  select(district_id, party_id, party_num, name_ka, round, votes, vote_share,
         registered, voted, voted_noon, voted_5pm,
         main_list, special_list, turnout_pct, noon_pct, five_pct,
         invalid_ballots, invalid_pct)
write_csv_utf8(smd_dist, file.path(OUT_RESULTS, "local2017_smd.csv"))

# Expand Tbilisi (selfgov_id=1) across CEC districts 1–10
tbilisi_exp <- smd_dist %>%
  filter(district_id == "1") %>%
  crossing(tibble(new_did = as.character(2:10))) %>%
  mutate(district_id = new_did) %>%
  select(-new_did)

smd_districts <- smd_dist %>%
  filter(district_id != "national") %>%
  bind_rows(tbilisi_exp) %>%
  bind_rows(filter(smd_dist, district_id == "national")) %>%
  arrange(district_id, party_id)
write_csv_utf8(smd_districts, file.path(OUT_RESULTS, "local2017_smd_districts.csv"))

smd_prec <- summarise_mayor_precincts(smd_final_long, mc_lookup)
write_csv_utf8(smd_prec, file.path(OUT_RESULTS, "local2017_smd_precincts.csv"))

# ── Mayor R2 sub-election ─────────────────────────────────────────────────
smd_r2_dist <- summarise_mayor_results(smd_r2_long, "selfgov_id", mc_lookup) %>%
  select(district_id, party_id, party_num, name_ka, votes, vote_share,
         registered, voted, voted_noon, voted_5pm,
         main_list, special_list, turnout_pct, noon_pct, five_pct,
         invalid_ballots, invalid_pct)
write_csv_utf8(smd_r2_dist, file.path(OUT_RESULTS, "local2017_r2_smd.csv"))

smd_r2_prec <- summarise_mayor_precincts(smd_r2_long, mc_lookup)
write_csv_utf8(smd_r2_prec, file.path(OUT_RESULTS, "local2017_r2_smd_precincts.csv"))

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
write_csv_utf8(smd_r2_districts, file.path(OUT_RESULTS, "local2017_r2_smd_districts.csv"))

# Stubs — no majoritarian runoffs in 2017
stub_cols <- c("district_id", "party_id", "name_ka", "votes", "vote_share",
               "registered", "voted", "voted_noon", "voted_5pm",
               "main_list", "special_list", "turnout_pct", "noon_pct", "five_pct",
               "invalid_ballots", "invalid_pct")
stub_prec_cols <- c("precinct_id", "district_id", "party_id", "votes", "vote_share",
                    "registered", "voted", "voted_noon", "voted_5pm",
                    "turnout_pct", "noon_pct", "five_pct", "invalid_ballots", "invalid_pct")

write_csv_utf8(setNames(as.data.frame(matrix(nrow=0, ncol=length(stub_cols))), stub_cols),
               file.path(OUT_RESULTS, "local2017_r2_council_smd.csv"))
write_csv_utf8(setNames(as.data.frame(matrix(nrow=0, ncol=length(stub_prec_cols))), stub_prec_cols),
               file.path(OUT_RESULTS, "local2017_r2_council_smd_precincts.csv"))

# ════════════════════════════════════════════════════════════════════════════
# 4. MAJORITARIAN (Sakrebulo SMD) — Round 1 only
# ════════════════════════════════════════════════════════════════════════════
cat("Processing majoritarian results...\n")

maj_long <- read_sheet_long(EXCEL_R1, "მაჟორიტარული", has_major = TRUE)

turn_maj <- maj_long %>%
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

party_maj <- maj_long %>%
  group_by(major_id, party_id) %>%
  summarise(votes = sum(votes, na.rm = TRUE), .groups = "drop") %>%
  filter(votes > 0)

valid_maj <- party_maj %>%
  group_by(major_id) %>%
  summarise(total_valid = sum(votes), .groups = "drop")

maj_dist <- party_maj %>%
  left_join(valid_maj,    by = "major_id") %>%
  left_join(turn_maj,     by = "major_id") %>%
  mutate(vote_share = round(votes / total_valid, 6)) %>%
  left_join(majc_lookup,  by = c("major_id", "party_id")) %>%
  mutate(name_ka = coalesce(name_ka, ""), round = 1L) %>%
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
write_csv_utf8(maj_final_out, file.path(OUT_RESULTS, "local2017_council_smd.csv"))

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
write_csv_utf8(maj_prec, file.path(OUT_RESULTS, "local2017_council_smd_precincts.csv"))

# ════════════════════════════════════════════════════════════════════════════
# 5. SEATS from elected politicians list
# ════════════════════════════════════════════════════════════════════════════
cat("Processing seat composition from elected politicians list...\n")

normalise_selfgov_key <- function(x) {
  x <- str_squish(as.character(x))
  x <- str_remove(x, "^თვითმმართველი\\s+ქალაქის\\s*-\\s*")
  # A couple of Georgian genitive forms do not reduce to the same stem by
  # suffix stripping alone; normalise them before joining to district names.
  x <- dplyr::recode(
    x,
    "ყვარლის" = "ყვარელ",
    "გარდაბნის" = "გარდაბან",
    .default = x
  )
  str_replace(x, "(ის|ოს|ს)$", "")
}

strip_final_vowel <- function(x) str_replace(x, "[აეიოუ]$", "")

infer_elected_party <- function(party_num, presenter) {
  mapped <- unname(PARTY_MAP[party_num])
  dplyr::case_when(
    !is.na(mapped) ~ mapped,
    str_detect(coalesce(presenter, ""), "ქართული ოცნება") ~ "gd",
    str_detect(coalesce(presenter, ""), "დამოუკიდებელი") ~ "independent",
    is.na(party_num) ~ "independent",
    TRUE ~ "initiative_group"
  )
}

raw_pr_candidates <- read_excel(CANDS_PATH, sheet = "PR candidates")
raw_elected <- read_excel(CANDS_PATH, sheet = "elected politicians")

selfgov_lookup <- raw_pr_candidates %>%
  transmute(
    selfgov_id = suppressWarnings(as.integer(district_number)),
    district_name = as.character(district_name)
  ) %>%
  distinct() %>%
  mutate(
    selfgov_id = if_else(district_name == "თბილისი", 1L, selfgov_id),
    selfgov_id = to_selfgov(selfgov_id),
    key_base = normalise_selfgov_key(district_name),
    key_stem = strip_final_vowel(key_base)
  ) %>%
  pivot_longer(c(key_base, key_stem), values_to = "selfgov_key") %>%
  filter(!is.na(selfgov_id), !is.na(selfgov_key), selfgov_key != "") %>%
  distinct(selfgov_key, .keep_all = TRUE) %>%
  select(selfgov_key, selfgov_id)

elected <- raw_elected %>%
  transmute(
    vote_type = str_to_lower(str_squish(as.character(election_type))),
    selfgov_key = normalise_selfgov_key(local_governing_unit),
    party_num = as.character(suppressWarnings(as.integer(party_number))),
    presenter = as.character(presenter_or_party)
  ) %>%
  left_join(selfgov_lookup, by = "selfgov_key") %>%
  mutate(party_id = infer_elected_party(party_num, presenter)) %>%
  filter(vote_type %in% c("pr", "smd", "mayor"), !is.na(selfgov_id), !is.na(party_id))

if (nrow(elected) != nrow(raw_elected)) {
  cat("  Warning: mapped elected rows:", nrow(elected), "of", nrow(raw_elected), "\n")
}

seats_pr <- elected %>%
  filter(vote_type == "pr") %>%
  group_by(selfgov_id, party_id) %>%
  summarise(seats_pr = n(), .groups = "drop")

seats_smd <- elected %>%
  filter(vote_type == "smd") %>%
  group_by(selfgov_id, party_id) %>%
  summarise(seats_smd = n(), .groups = "drop")

seats_mayor <- elected %>%
  filter(vote_type == "mayor") %>%
  group_by(selfgov_id, party_id) %>%
  summarise(seats_mayor = n(), .groups = "drop")

seats_by_unit <- seats_pr %>%
  full_join(seats_smd, by = c("selfgov_id", "party_id")) %>%
  full_join(seats_mayor, by = c("selfgov_id", "party_id")) %>%
  mutate(
    seats_pr = as.integer(coalesce(seats_pr, 0L)),
    seats_smd = as.integer(coalesce(seats_smd, 0L)),
    seats_mayor = as.integer(coalesce(seats_mayor, 0L)),
    selfgov_id = as.character(selfgov_id)
  )

seats_national <- seats_by_unit %>%
  group_by(party_id) %>%
  summarise(
    seats_pr = sum(seats_pr),
    seats_smd = sum(seats_smd),
    seats_mayor = sum(seats_mayor),
    .groups = "drop"
  ) %>%
  mutate(selfgov_id = "national") %>%
  select(selfgov_id, party_id, seats_pr, seats_smd, seats_mayor)

seats_final <- bind_rows(seats_national, seats_by_unit) %>%
  select(selfgov_id, party_id, seats_pr, seats_smd, seats_mayor)

write_csv_utf8(seats_final, file.path(OUT_RESULTS, "local2017_seats.csv"))
cat("  Total PR seats:", sum(seats_national$seats_pr), "\n")
cat("  Total SMD seats:", sum(seats_national$seats_smd), "\n")
cat("  Total Mayor seats:", sum(seats_national$seats_mayor), "\n")

cat("\nDone!\n")
