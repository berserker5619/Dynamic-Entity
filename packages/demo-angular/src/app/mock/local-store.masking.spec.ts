import { TestBed } from '@angular/core/testing';
import { DEMO_MASK } from './demo-mask';
import { LocalStore } from './local-store.service';
import { MASKED_ROLES } from './sample-data';

/**
 * The demo has two independent masks, and this is what stops them drifting apart.
 *
 * `MASKED_PLACEHOLDER` is the renderer declining to *display* a value it holds.
 * `LocalStore.applyMask` is a mock server declining to *send* one. They are different
 * mechanisms — the whole documented point of the first is that it is not an access-control
 * boundary — and a visitor can only tell them apart if they print the same string.
 *
 * There is no end-to-end assertion for the store half because there is nothing on screen to
 * look at: the demo's list rows render a record label, and none of the seeded configs mask a
 * field that a label is built from. That is a reason to assert it here, not a reason to skip
 * it — the constant is shared in source, and nothing else would notice if that stopped being
 * true.
 */
describe('the demo masks records with the same string it renders', () => {
  let store: LocalStore;

  beforeEach(() => {
    // A clean slate: `ensureSeed` treats existing keys as user modifications and keeps them.
    Object.keys(localStorage)
      .filter(key => key.startsWith('de_demo_'))
      .forEach(key => localStorage.removeItem(key));

    TestBed.configureTestingModule({ providers: [LocalStore] });
    store = TestBed.inject(LocalStore);
  });

  it('substitutes the shared constant for a masked field', () => {
    const page = store.getRecords('clients', { roles: MASKED_ROLES });

    expect(page.data.length).toBeGreaterThan(0);
    for (const row of page.data) {
      expect(row['salary']).toBe(DEMO_MASK);
    }
  });

  it('leaves the value intact for a role that is not masked', () => {
    const page = store.getRecords('clients', { roles: ['admin'] });

    expect(page.data.length).toBeGreaterThan(0);
    expect(page.data.some(row => typeof row['salary'] === 'number')).toBe(true);
    expect(page.data.every(row => row['salary'] !== DEMO_MASK)).toBe(true);
  });

  it('is not the library default, so the demo is exercising the token', () => {
    // If this ever equals `XXXXXXXXX` again, `MASKED_PLACEHOLDER` is registered but
    // indistinguishable from not being registered, and every assertion about it is vacuous.
    expect(DEMO_MASK).not.toBe('XXXXXXXXX');
  });
});
