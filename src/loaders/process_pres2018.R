#!/usr/bin/env Rscript
# src/loaders/process_pres2018.R
#
# Processes the 2018 Georgian presidential election (round 1 and round 2).
# Run from project root: Rscript src/loaders/process_pres2018.R
#
# Inputs (filenames discovered by Georgian substring):
#   src/data/raw/2018 შედეგები პირველი ტური საპრეზიდენტო.xlsx   (Round 1)
#   src/data/raw/2018 შედეგები მეორე ტური საპრეზიდენტო.xlsx     (Round 2)
#
# Outputs:
#   src/data/results/pres2018_r1.csv              (district-level R1)
#   src/data/results/pres2018_r1_precincts.csv    (precinct-level R1)
#   src/data/results/pres2018_r2.csv              (district-level R2)
#   src/data/results/pres2018_r2_precincts.csv    (precinct-level R2)
#   src/data/turnout/pres2018_turnout.csv         (district turnout R1, with "national" row)
#   src/data/turnout/pres2018_precincts_turnout.csv (precinct turnout R1)

suppressPackageStartupMessages({
  library(readxl)
  library(readr)
  library(dplyr)
  library(tidyr)
  library(stringr)
  library(purrr)
  library(tibble)
})

# Force fixed (non-scientific) notation; readr::write_csv otherwise emits
# small values like 0.000865 as "8.65e-4", which parses identically but
# churns needless git diffs against the existing Python-generated CSVs.
options(scipen = 100)

RAW_DIR  <- "src/data/raw"
RES_DIR  <- "src/data/results"
TURN_DIR <- "src/data/turnout"
dir.create(RES_DIR,  showWarnings = FALSE, recursive = TRUE)
dir.create(TURN_DIR, showWarnings = FALSE, recursive = TRUE)

# Discover raw filenames by Georgian substring (robust to full path quirks)
raw_files <- list.files(RAW_DIR)
R1_FILE <- file.path(RAW_DIR, raw_files[grepl("2018", raw_files) & grepl("პირველი", raw_files)][1])
R2_FILE <- file.path(RAW_DIR, raw_files[grepl("2018", raw_files) & grepl("მეორე",  raw_files)][1])
stopifnot(!is.na(R1_FILE), !is.na(R2_FILE), file.exists(R1_FILE), file.exists(R2_FILE))

JAMI <- "ჯამი"

# ── Candidate column layouts ────────────────────────────────────────────────
# CAND_R1: 25 candidates in ballot order (matches Excel column sequence).
# Original raw header is "N. <Name>" — we only need the canonical ids, since
# R1 columns are positional (cand_start + i * cand_step) regardless of name.
CAND_R1 <- c(
  "mikheil_antadze", "bakradze",    "gabunia",        "vashadze",
  "natelashvili",    "mekhatishvili","liluashvili",   "asatiani",
  "kukava",          "meunargia",   "gorgadze",       "usupashvili",
  "baghdavadze",     "saluashvili", "iashvili",       "tskharagauli",
  "khutsishvili",    "japaridze",   "chkheidze",      "zourabichvili",
  "tediashvili",     "andriadze",   "chichinadze",    "nonikashvili",
  "shashiashvili"
)

# 1-based column indices (Python used 0-based iloc)
R1 <- list(
  main_list = 4, special_list = 5,
  voted_noon = 6, voted_5pm = 7, voted = 8,
  cand_start = 11, cand_step = 2, num_cands = 25,
  valid_votes = 61, invalid_ballots = 62
)
R2 <- list(
  attached_precinct = 4,
  main_list = 5, special_list = 6,
  voted_noon = 7, voted_5pm = 8, voted = 9,
  vashadze = 12, zourabichvili = 14,
  valid_votes = 16, invalid_ballots = 17
)

# ── Helpers ─────────────────────────────────────────────────────────────────
safe_div <- function(num, den, decimals = 6) {
  # Note: do NOT use ifelse() here — it truncates to length(test), so a scalar
  # denominator with a vector numerator returns only one value. Divide first,
  # then zero-out non-finite results (NaN from 0/0, Inf from x/0).
  ratio <- num / den
  ratio[!is.finite(ratio)] <- 0
  round(ratio, decimals)
}
int_or_zero <- function(v) {
  v <- suppressWarnings(as.integer(v))
  ifelse(is.na(v), 0L, v)
}

# ── Read & forward-fill district id/name ────────────────────────────────────
read_pres_excel <- function(path) {
  df <- read_excel(path, col_names = TRUE)
  df[[1]] <- tidyr::fill(tibble(x = df[[1]]), x, .direction = "down")$x
  df[[2]] <- tidyr::fill(tibble(x = df[[2]]), x, .direction = "down")$x
  df[[1]] <- suppressWarnings(as.integer(df[[1]]))
  df
}

