// src/data/downloads.json.js
// Observable Framework data loader
// Builds the downloads manifest. Election-specific workbook generation lives
// in src/loaders/downloads/.

import {
  OUT_DIR,
  PARL2024_DOWNLOAD_FILENAME,
  collectLegacyDownloadEntries,
  downloadEntry,
  ensureDownloadsDir,
  mainSubElection,
  readElection,
} from "../loaders/downloads/shared.js";
import fs from "node:fs";
import path from "node:path";

const generatedAt = new Date();

ensureDownloadsDir();

const files = collectLegacyDownloadEntries({ excludeIds: new Set(["parl_2024"]) });
const parl2024Path = path.join(OUT_DIR, PARL2024_DOWNLOAD_FILENAME);

if (fs.existsSync(parl2024Path)) {
  files.push(downloadEntry(readElection("parl_2024"), mainSubElection(), PARL2024_DOWNLOAD_FILENAME));
}

files.sort((a, b) =>
  (a.election_type ?? "").localeCompare(b.election_type ?? "") ||
  (a.date ?? "").localeCompare(b.date ?? "") ||
  (a.election_id ?? "").localeCompare(b.election_id ?? "") ||
  (a.date === (readElection(a.election_id)?.date ?? "") ? 0 : 1) -
    (b.date === (readElection(b.election_id)?.date ?? "") ? 0 : 1) ||
  (a.sub_type ?? "").localeCompare(b.sub_type ?? "")
);

process.stdout.write(JSON.stringify({ generated: generatedAt.toISOString(), files }, null, 2));
