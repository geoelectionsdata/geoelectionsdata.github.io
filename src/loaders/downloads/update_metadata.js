#!/usr/bin/env node

import ExcelJS from "exceljs";
import path from "node:path";
import {
  OUT_DIR,
  WORKBOOK_CREATOR,
  addMetadataSheet,
  existingBundleFilename,
  readAllElections,
  subElections,
} from "./shared.js";

// Election-specific extras appended to the "About - Metadata" sheet.
// Filename handling is generic (see shared.js#bundleFilename); only the
// extra-rows table is per-election.
function metadataOptions(election, sub) {
  if (election.id === "parl_2024" && (!sub || sub.id === "__main__")) {
    return {
      extraRows: [
        ["Annulled Precinct", "District 22 (Marneuli), precinct 69, precinct_id 22069"],
      ],
    };
  }
  return {};
}

function downloadTargets() {
  const targets = [];
  for (const election of readAllElections()) {
    for (const sub of subElections(election)) {
      const filename = existingBundleFilename(election, sub);
      if (filename) targets.push({ election, sub, filename });
    }
  }
  return targets;
}

const generatedAt = new Date();
const targets = downloadTargets();

for (const { election, sub, filename } of targets) {
  const filePath = path.join(OUT_DIR, filename);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(filePath);
  wb.creator = WORKBOOK_CREATOR;
  wb.modified = generatedAt;
  addMetadataSheet(wb, election, sub, generatedAt, metadataOptions(election, sub));
  await wb.xlsx.writeFile(filePath);
  console.log(`Updated metadata: src/data/downloads/${filename}`);
}

console.log(`Updated ${targets.length} workbook metadata sheet(s).`);
