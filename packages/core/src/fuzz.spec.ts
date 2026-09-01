import {
  collectFieldScopes,
  ambiguousFieldIds,
  assignFieldRefs,
} from './field-scopes';
import {
  formatDisplayValue,
  getValueByPath,
  isUnsafePath,
  normalizeConfig,
  normalizeConfigOptions,
  setValueByPath,
} from './form-logic';
import { evaluateFormRules } from './rules-engine';
import { validateConfig } from './validate-config';
import type { EntityFormConfig } from './form-model.types';

/**
 * Property-based tests over generated input.
 *
 * Everything in this package parses data it did not create: configs come from a database, an
 * API, or a hand edit, and records outlive the schemas that shaped them. Example-based tests
 * only cover the malformed shapes someone thought of — this file generates thousands and
 * asserts the invariants that must hold whatever arrives.
 *
 * The generator is seeded and the seed is printed on failure, so a red run is reproducible
 * rather than a story about a bad afternoon. It is hand-rolled rather than pulled in: adding
 * a fuzzing dependency to a package that publishes none is a bigger decision than the tests
 * are worth, and the shapes here are specific to this schema anyway.
 */

/** Mulberry32 — small, fast, and deterministic from a 32-bit seed. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Values chosen to be awkward on purpose: the empty string and `0` are falsy but present,
 * `__proto__` is the prototype-pollution vector, and NaN breaks any comparison it touches.
 */
const NASTY: unknown[] = [
  undefined, null, '', 0, -0, NaN, Infinity, false, true,
  '__proto__', 'constructor', 'prototype',
  [], {}, [null], { en: undefined },
  'a'.repeat(500), ' ', '<script>', '../../etc/passwd', '1e999',
  // Control characters are worth generating and must not be *written* here: this repo
  // forbids them in source, and `check:chars` caught the literal NUL that was.
  String.fromCharCode(0), String.fromCharCode(27), String.fromCharCode(8),
];

function pick<T>(r: () => number, items: T[]): T {
  return items[Math.floor(r() * items.length)];
}

/** A config-shaped object that is only sometimes a valid config. */
function generateConfig(r: () => number, depth = 0): unknown {
  if (r() < 0.08) return pick(r, NASTY);

  const field = (): unknown => {
    if (r() < 0.15) return pick(r, NASTY);
    const f: Record<string, unknown> = {
      id: r() < 0.1 ? pick(r, NASTY) : `f${Math.floor(r() * 5)}`,
      type: r() < 0.2 ? pick(r, NASTY) : pick(r, ['text', 'dropdown', 'group', 'array', 'number', 'markdown']),
    };
    if (r() < 0.6) f['label'] = r() < 0.3 ? pick(r, NASTY) : { en: 'L' };
    if (r() < 0.3) f['options'] = r() < 0.5 ? pick(r, NASTY) : [{ en: 'A' }, pick(r, NASTY)];
    if (r() < 0.25) f['showWhen'] = { [`f${Math.floor(r() * 5)}`]: pick(r, NASTY) };
    if (r() < 0.2 && depth < 2) f['children'] = [field(), field()];
    if (r() < 0.15) f['validators'] = pick(r, NASTY);
    return f;
  };

  const tab = (d: number): unknown => {
    if (r() < 0.12) return pick(r, NASTY);
    const t: Record<string, unknown> = {
      id: r() < 0.1 ? pick(r, NASTY) : `t${Math.floor(r() * 4)}`,
      label: r() < 0.3 ? pick(r, NASTY) : { en: 'T' },
      fields: r() < 0.15 ? pick(r, NASTY) : Array.from({ length: Math.floor(r() * 4) }, field),
    };
    if (r() < 0.3) t['flatData'] = r() < 0.5;
    if (r() < 0.25 && d < 2) t['children'] = [tab(d + 1)];
    if (r() < 0.1) t['moduleName'] = pick(r, NASTY);
    return t;
  };

  return {
    entity: r() < 0.15 ? pick(r, NASTY) : 'generated',
    version: r() < 0.2 ? pick(r, NASTY) : 1,
    tabs: r() < 0.12 ? pick(r, NASTY) : Array.from({ length: Math.floor(r() * 4) }, () => tab(0)),
    permissions: r() < 0.2 ? pick(r, NASTY) : undefined,
  };
}

function generateRules(r: () => number): unknown[] {
  return Array.from({ length: Math.floor(r() * 3) }, () => {
    if (r() < 0.2) return pick(r, NASTY);
    return {
      id: `r${Math.floor(r() * 3)}`,
      fieldId: r() < 0.2 ? pick(r, NASTY) : `f${Math.floor(r() * 5)}`,
      enabled: r() < 0.8,
      priority: r() < 0.2 ? pick(r, NASTY) : Math.floor(r() * 3),
      conditions: [
        {
          operator: pick(r, ['EQUAL', 'NOT_EQUAL', 'CONTAINS', 'STARTS_WITH', 'GREATER_THAN', pick(r, NASTY)]),
          value: pick(r, NASTY),
          compareType: pick(r, ['value', 'field']),
          compareToField: `f${Math.floor(r() * 5)}`,
        },
      ],
      action: { type: pick(r, ['visibility', 'validation', 'info']), value: pick(r, NASTY) },
      targets: [{ id: `f${Math.floor(r() * 5)}`, type: pick(r, ['field', 'tab']) }],
    };
  });
}

/**
 * Runs `body` over generated input and, on the first failure, reports the seed and the
 * input that produced it. Without that a fuzz failure is unreproducible and gets retried
 * away rather than fixed.
 */
