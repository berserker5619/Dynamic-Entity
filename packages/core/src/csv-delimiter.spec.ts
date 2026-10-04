import { completeFirstLine, createCsvReader, decimalMarkFor, detectDelimiter, parseCsv, type CsvDelimiter } from './csv';
import { coerceCell } from './import-engine';
import type { NestedFieldConfig } from './form-model.types';

/** Every row a reader yields when the text arrives one character at a time. */
function byteByByte(text: string, delimiter: CsvDelimiter): string[][] {
  const reader = createCsvReader({ delimiter });
  const rows: string[][] = [];
  for (const char of text) rows.push(...reader.push(char));
  return [...rows, ...reader.end()];
}

describe('detectDelimiter', () => {
  it('picks the separator the header uses most', () => {
    expect(detectDelimiter('Name,Email,City')).toBe(',');
    expect(detectDelimiter('Name;Email;City')).toBe(';');
    expect(detectDelimiter('Name\tEmail\tCity')).toBe('\t');
  });

  it('ignores separators inside quotes', () => {
    expect(detectDelimiter('"Last, First";Email;City')).toBe(';');
    expect(detectDelimiter('"a;b;c;d",Email')).toBe(',');
  });

  it('falls back to a comma for a tie, or for a header with one column', () => {
    expect(detectDelimiter('Name')).toBe(',');
    expect(detectDelimiter('a;b,c')).toBe(',');
    expect(detectDelimiter('')).toBe(',');
  });
});

describe('completeFirstLine', () => {
  it('stops at the first line break outside quotes', () => {
    expect(completeFirstLine('a;"b\nc";d\r\nx')).toBe('a;"b\nc";d');
  });

  it('is null until a whole line has arrived', () => {
    expect(completeFirstLine('a;"b\nc')).toBeNull();
  });
});

describe('parseCsv with a delimiter', () => {
  it('splits a semicolon file and keeps a quoted semicolon in its cell', () => {
    const sheet = parseCsv('Name;Email;City\n"Rao; Jr.";rao@example.com;Pune');
    expect(sheet).toEqual({
      headers: ['Name', 'Email', 'City'],
      rows: [['Rao; Jr.', 'rao@example.com', 'Pune']],
      delimiter: ';',
    });
  });

  it('lets an explicit delimiter win over detection', () => {
    expect(parseCsv('a;b\n1;2', { delimiter: ',' }).headers).toEqual(['a;b']);
  });

  it('still reads a one-column comma file', () => {
    expect(parseCsv('Name\nAda\nBo')).toMatchObject({ headers: ['Name'], rows: [['Ada'], ['Bo']], delimiter: ',' });
  });

  it.each([';', '\t'] as const)('streams %j identically at any chunk boundary', delimiter => {
    const text = ['Name', 'Note', 'City'].join(delimiter) + '\r\n' + ['"Rao ""Jr"""', `"a${delimiter}b\nc"`, 'Pune'].join(delimiter) + '\r\n';
    const whole = createCsvReader({ delimiter });
    const expected = [...whole.push(text), ...whole.end()];
    expect(expected[1]).toEqual(['Rao "Jr"', `a${delimiter}b\nc`, 'Pune']);
    expect(byteByByte(text, delimiter)).toEqual(expected);
  });
});

describe('decimal comma', () => {
  const number: NestedFieldConfig = { id: 'amount', type: 'number', label: { en: 'Amount' } };

  it('is what a semicolon sheet means', () => {
    expect(decimalMarkFor(';')).toBe(',');
    expect(decimalMarkFor(',')).toBe('.');
    expect(decimalMarkFor('\t')).toBe('.');
    expect(decimalMarkFor(undefined)).toBe('.');
  });

  it('reads 1,5 and 1.234,5, and never reads 1,500 as fifteen hundred', () => {
    expect(coerceCell(number, '1,5', { decimal: ',' })).toEqual({ value: 1.5 });
    expect(coerceCell(number, '1.234,5', { decimal: ',' })).toEqual({ value: 1234.5 });
    expect(coerceCell(number, '1,500', { decimal: ',' })).toEqual({ value: 1.5 });
    expect(coerceCell(number, '-2', { decimal: ',' })).toEqual({ value: -2 });
  });

  it('rejects a point-decimal number, rather than guessing which convention it meant', () => {
    expect(coerceCell(number, '1.5', { decimal: ',' })).toEqual({ error: '"1.5" is not a number' });
  });

  it('leaves the default exactly as it was', () => {
    expect(coerceCell(number, '1,500')).toEqual({ value: 1500 });
    expect(coerceCell(number, '1,5')).toEqual({ error: '"1,5" is not a number' });
  });
});
