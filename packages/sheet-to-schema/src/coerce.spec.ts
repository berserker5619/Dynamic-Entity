/**
 * coerceValue (`coerce.ts`) against spec §8's "Generic coercion" table, and cellText
 * (`cell-text.ts`). The dates are built with `Date.UTC`, or are bare text, so every
 * expectation holds in every zone; `check:timezones` runs this file in six of them.
 */
import type { ValueKind } from './adapter.types';
import { cellText } from './cell-text';
import { coerceValue } from './coerce';

const read = (kind: ValueKind, raw: unknown, options = {}) => coerceValue(kind, raw, options);
const value = (kind: ValueKind, raw: unknown, options = {}) => {
  const outcome = read(kind, raw, options);
  if ('error' in outcome) throw new Error(`expected a value, got ${outcome.code}: ${outcome.error}`);
  return outcome.value;
};
const code = (kind: ValueKind, raw: unknown, options = {}) => {
  const outcome = read(kind, raw, options);
  return 'error' in outcome ? outcome.code : null;
};

const STRING: ValueKind = { kind: 'string' };
const NUMBER: ValueKind = { kind: 'number' };
const DATE: ValueKind = { kind: 'date' };

describe('coerceValue — no value', () => {
  it.each([null, undefined, '', '   '])('reads %p as no value, never an error or an empty string', raw => {
    for (const kind of [STRING, NUMBER, DATE, { kind: 'boolean' } as ValueKind, { kind: 'list', of: STRING } as ValueKind]) {
      expect(read(kind, raw)).toEqual({ value: undefined });
    }
  });
});

describe('coerceValue — string', () => {
  it('trims text', () => {
    expect(value(STRING, '  Ada  ')).toBe('Ada');
  });

  it('renders a typed cell through cellText, never String()', () => {
    expect(value(STRING, new Date(Date.UTC(2024, 2, 7)))).toBe('2024-03-07');
    expect(value(STRING, new Date(Date.UTC(2024, 2, 7, 15, 30)))).toBe('2024-03-07T15:30:00.000Z');
    expect(value(STRING, 42)).toBe('42');
    expect(value(STRING, true)).toBe('true');
  });
});

describe('coerceValue — number', () => {
  it.each([
    ['1234.5', 1234.5],
    ['1,234.5', 1234.5],
    ['-3', -3],
    ['+2e3', 2000],
  ])('reads %s with a decimal point', (text, expected) => {
    expect(value(NUMBER, text)).toBe(expected);
  });

  it.each(['0x10', '1,2,3', '12abc', 'Infinity', '1.234,5'])('refuses %s rather than guessing', text => {
    expect(code(NUMBER, text)).toBe('CELL_FORMAT');
  });

  it('reads a decimal comma when asked: 1,5 and 1.234,5, and never 1,500 as fifteen hundred', () => {
    expect(value(NUMBER, '1,5', { decimal: ',' })).toBe(1.5);
    expect(value(NUMBER, '1.234,5', { decimal: ',' })).toBe(1234.5);
    expect(value(NUMBER, '1,500', { decimal: ',' })).toBe(1.5);
    expect(code(NUMBER, '1.5', { decimal: ',' })).toBe('CELL_FORMAT');
  });

  it('takes a typed number as it is, and refuses one that is not finite', () => {
    expect(value(NUMBER, 0.1 + 0.2)).toBe(0.1 + 0.2);
    expect(code(NUMBER, Number.NaN)).toBe('CELL_FORMAT');
  });

  it('refuses a fraction for an integer kind, whether the cell is text or typed', () => {
    const integer: ValueKind = { kind: 'number', integer: true };
    expect(value(integer, '3')).toBe(3);
    expect(code(integer, '1.5')).toBe('CELL_FORMAT');
    expect(code(integer, 1.5)).toBe('CELL_FORMAT');
  });

  it('does not read a typed date as a number', () => {
    expect(code(NUMBER, new Date(Date.UTC(2024, 2, 7)))).toBe('CELL_FORMAT');
  });
});

