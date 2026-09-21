/**
 * Stable option identity: what a `$key` buys, what it costs nothing, and the migration that
 * attaches one to records saved before it existed.
 */
import type { EntityFormConfig } from './form-model.types';
import {
  OPTION_KEY,
  normalizeConfigOptions,
  normalizeLocalizedText,
  normalizeOption,
  resolveLabel,
  resolveOptionLabel,
  resolveOptionValue,
  canonicalizeValue,
  formatDisplayValue,
  valuesMatch,
} from './form-logic';
import { applyOptionKeys, migrateRecord, optionKeyMigration } from './migration';

const ACTIVE = { [OPTION_KEY]: 'active', en: 'Active', de: 'Aktiv' };
const CLOSED = { [OPTION_KEY]: 'closed', en: 'Closed' };

describe('a key is identity; the text is display', () => {
  it('matches a record across a rename in every language', () => {
    const stored = { [OPTION_KEY]: 'active', en: 'Active', de: 'Aktiv' };
    const renamed = { [OPTION_KEY]: 'active', en: 'Enabled', de: 'Freigegeben' };
    expect(valuesMatch(stored, renamed)).toBe(true);
  });

  it('separates two options whose text agrees', () => {
    expect(valuesMatch({ [OPTION_KEY]: 'a', en: 'Open' }, { [OPTION_KEY]: 'b', en: 'Open' })).toBe(false);
  });

  it('falls back to 1.x text matching when either side has no key', () => {
    expect(valuesMatch(ACTIVE, { en: 'Active' })).toBe(true);
    expect(valuesMatch({ de: 'Aktiv' }, ACTIVE)).toBe(true);
    expect(valuesMatch(ACTIVE, 'Active')).toBe(true);
  });
});

describe('the key never leaks out as text', () => {
  // `resolveLabel` falls back to the first truthy value, so an option keyed but authored in
  // a language the caller does not have would render its slug to a user.
  const keyedInGermanOnly = { [OPTION_KEY]: 'active', de: 'Aktiv' };

  it('resolveLabel returns a translation, never the key', () => {
    expect(resolveLabel(keyedInGermanOnly, 'fr')).toBe('Aktiv');
    expect(resolveLabel({ [OPTION_KEY]: 'active' } as never, 'fr')).toBe('');
  });

  it('resolveOptionLabel and resolveOptionValue agree with it', () => {
    expect(resolveOptionLabel(keyedInGermanOnly, 'fr')).toBe('Aktiv');
    expect(resolveOptionValue(keyedInGermanOnly, 'fr')).toBe('Aktiv');
    expect(resolveOptionLabel(ACTIVE, 'de')).toBe('Aktiv');
  });

  it('formatDisplayValue renders the translation', () => {
    expect(formatDisplayValue('dropdown', [ACTIVE, CLOSED], ACTIVE, 'de')).toBe('Aktiv');
    expect(formatDisplayValue('multiSelect', [ACTIVE, CLOSED], [ACTIVE, CLOSED], 'en')).toBe(
      'Active, Closed',
    );
    // The key does not become a label even when the option list is absent.
    expect(formatDisplayValue('dropdown', undefined, keyedInGermanOnly, 'fr')).toBe('Aktiv');
  });

  it('normalizeLocalizedText drops it — a LocalizedText has no identity', () => {
    expect(normalizeLocalizedText(ACTIVE)).toEqual({ en: 'Active', de: 'Aktiv' });
  });

  it('canonicalizeValue ignores it, so a keyed and a keyless option still project alike', () => {
    expect(canonicalizeValue(ACTIVE)).toBe(canonicalizeValue({ en: 'Active', de: 'Aktiv' }));
  });
});

describe('normalizeOption', () => {
  it('preserves an authored key', () => {
    expect(normalizeOption(ACTIVE)).toEqual(ACTIVE);
  });

  it('preserves it through the legacy label wrapper', () => {
    const legacy = { [OPTION_KEY]: 'active', value: 1, label: { en: 'Active' } };
    expect(normalizeOption(legacy as never)).toEqual({ [OPTION_KEY]: 'active', en: 'Active' });
  });

  it('never invents one', () => {
    // Two deployments normalising the same config must not disagree about what an option is
    // called, which is what minting a slug at runtime would guarantee.
    expect(normalizeOption({ en: 'Active' })).toEqual({ en: 'Active' });
    expect(normalizeOption('Active')).toEqual({ en: 'Active' });
  });

  it('survives a whole-config normalisation', () => {
    const config: EntityFormConfig = {
      entity: 'e',
      tabs: [
        {
          id: 't',
          label: { en: 'T' },
          fields: [{ id: 'status', type: 'dropdown', label: { en: 'S' }, options: [ACTIVE] }],
        },
      ],
    };
    const out = normalizeConfigOptions(config);
    expect(out.tabs[0].fields![0].options).toEqual([ACTIVE]);
  });
});

