# -*- coding: utf-8 -*-
"""
Generate 2018 Georgian Presidential Election CSVs.
Produces 6 output files from 2 raw Excel files.
"""

import os
import sys
import pandas as pd
import numpy as np

# ── Paths ──────────────────────────────────────────────────────────────────────
RAW_DIR  = r"D:\Dropbox (Personal)\My projects\Elections\ge_elections_dashboard\wireframe\observable_framework\elections_data\src\data\raw"
BASE     = r"D:\Dropbox (Personal)\My projects\Elections\ge_elections_dashboard\wireframe\observable_framework\elections_data\src\data"
RES_DIR  = os.path.join(BASE, "results")
TURN_DIR = os.path.join(BASE, "turnout")

# Discover filenames (handles non-ASCII on Windows)
_files = os.listdir(RAW_DIR)
R1_FILE = os.path.join(RAW_DIR, next(f for f in _files if "2018" in f and "\u10de\u10d8\u10e0\u10d5\u10d4\u10da\u10d8" in f))
R2_FILE = os.path.join(RAW_DIR, next(f for f in _files if "2018" in f and "\u10db\u10d4\u10dd\u10e0\u10d4" in f))

# ── Candidate mappings ─────────────────────────────────────────────────────────
CAND_R1 = {
    "1. \u10db\u10d8\u10ee\u10d4\u10d8\u10da \u10d0\u10dc\u10d7\u10d0\u10eb\u10d4": "mikheil_antadze",
    "2. \u10d3\u10d0\u10d5\u10d8\u10d7 \u10d1\u10d0\u10e5\u10e0\u10d0\u10eb\u10d4": "bakradze",
    "4. \u10d5\u10d0\u10ee\u10e2\u10d0\u10dc\u10d2 \u10d2\u10d0\u10d1\u10e3\u10dc\u10d8\u10d0": "gabunia",
    "5. \u10d2\u10e0\u10d8\u10d2\u10dd\u10da \u10d5\u10d0\u10e8\u10d0\u10eb\u10d4": "vashadze",
    "10. \u10e8\u10d0\u10da\u10d5\u10d0 \u10dc\u10d0\u10d7\u10d4\u10da\u10d0\u10e8\u10d5\u10d8\u10da\u10d8": "natelashvili",
    "13. \u10d6\u10d5\u10d8\u10d0\u10d3 \u10db\u10d4\u10ee\u10d0\u10e2\u10d8\u10e8\u10d5\u10d8\u10da\u10d8": "mekhatishvili",
    "17. \u10d2\u10d8\u10dd\u10e0\u10d2\u10d8 \u10da\u10d8\u10da\u10e3\u10d0\u10e8\u10d5\u10d8\u10da\u10d8": "liluashvili",
    "18. \u10d0\u10d9\u10d0\u10d9\u10d8 \u10d0\u10e1\u10d0\u10d7\u10d8\u10d0\u10dc\u10d8": "asatiani",
    "21. \u10d9\u10d0\u10ee\u10d0 \u10d9\u10e3\u10d9\u10d0\u10d5\u10d0": "kukava",
    "22. \u10dd\u10d7\u10d0\u10e0 \u10db\u10d4\u10e3\u10dc\u10d0\u10e0\u10d2\u10d8\u10d0": "meunargia",
    "23. \u10d8\u10e0\u10d0\u10d9\u10da\u10d8 \u10d2\u10dd\u10e0\u10d2\u10d0\u10eb\u10d4": "gorgadze",
    "25. \u10d3\u10d0\u10d5\u10d8\u10d7 \u10e3\u10e1\u10e3\u10e4\u10d0\u10e8\u10d5\u10d8\u10da\u10d8": "usupashvili",
    "27. \u10d6\u10d5\u10d8\u10d0\u10d3\u10d8 \u10d1\u10d0\u10e6\u10d3\u10d0\u10d5\u10d0\u10eb\u10d4": "baghdavadze",
    "28. \u10db\u10d8\u10ee\u10d4\u10d8\u10da \u10e1\u10d0\u10da\u10e3\u10d0\u10e8\u10d5\u10d8\u10da\u10d8": "saluashvili",
    "30. \u10d6\u10d5\u10d8\u10d0\u10d3 \u10d8\u10d0\u10e8\u10d5\u10d8\u10da\u10d8": "iashvili",
    "31. \u10d7\u10d0\u10db\u10d0\u10e0\u10d8 \u10ea\u10ee\u10dd\u10e0\u10d0\u10d2\u10d0\u10e3\u10da\u10d8": "tskharagauli",
    "35. \u10d2\u10d4\u10da\u10d0 \u10ee\u10e3\u10ea\u10d8\u10e8\u10d5\u10d8\u10da\u10d8": "khutsishvili",
    "36. \u10d6\u10e3\u10e0\u10d0\u10d1 \u10ef\u10d0\u10e4\u10d0\u10e0\u10d8\u10eb\u10d4": "japaridze",
    "40. \u10da\u10d4\u10d5\u10d0\u10dc\u10d8 \u10e9\u10ee\u10d4\u10d8\u10eb\u10d4": "chkheidze",
    "48. \u10e1\u10d0\u10da\u10dd\u10db\u10d4 \u10d6\u10e3\u10e0\u10d0\u10d1\u10d8\u10e8\u10d5\u10d8\u10da\u10d8": "zourabichvili",
    "49. \u10d1\u10d4\u10e1\u10d0\u10e0\u10d8\u10dd\u10dc \u10d7\u10d4\u10d3\u10d8\u10d0\u10e8\u10d5\u10d8\u10da\u10d8": "tediashvili",
    "51. \u10d2\u10d8\u10dd\u10e0\u10d2\u10d8 \u10d0\u10dc\u10d3\u10e0\u10d8\u10d0\u10eb\u10d4": "andriadze",
    "58. \u10d9\u10d0\u10ee\u10d0\u10d1\u10d4\u10e0 \u10ed\u10d8\u10ed\u10d8\u10dc\u10d0\u10eb\u10d4": "chichinadze",
    "62. \u10d5\u10da\u10d0\u10d3\u10d8\u10db\u10d4\u10e0 \u10dc\u10dd\u10dc\u10d8\u10d9\u10d0\u10e8\u10d5\u10d8\u10da\u10d8": "nonikashvili",
    "65. \u10d7\u10d4\u10d8\u10db\u10e3\u10e0\u10d0\u10d6 \u10e8\u10d0\u10e8\u10d8\u10d0\u10e8\u10d5\u10d8\u10da\u10d8": "shashiashvili",
}

