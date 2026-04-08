import json

TBILISI_KA = {
    "Mtatsminda": "მთაწმინდა",
    "Vake": "ვაკე",
    "Isani": "ისანი",
    "Chughureti": "ჩუღურეთი",
    "Didube": "დიდუბე",
    "Gldani": "გლდანი",
    "Krtsanisi": "კრწანისი",
    "Nadzaladevi": "ნაძალადევი",
    "Saburtalo": "საბურთალო",
    "Samgori": "სამგორი"
}

base = "src/data/shp/"
with open(base + "selfgov_areas_2025.geojson", encoding="utf-8") as f:
    selfgov = json.load(f)

selfgov_ka = {}
for feat in selfgov["features"]:
    p = feat["properties"]
    selfgov_ka[int(p["id"])] = p["name_ka"]

with open(base + "majoritarian_2021_major_id.geojson", encoding="utf-8") as f:
    maj = json.load(f)

updated = 0
for feat in maj["features"]:
    p = feat["properties"]
    city = int(p["city"])
    if city == 1:
        en = p.get("district_name_en", "")
        p["district_name_ka"] = TBILISI_KA.get(en, en)
    else:
        p["district_name_ka"] = selfgov_ka.get(city, p.get("district_name_en", ""))
    updated += 1

with open(base + "majoritarian_2021_major_id.geojson", "w", encoding="utf-8") as f:
    json.dump(maj, f, ensure_ascii=False)

print(f"Done: added district_name_ka to {updated} features")
