import { deepClone } from './clone';

describe('deepClone', () => {
  const original = { a: 1, nested: { list: [1, 2], flag: true } };

  it('returns a structurally equal copy', () => {
    expect(deepClone(original)).toEqual(original);
  });

  it('detaches nested objects and arrays', () => {
    const copy = deepClone(original);
    copy.nested.list.push(3);
    copy.nested.flag = false;

    expect(original.nested.list).toEqual([1, 2]);
    expect(original.nested.flag).toBe(true);
  });

  it('falls back to JSON when structuredClone is unavailable', () => {
    const globals = globalThis as { structuredClone?: unknown };
    const real = globals.structuredClone;
    delete globals.structuredClone;

    try {
      const copy = deepClone(original);
      expect(copy).toEqual(original);
      expect(copy.nested).not.toBe(original.nested);
    } finally {
      globals.structuredClone = real;
    }
  });

  it('prefers structuredClone when the runtime has it', () => {
    // jsdom does not provide it, so the native path is otherwise never exercised here even
    // though it is the one every browser takes.
    const globals = globalThis as { structuredClone?: unknown };
    const real = globals.structuredClone;
    const native = jest.fn((value: unknown) => JSON.parse(JSON.stringify(value)));
    globals.structuredClone = native;

    try {
      expect(deepClone(original)).toEqual(original);
      expect(native).toHaveBeenCalledWith(original);
    } finally {
      if (real === undefined) delete globals.structuredClone;
      else globals.structuredClone = real;
    }
  });

  it('handles primitives and null', () => {
    expect(deepClone(null)).toBeNull();
    expect(deepClone(7)).toBe(7);
    expect(deepClone('x')).toBe('x');
  });
});