CAND_R2 = {
    "5. \u10d2\u10e0\u10d8\u10d2\u10dd\u10da \u10d5\u10d0\u10e8\u10d0\u10eb\u10d4": "vashadze",
    "48. \u10e1\u10d0\u10da\u10dd\u10db\u10d4 \u10d6\u10e3\u10e0\u10d0\u10d1\u10d8\u10e8\u10d5\u10d8\u10da\u10d8": "zourabichvili",
}

JAMI = "\u10ef\u10d0\u10db\u10d8"

# ── R1 column offsets ──────────────────────────────────────────────────────────
R1 = dict(
    main_list=3, special_list=4,
    voted_noon=5, voted_5pm=6, voted=7,
    cand_start=10, cand_step=2, num_cands=25,
    valid_votes=60, invalid_ballots=61,
)

# R2 column offsets
R2 = dict(
    attached_precinct=3,
    main_list=4, special_list=5,
    voted_noon=6, voted_5pm=7, voted=8,
    vashadze=11, zourabichvili=13,
    valid_votes=15, invalid_ballots=16,
)


# ── Helper ─────────────────────────────────────────────────────────────────────

def safe_div(num, den, decimals=6):
    """Return num/den rounded to decimals, or 0.0 if den is 0."""
    if den == 0:
        return 0.0
    return round(float(num) / float(den), decimals)


def int_or_zero(v):
    if pd.isna(v):
        return 0
    return int(v)


# ── Read and pre-process ───────────────────────────────────────────────────────

def read_excel(path):
    df = pd.read_excel(path, header=0)
    # Forward-fill district_id (col 0) and district name (col 1)
    df.iloc[:, 0] = df.iloc[:, 0].ffill()
    df.iloc[:, 1] = df.iloc[:, 1].ffill()
    # Convert district_id to int
    df.iloc[:, 0] = df.iloc[:, 0].astype(int)
    return df


# ── Extract turnout fields from a row ─────────────────────────────────────────

