import type { EntityFormConfig } from './form-model.types';
import {
  ROOT_SCOPE,
  ambiguousFieldIds,
  assignFieldRefs,
  collectFieldScopes,
  fieldRefFor,
  refOf,
  parseFieldRef,
  toRefToken,
} from './field-scopes';

const config = (): EntityFormConfig => ({
  entity: 'people',
  version: 1,
  tabs: [
    { id: 'personal', label: {}, fields: [{ id: 'address', type: 'text', label: {} }] },
    {
      id: 'work',
      label: {},
      fields: [
        { id: 'address', type: 'text', label: {} },
        {
          id: 'addresses',
          type: 'group',
          label: {},
          children: [{ id: 'city', type: 'text', label: {} }],
        },
      ],
    },
    { id: 'meta', label: {}, flatData: true, fields: [{ id: 'notes', type: 'text', label: {} }] },
  ],
});

describe('collectFieldScopes', () => {
  it('scopes a field by the tab it is stored under', () => {
    const byPath = new Map(collectFieldScopes(config()).map(e => [e.path, e.scope]));

    expect(byPath.get('tabs[0].fields[0]')).toBe('personal');
    expect(byPath.get('tabs[1].fields[0]')).toBe('work');
  });

  // A group stores its children under itself, so they are not siblings of the group field.
  it('opens a scope for a group field', () => {
    const entry = collectFieldScopes(config()).find(e => e.field.id === 'city');
    expect(entry?.scope).toBe('work.addresses');
  });

  // flatData puts a tab's fields at the parent's level, so the tab does not open a scope.
  it('leaves a flatData tab in its parent scope', () => {
    const entry = collectFieldScopes(config()).find(e => e.field.id === 'notes');
    expect(entry?.scope).toBe(ROOT_SCOPE);
  });

  it('returns nothing for a config without tabs', () => {
    expect(collectFieldScopes(null)).toEqual([]);
    expect(collectFieldScopes({ entity: 'x', version: 1 } as EntityFormConfig)).toEqual([]);
  });
});

describe('ambiguousFieldIds', () => {
  it('reports only ids that more than one scope defines', () => {
    const ambiguous = ambiguousFieldIds(config());

    expect(ambiguous.get('address')).toEqual(['personal', 'work']);
    expect(ambiguous.has('city')).toBe(false);
    expect(ambiguous.has('notes')).toBe(false);
  });
});

describe('assignFieldRefs', () => {
  it('stamps every field with its full address', () => {
    const stamped = assignFieldRefs(config())!;

    expect(stamped.tabs![0].fields![0].refererField).toBe('personal.address');
    expect(stamped.tabs![1].fields![0].refererField).toBe('work.address');
    expect(stamped.tabs![1].fields![1].children![0].refererField).toBe('work.addresses.city');
  });

  // A flatData tab's field sits at the root, so its ref is the bare id — there is no scope
  // above it to name.
  it('uses the bare id at the root scope', () => {
    const stamped = assignFieldRefs(config())!;
    expect(stamped.tabs![2].fields![0].refererField).toBe('notes');
    expect(fieldRefFor(ROOT_SCOPE, 'notes')).toBe('notes');
  });

  it('tolerates a null config', () => {
    expect(assignFieldRefs(null)).toBeNull();
  });

  /**
   * `refererField` has always been a binding override, so an authored one is a deliberate
   * instruction about where the value lives. Taking it over as an identity would silently
   * rebind that field's data.
   */
  it('never overwrites a refererField the config already declares', () => {
    const c = config();
    c.tabs![0].fields![0].refererField = 'customer.billing.street';

    const stamped = assignFieldRefs(c)!;

    expect(stamped.tabs![0].fields![0].refererField).toBe('customer.billing.street');
    expect(stamped.tabs![1].fields![0].refererField).toBe('work.address');
  });

  it('reads a field address from what it declares, else from its position', () => {
    expect(refOf({ id: 'address' }, 'work')).toBe('work.address');
    expect(refOf({ id: 'address', refererField: 'customer.street' }, 'work')).toBe('customer.street');
  });
});

describe('parseFieldRef', () => {
  it('reads a bracketed reference as a ref', () => {
    expect(parseFieldRef('[personal.address]')).toEqual({ kind: 'ref', value: 'personal.address' });
    expect(parseFieldRef('  [work.address] ')).toEqual({ kind: 'ref', value: 'work.address' });
  });

  // Every config written before refs existed addresses a field by bare id, and must keep
  // resolving that way.
  it('reads anything else as a legacy field id', () => {
    expect(parseFieldRef('address')).toEqual({ kind: 'id', value: 'address' });
    expect(parseFieldRef('[]')).toEqual({ kind: 'id', value: '[]' });
    expect(parseFieldRef('')).toEqual({ kind: 'id', value: '' });
  });

  it('round-trips a ref through its token form', () => {
    expect(parseFieldRef(toRefToken('work.addresses.city'))).toEqual({
      kind: 'ref',
      value: 'work.addresses.city',
    });
  });
});
