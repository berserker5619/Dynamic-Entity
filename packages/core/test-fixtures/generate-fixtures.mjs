/* eslint-disable no-console */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ExcelJS from 'exceljs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Builds case1_1904_dates.xlsx
 * Mac Excel 1904 epoch workbook containing pre-1970 and modern dates.
 */
async function buildCase1(dir) {
  const wb = new ExcelJS.Workbook();
  wb.properties.date1904 = true;
  const ws = wb.addWorksheet('Employees');
  ws.addRow(['Name', 'BirthDate', 'JoinDate']);
  ws.addRow(['Alice Mac', new Date('2026-05-15T00:00:00.000Z'), new Date('1904-01-02T00:00:00.000Z')]);
  ws.addRow(['Bob Mac', new Date('1985-10-26T00:00:00.000Z'), new Date('2020-03-01T00:00:00.000Z')]);
  await wb.xlsx.writeFile(path.join(dir, 'case1_1904_dates.xlsx'));
}

/**
 * Builds case2_numeric_identifiers.xlsx
 * Numeric cells holding phone numbers, safe 16-digit IDs, unsafe 16-digit IDs, postal codes, and counts.
 */
async function buildCase2(dir) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Identifiers');
  ws.addRow(['Name', 'Phone', 'NationalID', 'PostalCode', 'ItemCount']);
  ws.addRow(['Alice', 9876543210, 1234567890123456, 600001, 42]);
  ws.addRow(['Bob', 8765432109, 9876543210987654, 12345, 100]);
  await wb.xlsx.writeFile(path.join(dir, 'case2_numeric_identifiers.xlsx'));
}

/**
 * Builds case4_complex_sheet.xlsx
 * Complex sheet with merged header (A1:B1), hidden column (F), formulas (Total), duplicate headers (Status),
 * trailing empty rows (rows 4-10), and multiple sheets.
 */
async function buildCase4(dir) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Sales');

  // Header row
  ws.addRow(['Customer Info', '', 'Qty', 'Price', 'Total', 'Secret', 'Status', 'Status']);
  ws.mergeCells('A1:B1');
  ws.getColumn('F').hidden = true;

  // Data rows
  ws.addRow([
    'Acme Corp',
    'North America',
    10,
    25.5,
    { formula: 'C2*D2', result: 255 },
    'Internal discount applied',
    'Pending',
    'Active',
  ]);
  ws.addRow([
    'Globex',
    'Europe',
    4,
    100,
    { formula: 'C3*D3', result: 400 },
    'VIP client',
    'Shipped',
    'Archived',
  ]);

  // Trailing empty styled rows 4 to 10
  for (let r = 4; r <= 10; r++) {
    const emptyRow = ws.addRow([]);
    for (let c = 1; c <= 8; c++) {
      const cell = emptyRow.getCell(c);
      cell.fill = {
        type: 'pattern',
        pattern: 'none',
      };
    }
  }

  // Second sheet: Instructions
  const ws2 = wb.addWorksheet('Instructions');
  ws2.addRow(['Instructions for sales import']);
  ws2.addRow(['Do not modify formulas in column E.']);

  await wb.xlsx.writeFile(path.join(dir, 'case4_complex_sheet.xlsx'));
}

export async function generateAllFixtures(targetDir = __dirname) {
  await buildCase1(targetDir);
  await buildCase2(targetDir);
  await buildCase4(targetDir);
  console.log(`Generated case1, case2, case4 fixtures in ${targetDir}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await generateAllFixtures();
}
