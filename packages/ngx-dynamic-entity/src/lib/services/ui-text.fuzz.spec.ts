import { DEFAULT_UI_TEXT, resolveUiText, type UiTextKey } from './ui-text.service';

/**
 * Property-based tests over generated overrides.
 *
 * `UI_TEXT` is the one token whose value is written by a *translator's* toolchain rather than
 * a developer's — a JSON catalogue, a spreadsheet export, a CMS. None of that is type-checked
 * at the boundary, and a missing entry is the normal case rather than the exceptional one.
 * Example-based tests cover the malformed shapes someone thought of; this generates thousands
 * and asserts the two invariants a template depends on: the call returns a string, and it is
 * never blank while an English default exists.
 *
 * Seeded and deterministic, printing the seed on failure — the same harness core uses, for
 * the same reason.
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

function pick<T>(r: () => number, items: T[]): T {
  return items[Math.floor(r() * items.length)];
}

const KEYS = Object.keys(DEFAULT_UI_TEXT) as UiTextKey[];

/** Keys a catalogue might carry that the library never publishes, plus the inherited ones. */
const STRANGE_KEYS = ['', ' ', 'toString', 'constructor', '__proto__', 'valueOf', 'save ', 'SAVE', 'noSuchKey'];

const NASTY: unknown[] = [
  undefined,
  null,
  '',
  0,
  -0,
  NaN,
  Infinity,
  false,
  true,
  [],
  {},
  [null],
  { en: undefined },
  { en: null },
  { de: '' },
  'a'.repeat(500),
  ' ',
  '<script>alert(1)</script>',
  '{unclosed',
  '{}',
  '{a}{b}{a}',
  String.fromCharCode(0),
  String.fromCharCode(27),
];

function generateOverrides(r: () => number): unknown {
  const shape = r();

  // A resolver, which is the form an existing i18n layer takes.
  if (shape < 0.2) {
    const mode = r();
    return (key: string, defaultText: string) => {
      if (mode < 0.15) throw new Error('catalogue not loaded');
      if (mode < 0.3) return undefined as unknown as string;
      if (mode < 0.45) return '';
      if (mode < 0.55) return pick(r, NASTY) as string;
      return `${defaultText}!${key.length}`;
    };
  }

  if (shape < 0.3) return pick(r, [undefined, null, {}, ...NASTY]);

  // A partial map, which is what a translation file exports.
  const map: Record<string, unknown> = {};
  const entries = Math.floor(r() * 8);
  for (let i = 0; i < entries; i++) {
    const key = r() < 0.25 ? pick(r, STRANGE_KEYS) : pick(r, KEYS);
    const value = r();
    map[key] =
      value < 0.35
        ? { en: `EN ${key}`, de: `DE ${key}` }
        : value < 0.5
          ? `flat ${key}`
          : value < 0.6
            ? { de: `DE only ${key}` }
            : pick(r, NASTY);
  }
  return map;
}

function generateCall(r: () => number): { overrides: unknown; key: string; language: string; params?: unknown } {
  return {
    overrides: generateOverrides(r),
    key: r() < 0.2 ? pick(r, STRANGE_KEYS) : pick(r, KEYS),
    language: pick(r, ['en', 'de', 'fr', '', 'zz', 'EN']),
    params: r() < 0.5 ? undefined : pick(r, [{}, { field: 'X' }, { count: 3 }, { fields: null }, NASTY[12]]),
  };
}

function forEachGenerated(count: number, body: (input: ReturnType<typeof generateCall>) => void): void {
  for (let seed = 1; seed <= count; seed++) {
    const input = generateCall(rng(seed));
    try {
      body(input);
    } catch (error) {
      const shown = { ...input, overrides: typeof input.overrides === 'function' ? '[resolver]' : input.overrides };
      throw new Error(
        `Failed at seed ${seed}\ninput: ${JSON.stringify(shown)?.slice(0, 800)}\n` + `cause: ${(error as Error).message}`,
      );
    }
  }
}

const RUNS = 1500;

describe('fuzz — UI text overrides are data, and may be any shape', () => {
  const call = (input: ReturnType<typeof generateCall>) =>
    resolveUiText(
      input.overrides as never,
      DEFAULT_UI_TEXT as Readonly<Record<string, string>>,
      input.key as UiTextKey,
      input.language,
      input.params as never,
    );

  it('always returns a string, never throws', () => {
    forEachGenerated(RUNS, input => {
      expect(typeof call(input)).toBe('string');
    });
  });

  it('never renders a blank control where English exists', () => {
    forEachGenerated(RUNS, input => {
      const published = Object.prototype.hasOwnProperty.call(DEFAULT_UI_TEXT, input.key);
      if (published) expect(call(input).length).toBeGreaterThan(0);
    });
  });

  it('is stable — the same input resolves the same way twice', () => {
    // A resolver is called once per label per change-detection pass. One that answered
    // differently on the second call would flicker rather than fail.
    forEachGenerated(RUNS, input => {
      if (typeof input.overrides === 'function') return;
      expect(call(input)).toBe(call(input));
    });
  });

  it('leaves no placeholder filled that the caller did not pass', () => {
    forEachGenerated(RUNS, input => {
      const text = call(input);
      const params = (input.params ?? {}) as Record<string, unknown>;
      for (const match of text.matchAll(/[{]([a-zA-Z0-9_]+)[}]/g)) {
        const name = match[1];
        const passed = Object.prototype.hasOwnProperty.call(params, name);
        // A placeholder still standing means it was not passed, or was passed as null —
        // never that a value was dropped.
        expect(!passed || params[name] === null || params[name] === undefined).toBe(true);
      }
    });
  });
});