def extract_turnout_r1(row):
    main_list     = int_or_zero(row.iloc[R1["main_list"]])
    special_list  = int_or_zero(row.iloc[R1["special_list"]])
    registered    = main_list + special_list
    voted         = int_or_zero(row.iloc[R1["voted"]])
    voted_noon    = int_or_zero(row.iloc[R1["voted_noon"]])
    voted_5pm     = int_or_zero(row.iloc[R1["voted_5pm"]])
    return dict(
        registered=registered, voted=voted, voted_noon=voted_noon, voted_5pm=voted_5pm,
        main_list=main_list, special_list=special_list,
        turnout_pct=safe_div(voted, registered),
        noon_pct=safe_div(voted_noon, registered),
        five_pct=safe_div(voted_5pm, registered),
    )


def extract_votes_r1(row, valid_votes):
    """Return list of (party_id, votes, vote_share) for R1."""
    cands = list(CAND_R1.values())
    result = []
    col_start = R1["cand_start"]
    col_step  = R1["cand_step"]
    for i, party_id in enumerate(cands):
        col_idx = col_start + i * col_step
        v = int_or_zero(row.iloc[col_idx])
        vs = safe_div(v, valid_votes)
        result.append((party_id, v, vs))
    return result


def extract_turnout_r2(row):
    main_list    = int_or_zero(row.iloc[R2["main_list"]])
    special_list = int_or_zero(row.iloc[R2["special_list"]])
    registered   = main_list + special_list
    voted        = int_or_zero(row.iloc[R2["voted"]])
    voted_noon   = int_or_zero(row.iloc[R2["voted_noon"]])
    voted_5pm    = int_or_zero(row.iloc[R2["voted_5pm"]])
    return dict(
        registered=registered, voted=voted, voted_noon=voted_noon, voted_5pm=voted_5pm,
        main_list=main_list, special_list=special_list,
        turnout_pct=safe_div(voted, registered),
        noon_pct=safe_div(voted_noon, registered),
        five_pct=safe_div(voted_5pm, registered),
    )


def extract_votes_r2(row, valid_votes):
    """Return list of (party_id, votes, vote_share) for R2."""
    result = []
    for col_idx, party_id in [(R2["vashadze"], "vashadze"), (R2["zourabichvili"], "zourabichvili")]:
        v = int_or_zero(row.iloc[col_idx])
        vs = safe_div(v, valid_votes)
        result.append((party_id, v, vs))
    return result


# ── Build results rows ─────────────────────────────────────────────────────────

DIST_RESULT_COLS    = ["district_id", "party_id", "votes", "vote_share",
                       "registered", "voted", "voted_noon", "voted_5pm",
                       "main_list", "special_list", "turnout_pct", "noon_pct",
                       "five_pct", "invalid_ballots", "invalid_pct"]

PREC_RESULT_COLS    = ["precinct_id", "district_id", "party_id", "votes", "vote_share",
                       "registered", "voted", "voted_noon", "voted_5pm",
                       "main_list", "special_list", "turnout_pct", "noon_pct",
                       "five_pct", "invalid_ballots", "invalid_pct"]

DIST_TURNOUT_COLS   = ["district_id", "vote_type", "registered", "voted",
                       "turnout_pct", "voted_noon", "voted_5pm", "main_list", "special_list"]

PREC_TURNOUT_COLS   = ["precinct_id", "district_id", "vote_type",
                       "registered", "voted", "turnout_pct", "voted_noon", "voted_5pm"]


