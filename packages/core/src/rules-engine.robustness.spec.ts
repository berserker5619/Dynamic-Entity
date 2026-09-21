/**
 * What the rules engine does with configs it was never given: a half-authored rule, a rule
 * addressing a field by path, and a rule that shows something the config hides.
 *
 * Each of these was a defect the README's headline feature claimed not to have.
 */
import type { EntityFormConfig, FormRule } from './form-model.types';
import { evaluateFormRules, filterRulesForTab } from './rules-engine';

const config: EntityFormConfig = {
  entity: 'employees',
  tabs: [
    {
      id: 'personal',
      label: { en: 'Personal' },
      fields: [
        { id: 'status', type: 'dropdown', label: { en: 'Status' }, options: [{ en: 'Active' }] },
        {
          id: 'address',
          type: 'group',
          label: { en: 'Address' },
          children: [
            { id: 'city', type: 'text', label: { en: 'City' } },
            { id: 'postcode', type: 'text', label: { en: 'Postcode' } },
          ],
        },
      ],
      children: [
        {
          id: 'emergency',
          label: { en: 'Emergency' },
          fields: [{ id: 'contact', type: 'text', label: { en: 'Contact' } }],
        },
      ],
    },
    {
      id: 'work',
      label: { en: 'Work' },
      fields: [
        {
          id: 'address',
          type: 'group',
          label: { en: 'Address' },
          children: [{ id: 'city', type: 'text', label: { en: 'City' } }],
        },
      ],
    },
  ],
};

const rule = (over: Partial<FormRule> = {}): FormRule => ({
  formConfigId: 'employees',
  fieldId: 'status',
  conditions: [{ operator: 'EQUAL', compareType: 'value', value: 'archived' }],
  action: { type: 'visibility', value: false },
  targets: [{ id: 'city', type: 'field' }],
  enabled: true,
  priority: 1,
  ...over,
});

describe('a malformed rule does not stop the others', () => {
  const good = rule({ id: 'good', targets: [{ id: 'postcode', type: 'field' }] });

  const broken: Record<string, FormRule> = {
    'no conditions': { ...rule({ id: 'bad' }), conditions: undefined as never },
    'conditions not an array': { ...rule({ id: 'bad' }), conditions: 'nope' as never },
    'no targets': { ...rule({ id: 'bad' }), targets: undefined as never },
    'targets not an array': { ...rule({ id: 'bad' }), targets: 42 as never },
    'no action': { ...rule({ id: 'bad' }), action: undefined as never },
    'action not an object': { ...rule({ id: 'bad' }), action: 'hide' as never },
  };

  for (const [why, bad] of Object.entries(broken)) {
    it(`survives a rule with ${why}`, () => {
      const problems: string[] = [];
      const result = evaluateFormRules([bad, good], { status: 'archived' }, undefined, {
        onProblem: message => problems.push(message),
      });

      expect(result.hiddenFields).toEqual(['postcode']);
      expect(problems).toHaveLength(1);
      expect(problems[0]).toContain('"bad"');
    });
  }

  it('survives a null entry in the rules array', () => {
    const problems: string[] = [];
    const result = evaluateFormRules([null as never, good], { status: 'archived' }, undefined, {
      onProblem: message => problems.push(message),
    });
    expect(result.hiddenFields).toEqual(['postcode']);
    expect(problems[0]).toContain('index 0');
  });

  it('reports nothing when every rule is well formed', () => {
    const onProblem = jest.fn();
    evaluateFormRules([good], { status: 'archived' }, undefined, { onProblem });
    expect(onProblem).not.toHaveBeenCalled();
  });

  it('does not require a reporter', () => {
    expect(() => evaluateFormRules([broken['no conditions'], good], {})).not.toThrow();
  });
});

