/** setRecordValue, getRecordValue and isEmptyValue (`record-path.ts`). */
import { getRecordValue, isEmptyValue, setRecordValue } from './record-path';

describe('setRecordValue', () => {
  it('creates an array for a numeric segment, not an object with a "0" key', () => {
    const record: Record<string, unknown> = {};
    setRecordValue(record, 'phones.1.number', '555');
    expect(Array.isArray(record['phones'])).toBe(true);
    expect(record).toEqual({ phones: [undefined, { number: '555' }] });
  });

  it('replaces a non-object in the way, and writes nothing for an unsafe or empty path', () => {
    const record: Record<string, unknown> = { customer: 'flat' };
    setRecordValue(record, 'customer.name', 'Ada');
    expect(record).toEqual({ customer: { name: 'Ada' } });
    setRecordValue(record, '__proto__.polluted', true);
    setRecordValue(record, 'a.constructor.prototype.polluted', true);
    setRecordValue(record, '', true);
    expect(({} as { polluted?: unknown }).polluted).toBeUndefined();
    expect(record).toEqual({ customer: { name: 'Ada' } });
  });
});

describe('getRecordValue', () => {
  it('reads a dot path, through arrays, and returns undefined past a leaf', () => {
    const record = { phones: [{ number: '555' }], name: 'Ada' };
    expect(getRecordValue(record, 'phones.0.number')).toBe('555');
    expect(getRecordValue(record, 'name.first')).toBeUndefined();
    expect(getRecordValue(null, 'a')).toBeUndefined();
  });

  it('reads nothing through an unsafe or empty path', () => {
    expect(getRecordValue({}, '__proto__')).toBeUndefined();
    expect(getRecordValue({ a: 1 }, '')).toBeUndefined();
  });
});

describe('isEmptyValue', () => {
  it.each([undefined, null, '', [], {}, { a: '', b: [] }])('treats %p as empty', value => {
    expect(isEmptyValue(value)).toBe(true);
  });
  it.each([0, false, 'x', [null], { a: 0 }, new Date(0)])('treats %p as a value', value => {
    expect(isEmptyValue(value)).toBe(false);
  });
});