def process_r1(df):
    dist_rows  = []
    prec_rows  = []
    turn_dist  = []
    turn_prec  = []

    # Separate district-total rows and precinct rows
    # Skip NaN col 2 rows (grand-total rows, attached precincts, etc.)
    col2 = df.iloc[:, 2]
    jami_mask  = col2 == JAMI
    # Precinct rows: numeric col 2 (not NaN, not "ჯამი")
    prec_mask  = col2.notna() & (col2 != JAMI)

    for _, row in df[jami_mask].iterrows():
        district_id = int(row.iloc[0])
        t = extract_turnout_r1(row)
        valid_votes   = int_or_zero(row.iloc[R1["valid_votes"]])
        invalid_balls = int_or_zero(row.iloc[R1["invalid_ballots"]])
        invalid_pct   = safe_div(invalid_balls, t["voted"])

        for party_id, votes, vote_share in extract_votes_r1(row, valid_votes):
            dist_rows.append(dict(
                district_id=district_id, party_id=party_id,
                votes=votes, vote_share=vote_share,
                registered=t["registered"], voted=t["voted"],
                voted_noon=t["voted_noon"], voted_5pm=t["voted_5pm"],
                main_list=t["main_list"], special_list=t["special_list"],
                turnout_pct=t["turnout_pct"], noon_pct=t["noon_pct"], five_pct=t["five_pct"],
                invalid_ballots=invalid_balls, invalid_pct=invalid_pct,
            ))

        turn_dist.append(dict(
            district_id=district_id, vote_type="pr",
            registered=t["registered"], voted=t["voted"],
            turnout_pct=t["turnout_pct"],
            voted_noon=t["voted_noon"], voted_5pm=t["voted_5pm"],
            main_list=t["main_list"], special_list=t["special_list"],
        ))

    for _, row in df[prec_mask].iterrows():
        district_id  = int(row.iloc[0])
        precinct_no  = int(row.iloc[2])
        precinct_id  = district_id * 1000 + precinct_no
        t = extract_turnout_r1(row)
        valid_votes   = int_or_zero(row.iloc[R1["valid_votes"]])
        invalid_balls = int_or_zero(row.iloc[R1["invalid_ballots"]])
        invalid_pct   = safe_div(invalid_balls, t["voted"])

        for party_id, votes, vote_share in extract_votes_r1(row, valid_votes):
            prec_rows.append(dict(
                precinct_id=precinct_id, district_id=district_id, party_id=party_id,
                votes=votes, vote_share=vote_share,
                registered=t["registered"], voted=t["voted"],
                voted_noon=t["voted_noon"], voted_5pm=t["voted_5pm"],
                main_list=t["main_list"], special_list=t["special_list"],
                turnout_pct=t["turnout_pct"], noon_pct=t["noon_pct"], five_pct=t["five_pct"],
                invalid_ballots=invalid_balls, invalid_pct=invalid_pct,
            ))

        turn_prec.append(dict(
            precinct_id=precinct_id, district_id=district_id, vote_type="pr",
            registered=t["registered"], voted=t["voted"],
            turnout_pct=t["turnout_pct"],
            voted_noon=t["voted_noon"], voted_5pm=t["voted_5pm"],
        ))

    # Build DataFrames
    df_dist = pd.DataFrame(dist_rows, columns=DIST_RESULT_COLS)
    df_prec = pd.DataFrame(prec_rows, columns=PREC_RESULT_COLS)
    df_td   = pd.DataFrame(turn_dist, columns=DIST_TURNOUT_COLS)
    df_tp   = pd.DataFrame(turn_prec, columns=PREC_TURNOUT_COLS)

    # Sort
    df_dist = df_dist.sort_values(["district_id", "votes"], ascending=[True, False]).reset_index(drop=True)
    df_prec = df_prec.sort_values(["precinct_id", "votes"], ascending=[True, False]).reset_index(drop=True)
    df_tp   = df_tp.sort_values("precinct_id").reset_index(drop=True)

    # Turnout: national aggregate row first, then districts
    nat = dict(
        district_id="national", vote_type="pr",
        registered=df_td["registered"].sum(),
        voted=df_td["voted"].sum(),
        voted_noon=df_td["voted_noon"].sum(),
        voted_5pm=df_td["voted_5pm"].sum(),
        main_list=df_td["main_list"].sum(),
        special_list=df_td["special_list"].sum(),
    )
    nat["turnout_pct"] = safe_div(nat["voted"], nat["registered"])
    nat_df = pd.DataFrame([nat], columns=DIST_TURNOUT_COLS)
    df_td  = df_td.sort_values("district_id").reset_index(drop=True)
    df_td  = pd.concat([nat_df, df_td], ignore_index=True)

    return df_dist, df_prec, df_td, df_tp


