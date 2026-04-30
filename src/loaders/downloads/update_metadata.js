#!/usr/bin/env node

import ExcelJS from "exceljs";
import fs from "node:fs";
import path from "node:path";
import {
  OUT_DIR,
  PARL2024_DOWNLOAD_FILENAME,
  WORKBOOK_CREATOR,
  addMetadataSheet,
  latestLegacyDownload,
  mainSubElection,
  readAllElections,
  readElection,
  subElections,
} from "./shared.js";

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
    if (election.id === "parl_2024") continue;
    for (const sub of subElections(election)) {
      const filename = latestLegacyDownload(election, sub);
      if (filename) targets.push({ election, sub, filename });
    }
  }

  const parl2024Path = path.join(OUT_DIR, PARL2024_DOWNLOAD_FILENAME);
  if (fs.existsSync(parl2024Path)) {
    targets.push({
      election: readElection("parl_2024"),
      sub: mainSubElection(),
      filename: PARL2024_DOWNLOAD_FILENAME,
    });
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
