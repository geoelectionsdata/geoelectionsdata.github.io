import fs from "fs";

async function inspectGeoJSON(filePath) {
  console.log(`\n${"=".repeat(80)}`);
  console.log(`FILE: ${filePath}`);
  console.log("=".repeat(80));
  
  const data = fs.readFileSync(filePath, 'utf8');
  const geojson = JSON.parse(data);
  
  console.log(`Type: ${geojson.type}`);
  console.log(`Number of features: ${geojson.features.length}`);
  
  if (geojson.features.length > 0) {
    const firstFeature = geojson.features[0];
    console.log("\nFirst feature properties:");
    console.log(JSON.stringify(firstFeature.properties, null, 2));
    console.log(`\nGeometry type: ${firstFeature.geometry.type}`);
  }
}

const files = [
  "src/data/shp/parl2020_smd.geojson",
  "src/data/shp/parl2020_pr_precincts.geojson"
];

for (const file of files) {
  await inspectGeoJSON(file);
}
