/**
 * Every problem DE emits carries a code, and every exported code is emitted by something.
 *
 * Covers `validateConfig` (`validate-config.ts`) and `validateMappingPlan` (`import-columns.ts`),
 * whose `add` helpers take the code as a required argument, against:
 * - one deliberately broken config or plan per check (`test-fixtures/problem-fixtures.ts`);
 * - the moved-container configs;
 * - every config the repository ships, as JSON. The demo's TypeScript `DEMO_RULES` need a built
 *   core, so they are checked in `server/src/shipped-configs.spec.ts`. Those configs emit no
 *   problems today, so that check is a guard; the broken fixtures are the coverage.
 *
 * The `formatConfigProblems` snapshot holds the printed form of every case. It was checked equal
 * to 2.3.1's output when it was written. 2.4 then changes exactly one message: the legacy-ref
 * warning says the alias lasts "until 4.0" rather than "until 3.0" (Decision 3).
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { CONFIG_CASES, MOVED_CONTAINER_CONFIGS, PLAN_CASES } from '../test-fixtures/problem-fixtures';
import { validateMappingPlan } from './import-columns';
import { CONFIG_PROBLEM_CODES, PLAN_PROBLEM_CODES } from './problem-codes';
import { formatConfigProblems, validateConfig, type ConfigProblem } from './validate-config';
import type { EntityFormConfig, FormRule } from './form-model.types';

const ROOT = join(__dirname, '..', '..', '..');
const read = (path: string): unknown => JSON.parse(readFileSync(path, 'utf8'));
const rulesOf = (config: EntityFormConfig): FormRule[] => {
  const raw = (config as unknown as Record<string, unknown>)['rules'];
  return Array.isArray(raw) ? (raw as FormRule[]) : [];
};

const DEMO = join(ROOT, 'packages', 'demo-angular', 'src', 'app', 'mock', 'configs');
const SHIPPED: [string, EntityFormConfig][] = [
  ...(read(join(ROOT, 'test_data.json')) as EntityFormConfig[]).map(
    config => [`test_data.json ${config.entity}`, config] as [string, EntityFormConfig],
  ),
  ...readdirSync(DEMO)
    .filter(name => name.endsWith('.json'))
    .map(name => [`demo ${name}`, read(join(DEMO, name)) as EntityFormConfig] as [string, EntityFormConfig]),
];

const configProblems = (c: (typeof CONFIG_CASES)[number]): ConfigProblem[] =>
  validateConfig(c.config as EntityFormConfig, c.options);
const planProblems = (c: (typeof PLAN_CASES)[number]): ConfigProblem[] =>
  validateMappingPlan(c.plan as never, c.config);

const KNOWN = new Set<string>([...CONFIG_PROBLEM_CODES, ...PLAN_PROBLEM_CODES]);

describe('each check emits its code', () => {
  it.each(CONFIG_CASES.map(c => [c.name, c] as const))('%s', (_name, c) => {
    expect(configProblems(c).map(problem => problem.code)).toContain(c.code);
  });

  it.each(PLAN_CASES.map(c => [c.name, c] as const))('%s', (_name, c) => {
    expect(planProblems(c).map(problem => problem.code)).toContain(c.code);
  });
});

describe('every code is emitted by something', () => {
  it.each([...CONFIG_PROBLEM_CODES])('%s', code => {
    expect(CONFIG_CASES.some(c => c.code === code && configProblems(c).some(p => p.code === code))).toBe(true);
  });

  it.each([...PLAN_PROBLEM_CODES])('%s', code => {
    expect(PLAN_CASES.some(c => c.code === code && planProblems(c).some(p => p.code === code))).toBe(true);
  });
});

describe('every problem DE emits has an exported code', () => {
  const uncoded = (problems: ConfigProblem[]) => problems.filter(problem => !problem.code || !KNOWN.has(problem.code));

  it('across the broken fixtures', () => {
    expect(CONFIG_CASES.flatMap(configProblems).filter(p => !p.code || !KNOWN.has(p.code))).toEqual([]);
    expect(PLAN_CASES.flatMap(planProblems).filter(p => !p.code || !KNOWN.has(p.code))).toEqual([]);
  });

  it.each(MOVED_CONTAINER_CONFIGS.map(([name, config]) => [name, config] as const))(
    'across the moved-container config: %s',
    (_name, config) => {
      expect(uncoded(validateConfig(config))).toEqual([]);
    },
  );

  it('finds the configs the repository ships', () => {
    expect(SHIPPED.length).toBeGreaterThanOrEqual(13);
  });

  it.each(SHIPPED)('across the shipped config: %s', (_name, config) => {
    expect(uncoded(validateConfig(config, { rules: rulesOf(config), additionalFieldTypes: ['nps'] }))).toEqual([]);
  });
});

describe('formatConfigProblems', () => {
  // The printed form is what the CLI and the renderer's error banner show, and it carries no
  // code. Pinned so that adding codes, or any later change, cannot alter it unnoticed.
  it('prints every case as it always has', () => {
    const printed = [
      ...CONFIG_CASES.map(c => `# ${c.name}\n${formatConfigProblems(configProblems(c))}`),
      ...PLAN_CASES.map(c => `# ${c.name}\n${formatConfigProblems(planProblems(c))}`),
    ].join('\n');
    expect(printed).toMatchSnapshot();
  });
});