describe('coerceValue — boolean', () => {
  it.each(['true', 'T', 'Yes', 'y', '1'])('reads %s as true', text => {
    expect(value({ kind: 'boolean' }, text)).toBe(true);
  });
  it.each(['false', 'F', 'No', 'n', '0'])('reads %s as false', text => {
    expect(value({ kind: 'boolean' }, text)).toBe(false);
  });
  it('takes a typed boolean as it is, and refuses anything else', () => {
    expect(value({ kind: 'boolean' }, false)).toBe(false);
    expect(code({ kind: 'boolean' }, 'maybe')).toBe('CELL_FORMAT');
  });
});

describe('coerceValue — date', () => {
  it('reads a bare ISO date as text, so no zone can shift it', () => {
    expect(value(DATE, '2024-03-07')).toBe('2024-03-07');
    expect(value(DATE, '2024-3-7')).toBe('2024-03-07');
    expect(value(DATE, '2024-01-01')).toBe('2024-01-01');
  });

  it('refuses a date that does not exist rather than rolling it forward', () => {
    expect(code(DATE, '2024-02-30')).toBe('CELL_FORMAT');
    expect(value(DATE, '2024-02-29')).toBe('2024-02-29');
    expect(code(DATE, 'not a date')).toBe('CELL_FORMAT');
  });

  it('reads another spelling as the local calendar day it names', () => {
    expect(value(DATE, 'March 7, 2024')).toBe('2024-03-07');
  });

  it('reads a typed date by its UTC parts', () => {
    expect(value(DATE, new Date(Date.UTC(2024, 0, 1)))).toBe('2024-01-01');
    expect(value(DATE, new Date(Date.UTC(2024, 2, 7, 23, 59)))).toBe('2024-03-07');
    expect(code(DATE, new Date(Number.NaN))).toBe('CELL_FORMAT');
  });
});

describe('coerceValue — datetime, time and month', () => {
  it('reads a datetime as an instant, in ISO form', () => {
    expect(value({ kind: 'datetime' }, '2024-03-07T15:30:00Z')).toBe('2024-03-07T15:30:00.000Z');
    expect(value({ kind: 'datetime' }, new Date(Date.UTC(2024, 2, 7, 15, 30)))).toBe('2024-03-07T15:30:00.000Z');
    expect(code({ kind: 'datetime' }, 'soon')).toBe('CELL_FORMAT');
  });

  it('reads a time by its clock, from text, a UTC instant or a typed cell', () => {
    expect(value({ kind: 'time' }, '9:05')).toBe('09:05');
    expect(value({ kind: 'time' }, '09:05:30')).toBe('09:05');
    expect(value({ kind: 'time' }, '1899-12-30T09:05:00.000Z')).toBe('09:05');
    expect(value({ kind: 'time' }, new Date(Date.UTC(1899, 11, 30, 9, 5)))).toBe('09:05');
  });

  it.each(['24:00', '09:60', '09:30+05:00', 'nine'])('refuses %s as a time', text => {
    expect(code({ kind: 'time' }, text)).toBe('CELL_FORMAT');
  });

  it('reads a month from YYYY-M(M), from any date, or from a typed cell', () => {
    expect(value({ kind: 'month' }, '2024-3')).toBe('2024-03');
    expect(value({ kind: 'month' }, '2024-03-31')).toBe('2024-03');
    expect(value({ kind: 'month' }, new Date(Date.UTC(2024, 0, 1)))).toBe('2024-01');
    expect(code({ kind: 'month' }, '2024-13')).toBe('CELL_FORMAT');
    expect(code({ kind: 'month' }, 'spring')).toBe('CELL_FORMAT');
  });
});

