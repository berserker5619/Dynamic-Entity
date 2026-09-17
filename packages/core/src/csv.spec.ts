import { escapeFormula, parseCsv, toCsv } from './csv';

describe('parseCsv', () => {
  it('reads headers and positional rows', () => {
    expect(parseCsv('a,b\n1,2')).toEqual({ headers: ['a', 'b'], rows: [['1', '2']] });
  });

  it('keeps a quoted field containing a comma, a quote and a line break', () => {
    const { rows } = parseCsv('a,b\n"x, y","he said ""hi""\nagain"');
    expect(rows).toEqual([['x, y', 'he said "hi"\nagain']]);
  });

  it('accepts LF, CRLF and CR line endings', () => {
    expect(parseCsv('a\n1').rows).toEqual([['1']]);
    expect(parseCsv('a\r\n1').rows).toEqual([['1']]);
    expect(parseCsv('a\r1').rows).toEqual([['1']]);
  });

  it('strips a UTF-8 BOM, which Excel writes', () => {
    const bom = String.fromCharCode(0xfeff);
    expect(parseCsv(`${bom}name\nAlice`).headers).toEqual(['name']);
  });

  it('does not invent a final row from a trailing newline', () => {
    expect(parseCsv('a,b\n1,2\n').rows).toEqual([['1', '2']]);
  });

  it('keeps a trailing empty field, which is a value the user left blank', () => {
    expect(parseCsv('a,b\n1,').rows).toEqual([['1', '']]);
  });

  it('pads a short row rather than dropping the cells it did fill', () => {
    expect(parseCsv('a,b,c\n1').rows).toEqual([['1', '', '']]);
  });

  it('keeps a blank line as a row, so later row numbers still match the spreadsheet', () => {
    // The importer skips and counts these. Dropping them here would shift every subsequent
    // row number in every error message.
    expect(parseCsv('a\n1\n\n2').rows).toEqual([['1'], [''], ['2']]);
  });

  it('returns empty headers for empty input', () => {
    expect(parseCsv('')).toEqual({ headers: [], rows: [] });
  });
});

describe('escapeFormula', () => {
  it.each(['=cmd|calc', '+1+cmd', '@SUM(A1)', '\tx', '\rx'])('neutralises %p', value => {
    expect(escapeFormula(value)).toBe(`'${value}`);
  });

  it('leaves a negative number alone', () => {
    // Escaping these would corrupt every negative number in every export — a silent bug that
    // happens always, traded for one that happens only on crafted input.
    expect(escapeFormula('-5')).toBe('-5');
    expect(escapeFormula('+1.5')).toBe('+1.5');
  });

  it('escapes a string that merely begins like a number', () => {
    expect(escapeFormula('-2+3+cmd|calc')).toBe("'-2+3+cmd|calc");
  });

  it('leaves ordinary text alone', () => {
    expect(escapeFormula('Alice')).toBe('Alice');
    expect(escapeFormula('')).toBe('');
  });
});

describe('toCsv', () => {
  it('quotes only what needs quoting', () => {
    expect(toCsv(['a', 'b'], [['plain', 'has, comma']])).toBe('a,b\r\nplain,"has, comma"');
  });

  it('doubles an embedded quote', () => {
    expect(toCsv(['a'], [['say "hi"']])).toBe('a\r\n"say ""hi"""');
  });

  it('escapes a formula in a header as well as in a cell', () => {
    expect(toCsv(['=BAD()'], [['=ALSO()']])).toBe("'=BAD()\r\n'=ALSO()");
  });

  it('renders null and undefined as empty cells', () => {
    expect(toCsv(['a', 'b'], [[null, undefined]])).toBe('a,b\r\n,');
  });

  it('round-trips what it wrote', () => {
    const headers = ['name', 'note'];
    const rows = [['Alice', 'says "hi", loudly'], ['Bob', 'line\nbreak']];
    const parsed = parseCsv(toCsv(headers, rows));
    expect(parsed).toEqual({ headers, rows });
  });
});
