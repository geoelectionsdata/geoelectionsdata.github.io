import ExcelJS from "exceljs";

async function inspectFile(filePath) {
  console.log(`\n${"=".repeat(80)}`);
  console.log(`FILE: ${filePath}`);
  console.log("=".repeat(80));
  
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(filePath);
  
  console.log(`Total worksheets: ${wb.worksheets.length}\n`);
  
  for (const ws of wb.worksheets) {
    console.log(`\n--- Sheet: "${ws.name}" ---`);
    console.log(`Dimensions: ${ws.rowCount} rows × ${ws.columnCount} columns`);
    
    // Show rows 1-4
    for (let r = 1; r <= Math.min(4, ws.rowCount); r++) {
      const row = ws.getRow(r);
      const cells = [];
      for (let c = 1; c <= ws.columnCount; c++) {
        const cell = row.getCell(c);
        const v = cell.value;
        if (v != null) {
          const strVal = String(v).slice(0, 40);
          cells.push(`[${c}]=${JSON.stringify(strVal)}`);
        } else {
          cells.push(`[${c}]=null`);
        }
      }
      console.log(`  Row ${r}:`);
      console.log(`    ${cells.join(", ")}`);
    }
    
    // Show first data row (row 3 or later if all rows have headers)
    if (ws.rowCount > 2) {
      console.log(`  First data row (row 3):`);
      const row = ws.getRow(3);
      const cells = [];
      for (let c = 1; c <= ws.columnCount; c++) {
        const v = row.getCell(c).value;
        const strVal = String(v).slice(0, 40);
        cells.push(`[${c}]=${JSON.stringify(strVal)}`);
      }
      console.log(`    ${cells.join(", ")}`);
    }
  }
}

const files = [
  "src/data/raw/2020 პარლამენტი I ტური, საკრებულო, მერი.xlsx",
  "src/data/raw/2020 მაჟორიტარული მეორე ტური.xlsx"
];

for (const file of files) {
  try {
    await inspectFile(file);
  } catch (e) {
    console.error(`ERROR reading ${file}:`, e.message);
  }
}