describe('optionKeyMigration', () => {
  const config: EntityFormConfig = {
    entity: 'employees',
    version: 2,
    tabs: [
      {
        id: 'personal',
        label: { en: 'Personal' },
        fields: [
          { id: 'status', type: 'dropdown', label: { en: 'Status' }, options: [ACTIVE, CLOSED] },
          {
            id: 'tags',
            type: 'multiSelect',
            label: { en: 'Tags' },
            options: [ACTIVE, CLOSED],
          },
          {
            id: 'address',
            type: 'group',
            label: { en: 'Address' },
            children: [
              { id: 'kind', type: 'radio', label: { en: 'Kind' }, options: [ACTIVE, CLOSED] },
            ],
          },
          {
            id: 'contacts',
            type: 'array',
            label: { en: 'Contacts' },
            children: [
              { id: 'kind', type: 'dropdown', label: { en: 'Kind' }, options: [ACTIVE, CLOSED] },
              { id: 'name', type: 'text', label: { en: 'Name' } },
            ],
          },
          { id: 'note', type: 'text', label: { en: 'Note' } },
          {
            id: 'unkeyed',
            type: 'dropdown',
            label: { en: 'Unkeyed' },
            options: [{ en: 'Yes' }, { en: 'No' }],
          },
        ],
      },
    ],
  };

  const record = () => ({
    personal: {
      status: { en: 'Active', de: 'Aktiv' },
      tags: [{ en: 'Active' }, { en: 'Closed' }],
      address: { kind: { en: 'Closed' } },
      contacts: [{ kind: { en: 'Active' }, name: 'Ada' }, { kind: { en: 'Closed' }, name: 'Bo' }],
      note: 'nothing to key here',
      unkeyed: { en: 'Yes' },
    },
  });

  it('keys a top-level choice value', () => {
    const out = applyOptionKeys(record(), config);
    expect(out['personal'].status).toEqual({ [OPTION_KEY]: 'active', en: 'Active', de: 'Aktiv' });
  });

  it('keys every value of a multi-select', () => {
    const out = applyOptionKeys(record(), config);
    expect(out['personal'].tags).toEqual([
      { [OPTION_KEY]: 'active', en: 'Active' },
      { [OPTION_KEY]: 'closed', en: 'Closed' },
    ]);
  });

  it('reaches a choice inside a group', () => {
    const out = applyOptionKeys(record(), config);
    expect(out['personal'].address.kind).toEqual({ [OPTION_KEY]: 'closed', en: 'Closed' });
  });

  it('reaches a choice in every row of an array', () => {
    // There is no single path to `contacts.kind` — there is one per row, which is why the
    // migration walks the record rather than addressing it.
    const out = applyOptionKeys(record(), config);
    expect(out['personal'].contacts.map((r: Record<string, unknown>) => r['kind'])).toEqual([
      { [OPTION_KEY]: 'active', en: 'Active' },
      { [OPTION_KEY]: 'closed', en: 'Closed' },
    ]);
    expect(out['personal'].contacts[0].name).toBe('Ada');
  });

  it('leaves a value whose options carry no key alone', () => {
    const out = applyOptionKeys(record(), config);
    expect(out['personal'].unkeyed).toEqual({ en: 'Yes' });
  });

  it('leaves a value that matches no current option alone', () => {
    const orphan = { personal: { status: { en: 'Archived' } } };
    expect(applyOptionKeys(orphan, config)['personal'].status).toEqual({ en: 'Archived' });
  });

  it('does not re-derive a value that already carries a key', () => {
    // Re-deriving from text would undo exactly the rename the key exists to survive.
    const alreadyKeyed = { personal: { status: { [OPTION_KEY]: 'active', en: 'Enabled' } } };
    expect(applyOptionKeys(alreadyKeyed, config)['personal'].status).toEqual({
      [OPTION_KEY]: 'active',
      en: 'Enabled',
    });
  });

  it('does not mutate the record it was given', () => {
    const input = record();
    applyOptionKeys(input, config);
    expect(input.personal.status).toEqual({ en: 'Active', de: 'Aktiv' });
    expect(input.personal.contacts[0].kind).toEqual({ en: 'Active' });
  });

  it('runs as a registered migration step', () => {
    const step = optionKeyMigration(config);
    expect(step).toMatchObject({ from: 1, to: 2 });

    const result = migrateRecord({ ...record(), _configVersion: 1 }, config, [step]);
    expect(result.applied).toEqual([2]);
    expect(result.record['personal'].status).toEqual({
      [OPTION_KEY]: 'active',
      en: 'Active',
      de: 'Aktiv',
    });
    expect(result.record._configVersion).toBe(2);
  });

  it('takes explicit versions when the config is further ahead', () => {
    expect(optionKeyMigration(config, { from: 4, to: 5 })).toMatchObject({ from: 4, to: 5 });
  });

  it('tolerates a record that is missing the tab entirely', () => {
    expect(applyOptionKeys({}, config)).toEqual({});
    expect(applyOptionKeys({ personal: null }, config)).toEqual({ personal: null });
  });

  it('keys a flatData tab at the record root', () => {
    const flat: EntityFormConfig = {
      entity: 'e',
      version: 2,
      tabs: [
        {
          id: 'main',
          label: { en: 'Main' },
          flatData: true,
          fields: [{ id: 'status', type: 'dropdown', label: { en: 'S' }, options: [ACTIVE] }],
        },
      ],
    };
    expect(applyOptionKeys({ status: { en: 'Active' } }, flat)).toEqual({
      status: { [OPTION_KEY]: 'active', en: 'Active' },
    });
  });
});
