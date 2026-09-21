/**
 * The checks `validateConfig` did not have.
 *
 * Every case here is a config that returned zero problems and then misbehaved at runtime —
 * a regex that throws while the control is built, a uniqueness check that quietly never
 * runs, a field that can never hold a value.
 */
import type { EntityFormConfig, FormRule, NestedFieldConfig } from './form-model.types';
import { validateConfig } from './validate-config';

const wrap = (fields: NestedFieldConfig[], over: Partial<EntityFormConfig> = {}): EntityFormConfig => ({
  entity: 'employees',
  tabs: [{ id: 'personal', label: { en: 'Personal' }, fields }],
  ...over,
});

const text = (id: string, over: Partial<NestedFieldConfig> = {}): NestedFieldConfig => ({
  id,
  type: 'text',
  label: { en: id },
  ...over,
});

const errorsAt = (config: EntityFormConfig, path: string, options = {}) =>
  validateConfig(config, options).filter(p => p.level === 'error' && p.path.startsWith(path));

describe('validators.pattern', () => {
  it('reports an unparseable regex', () => {
    const config = wrap([text('code', { validators: { pattern: '[' } })]);
    const problems = errorsAt(config, 'tabs[0].fields[0].validators.pattern');
    expect(problems).toHaveLength(1);
    expect(problems[0].message).toContain('not a valid regular expression');
  });

  it('accepts a valid one', () => {
    const config = wrap([text('code', { validators: { pattern: '^[A-Z]{3}$' } })]);
    expect(errorsAt(config, 'tabs[0].fields[0].validators')).toEqual([]);
  });

  it('rejects a non-string pattern', () => {
    const config = wrap([text('code', { validators: { pattern: 7 as never } })]);
    expect(errorsAt(config, 'tabs[0].fields[0].validators.pattern')).toHaveLength(1);
  });
});

describe('bounds that contradict each other', () => {
  it('reports min greater than max', () => {
    const config = wrap([{ ...text('n'), type: 'number', validators: { min: 10, max: 1 } }]);
    expect(errorsAt(config, 'tabs[0].fields[0].validators')[0].message).toContain('no value can satisfy both');
  });

  it('reports minLength greater than maxLength', () => {
    const config = wrap([text('s', { validators: { minLength: 20, maxLength: 5 } })]);
    expect(errorsAt(config, 'tabs[0].fields[0].validators')).toHaveLength(1);
  });

  it('accepts equal bounds', () => {
    const config = wrap([text('s', { validators: { minLength: 5, maxLength: 5 } })]);
    expect(errorsAt(config, 'tabs[0].fields[0].validators')).toEqual([]);
  });
});

describe('defaultValue', () => {
  it('reports a string default on a number field', () => {
    const config = wrap([{ ...text('n'), type: 'number', defaultValue: '5' }]);
    expect(errorsAt(config, 'tabs[0].fields[0].defaultValue')[0].message).toContain('must be a number');
  });

  it('reports a string default on a boolean field', () => {
    const config = wrap([{ ...text('b'), type: 'boolean', defaultValue: 'true' }]);
    expect(errorsAt(config, 'tabs[0].fields[0].defaultValue')).toHaveLength(1);
  });

  it('leaves an absent default alone', () => {
    const config = wrap([{ ...text('n'), type: 'number' }]);
    expect(errorsAt(config, 'tabs[0].fields[0].defaultValue')).toEqual([]);
  });
});

describe('named validators', () => {
  const config = wrap([
    text('email', { validators: { custom: ['noDisposable'], customAsync: ['uniqueEmail'] } }),
  ]);

  it('says nothing when the caller does not list what is registered', () => {
    expect(errorsAt(config, 'tabs[0].fields[0].validators')).toEqual([]);
  });

  it('reports a name nothing will resolve', () => {
    const problems = errorsAt(config, 'tabs[0].fields[0].validators', { knownValidators: [] });
    expect(problems).toHaveLength(2);
    expect(problems.map(p => p.message).join(' ')).toContain('"noDisposable"');
  });

  it('says what an unresolved async validator costs', () => {
    const problems = errorsAt(config, 'tabs[0].fields[0].validators.customAsync', {
      knownValidators: ['noDisposable'],
    });
    expect(problems[0].message).toContain('duplicate');
  });

  it('accepts registered names', () => {
    const options = { knownValidators: ['noDisposable', 'uniqueEmail'] };
    expect(errorsAt(config, 'tabs[0].fields[0].validators', options)).toEqual([]);
  });

  it('accepts the built-ins the registry resolves on its own', () => {
    const builtIns = wrap([
      text('n', { validators: { custom: ['required', 'email', 'min:0', 'maxLength:255'] } }),
    ]);
    expect(errorsAt(builtIns, 'tabs[0].fields[0].validators', { knownValidators: [] })).toEqual([]);
  });

  it('rejects a parameterised built-in with a non-numeric argument', () => {
    const bad = wrap([text('n', { validators: { custom: ['min:abc'] } })]);
    expect(errorsAt(bad, 'tabs[0].fields[0].validators', { knownValidators: [] })).toHaveLength(1);
  });
});

