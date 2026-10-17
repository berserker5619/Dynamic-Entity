import fs from 'node:fs';
import * as XLSX from 'xlsx';
const wb = XLSX.read(fs.readFileSync(process.argv[2]), {});
const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, defval: '' });
const cps = s => [...s].slice(0, 3).map(c => 'U+' + c.codePointAt(0).toString(16).toUpperCase().padStart(4, '0'));
console.log('C1 first code points:', cps(rows[0][2]), '| expected U+1F4E6 (📦)');
console.log('128230 & 0xFFFF =', 'U+' + (128230 & 0xffff).toString(16).toUpperCase());
// Same text as raw UTF-8 instead of a character reference: does SheetJS keep it?
const wb2 = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb2, XLSX.utils.aoa_to_sheet([['📦 ஆர்டர் எண்', 'Rajesh Kumar 🎉']]), 'S');
const back = XLSX.read(XLSX.write(wb2, { type: 'buffer', bookType: 'xlsx' }), {});
console.log('raw UTF-8 round trip:', JSON.stringify(XLSX.utils.sheet_to_json(back.Sheets.S, { header: 1 })[0]));
