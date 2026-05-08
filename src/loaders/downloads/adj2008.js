import ExcelJS from "exceljs";
import fs from "node:fs";
import path from "node:path";
import { csvParse, autoType } from "d3-dsv";
import {
  OUT_DIR,
  WORKBOOK_CREATOR,
  addMetadataSheet,
  downloadEntry,
  legacyFilenamePrefix,
  readElection,
  resolveSrcPath,
  subElections,
} from "./shared.js";

const HDR_FILL = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1A3A5C" } };
const HDR_FONT = { bold: true, color: { argb: "FFFFFFFF" }, size: 9, name: "Calibri" };
const ALT_FILL = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF2F6FA" } };

function readCSV(p) {
  const full = resolveSrcPath(p);
  if (!p || !fs.existsSync(full)) return [];
  return csvParse(fs.readFileSync(full, "utf8"), autoType);
}

function styleHeader(row) {
  row.height = 34;
  row.eachCell(cell => {
    cell.fill = HDR_FILL;
    cell.font = HDR_FONT;
    cell.alignment = { wrapText: true, vertical: "middle", horizontal: "center" };
    cell.border = { bottom: { style: "medium", color: { argb: "FF4A7AAC" } } };
  });
}

function finishSheet(sheet, widths) {
  widths.forEach((w, i) => { if (w) sheet.getColumn(i + 1).width = w; });
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  for (let r = 2; r <= sheet.rowCount; r++) {
    if (r % 2 === 0) {
      sheet.getRow(r).eachCell({ includeEmpty: false }, cell => {
        if (!cell.fill?.fgColor) cell.fill = ALT_FILL;
      });
    }
  }
}

function pctValue(v) {
  if (v == null || v === "" || v === "NA") return "";
  const n = Number(v);
  return Number.isFinite(n) ? Number((n * 100).toFixed(2)) : "";
}

function buildCsvSheet(wb, sheetName, rows) {
  if (!rows.length) return;
  const sheet = wb.addWorksheet(sheetName);
  const keys = Object.keys(rows[0]);
  styleHeader(sheet.addRow(keys));
  for (const row of rows) {
    sheet.addRow(keys.map(k => {
      const v = row[k];
      if (/_pct$/.test(k) || k === "vote_share") return pctValue(v);
      return v ?? "";
    }));
  }
  finishSheet(sheet, keys.map(k => Math.min(42, Math.max(10, k.length + 4))));
}

async function generateBundle(election, sub, generatedAt) {
  const isMain = !sub || sub.id === "__main__";
  const files = isMain ? election.files : sub.files;

  const wb = new ExcelJS.Workbook();
  wb.creator = WORKBOOK_CREATOR;
  wb.created = generatedAt;
  wb.modified = generatedAt;

  buildCsvSheet(wb, "PR - Districts", readCSV(files?.pr_results));
  buildCsvSheet(wb, "PR - Precincts", readCSV(files?.pr_precinct_results));
  buildCsvSheet(wb, "SMD - Districts", readCSV(files?.smd_results));
  buildCsvSheet(wb, "SMD - Precincts", readCSV(files?.smd_precinct_results));
  buildCsvSheet(wb, "Turnout - Districts", readCSV(election.turnout?.file));
  buildCsvSheet(wb, "Turnout - Precincts", readCSV(election.turnout?.precinct_file));
  buildCsvSheet(wb, "Party Lists", readCSV(files?.party_lists));
  buildCsvSheet(wb, "SMD Candidates", readCSV(files?.candidates));

  addMetadataSheet(wb, election, sub, generatedAt);

  const prefix = legacyFilenamePrefix(election, sub);
  const timestamp = generatedAt.toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const filename = `${prefix}${timestamp}.xlsx`;
  const outPath = path.join(OUT_DIR, filename);
  await wb.xlsx.writeFile(outPath);
  return downloadEntry(election, sub, filename);
}

export async function generateAdj2008Downloads({ generatedAt = new Date() } = {}) {
  const election = readElection("adj_2008");
  const results = [];
  for (const sub of subElections(election)) {
    results.push(await generateBundle(election, sub, generatedAt));
  }
  return results;
}
