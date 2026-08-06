import { migrateConfig } from './config-migration';
import { simpleToRich } from './simple-to-rich.upcaster';

describe('simpleToRich', () => {
  it('groups flat fields[] by field.tab into nested tabs', () => {
    const flat = {
      entity: 'employees',
      name: { en: 'Employees' },
      fields: [
        { id: 'firstName', type: 'text', tab: 'Personal', label: { en: 'First Name' } },
        { id: 'lastName', type: 'text', tab: 'Personal', label: { en: 'Last Name' } },
        { id: 'salary', type: 'number', tab: 'Employment', label: { en: 'Salary' }, mandatory: true },
      ],
    };

    const rich = simpleToRich(flat);

    expect(rich.entity).toBe('employees');
    expect(rich.name).toEqual({ en: 'Employees' });
    expect(rich.tabs).toHaveLength(2);

    const personal = rich.tabs.find(t => t.id === 'personal');
    const employment = rich.tabs.find(t => t.id === 'employment');
    expect(personal?.fields).toHaveLength(2);
    expect(personal?.fields?.map(f => f.id)).toEqual(['firstName', 'lastName']);
    expect(employment?.fields).toHaveLength(1);
    expect(employment?.fields?.[0].validators?.required).toBe(true);
  });

  it('places fields without tab into a general tab', () => {
    const flat = {
      entity: 'contacts',
      fields: [{ id: 'name', type: 'text', label: 'Full Name' }],
    };
    const rich = simpleToRich(flat);
    expect(rich.tabs).toHaveLength(1);
    expect(rich.tabs[0].id).toBe('general');
    expect(rich.tabs[0].fields?.[0].label).toEqual({ en: 'Full Name' });
    expect(rich.tabs[0].isPrimaryTab).toBe(true);
  });

  it('converts legacy entities[].forms[] into one tab per entity section', () => {
    const legacy = {
      entity: 'multi',
      entities: [
        { name: 'Section A', forms: [{ id: 'a1', type: 'text', label: 'A1' }] },
        { name: 'Section B', forms: [{ id: 'b1', type: 'dropdown', label: 'B1', values: ['x', 'y'] }] },
      ],
    };
    const rich = simpleToRich(legacy);
    expect(rich.tabs).toHaveLength(2);
    expect(rich.tabs[0].id).toBe('section_a');
    expect(rich.tabs[1].fields?.[0].options).toHaveLength(2);
  });

  it('maps legacy type aliases to RichFieldType', () => {
    const flat = {
      entity: 'test',
      fields: [
        { id: 't1', type: 'textbox', label: 'T1' },
        { id: 't2', type: 'select', label: 'T2', values: ['a'] },
        { id: 't3', type: 'bool', label: 'T3' },
      ],
    };
    const rich = simpleToRich(flat);
    const fields = rich.tabs[0].fields!;
    expect(fields[0].type).toBe('text');
    expect(fields[1].type).toBe('dropdown');
    expect(fields[2].type).toBe('boolean');
  });
});

describe('migrateConfig + simpleToRich', () => {
  it('round-trips flat config through migrateConfig to version 1', () => {
    const flat = {
      entity: 'clients',
      fields: [
        { id: 'name', type: 'text', tab: 'Main', label: 'Name' },
        { id: 'email', type: 'email', tab: 'Main', label: 'Email' },
      ],
    };

    const migrated = migrateConfig(flat);

    expect(migrated.version).toBe(1);
    expect(migrated.entity).toBe('clients');
    expect(migrated.tabs).toHaveLength(1);
    expect(migrated.tabs[0].id).toBe('main');
    expect(migrated.tabs[0].fields).toHaveLength(2);
    expect(migrated.tabs[0].fields![0].label).toEqual({ en: 'Name' });
  });

  it('passes through already-rich configs with normalization', () => {
    const rich = {
      version: 1,
      entity: 'clients',
      tabs: [{ id: 'main', label: { en: 'Main' }, fields: [{ id: 'name', type: 'text', label: 'Name' }] }],
    };
    const migrated = migrateConfig(rich);
    expect(migrated.version).toBe(1);
    expect(migrated.tabs[0].fields![0].label).toEqual({ en: 'Name' });
  });
});