describe('filterRulesForTab resolves references the way the renderer does', () => {
  const idFor = (r: FormRule) => r.id;

  it('finds a rule addressing a nested field by path', () => {
    // What the builder writes. This matched nothing before: the filter compared bracketed
    // refs against bare ids, and never looked inside a `group`.
    const byRef = rule({ id: 'by-ref', fieldId: '[personal.address.city]' });
    expect(filterRulesForTab([byRef], 'personal', config).map(idFor)).toEqual(['by-ref']);
  });

  it('finds a rule targeting a nested field by path', () => {
    const byRef = rule({
      id: 'target-ref',
      fieldId: 'unrelated',
      targets: [{ id: '[personal.address.postcode]', type: 'field' }],
    });
    expect(filterRulesForTab([byRef], 'personal', config).map(idFor)).toEqual(['target-ref']);
  });

  it('still finds a rule addressing a field by bare id', () => {
    const byId = rule({ id: 'by-id', fieldId: 'status' });
    expect(filterRulesForTab([byId], 'personal', config).map(idFor)).toEqual(['by-id']);
  });

  it('reaches fields on a sub-tab', () => {
    const onSubTab = rule({ id: 'sub', fieldId: '[personal.emergency.contact]' });
    expect(filterRulesForTab([onSubTab], 'personal', config).map(idFor)).toEqual(['sub']);
  });

  it('does not hand one tab another tab’s rule', () => {
    // Addressed by path on both ends. A bare `city` would legitimately match both tabs —
    // that ambiguity is what the ref syntax exists to resolve, and what the renderer warns
    // about when a rule keeps using the bare form.
    const workOnly = rule({
      id: 'work',
      fieldId: '[work.address.city]',
      targets: [{ id: '[work.address.city]', type: 'field' }],
    });
    expect(filterRulesForTab([workOnly], 'personal', config)).toEqual([]);
    expect(filterRulesForTab([workOnly], 'work', config).map(idFor)).toEqual(['work']);
  });

  it('keeps a rule whose target is the tab itself or one of its sub-tabs', () => {
    const tabTarget = rule({ id: 'tab', fieldId: 'unrelated', targets: [{ id: 'personal', type: 'tab' }] });
    const subTarget = rule({ id: 'sub-tab', fieldId: 'unrelated', targets: [{ id: 'emergency', type: 'tab' }] });
    expect(filterRulesForTab([tabTarget, subTarget], 'personal', config).map(idFor)).toEqual([
      'tab',
      'sub-tab',
    ]);
  });

  it('returns nothing for a tab that does not exist', () => {
    expect(filterRulesForTab([rule()], 'nope', config)).toEqual([]);
  });

  it('drops a malformed entry rather than throwing', () => {
    const rules = [null as never, { ...rule({ id: 'ok' }) }];
    expect(filterRulesForTab(rules, 'personal', config).map(idFor)).toEqual(['ok']);
  });
});

describe('a visibility rule can show as well as hide', () => {
  const show = (over: Partial<FormRule> = {}) =>
    rule({ action: { type: 'visibility', value: true }, ...over });

  it('collects a shown field', () => {
    const result = evaluateFormRules([show()], { status: 'archived' });
    expect(result.shownFields).toEqual(['city']);
    expect(result.hiddenFields).toEqual([]);
  });

  it('collects a shown tab', () => {
    const result = evaluateFormRules([show({ targets: [{ id: 'work', type: 'tab' }] })], {
      status: 'archived',
    });
    expect(result.shownTabs).toEqual(['work']);
  });

  it('treats the string "true" as a show and "false" as a hide', () => {
    const asString = (value: string) =>
      evaluateFormRules([rule({ action: { type: 'visibility', value } })], { status: 'archived' });
    expect(asString('true').shownFields).toEqual(['city']);
    expect(asString('false').hiddenFields).toEqual(['city']);
  });

  it('reports a field as both shown and hidden when two rules disagree', () => {
    // The engine records both; precedence is the consumer's to apply, and it is stated on
    // `RuleEvaluationResult`: an explicit hide beats a show, whichever order they are in.
    const result = evaluateFormRules([show({ id: 'a' }), rule({ id: 'b' })], { status: 'archived' });
    expect(result.shownFields).toEqual(['city']);
    expect(result.hiddenFields).toEqual(['city']);
  });

  it('ignores a target with no id', () => {
    const result = evaluateFormRules([rule({ targets: [{ id: '', type: 'field' }] })], {
      status: 'archived',
    });
    expect(result.hiddenFields).toEqual([]);
  });
});

describe('priority', () => {
  it('applies ascending, so the highest number writes last and wins', () => {
    const message = (priority: number, value: string) =>
      rule({ priority, action: { type: 'validation', value }, targets: [{ id: 'city', type: 'field' }] });

    const result = evaluateFormRules([message(10, 'from ten'), message(2, 'from two')], {
      status: 'archived',
    });
    expect(result.validationErrors['city']).toBe('from ten');
  });
});
