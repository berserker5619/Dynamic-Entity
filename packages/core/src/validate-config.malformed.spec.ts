import { validateConfig } from './validate-config';
import type { EntityFormConfig } from './form-model.types';

/**
 * `validateConfig` against configs that are not merely wrong but malformed.
 *
 * A config is data. It arrives from a database, an API, or a hand edit, and by the time it
 * reaches the validator it may not be shaped like a config at all. These branches are what
 * stops the validator throwing on the input it exists to describe — a crash here takes the
 * `dynamic-entity validate` CLI down with it, and that is the tool people run in CI.
 */
const messages = (config: unknown): string[] =>
  validateConfig(config as unknown as EntityFormConfig).map(issue => issue.message);

describe('validateConfig — malformed input', () => {
  it('reports a field that is not an object instead of throwing', () => {
    const config = {
      entity: 'clients',
      tabs: [{ id: 'main', label: { en: 'Main' }, fields: [null, 'nonsense', 42] }],
    };
    expect(() => messages(config)).not.toThrow();
    expect(messages(config).filter(m => /Field is missing or not an object/.test(m))).toHaveLength(3);
  });

  it('reports a field with no id', () => {
    const config = {
      entity: 'clients',
      tabs: [{ id: 'main', label: { en: 'Main' }, fields: [{ type: 'text' }] }],
    };
    expect(messages(config)).toContain('A field id is required.');
  });

  it('reports a field with no type', () => {
    const config = {
      entity: 'clients',
      tabs: [{ id: 'main', label: { en: 'Main' }, fields: [{ id: 'name' }] }],
    };
    expect(messages(config)).toContain('A field type is required.');
  });

  it('warns about a field with no label, without failing the config', () => {
    const config = {
      entity: 'clients',
      tabs: [{ id: 'main', label: { en: 'Main' }, fields: [{ id: 'name', type: 'text' }] }],
    };
    const issues = validateConfig(config as unknown as EntityFormConfig);
    const label = issues.find(i => /No label/.test(i.message));
    // A missing label is ugly, not broken — it must not stop a config being saved.
    expect(label?.level).toBe('warning');
  });

  it('warns when children hang off a field type that cannot hold them', () => {
    const config = {
      entity: 'clients',
      tabs: [
        {
          id: 'main',
          label: { en: 'Main' },
          fields: [
            {
              id: 'name',
              type: 'text',
              label: { en: 'Name' },
              children: [{ id: 'nested', type: 'text', label: { en: 'Nested' } }],
            },
          ],
        },
      ],
    };
    // Only `group` and `array` render children; anywhere else they are silently dropped,
    // which looks like data loss unless something says so.
    expect(messages(config).some(m => /Children on a "text" field are ignored/.test(m))).toBe(true);
  });

  it('reports a tab that is not an object', () => {
    const config = { entity: 'clients', tabs: [null, 7] };
    expect(() => messages(config)).not.toThrow();
    expect(messages(config).filter(m => /Tab is missing or not an object/.test(m))).toHaveLength(2);
  });

  it('reports a tab with no id', () => {
    const config = { entity: 'clients', tabs: [{ label: { en: 'Main' }, fields: [] }] };
    expect(messages(config)).toContain('A tab id is required.');
  });

  it('warns about a tab that would render nothing', () => {
    const config = { entity: 'clients', tabs: [{ id: 'empty', label: { en: 'Empty' } }] };
    // No fields, no sub-tabs, no module: a tab strip entry that opens onto blank space.
    expect(messages(config).some(m => /renders empty/.test(m))).toBe(true);
  });

  it('accepts a tab that has only a module', () => {
    const config = {
      entity: 'clients',
      tabs: [{ id: 'docs', label: { en: 'Docs' }, moduleName: 'documents-view' }],
    };
    // A module tab legitimately has no fields — its content comes from a component.
    expect(messages(config).some(m => /renders empty/.test(m))).toBe(false);
  });

  it('reports a rule that is not an object', () => {
    const config: EntityFormConfig = {
      entity: 'clients',
      tabs: [{ id: 'main', label: { en: 'Main' }, fields: [{ id: 'a', type: 'text', label: { en: 'A' } }] }],
    };
    const issues = validateConfig(config, { rules: [null, 'nope'] as never });
    expect(issues.filter(i => /Rule is missing or not an object/.test(i.message))).toHaveLength(2);
  });

  it('survives a config that is not an object at all', () => {
    for (const input of [null, undefined, 'a string', 42, []]) {
      expect(() => validateConfig(input as never)).not.toThrow();
    }
  });
});
