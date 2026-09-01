import { ambiguousFieldIds, collectFieldScopes, parseFieldRef } from './field-scopes';
import { evaluateCondition, evaluateFormRules } from './rules-engine';
import { migrateRecord } from './migration';
import type { EntityFormConfig, FormRule } from './form-model.types';

/**
 * The defensive branches across core.
 *
 * Everything here answers the same question — what happens when the input is not what the
 * signature promises — because config and records both arrive as data, from storage, an API,
 * or a hand edit. A guard that has never been executed is a guess.
 */
describe('field scopes with malformed input', () => {
  it('skips entries that are not objects instead of throwing', () => {
    const config = {
      entity: 'x',
      tabs: [
        null,
        { id: 'main', label: { en: 'Main' }, fields: [null, { id: 'ok', type: 'text', label: { en: 'Ok' } }] },
      ],
    };
    const entries = collectFieldScopes(config as never);
    // The one real field survives; the malformed neighbours are simply absent.
    expect(entries.map(e => e.field.id)).toEqual(['ok']);
  });

  it('ignores a field with no id when looking for ambiguity', () => {
    const config = {
      entity: 'x',
      tabs: [{ id: 'main', label: { en: 'Main' }, fields: [{ type: 'text', label: { en: 'No id' } }] }],
    };
    expect(ambiguousFieldIds(config as never).size).toBe(0);
  });

  it('treats an empty or absent reference as naming nothing', () => {
    // A rule saved with a cleared field picker holds '' — it must not resolve to a field.
    expect(parseFieldRef('   ').value).toBe('');
    expect(parseFieldRef(undefined as never).value).toBe('');
  });
});

describe('rules engine — string operators', () => {
  const cond = (operator: string, value: unknown) =>
    ({ operator, value, compareType: 'value' }) as never;

  const matches = (operator: string, value: unknown, actual: unknown): boolean =>
    evaluateCondition(cond(operator, value), actual, {});

  it('matches CONTAINS and its negation on strings', () => {
    expect(matches('CONTAINS', 'urgent', 'this is urgent')).toBe(true);
    expect(matches('CONTAINS', 'urgent', 'routine')).toBe(false);
    expect(matches('NOT_CONTAINS', 'urgent', 'routine')).toBe(true);
    expect(matches('NOT_CONTAINS', 'urgent', 'this is urgent')).toBe(false);
  });

  it('matches STARTS_WITH', () => {
    expect(matches('STARTS_WITH', 'CLM', 'CLM-2026-1')).toBe(true);
    expect(matches('STARTS_WITH', 'CLM', 'X-CLM-1')).toBe(false);
  });

  it('does not match a string operator against a non-string value', () => {
    // A number cannot contain a substring, and coercing one would make 42 contain "2".
    expect(matches('CONTAINS', '2', 42)).toBe(false);
    expect(matches('STARTS_WITH', '4', 42)).toBe(false);
  });

  it('compares against another field when asked to', () => {
    const condition = { operator: 'EQUAL', compareType: 'field', compareToField: 'other' } as never;
    expect(evaluateCondition(condition, 'x', { other: 'x' })).toBe(true);
    expect(evaluateCondition(condition, 'x', { other: 'y' })).toBe(false);
  });
});

