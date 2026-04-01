import sys
import pandas as pd

sys.stdout.reconfigure(encoding='utf-8')

xl_path = (
    r'D:\Dropbox (Personal)\My projects\Elections'
    r'\ge_elections_dashboard\wireframe\observable_framework'
    r'\elections_data\src\data\raw\დამფუძნებელი კრება, 1919.xlsx'
)
out_path = (
    r'D:\Dropbox (Personal)\My projects\Elections'
    r'\ge_elections_dashboard\wireframe\observable_framework'
    r'\elections_data\src\data\results\parl1919_pr.csv'
)

party_map = {
    "საქართველოს სოციალ-დემოკრატიული მუშათა პარტია": "social_democrats_1919",
    "საქართველოს ეროვნულ-დემოკრატიული პარტია": "national_democrats_1919",
    "საქართველოს სოციალისტ-რევოლუციონერთა პარტია": "sr_1919",
    "\u201eდაშნაკცუთიუნ\u201c": "dashnaks",
    "საქართველოს სოციალისტ-ფედერალისტთა პარტია": "federalists_1919",
    "მუსლიმთა ეროვნული საბჭო": "muslim_1919",
    "საქართველოს რადიკალ-დემოკრატთა პარტია": "raddem_1919",
    "საქართველოს ეროვნული პარტია": "natparty_1919",
    "მემარცხენე სოციალისტ-ფედერალისტთა მაშვრალთა პარტია": "left_federalists_1919",
    "შოთა რუსთაველის ჯგუფი": "rustaveli_1919",
    "დამოუკიდებელთა (უპარტიო) კავშირი": "indie_1919",
    "ბორჩალოს მაზრის მცხოვრებ მუსულმანთა ჯგუფი": "borchalo_1919",
    "რუსეთის სოციალ-დემოკრატთა მუშათა პარტია": "sdwpr_1919",
    "ესთეტიური ლიგა პატრიოტებისა": "aesth_1919",
    "საქართველოს ელინთა დემოკრატიული ჯგუფი": "hellenic_1919",
    "აფხაზეთის ნაციონალური პარტია": "abkh_1919",
}

# --- Load ---
df = pd.read_excel(xl_path, sheet_name='source')
print(f"Loaded {len(df)} rows from Excel")

# --- Confirm all party columns are present ---
party_cols = list(party_map.keys())
missing = [c for c in party_cols if c not in df.columns]
if missing:
    print("WARNING: Missing party columns:")
    for m in missing:
        print(" ", repr(m))

# Fill NaN in party vote columns with 0 and convert to int
df[party_cols] = df[party_cols].fillna(0).astype(int)

# --- Melt to long format ---
id_vars = ['id', 'total_voters', 'votes', 'valid_votes']
df_long = df[id_vars + party_cols].melt(
    id_vars=id_vars,
    value_vars=party_cols,
    var_name='party_ka',
    value_name='party_votes'
)

# --- Map party names to IDs ---
df_long['party_id'] = df_long['party_ka'].map(party_map)

# --- Compute derived columns ---
df_long['votes_cast'] = df_long['votes_cast'] if 'votes_cast' in df_long.columns else df_long['votes']

def calc_vote_share(row):
    if row['valid_votes'] == 0:
        return 0.0
    return round(row['party_votes'] / row['valid_votes'], 6)

df_long['vote_share'] = df_long.apply(calc_vote_share, axis=1)
df_long['invalid_ballots'] = df_long['votes'] - df_long['valid_votes']

# --- Rename and select output columns ---
df_out = df_long.rename(columns={
    'id': 'district_id',
    'party_votes': 'votes',
    'total_voters': 'registered',
    'votes': 'voted',
}).copy()

df_out = df_out[['district_id', 'party_id', 'votes', 'vote_share', 'registered', 'voted', 'invalid_ballots']]

# --- Sort: district_id asc, then votes desc within each district ---
df_out = df_out.sort_values(
    by=['district_id', 'votes'],
    ascending=[True, False]
).reset_index(drop=True)

# --- Write output ---
df_out.to_csv(out_path, index=False)
print(f"\nWrote {len(df_out)} rows to {out_path}")
print(f"Total row count: {len(df_out)}")
print(f"\nFirst 20 rows:")
print(df_out.head(20).to_string(index=False))
