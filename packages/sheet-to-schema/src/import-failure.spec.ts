/** ImportFailure (`import-failure.ts`): a failure of the whole import, by code. */
import { IMPORT_FAILURE_CODES, ImportFailure } from './import-failure';

describe('ImportFailure', () => {
  it('is an Error carrying its code and details, with empty details by default', () => {
    const failure = new ImportFailure('GROUP_TOO_LARGE', 'too many rows');
    expect(failure).toBeInstanceOf(Error);
    expect(failure.name).toBe('ImportFailure');
    expect(failure.code).toBe('GROUP_TOO_LARGE');
    expect(failure.details).toEqual({});
  });

  it('lists the three codes the spec names (§9)', () => {
    expect([...IMPORT_FAILURE_CODES]).toEqual(['GROUP_NOT_CONTIGUOUS', 'GROUP_TOO_LARGE', 'TOO_MANY_GROUPS']);
  });
});
