#!/usr/bin/env node

import { ensureDownloadsDir } from "./shared.js";
import { generatePres2013Downloads } from "./pres2013.js";

ensureDownloadsDir();

const entries = await generatePres2013Downloads({ generatedAt: new Date() });
for (const entry of entries) {
  console.log(`Wrote src/data/downloads/${entry.filename}`);
  console.log(`  Sub: ${entry.sub_id} | Size: ${entry.size_bytes} bytes | SHA-256: ${entry.sha}`);
}