function forEachGenerated(
  count: number,
  make: (r: () => number) => unknown,
  body: (input: unknown) => void,
): void {
  for (let seed = 1; seed <= count; seed++) {
    const input = make(rng(seed));
    try {
      body(input);
    } catch (error) {
      throw new Error(
        `Failed at seed ${seed}\ninput: ${JSON.stringify(input)?.slice(0, 800)}\n` +
          `cause: ${(error as Error).message}`,
      );
    }
  }
}

/**
 * Runs per property. Seeds are 1..RUNS and deterministic, so this is a fixed body of work
 * rather than a lottery — raising it widens what is covered permanently, and every failure
 * stays reproducible from the seed it prints.
 */
const RUNS = 1500;

describe('fuzz — a config is data, and may be any shape', () => {
  it('validateConfig always returns issues rather than throwing', () => {
    forEachGenerated(RUNS, generateConfig, input => {
      const issues = validateConfig(input as EntityFormConfig);
      expect(Array.isArray(issues)).toBe(true);
      for (const issue of issues) {
        expect(typeof issue.message).toBe('string');
        expect(['error', 'warning']).toContain(issue.level);
      }
    });
  });

  it('validateConfig accepts arbitrary rules alongside an arbitrary config', () => {
    forEachGenerated(RUNS, r => ({ config: generateConfig(r), rules: generateRules(r) }), input => {
      const { config, rules } = input as { config: unknown; rules: unknown[] };
      expect(Array.isArray(validateConfig(config as EntityFormConfig, { rules: rules as never }))).toBe(true);
    });
  });

  it('normalizeConfig never throws and never invents a non-array tabs', () => {
    forEachGenerated(RUNS, generateConfig, input => {
      const config = normalizeConfig(input);
      if (config && typeof config === 'object' && 'tabs' in config) {
        expect(Array.isArray(config.tabs)).toBe(true);
      }
    });
  });

  it('normalizeConfigOptions never throws', () => {
    forEachGenerated(RUNS, generateConfig, input => {
      normalizeConfigOptions(input as EntityFormConfig);
    });
  });

  it('collectFieldScopes returns well-formed entries, or none', () => {
    forEachGenerated(RUNS, generateConfig, input => {
      for (const entry of collectFieldScopes(input as EntityFormConfig)) {
        expect(typeof entry.scope).toBe('string');
        expect(entry.field).toBeTruthy();
      }
    });
  });

  it('ambiguousFieldIds and assignFieldRefs survive anything collectFieldScopes does', () => {
    forEachGenerated(RUNS, generateConfig, input => {
      expect(ambiguousFieldIds(input as EntityFormConfig)).toBeInstanceOf(Map);
      assignFieldRefs(input as EntityFormConfig);
    });
  });

  it('evaluateFormRules always returns a complete result', () => {
    forEachGenerated(RUNS, r => ({ rules: generateRules(r), values: { f0: pick(r, NASTY), f1: pick(r, NASTY) } }), input => {
      const { rules, values } = input as { rules: unknown[]; values: Record<string, unknown> };
      const result = evaluateFormRules(rules as never, values);
      expect(Array.isArray(result.hiddenFields)).toBe(true);
      expect(Array.isArray(result.hiddenTabs)).toBe(true);
      expect(result.validationErrors).toBeTruthy();
    });
  });

  it('formatDisplayValue always returns a string', () => {
    forEachGenerated(RUNS, r => ({ type: pick(r, ['text', 'date', 'dropdown', 'multiSelect', 'boolean', 'time', pick(r, NASTY)]), raw: pick(r, NASTY) }), input => {
      const { type, raw } = input as { type: string; raw: unknown };
      expect(typeof formatDisplayValue(type, undefined, raw)).toBe('string');
    });
  });
});

describe('fuzz — nested record paths', () => {
  it('never writes through a path that could reach a prototype', () => {
    forEachGenerated(RUNS, r => ({
      path: [pick(r, ['a', '__proto__', 'constructor', 'b.c', 'prototype', 'x.__proto__.y'])].join(''),
      value: pick(r, NASTY),
    }), input => {
      const { path, value } = input as { path: string; value: unknown };
      const target: Record<string, unknown> = {};
      setValueByPath(target, path, value);

      // Whatever happened, no bare object may have gained a property.
      expect(({} as Record<string, unknown>)['y']).toBeUndefined();
      expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
      if (isUnsafePath(path)) expect(Object.keys(target)).toHaveLength(0);
    });
  });

  it('reads back what it wrote for safe paths', () => {
    forEachGenerated(RUNS, r => ({
      path: ['a', 'a.b', 'a.b.c', 'x'][Math.floor(r() * 4)],
      value: pick(r, NASTY),
    }), input => {
      const { path, value } = input as { path: string; value: unknown };
      const target: Record<string, unknown> = {};
      setValueByPath(target, path, value);
      const read = getValueByPath(target, path);
      // NaN is never equal to itself, so compare it by shape rather than by value.
      if (typeof value === 'number' && Number.isNaN(value)) expect(Number.isNaN(read as number)).toBe(true);
      else expect(read).toEqual(value);
    });
  });

  it('reading an arbitrary path never throws', () => {
    forEachGenerated(RUNS, r => ({ obj: generateConfig(r), path: pick(r, ['a', 'a.b', '__proto__.x', '', 'tabs.0.fields']) }), input => {
      const { obj, path } = input as { obj: unknown; path: string };
      getValueByPath(obj, path);
    });
  });
});
