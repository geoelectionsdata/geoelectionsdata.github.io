#!/usr/bin/env node

import { ensureDownloadsDir } from "./shared.js";
import { generateParl2024Download } from "./parl2024.js";

ensureDownloadsDir();

const entry = await generateParl2024Download({ generatedAt: new Date() });
console.log(`Wrote src/data/downloads/${entry.filename}`);
console.log(`Size: ${entry.size_bytes} bytes`);
console.log(`SHA-256: ${entry.sha}`);
