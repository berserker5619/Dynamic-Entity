import { DEFAULT_LIMITS, resolveLimits } from './limits';

describe('resolveLimits', () => {
  it('gives every limit a finite default', () => {
    // The claim in the file's own header, asserted rather than trusted. A limit that is only
    // a limit when a consumer sets one is documentation.
    for (const [name, value] of Object.entries(DEFAULT_LIMITS)) {
      expect({ name, finite: Number.isFinite(value) && value > 0 }).toEqual({
        name,
        finite: true,
      });
    }
  });

  it('returns the defaults when given nothing', () => {
    expect(resolveLimits()).toEqual(DEFAULT_LIMITS);
    expect(resolveLimits({})).toEqual(DEFAULT_LIMITS);
  });

  it('takes an override', () => {
    expect(resolveLimits({ maxBytes: 1024 }).maxBytes).toBe(1024);
  });

  it('does not hand back the defaults object to be mutated', () => {
    const resolved = resolveLimits();
    resolved.maxBytes = 1;
    expect(DEFAULT_LIMITS.maxBytes).not.toBe(1);
  });

  it('ignores the two shapes a configuration mistake takes', () => {
    // `0` from a mis-parsed environment variable disables every upload; `Infinity` disables
    // the guard. Both look deliberate in a diff, and neither is.
    expect(resolveLimits({ maxBytes: 0 }).maxBytes).toBe(DEFAULT_LIMITS.maxBytes);
    expect(resolveLimits({ maxBytes: Infinity }).maxBytes).toBe(DEFAULT_LIMITS.maxBytes);
    expect(resolveLimits({ maxBytes: -1 }).maxBytes).toBe(DEFAULT_LIMITS.maxBytes);
    expect(resolveLimits({ maxBytes: NaN }).maxBytes).toBe(DEFAULT_LIMITS.maxBytes);
    expect(resolveLimits({ maxBytes: '10' as unknown as number }).maxBytes).toBe(
      DEFAULT_LIMITS.maxBytes,
    );
  });

  it('floors a fractional override rather than counting half a row', () => {
    expect(resolveLimits({ batchSize: 10.9 }).batchSize).toBe(10);
  });

  it('ignores a key that is not a limit', () => {
    const resolved = resolveLimits({ nonsense: 1 } as unknown as { maxBytes: number });
    expect(resolved).toEqual(DEFAULT_LIMITS);
  });
});
