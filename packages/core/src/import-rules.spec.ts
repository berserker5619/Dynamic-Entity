/**
 * Rules and `showWhen` during import, addressed the way the builder addresses them.
 *
 * The builder writes rule triggers and targets as `[tab.field]` refs. Import used to evaluate
 * rules per tab against values keyed only by bare id, so a ref never resolved: a required field
 * the form hid still rejected the row. These specs pin import to the form's model — one flat map
 * where every field answers to both of its names.
 */
import { applyMapping } from './import-engine';
import type { EntityFormConfig, FormRule, NestedFieldConfig } from './form-model.types';
import type { MappingPlan } from './import-model.types';

const rule = (fieldId: string, value: string, action: FormRule['action'], ...targets: string[]): FormRule => ({
  formConfigId: 'claims',
  fieldId,
  conditions: [{ operator: 'EQUAL', value, compareType: 'value' }],
  action,
  targets: targets.map(id => ({ id, type: 'field' })),
  enabled: true,
  priority: 0,
});
const hide = { type: 'visibility', value: false } as const;
const show = { type: 'visibility', value: true } as const;

const required = (id: string, extra: Partial<NestedFieldConfig> = {}): NestedFieldConfig => ({
  id,
  type: 'text',
  label: { en: id },
  validators: { required: true },
  ...extra,
});

const CONFIG: EntityFormConfig = {
  entity: 'claims',
  tabs: [
    {
      id: 'main',
      label: { en: 'Main' },
      fields: [
        { id: 'status', type: 'text', label: { en: 'Status' } },
        required('reason'),
        { id: 'home', type: 'group', label: { en: 'Home' }, children: [required('city')] },
        { id: 'work', type: 'group', label: { en: 'Work' }, children: [required('city')] },
      ],
    },
  ],
};

/** Every column of `CONFIG`, in order: status, reason, home.city, work.city. */
const PLAN: MappingPlan = {
  entity: 'claims',
  entries: ['main.status', 'main.reason', 'main.home.city', 'main.work.city'].map((ref, column) => ({
    ref,
    column,
  })),
};

const errorRefs = (rules: FormRule[], row: string[], config = CONFIG, plan = PLAN): string[] =>
  applyMapping([row], plan, config, { rules, stamp: false }).errors.map(error => error.ref);

describe('rules addressed by [ref]', () => {
  it('relax a required field the rule hides', () => {
    const rules = [rule('[main.status]', 'closed', hide, '[main.reason]')];
    expect(errorRefs(rules, ['closed', '', 'Oslo', 'Oslo'])).toEqual([]);
    expect(errorRefs(rules, ['open', '', 'Oslo', 'Oslo'])).toEqual(['main.reason']);
  });

  it('hide exactly the field they name when two scopes share an id', () => {
    const rules = [rule('[main.status]', 'remote', hide, '[main.work.city]')];
    expect(errorRefs(rules, ['remote', 'x', '', ''])).toEqual(['main.home.city']);
  });

  it('hide everything inside a container they hide', () => {
    const rules = [rule('[main.status]', 'remote', hide, '[main.work]')];
    expect(errorRefs(rules, ['remote', 'x', 'Oslo', ''])).toEqual([]);
  });

  it('attach their validation message to the field they name', () => {
    const rules = [
      rule('[main.status]', 'closed', { type: 'validation', value: 'Say why it closed' }, '[main.reason]'),
    ];
    const result = applyMapping([['closed', 'x', 'Oslo', 'Oslo']], PLAN, CONFIG, { rules, stamp: false });
    expect(result.errors).toEqual([expect.objectContaining({ ref: 'main.reason', message: 'Say why it closed' })]);
  });
});

describe('rules addressed by bare id', () => {
  it('still work, as they always have', () => {
    const rules = [rule('status', 'closed', hide, 'reason')];
    expect(errorRefs(rules, ['closed', '', 'Oslo', 'Oslo'])).toEqual([]);
  });

  /**
   * The form hides every field that answers to the name, and import must agree with the form.
   * `validateConfig` is what flags the ambiguous reference.
   */
  it('hide every field answering to an ambiguous id, as the form does', () => {
    const rules = [rule('status', 'remote', hide, 'city')];
    expect(errorRefs(rules, ['remote', 'x', '', ''])).toEqual([]);
  });
});

describe('showWhen and show rules', () => {
  const withShowWhen = (showWhen: Record<string, unknown>): EntityFormConfig => ({
    ...CONFIG,
    tabs: [{ ...CONFIG.tabs[0], fields: [CONFIG.tabs[0].fields![0], required('reason', { showWhen })] }],
  });
  const plan: MappingPlan = { entity: 'claims', entries: PLAN.entries.slice(0, 2) };

  it('resolve a [ref] showWhen key', () => {
    const config = withShowWhen({ '[main.status]': 'closed' });
    expect(errorRefs([], ['open', ''], config, plan)).toEqual([]);
    expect(errorRefs([], ['closed', ''], config, plan)).toEqual(['main.reason']);
  });

  it('let a show rule beat a showWhen that does not hold', () => {
    const config = withShowWhen({ status: 'never' });
    expect(errorRefs([], ['open', ''], config, plan)).toEqual([]);
    expect(errorRefs([rule('[main.status]', 'open', show, '[main.reason]')], ['open', ''], config, plan)).toEqual([
      'main.reason',
    ]);
  });
});

describe('a hidden tab', () => {
  it('relaxes every field it owns, sub-tabs and groups included', () => {
    const config: EntityFormConfig = {
      entity: 'claims',
      tabs: [
        { id: 'main', label: { en: 'Main' }, fields: [{ id: 'status', type: 'text', label: { en: 'Status' } }] },
        {
          id: 'extra',
          label: { en: 'Extra' },
          fields: [{ id: 'box', type: 'group', label: { en: 'Box' }, children: [required('inner')] }],
          children: [{ id: 'deep', label: { en: 'Deep' }, fields: [required('leaf')] }],
        },
      ],
    };
    const plan: MappingPlan = {
      entity: 'claims',
      entries: ['main.status', 'extra.box.inner', 'extra.deep.leaf'].map((ref, column) => ({ ref, column })),
    };
    const hideTab: FormRule = { ...rule('[main.status]', 'short', hide), targets: [{ id: 'extra', type: 'tab' }] };

    expect(errorRefs([hideTab], ['short', '', ''], config, plan)).toEqual([]);
    expect(errorRefs([hideTab], ['long', '', ''], config, plan)).toEqual(['extra.box.inner', 'extra.deep.leaf']);
  });
});