# ── Turnout extractors (one precinct or ჯამი row → named list) ──────────────
extract_turnout <- function(row, idx) {
  main_list    <- int_or_zero(row[[idx$main_list]])
  special_list <- int_or_zero(row[[idx$special_list]])
  registered   <- main_list + special_list
  voted        <- int_or_zero(row[[idx$voted]])
  voted_noon   <- int_or_zero(row[[idx$voted_noon]])
  voted_5pm    <- int_or_zero(row[[idx$voted_5pm]])
  list(
    registered = registered, voted = voted,
    voted_noon = voted_noon, voted_5pm = voted_5pm,
    main_list  = main_list,  special_list = special_list,
    turnout_pct = safe_div(voted, registered),
    noon_pct    = safe_div(voted_noon, registered),
    five_pct    = safe_div(voted_5pm,  registered)
  )
}

# ── Vote extractors → data.frame of (party_id, votes, vote_share) ───────────
extract_votes_r1 <- function(row, valid_votes) {
  cols  <- R1$cand_start + (seq_along(CAND_R1) - 1) * R1$cand_step
  votes <- vapply(cols, function(c) int_or_zero(row[[c]]), integer(1))
  tibble(
    party_id   = CAND_R1,
    votes      = votes,
    vote_share = safe_div(votes, valid_votes)
  )
}
extract_votes_r2 <- function(row, valid_votes) {
  pairs <- list(vashadze = R2$vashadze, zourabichvili = R2$zourabichvili)
  tibble(
    party_id   = names(pairs),
    votes      = vapply(pairs, function(c) int_or_zero(row[[c]]), integer(1)),
    vote_share = NA_real_
  ) |> mutate(vote_share = safe_div(votes, valid_votes))
}

# ── Build a result row (district or precinct) from a raw row ────────────────
build_result_rows <- function(row, idx, extract_votes, precinct_id = NULL) {
  t             <- extract_turnout(row, idx)
  valid_votes   <- int_or_zero(row[[idx$valid_votes]])
  invalid_balls <- int_or_zero(row[[idx$invalid_ballots]])
  invalid_pct   <- safe_div(invalid_balls, t$voted)
  district_id   <- as.integer(row[[1]])

  extract_votes(row, valid_votes) |>
    mutate(
      district_id     = district_id,
      registered      = t$registered, voted = t$voted,
      voted_noon      = t$voted_noon, voted_5pm = t$voted_5pm,
      main_list       = t$main_list,  special_list = t$special_list,
      turnout_pct     = t$turnout_pct,
      noon_pct        = t$noon_pct, five_pct = t$five_pct,
      invalid_ballots = invalid_balls,
      invalid_pct     = invalid_pct,
      precinct_id     = if (is.null(precinct_id)) NA_integer_ else precinct_id
    )
}

DIST_RESULT_COLS  <- c("district_id", "party_id", "votes", "vote_share",
                       "registered", "voted", "voted_noon", "voted_5pm",
                       "main_list", "special_list", "turnout_pct", "noon_pct",
                       "five_pct", "invalid_ballots", "invalid_pct")
PREC_RESULT_COLS  <- c("precinct_id", DIST_RESULT_COLS)
DIST_TURNOUT_COLS <- c("district_id", "vote_type", "registered", "voted",
                       "turnout_pct", "voted_noon", "voted_5pm",
                       "main_list", "special_list")
PREC_TURNOUT_COLS <- c("precinct_id", "district_id", "vote_type",
                       "registered", "voted", "turnout_pct",
                       "voted_noon", "voted_5pm")

# ── Process a round's raw dataframe ─────────────────────────────────────────
process_round <- function(df, idx, extract_votes, skip_district = NULL, prec_extra_filter = NULL) {
  col2      <- df[[3]]  # Python's iloc[:, 2] → R column 3 (1-based)
  jami_mask <- !is.na(col2) & col2 == JAMI
  prec_mask <- !is.na(col2) & col2 != JAMI
  if (!is.null(prec_extra_filter)) {
    prec_mask <- prec_mask & prec_extra_filter(df)
  }

  dist_rows <- map_dfr(which(jami_mask), function(i) {
    build_result_rows(df[i, ], idx, extract_votes)
  })
  prec_rows <- map_dfr(which(prec_mask), function(i) {
    row         <- df[i, ]
    district_id <- as.integer(row[[1]])
    if (!is.null(skip_district) && isTRUE(district_id == skip_district)) return(NULL)
    precinct_no <- as.integer(row[[3]])
    precinct_id <- district_id * 1000L + precinct_no
    build_result_rows(row, idx, extract_votes, precinct_id = precinct_id)
  })

  # Reorder to canonical column sets
  dist_rows <- dist_rows |>
    select(all_of(DIST_RESULT_COLS)) |>
    arrange(district_id, desc(votes))
  prec_rows <- prec_rows |>
    select(all_of(PREC_RESULT_COLS)) |>
    arrange(precinct_id, desc(votes))

  list(dist = dist_rows, prec = prec_rows)
}

