import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_UI_TEXT } from './ui-text.service';

/**
 * Every published key is rendered by something, and every rendered key is published.
 *
 * The defect this guards is the one that started the work: a template holding an English
 * literal that no token could reach. Nothing fails when that happens — the button renders,
 * the tests pass, and a host that configured a translation simply never sees it on that one
 * control out of fifty.
 *
 * A key with no call site is the same fault seen from the other end: a string was added to
 * the map and the template it was written for still holds its literal, or the template
 * changed and the key is now dead weight in a translator's file.
 *
 * This reads the source rather than rendering, deliberately: rendering every key would mean
 * driving every component into every state, and the states nobody thinks to drive are the
 * ones where a literal survives.
 */
describe('the published UI text keys and the templates agree', () => {
  const LIB = join(__dirname, '..');
  const CALL = 'ui.text(';

  function sources(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) return sources(full);
      if (!/\.(ts|html)$/.test(entry.name) || entry.name.includes('.spec.')) return [];
      return [readFileSync(full, 'utf8')];
    });
  }

  /**
   * The keys named in one call's first argument.
   *
   * A regex is not enough: the argument is sometimes a ternary whose condition is itself a
   * call — `ui.text(isFieldLocked(f) ? 'unlockField' : 'lockField', language)` — so the scan
   * tracks parentheses and stops at the comma that ends the argument, not the first one it
   * meets.
   */
  function keysInArgument(source: string, from: number): string[] {
    const keys: string[] = [];
    let depth = 0;
    for (let i = from; i < source.length; i++) {
      const ch = source[i];
      if (ch === '(') depth++;
      else if (ch === ')') {
        if (depth === 0) break;
        depth--;
      } else if (ch === ',' && depth === 0) break;
      else if (ch === "'") {
        const end = source.indexOf("'", i + 1);
        if (end === -1) break;
        keys.push(source.slice(i + 1, end));
        i = end;
      }
    }
    return keys;
  }

  const all = sources(LIB);

  /** Keys named literally at a call site. */
  const called = new Set<string>();
  for (const source of all) {
    for (let at = source.indexOf(CALL); at !== -1; at = source.indexOf(CALL, at + 1)) {
      for (const key of keysInArgument(source, at + CALL.length)) called.add(key);
    }
  }

  /**
   * Keys named anywhere in a component, which covers the ones chosen a line above the call:
   * `const key = isNew ? 'addRowTitle' : 'editRowTitle'; return this.ui.text(key, …)`. A
   * looser signal, and deliberately so — it is only used to *excuse* a key from the dead-key
   * check, where a false alarm would train people to ignore the test.
   */
  const named = new Set(called);
  for (const key of Object.keys(DEFAULT_UI_TEXT)) {
    if (all.some(source => source.includes(`'${key}'`))) named.add(key);
  }

  it('finds the call sites at all, so a passing sweep means something', () => {
    expect(called.size).toBeGreaterThan(30);
  });

  it('renders every key it publishes', () => {
    expect(Object.keys(DEFAULT_UI_TEXT).filter(key => !named.has(key))).toEqual([]);
  });

  it('publishes every key it renders', () => {
    // The template type-checker catches this during a build; this reports it by name in a
    // test run, which is where someone adding a string is actually looking.
    const published = new Set(Object.keys(DEFAULT_UI_TEXT));
    expect([...called].filter(key => !published.has(key))).toEqual([]);
  });
});