describe('reserved ids', () => {
  it('reports a field named __proto__', () => {
    // It passes ID_PATTERN, and then every path guard in form-logic refuses to read or
    // write it: a field that renders, accepts input, and can never hold a value.
    const config = wrap([text('__proto__')]);
    expect(errorsAt(config, 'tabs[0].fields[0].id')[0].message).toContain('reserved object key');
  });

  it('reports a field named constructor', () => {
    expect(errorsAt(wrap([text('constructor')]), 'tabs[0].fields[0].id')).toHaveLength(1);
  });

  it('reports a tab named prototype', () => {
    const config: EntityFormConfig = {
      entity: 'employees',
      tabs: [{ id: 'prototype', label: { en: 'P' }, fields: [text('a')] }],
    };
    expect(errorsAt(config, 'tabs[0].id')).toHaveLength(1);
  });
});

describe('prototype-reaching mappings', () => {
  it('reports an autoPatch target that names a reserved key', () => {
    const config = wrap([
      text('company', {
        autoPatch: { targetTab: 'personal', mappings: [{ source: 'name', target: '__proto__' }] },
      }),
    ]);
    expect(errorsAt(config, 'tabs[0].fields[0].autoPatch')[0].message).toContain('reserved object key');
  });

  it('reports a patchOnTrue destination that names a reserved key', () => {
    const config = wrap([
      text('sameAsPostal', { patchOnTrue: [{ from: 'company', to: 'constructor' }] }),
      text('company'),
    ]);
    const problems = errorsAt(config, 'tabs[0].fields[0].patchOnTrue[0].to');
    expect(problems.some(p => p.message.includes('reserved object key'))).toBe(true);
  });
});

describe('options', () => {
  it('warns when two options read the same in the active language', () => {
    const config = wrap([
      { ...text('status'), type: 'dropdown', options: [{ en: 'Open' }, { en: 'Open', de: 'Offen' }] },
    ]);
    const warnings = validateConfig(config).filter(p => p.level === 'warning' && p.path.includes('options'));
    expect(warnings).toHaveLength(1);
    expect(warnings[0].message).toContain('cannot say which was picked');
  });

  it('does not warn when they differ in the active language', () => {
    const config = wrap(
      [{ ...text('status'), type: 'dropdown', options: [{ en: 'Open', de: 'X' }, { en: 'Closed', de: 'X' }] }],
    );
    const warnings = validateConfig(config).filter(p => p.level === 'warning' && p.path.includes('options'));
    expect(warnings).toEqual([]);
  });

  it('reports a duplicate option key', () => {
    const config = wrap([
      {
        ...text('status'),
        type: 'dropdown',
        options: [
          { $key: 'open', en: 'Open' },
          { $key: 'open', en: 'Closed' },
        ],
      },
    ]);
    expect(errorsAt(config, 'tabs[0].fields[0].options[1].$key')[0].message).toContain('Duplicate option key');
  });

  it('reports a reserved $-prefixed key other than $key', () => {
    const config = wrap([
      { ...text('status'), type: 'dropdown', options: [{ $id: 'open', en: 'Open' } as never] },
    ]);
    expect(errorsAt(config, 'tabs[0].fields[0].options[0].$id')).toHaveLength(1);
  });

  it('reports an option that is not an object', () => {
    const config = wrap([{ ...text('status'), type: 'dropdown', options: ['Open' as never] }]);
    expect(errorsAt(config, 'tabs[0].fields[0].options[0]')).toHaveLength(1);
  });
});

describe('rule shape', () => {
  const base: FormRule = {
    formConfigId: 'employees',
    fieldId: 'status',
    conditions: [{ operator: 'EQUAL', compareType: 'value', value: 'x' }],
    action: { type: 'visibility', value: false },
    targets: [{ id: 'status', type: 'field' }],
    enabled: true,
    priority: 1,
  };
  const config = wrap([{ ...text('status'), type: 'dropdown', options: [{ en: 'Open' }] }]);

  it('accepts a well-formed rule', () => {
    expect(errorsAt(config, 'rules', { rules: [base] })).toEqual([]);
  });

  it('reports missing conditions', () => {
    // `rule.conditions?.forEach` validated this clean — for exactly the shape that used to
    // throw inside change detection.
    const rules = [{ ...base, conditions: undefined as never }];
    expect(errorsAt(config, 'rules[0].conditions')).toHaveLength(0);
    expect(errorsAt(config, 'rules[0].conditions', { rules })).toHaveLength(1);
  });

  it('reports non-array targets', () => {
    const rules = [{ ...base, targets: 'status' as never }];
    expect(errorsAt(config, 'rules[0].targets', { rules })).toHaveLength(1);
  });

  it('reports a missing action', () => {
    const rules = [{ ...base, action: undefined as never }];
    expect(errorsAt(config, 'rules[0].action', { rules })).toHaveLength(1);
  });

  it('warns that a validation action on a tab does nothing', () => {
    const rules: FormRule[] = [
      { ...base, action: { type: 'validation', value: 'nope' }, targets: [{ id: 'personal', type: 'tab' }] },
    ];
    const warnings = validateConfig(config, { rules }).filter(p => p.level === 'warning');
    expect(warnings.some(w => w.message.includes('only "visibility"'))).toBe(true);
  });
});
