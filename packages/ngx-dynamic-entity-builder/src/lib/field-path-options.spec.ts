import type { EntityFormConfig } from '@dynamic-entity/core';
import { fieldPathOptions, withExistingOptions } from './field-path-options';

const CONFIG: EntityFormConfig = {
  entity: 'people',
  version: 1,
  tabs: [
    { id: 'personal', label: {}, fields: [{ id: 'address', type: 'text', label: { en: 'Address' } }] },
    {
      id: 'work',
      label: {},
      fields: [
        { id: 'address', type: 'text', label: { en: 'Address' } },
        {
          id: 'site',
          type: 'group',
          label: { en: 'Site' },
          children: [{ id: 'city', type: 'text', label: {} }],
        },
      ],
    },
  ],
};

describe('fieldPathOptions', () => {
  it('offers every field by path, including one nested in a group', () => {
    expect(fieldPathOptions(CONFIG, 'en').map(o => o.value)).toEqual([
      '[personal.address]',
      '[work.address]',
      '[work.site]',
      '[work.site.city]',
    ]);
  });

  // Two fields may share a label as well as an id, which is why the path is shown beside it.
  it('carries the label and the path separately', () => {
    const options = fieldPathOptions(CONFIG, 'en');

    expect(options.slice(0, 2).map(o => o.label)).toEqual(['Address', 'Address']);
    expect(options.slice(0, 2).map(o => o.path)).toEqual(['personal.address', 'work.address']);
  });

  it('falls back to the id when a field has no label', () => {
    expect(fieldPathOptions(CONFIG, 'en').find(o => o.path === 'work.site.city')?.label).toBe('city');
  });

  it('returns nothing for a config with no tabs', () => {
    expect(fieldPathOptions(null, 'en')).toEqual([]);
  });
});

describe('withExistingOptions', () => {
  const options = () => fieldPathOptions(CONFIG, 'en');

  /**
   * A mat-select silently drops a value it has no option for, so a reference naming a bare id
   * or a field since deleted would be erased just by opening the config and saving it.
   */
  it('keeps a value the config no longer contains, and marks it', () => {
    const result = withExistingOptions(options(), ['legacyBareId']);

    expect(result.map(o => o.value)).toContain('legacyBareId');
    expect(result.find(o => o.value === 'legacyBareId')?.path).toBe('not in this config');
  });

  it('does not duplicate a value the list already has', () => {
    const result = withExistingOptions(options(), ['[work.address]']);
    expect(result.filter(o => o.value === '[work.address]')).toHaveLength(1);
  });

  it('ignores empty and undefined selections', () => {
    expect(withExistingOptions(options(), ['', undefined])).toEqual(options());
  });
});
