import {
  getTabData,
  setTabData,
  normalizeConfig,
  normalizeConfigOptions,
  resolveOptionValue,
} from './form-logic';
import type { EntityFormConfig } from './form-model.types';

/**
 * Edges of `form-logic` — the module every other package leans on.
 *
 * These are the branches that were carrying no coverage: legacy config shapes the code
 * explicitly supports, and the walk that writes a tab's values into a nested record. Both
 * fail *silently* when they fail — a config that half-loads, or values written at the wrong
 * depth — so nothing downstream reports them.
 */
describe('form-logic — legacy config shapes', () => {
  /**
   * Older configs stored tabs and fields as objects keyed by id rather than arrays. The
   * normaliser converts them and lifts the key into `id`; without that a legacy config
   * loads as a form with no tabs at all.
   */
  it('converts object-keyed tabs into an array, keeping the key as the id', () => {
    const raw = {
      entity: 'clients',
      tabs: {
        main: { label: { en: 'Main' }, fields: [] },
        extra: { label: { en: 'Extra' }, fields: [] },
      },
    };

    const config = normalizeConfig(raw);
    expect(config.tabs?.map(t => t.id)).toEqual(['main', 'extra']);
    expect(config.tabs?.[0].label).toEqual({ en: 'Main' });
  });

  it('converts object-keyed fields on a tab', () => {
    const raw = {
      entity: 'clients',
      tabs: { main: { label: { en: 'Main' }, fields: { name: { type: 'text' } } } },
    };

    const config = normalizeConfig(raw);
    expect(config.tabs?.[0].fields?.map(f => f.id)).toEqual(['name']);
    expect(config.tabs?.[0].fields?.[0].type).toBe('text');
  });

  it('converts object-keyed sub-tabs', () => {
    const raw = {
      entity: 'clients',
      tabs: {
        parent: {
          label: { en: 'Parent' },
          fields: [],
          children: { nested: { label: { en: 'Nested' }, fields: [] } },
        },
      },
    };

    const config = normalizeConfig(raw);
    expect(config.tabs?.[0].children?.map(t => t.id)).toEqual(['nested']);
  });

  it('leaves an already-normalised array config alone', () => {
    const raw: EntityFormConfig = {
      entity: 'clients',
      tabs: [{ id: 'main', label: { en: 'Main' }, fields: [{ id: 'name', type: 'text', label: { en: 'Name' } }] }],
    };

    const config = normalizeConfig(raw);
    expect(config.tabs?.map(t => t.id)).toEqual(['main']);
    expect(config.tabs?.[0].fields?.map(f => f.id)).toEqual(['name']);
  });

  it('returns a non-object input untouched rather than throwing', () => {
    // Configs arrive from storage and APIs, where `null` is a real possibility.
    expect(normalizeConfig(null)).toBeNull();
    expect(normalizeConfig(undefined)).toBeUndefined();
  });
});

describe('form-logic — writing a tab back into a record', () => {
  const config: EntityFormConfig = {
    entity: 'claims',
    tabs: [
      {
        id: 'incident',
        label: { en: 'Incident' },
        fields: [],
        children: [{ id: 'details', label: { en: 'Details' }, fields: [{ id: 'when', type: 'date', label: { en: 'When' } }] }],
      },
    ],
  };

  it('creates the intermediate objects a nested path needs', () => {
    const record: Record<string, unknown> = {};
    setTabData(record, 'details', { when: '2026-01-01' }, config);
    // Two levels deep, and neither existed a moment ago.
    expect(record).toEqual({ incident: { details: { when: '2026-01-01' } } });
  });

  it('replaces a non-object sitting where a path segment belongs', () => {
    // A malformed or migrated record can hold a scalar where a group is expected. Writing
    // through it would throw or, worse, attach properties to a boxed primitive and lose them.
    const record: Record<string, unknown> = { incident: 'not an object' };
    setTabData(record, 'details', { when: '2026-01-01' }, config);
    expect(record).toEqual({ incident: { details: { when: '2026-01-01' } } });
  });

  it('merges into an existing sibling rather than replacing it', () => {
    const record: Record<string, unknown> = {
      incident: { details: { where: 'Berlin' }, other: 'kept' },
    };
    setTabData(record, 'details', { when: '2026-01-01' }, config);
    expect(record).toEqual({
      incident: { details: { where: 'Berlin', when: '2026-01-01' }, other: 'kept' },
    });
  });

  it('refuses a path that would reach an object prototype', () => {
    const record: Record<string, unknown> = {};
    const hostile: EntityFormConfig = {
      entity: 'x',
      tabs: [{ id: '__proto__', label: { en: 'x' }, fields: [] }],
    };
    setTabData(record, '__proto__', { polluted: true }, hostile);

    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
  });
});

describe('form-logic — reading a tab out of a record', () => {
  it('falls back to the record itself when no config is supplied', () => {
    // Callers without a config cannot know whether a tab nests, so an unknown id means the
    // values are most likely at the root.
    expect(getTabData('main', { main: { a: 1 } })).toEqual({ a: 1 });
    expect(getTabData('missing', { a: 1 })).toEqual({ a: 1 });
  });

  it('returns null for an absent record instead of throwing', () => {
    expect(getTabData('main', null)).toBeNull();
  });
});

describe('form-logic — option value resolution', () => {
  it('resolves a localized option to its text in the active language', () => {
    expect(resolveOptionValue({ en: 'Active', de: 'Aktiv' }, 'de')).toBe('Aktiv');
  });

  it('passes scalar options through unchanged', () => {
    expect(resolveOptionValue('ENG')).toBe('ENG');
    expect(resolveOptionValue(7)).toBe(7);
    expect(resolveOptionValue(true)).toBe(true);
  });

  it('resolves an empty option to an empty string, not "null"', () => {
    // Stringifying here would put the word "null" in a dropdown.
    expect(resolveOptionValue(null)).toBe('');
    expect(resolveOptionValue(undefined)).toBe('');
  });
});

describe('form-logic — option normalisation is idempotent', () => {
  it('leaves an already-canonical config unchanged by a second pass', () => {
    const config: EntityFormConfig = {
      entity: 'clients',
      tabs: [
        {
          id: 'main',
          label: { en: 'Main' },
          fields: [
            { id: 'status', type: 'dropdown', label: { en: 'Status' }, options: [{ en: 'Active' }] },
          ],
        },
      ],
    };

    const once = normalizeConfigOptions(config);
    const twice = normalizeConfigOptions(once);
    // The renderer and the builder both normalise on entry; a second pass must not rewrap.
    expect(twice).toBe(once);
  });
});