# ── Build turnout outputs from R1 result rows ───────────────────────────────
build_turnout_r1 <- function(r1_dist, r1_prec) {
  # One row per district (dedup across candidates)
  td <- r1_dist |>
    distinct(district_id, .keep_all = TRUE) |>
    transmute(
      district_id, vote_type = "pr",
      registered, voted, turnout_pct,
      voted_noon, voted_5pm, main_list, special_list
    ) |>
    arrange(district_id)

  # National aggregate row
  nat <- td |>
    summarise(
      registered   = sum(registered,   na.rm = TRUE),
      voted        = sum(voted,        na.rm = TRUE),
      voted_noon   = sum(voted_noon,   na.rm = TRUE),
      voted_5pm    = sum(voted_5pm,    na.rm = TRUE),
      main_list    = sum(main_list,    na.rm = TRUE),
      special_list = sum(special_list, na.rm = TRUE)
    ) |>
    mutate(
      district_id = "national", vote_type = "pr",
      turnout_pct = safe_div(voted, registered)
    ) |>
    select(all_of(DIST_TURNOUT_COLS))

  # district_id becomes character once we bind the "national" row
  td <- td |> mutate(district_id = as.character(district_id))
  td <- bind_rows(nat, td) |> select(all_of(DIST_TURNOUT_COLS))

  # Dedupe across the full turnout signature, not just precinct_id: district 84
  # (abroad) has some precinct_id collisions with genuinely different counts,
  # and Python emits both rows. Unique turnout signatures collapse cleanly.
  tp <- r1_prec |>
    distinct(precinct_id, district_id, registered, voted,
             voted_noon, voted_5pm, turnout_pct, .keep_all = TRUE) |>
    transmute(
      precinct_id, district_id, vote_type = "pr",
      registered, voted, turnout_pct, voted_noon, voted_5pm
    ) |>
    arrange(precinct_id) |>
    select(all_of(PREC_TURNOUT_COLS))

  list(district = td, precinct = tp)
}

# ── Main ────────────────────────────────────────────────────────────────────
message("Reading R1 …")
df1 <- read_pres_excel(R1_FILE)
message(sprintf("  R1 rows: %d", nrow(df1)))

message("Reading R2 …")
df2 <- read_pres_excel(R2_FILE)
message(sprintf("  R2 rows: %d", nrow(df2)))

message("Processing R1 …")
r1 <- process_round(df1, R1, extract_votes_r1)

message("Processing R2 …")
# R2 precinct rows: col2 != ჯამი AND col (attached_precinct) is NA.
# District 87 (abroad precincts) is skipped.
r2 <- process_round(
  df2, R2, extract_votes_r2,
  skip_district     = 87L,
  prec_extra_filter = function(d) is.na(d[[R2$attached_precinct]])
)

message("Building R1 turnout …")
turnout_r1 <- build_turnout_r1(r1$dist, r1$prec)

# ── Write CSV outputs ───────────────────────────────────────────────────────
outputs <- list(
  list(path = file.path(RES_DIR,  "pres2018_r1.csv"),              data = r1$dist),
  list(path = file.path(RES_DIR,  "pres2018_r1_precincts.csv"),    data = r1$prec),
  list(path = file.path(RES_DIR,  "pres2018_r2.csv"),              data = r2$dist),
  list(path = file.path(RES_DIR,  "pres2018_r2_precincts.csv"),    data = r2$prec),
  list(path = file.path(TURN_DIR, "pres2018_turnout.csv"),         data = turnout_r1$district),
  list(path = file.path(TURN_DIR, "pres2018_precincts_turnout.csv"), data = turnout_r1$precinct)
)
# Fractional columns to format with preserved "0.0" for exact zeros
# (everything else becomes plain as.character — e.g. 9573 → "9573").
FRAC_COLS <- c("vote_share", "turnout_pct", "noon_pct", "five_pct", "invalid_pct")
fmt_frac  <- function(x) {
  out <- as.character(x)
  out[!is.na(x) & x == 0] <- "0.0"
  out
}
for (o in outputs) {
  # readr's serializer ignores scipen — force fixed notation by pre-converting
  # double columns to character.
  o$data |>
    mutate(across(any_of(FRAC_COLS), fmt_frac)) |>
    mutate(across(where(is.double), as.character)) |>
    write_csv(o$path)
  message(sprintf("  %-50s %6d rows", basename(o$path), nrow(o$data)))
}
message("Done.")
