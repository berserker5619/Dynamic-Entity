import fs from 'node:fs';
import * as XLSX from 'xlsx';
const buf = fs.readFileSync(process.argv[2]);
const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
const file = new File([buf], 'case5.xlsx');
const show = (label, data, opts) => {
  const wb = XLSX.read(data, opts);
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, defval: '', UTC: true });
  console.log(label.padEnd(44), JSON.stringify(rows[0][2]), JSON.stringify(rows[3][0]));
};
show('Buffer, documented options', buf, { cellDates: true });
show('ArrayBuffer, documented options', ab, { cellDates: true });
show('await File.arrayBuffer() (as documented)', await file.arrayBuffer(), { cellDates: true });
show('ArrayBuffer, type:array', ab, { cellDates: true, type: 'array' });
show('ArrayBuffer, no options', ab, {});
console.log('SheetJS', XLSX.version);
// What is stored: the shared-strings XML, read straight from the zip
const wb = XLSX.read(ab, { bookFiles: true });
const sst = wb.files?.['xl/sharedStrings.xml'];
console.log('sharedStrings has 📦:', sst ? Buffer.from(sst.content).toString('utf8').includes('📦') : 'n/a');
