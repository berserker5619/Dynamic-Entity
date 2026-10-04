/**
 * Every config this repository ships validates clean, rules included.
 *
 * `test_data.json` carried `EQUALS` and `GREATER_THAN` for two releases. Neither is an
 * operator, so `evaluateCondition` returned `false` and both rules were dead the whole time —
 * and nothing failed, because nothing ran `validateConfig` over the rules. This does, so the
 * next typo fails `npm test` instead of silently disabling a rule.
 *
 * It lives here rather than in core because it imports the demo's `DEMO_RULES`, a TypeScript
 * module that imports core's types: this package's tests run against a built core, and
 * core's own tests do not.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { formatConfigProblems, validateConfig, type EntityFormConfig, type FormRule } from '@dynamic-entity/core';
import { DEMO_RULES } from '../../demo-angular/src/app/mock/demo-rules';

const ROOT = join(__dirname, '..', '..', '..');
const DEMO_CONFIGS = join(ROOT, 'packages', 'demo-angular', 'src', 'app', 'mock', 'configs');

/** The demo registers one custom type (`extensions-entity.ts`); a real host passes its own. */
const ADDITIONAL_FIELD_TYPES = ['nps'];

const read = (path: string): unknown => JSON.parse(readFileSync(path, 'utf8'));

/** `rules` rides on the JSON beside the config; `EntityFormConfig` does not declare it. */
function rulesOf(config: EntityFormConfig): FormRule[] {
  const raw = (config as unknown as Record<string, unknown>)['rules'];
  return Array.isArray(raw) ? (raw as FormRule[]) : [];
}

const testData = (read(join(ROOT, 'test_data.json')) as EntityFormConfig[]).map(
  config => [`test_data.json ${config.entity}`, config, rulesOf(config)] as const,
);
const demoConfigs = readdirSync(DEMO_CONFIGS)
  .filter(name => name.endsWith('.json'))
  .map(name => {
    const config = read(join(DEMO_CONFIGS, name)) as EntityFormConfig;
    return [`demo ${name}`, config, [...rulesOf(config), ...(DEMO_RULES[config.entity] ?? [])]] as const;
  });

describe('every shipped config', () => {
  it('finds the configs it is meant to check', () => {
    expect(testData.length).toBeGreaterThanOrEqual(7);
    expect(demoConfigs.length).toBeGreaterThanOrEqual(6);
  });

  // A rule in DEMO_RULES for an entity with no config would never be validated below.
  it('has a config for every entity DEMO_RULES names', () => {
    const entities = new Set(demoConfigs.map(([, config]) => config.entity));
    expect(Object.keys(DEMO_RULES).filter(entity => !entities.has(entity))).toEqual([]);
  });

  it.each([...testData, ...demoConfigs])('%s validates with no errors', (_name, config, rules) => {
    const errors = validateConfig(config, { rules, additionalFieldTypes: ADDITIONAL_FIELD_TYPES }).filter(
      problem => problem.level === 'error',
    );
    // The formatted text is the useful failure message: it names the path and the reason.
    expect(formatConfigProblems(errors)).toBe('');
  });
});