def process_r2(df):
    dist_rows = []
    prec_rows = []

    jami_mask = df.iloc[:, 2] == JAMI
    # Precinct rows: not jami AND col3 (attached_precinct) is null
    prec_mask = (df.iloc[:, 2] != JAMI) & df.iloc[:, R2["attached_precinct"]].isna()

    for _, row in df[jami_mask].iterrows():
        district_id = int(row.iloc[0])
        t = extract_turnout_r2(row)
        valid_votes   = int_or_zero(row.iloc[R2["valid_votes"]])
        invalid_balls = int_or_zero(row.iloc[R2["invalid_ballots"]])
        invalid_pct   = safe_div(invalid_balls, t["voted"])

        for party_id, votes, vote_share in extract_votes_r2(row, valid_votes):
            dist_rows.append(dict(
                district_id=district_id, party_id=party_id,
                votes=votes, vote_share=vote_share,
                registered=t["registered"], voted=t["voted"],
                voted_noon=t["voted_noon"], voted_5pm=t["voted_5pm"],
                main_list=t["main_list"], special_list=t["special_list"],
                turnout_pct=t["turnout_pct"], noon_pct=t["noon_pct"], five_pct=t["five_pct"],
                invalid_ballots=invalid_balls, invalid_pct=invalid_pct,
            ))

    for _, row in df[prec_mask].iterrows():
        district_id  = int(row.iloc[0])
        if district_id == 87:
            continue  # skip abroad precincts
        precinct_no  = int(row.iloc[2])
        precinct_id  = district_id * 1000 + precinct_no
        t = extract_turnout_r2(row)
        valid_votes   = int_or_zero(row.iloc[R2["valid_votes"]])
        invalid_balls = int_or_zero(row.iloc[R2["invalid_ballots"]])
        invalid_pct   = safe_div(invalid_balls, t["voted"])

        for party_id, votes, vote_share in extract_votes_r2(row, valid_votes):
            prec_rows.append(dict(
                precinct_id=precinct_id, district_id=district_id, party_id=party_id,
                votes=votes, vote_share=vote_share,
                registered=t["registered"], voted=t["voted"],
                voted_noon=t["voted_noon"], voted_5pm=t["voted_5pm"],
                main_list=t["main_list"], special_list=t["special_list"],
                turnout_pct=t["turnout_pct"], noon_pct=t["noon_pct"], five_pct=t["five_pct"],
                invalid_ballots=invalid_balls, invalid_pct=invalid_pct,
            ))

    df_dist = pd.DataFrame(dist_rows, columns=DIST_RESULT_COLS)
    df_prec = pd.DataFrame(prec_rows, columns=PREC_RESULT_COLS)

    df_dist = df_dist.sort_values(["district_id", "votes"], ascending=[True, False]).reset_index(drop=True)
    df_prec = df_prec.sort_values(["precinct_id", "votes"], ascending=[True, False]).reset_index(drop=True)

    return df_dist, df_prec


# ── Main ───────────────────────────────────────────────────────────────────────

def main():
    print("Reading R1...", flush=True)
    df1 = read_excel(R1_FILE)
    print(f"  R1 raw rows: {len(df1)}", flush=True)

    print("Reading R2...", flush=True)
    df2 = read_excel(R2_FILE)
    print(f"  R2 raw rows: {len(df2)}", flush=True)

    print("Processing R1...", flush=True)
    r1_dist, r1_prec, r1_td, r1_tp = process_r1(df1)

    print("Processing R2...", flush=True)
    r2_dist, r2_prec = process_r2(df2)

    # ── Write outputs ──────────────────────────────────────────────────────────
    out = {
        os.path.join(RES_DIR,  "pres2018_r1.csv"):              r1_dist,
        os.path.join(RES_DIR,  "pres2018_r1_precincts.csv"):    r1_prec,
        os.path.join(RES_DIR,  "pres2018_r2.csv"):              r2_dist,
        os.path.join(RES_DIR,  "pres2018_r2_precincts.csv"):    r2_prec,
        os.path.join(TURN_DIR, "pres2018_turnout.csv"):         r1_td,
        os.path.join(TURN_DIR, "pres2018_precincts_turnout.csv"): r1_tp,
    }

    print("\nWriting files...", flush=True)
    for path, df in out.items():
        df.to_csv(path, index=False)
        fname = os.path.basename(path)
        print(f"\n{'='*60}")
        print(f"  {fname}  ({len(df):,} rows)")
        print(f"{'='*60}")
        print(df.head(3).to_string(index=False))

    print("\nDone.", flush=True)


if __name__ == "__main__":
    main()