describe('rules engine — evaluation', () => {
  // The action lives on the rule; a target only names what the action applies to.
  const rule = (over: Record<string, unknown> = {}): FormRule =>
    ({
      id: 'r1',
      formConfigId: 'x',
      fieldId: 'note',
      conditions: [{ operator: 'CONTAINS', value: 'urgent', compareType: 'value' }],
      action: { type: 'visibility', value: false },
      targets: [{ id: 'target', type: 'field' }],
      enabled: true,
      priority: 0,
      ...over,
    }) as unknown as FormRule;

  it('hides a field when the rule matches', () => {
    expect(evaluateFormRules([rule()], { note: 'this is urgent' }).hiddenFields).toContain('target');
  });

  it('leaves the field alone when the rule does not match', () => {
    expect(evaluateFormRules([rule()], { note: 'routine' }).hiddenFields).not.toContain('target');
  });

  it('hides a whole tab when the target is one', () => {
    const tabRule = rule({ targets: [{ id: 'secrets', type: 'tab' }] });
    expect(evaluateFormRules([tabRule], { note: 'urgent' }).hiddenTabs).toContain('secrets');
  });

  it('ignores a disabled rule', () => {
    // Disabling is how an author parks a rule without deleting it.
    expect(evaluateFormRules([rule({ enabled: false })], { note: 'urgent' }).hiddenFields).toEqual([]);
  });

  it('returns an empty result for no rules at all', () => {
    for (const input of [undefined, null, []]) {
      const result = evaluateFormRules(input as never, {});
      expect(result.hiddenFields).toEqual([]);
      expect(result.hiddenTabs).toEqual([]);
    }
  });

  it('records a validation error and a warning under their target', () => {
    const err = rule({ action: { type: 'validation', value: 'Too risky', severity: 'error' } });
    const warn = rule({ action: { type: 'validation', value: 'Check this', severity: 'warning' } });

    expect(evaluateFormRules([err], { note: 'urgent' }).validationErrors['target']).toBe('Too risky');
    expect(evaluateFormRules([warn], { note: 'urgent' }).validationWarnings['target']).toBe('Check this');
  });

  it('renders an info banner with no message as blank, not "undefined"', () => {
    const banner = rule({ action: { type: 'info' } });
    // The author cleared the text; a banner reading "undefined" is worse than an empty one.
    expect(evaluateFormRules([banner], { note: 'urgent' }).infoBanners['target']).toBe('');
  });
});

describe('record migration', () => {
  const config: EntityFormConfig = {
    entity: 'clients',
    version: 3,
    tabs: [{ id: 'main', label: { en: 'Main' }, fields: [{ id: 'name', type: 'text', label: { en: 'Name' } }] }],
  };

  it('leaves a record that is already current alone', () => {
    const record = { _configVersion: 3, main: { name: 'Ada' } };
    const result = migrateRecord(record, config, []);
    expect(result.applied).toEqual([]);
    expect(result.record).toEqual(record);
  });

  it('runs a registered migration and stamps the new version', () => {
    const result = migrateRecord({ _configVersion: 2, main: { name: 'Ada' } }, config, [
      {
        from: 2,
        to: 3,
        migrate: (r: Record<string, any>) => ({ ...r, main: { name: String(r['main'].name).toUpperCase() } }),
      },
    ]);
    expect(result.applied).toEqual([3]);
    expect(result.record['main'].name).toBe('ADA');
    expect(result.record['_configVersion']).toBe(3);
  });

  it('chains steps to cross more than one version', () => {
    const result = migrateRecord({ _configVersion: 1, main: { name: 'a' } }, config, [
      { from: 1, to: 2, migrate: (r: Record<string, any>) => ({ ...r, step1: true }) },
      { from: 2, to: 3, migrate: (r: Record<string, any>) => ({ ...r, step2: true }) },
    ]);
    expect(result.applied).toEqual([2, 3]);
    expect(result.record['step1']).toBe(true);
    expect(result.record['step2']).toBe(true);
  });

  it('refuses a gap it has no migration for, rather than upgrading halfway', () => {
    // A partial upgrade would leave the record stamped as something it is not, and the next
    // run would skip the steps it still needs.
    expect(() => migrateRecord({ _configVersion: 1 }, config, [])).toThrow(/No migration from config version 1/);
  });

  it('names the entity in that error, so the failing config is identifiable', () => {
    expect(() => migrateRecord({ _configVersion: 1 }, config, [])).toThrow(/clients/);
  });

  it('refuses a migration that overshoots the config version', () => {
    expect(() =>
      migrateRecord({ _configVersion: 2 }, config, [
        { from: 2, to: 9, migrate: (r: Record<string, any>) => r },
      ]),
    ).toThrow(/overshoots/);
  });

  it('does not migrate a record that carries no version', () => {
    // Records written before versioning existed have no stamp; guessing one could run a
    // migration twice over the same data.
    const result = migrateRecord({ main: { name: 'Ada' } }, config, []);
    expect(result.applied).toEqual([]);
    expect(result.from).toBeNull();
  });
});
