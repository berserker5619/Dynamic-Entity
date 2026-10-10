/** validateRecord (`validate-record.ts`): the generic checks an adapter with no `validate` gets (spec §8). */
import { leaf } from './adapter.fixtures';
import type { ImportTarget, TargetArray, TargetSet, ValueKind } from './adapter.types';
import { validateRecord } from './validate-record';

const set = (targets: ImportTarget<null>[], arrays: TargetArray[] = []): TargetSet<null> => ({ targets, arrays, unsupported: [] });
const codes = (record: Record<string, unknown>, s: TargetSet<null>) => validateRecord(record, s).map(({ ref, code }) => ({ ref, code }));
const one = (value: ValueKind, extra = {}) => set([leaf('v', value, extra)]);

describe('validateRecord', () => {
  it('passes an absent optional value, and reports an absent required one once', () => {
    expect(codes({}, one({ kind: 'number', min: 5 }))).toEqual([]);
    expect(codes({ v: '' }, one({ kind: 'string', minLength: 3 }, { required: true }))).toEqual([{ ref: 'v', code: 'RECORD_REQUIRED' }]);
    expect(codes({ v: [] }, one({ kind: 'list', of: { kind: 'string' } }, { required: true }))).toEqual([{ ref: 'v', code: 'RECORD_REQUIRED' }]);
  });

  it('checks number bounds on both sides', () => {
    const bounded = one({ kind: 'number', min: 1, max: 9 });
    expect(codes({ v: 0 }, bounded)).toEqual([{ ref: 'v', code: 'RECORD_RANGE' }]);
    expect(codes({ v: 10 }, bounded)).toEqual([{ ref: 'v', code: 'RECORD_RANGE' }]);
    expect(codes({ v: 5 }, bounded)).toEqual([]);
  });

  it('checks string length on both sides', () => {
    const sized = one({ kind: 'string', minLength: 2, maxLength: 4 });
    expect(codes({ v: 'a' }, sized)).toEqual([{ ref: 'v', code: 'RECORD_RANGE' }]);
    expect(codes({ v: 'abcde' }, sized)).toEqual([{ ref: 'v', code: 'RECORD_RANGE' }]);
  });

  it('skips a pattern that does not compile: that is the schema\'s fault, not the row\'s', () => {
    expect(codes({ v: 'x' }, one({ kind: 'string', pattern: '(' }))).toEqual([]);
  });

  it.each([
    ['email', 'ada@example.com', 'ada@'],
    ['url', 'https://example.com/a', 'ftp://example.com'],
    ['url', 'http://example.com', 'http://exa mple.com'],
    ['url', 'https://example.com', 'not a url'],
    ['phone', '+44 (20) 7946-0000', '12345'],
    ['phone', '020 7946 0000', 'call me'],
  ] as const)('checks the %s format', (format, good, bad) => {
    const formatted = one({ kind: 'string', format });
    expect(codes({ v: good }, formatted)).toEqual([]);
    expect(codes({ v: bad }, formatted)).toEqual([{ ref: 'v', code: 'RECORD_FORMAT' }]);
  });

  it('checks list sizes on both sides', () => {
    const sized = one({ kind: 'list', of: { kind: 'string' }, minItems: 2, maxItems: 3 });
    expect(codes({ v: ['a'] }, sized)).toEqual([{ ref: 'v', code: 'RECORD_RANGE' }]);
    expect(codes({ v: ['a', 'b', 'c', 'd'] }, sized)).toEqual([{ ref: 'v', code: 'RECORD_RANGE' }]);
  });

  it('requires an array the schema marks required', () => {
    const arrays: TargetArray[] = [{ ref: 'items', label: 'Items', itemKind: 'object', required: true, positional: false }];
    expect(codes({}, set([], arrays))).toEqual([{ ref: 'items', code: 'RECORD_REQUIRED' }]);
    expect(codes({ items: [{ sku: 'A' }] }, set([], arrays))).toEqual([]);
  });

  it('checks a primitive array item by item, skipping positional holes', () => {
    const tags = set([
      leaf('tags.0', { kind: 'string', minLength: 2 }, { shapeRef: 'tags', arrayRef: 'tags', arrayIndex: 0 }),
      leaf('tags.1', { kind: 'string', minLength: 2 }, { shapeRef: 'tags', arrayRef: 'tags', arrayIndex: 1 }),
    ]);
    expect(codes({ tags: [null, 'a', 'ok'] }, tags)).toEqual([{ ref: 'tags.1', code: 'RECORD_RANGE' }]);
    expect(codes({ tags: 'not an array' }, tags)).toEqual([]);
  });
});
