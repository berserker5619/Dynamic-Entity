import { createCsvReader, escapeFormula, padRow, parseCsv, toCsv } from './csv';

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

describe('createCsvReader', () => {
  /**
   * The chunk boundary is the whole risk, so the test is every boundary rather than a
   * representative one. Three of CSV's decisions need the character after the one in hand —
   * a doubled quote, a CRLF, a line break inside a quoted field — and a split landing between
   * any of them is the failure this reader exists to not have.
   */
  const SAMPLE =
    'name,notes,qty\r\n' +
    'Alice,"he said ""hi""\r\nagain",3\r\n' +
    'Bob,"x, y",4\n' +
    ',,\n' +
    '\n' +
    'Carol,plain,5';

  const readInChunks = (...parts: string[]): string[][] => {
    const reader = createCsvReader();
    const rows: string[][] = [];
    for (const part of parts) rows.push(...reader.push(part));
    rows.push(...reader.end());
    return rows;
  };

  const whole = (text: string): string[][] => {
    const reader = createCsvReader();
    return [...reader.push(text), ...reader.end()];
  };

  it('agrees with parseCsv when fed in one piece', () => {
    const { headers, rows } = parseCsv(SAMPLE);
    const direct = whole(SAMPLE);
    expect(direct[0]).toEqual(headers);
    // parseCsv pads short rows; the reader is deliberately raw.
    expect(direct.slice(1).map(r => [...r, ...Array(3 - r.length).fill('')])).toEqual(rows);
  });

  it('produces identical rows split at every byte offset', () => {
    const expected = whole(SAMPLE);
    for (let at = 0; at <= SAMPLE.length; at++) {
      const rows = readInChunks(SAMPLE.slice(0, at), SAMPLE.slice(at));
      expect({ at, rows }).toEqual({ at, rows: expected });
    }
  });

  it('produces identical rows one character at a time', () => {
    expect(readInChunks(...SAMPLE)).toEqual(whole(SAMPLE));
  });

  it('strips a BOM that arrives alone in the first chunk', () => {
    const reader = createCsvReader();
    reader.push(String.fromCharCode(0xfeff));
    const rows = [...reader.push('name\nAlice'), ...reader.end()];
    expect(rows).toEqual([['name'], ['Alice']]);
  });

  it('does not strip a BOM that appears later in the stream', () => {
    // Only a *leading* BOM is a byte-order mark; one mid-file is a character in a cell.
    const bom = String.fromCharCode(0xfeff);
    const rows = whole(`name\n${bom}Alice`);
    expect(rows).toEqual([['name'], [`${bom}Alice`]]);
  });

  it('holds a CRLF split across a chunk boundary as one terminator', () => {
    expect(readInChunks('a\r', '\nb')).toEqual([['a'], ['b']]);
  });

  it('holds a doubled quote split across a chunk boundary as one literal quote', () => {
    expect(readInChunks('"a"', '"b"')).toEqual([['a"b']]);
  });

  it('ignores a non-string chunk rather than throwing', () => {
    const reader = createCsvReader();
    expect(reader.push(undefined as unknown as string)).toEqual([]);
    expect(reader.end()).toEqual([]);
  });

  it('returns nothing at all for empty input', () => {
    expect(whole('')).toEqual([]);
  });
});

describe('padRow', () => {
  it('fills a short row out to the header width', () => {
    expect(padRow(['1'], 3)).toEqual(['1', '', '']);
  });

  it('leaves a row that is long enough alone, extra cells included', () => {
    expect(padRow(['1', '2', '3', '4'], 3)).toEqual(['1', '2', '3', '4']);
  });

  it('copies rather than returning the row it was given', () => {
    const row = ['1', '2', '3'];
    expect(padRow(row, 3)).not.toBe(row);
  });
});