describe('coerceValue — enum', () => {
  const STATUS: ValueKind = { kind: 'enum', values: ['active', 'inactive', 3], labels: ['Active', 'Inactive', 'Three'] };

  it('matches a value or a label, case-insensitively, and stores the value', () => {
    expect(value(STATUS, 'ACTIVE')).toBe('active');
    expect(value(STATUS, 'Inactive')).toBe('inactive');
    expect(value(STATUS, 'three')).toBe(3);
    expect(value(STATUS, '3')).toBe(3);
  });

  it('matches a typed cell by its cellText form', () => {
    expect(value(STATUS, 3)).toBe(3);
    const days: ValueKind = { kind: 'enum', values: ['2024-03-07'] };
    expect(value(days, new Date(Date.UTC(2024, 2, 7)))).toBe('2024-03-07');
  });

  it('refuses a cell matching nothing with CELL_UNKNOWN_OPTION, on text and typed input alike', () => {
    expect(code(STATUS, 'archived')).toBe('CELL_UNKNOWN_OPTION');
    expect(code(STATUS, 4)).toBe('CELL_UNKNOWN_OPTION');
  });
});

describe('coerceValue — list', () => {
  const TAGS: ValueKind = { kind: 'list', of: STRING };
  const NUMBERS: ValueKind = { kind: 'list', of: NUMBER };

  it('splits on ";" by default, trimming parts and dropping empty ones', () => {
    expect(value(TAGS, 'festive; cotton')).toEqual(['festive', 'cotton']);
    expect(value(TAGS, ' a ;; b ; ')).toEqual(['a', 'b']);
    expect(read(TAGS, ' ; ; ')).toEqual({ value: undefined });
  });

  it("uses the entry's split over the kind's separator, and the kind's over the default (§6)", () => {
    const piped: ValueKind = { kind: 'list', of: STRING, separator: '|' };
    expect(value(piped, 'a|b;c')).toEqual(['a', 'b;c']);
    expect(value(piped, 'a/b|c', { split: '/' })).toEqual(['a', 'b|c']);
    expect(value(TAGS, 'a|b', { split: '|' })).toEqual(['a', 'b']);
  });

  it('reads each part as the list item kind', () => {
    expect(value(NUMBERS, '3; 5')).toEqual([3, 5]);
    expect(value(NUMBERS, '1,5; 2', { decimal: ',' })).toEqual([1.5, 2]);
  });

  it('fails the cell with CELL_LIST_ITEM when one part fails, naming its position', () => {
    const outcome = read(NUMBERS, '3; x');
    expect(outcome).toEqual({ code: 'CELL_LIST_ITEM', error: expect.any(String) });
    expect('error' in outcome && outcome.error.startsWith('item 2:')).toBe(true);
  });

  it('reads a typed cell as a one-item list', () => {
    expect(value(NUMBERS, 7)).toEqual([7]);
    expect(value({ kind: 'list', of: DATE }, new Date(Date.UTC(2024, 2, 7)))).toEqual(['2024-03-07']);
  });
});

describe('coerceValue — custom', () => {
  it('throws: only the adapter can read a custom kind (§7)', () => {
    expect(() => coerceValue({ kind: 'custom' }, 'x')).toThrow(/custom/);
  });
});

describe('cellText', () => {
  it('renders a midnight-UTC date as the bare day, and any other instant in full', () => {
    expect(cellText(new Date(Date.UTC(2024, 2, 7)))).toBe('2024-03-07');
    expect(cellText(new Date(Date.UTC(2024, 2, 7, 9)))).toBe('2024-03-07T09:00:00.000Z');
  });

  it('renders nothing as empty text, and an invalid date as empty rather than "Invalid Date"', () => {
    expect(cellText(null)).toBe('');
    expect(cellText(undefined)).toBe('');
    expect(cellText(new Date(Number.NaN))).toBe('');
    expect(cellText('as is')).toBe('as is');
    expect(cellText(false)).toBe('false');
  });
});
