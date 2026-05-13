// src/data/downloads.json.js
// Observable Framework data loader.
// Builds the downloads manifest. Election-specific workbook generation lives
// in src/loaders/downloads/.

import {
  collectDownloadEntries,
  ensureDownloadsDir,
  readElection,
} from "../loaders/downloads/shared.js";

const generatedAt = new Date();

ensureDownloadsDir();

const files = collectDownloadEntries();

files.sort((a, b) =>
  (a.election_type ?? "").localeCompare(b.election_type ?? "") ||
  (a.date ?? "").localeCompare(b.date ?? "") ||
  (a.election_id ?? "").localeCompare(b.election_id ?? "") ||
  (a.date === (readElection(a.election_id)?.date ?? "") ? 0 : 1) -
    (b.date === (readElection(b.election_id)?.date ?? "") ? 0 : 1) ||
  (a.sub_type ?? "").localeCompare(b.sub_type ?? "")
);

process.stdout.write(JSON.stringify({ generated: generatedAt.toISOString(), files }, null, 2));
