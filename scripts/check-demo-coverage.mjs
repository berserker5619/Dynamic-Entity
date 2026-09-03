#!/usr/bin/env node
/**
 * Fail the build when a documented extension point has no demo that uses it.
 *
 * Why this exists: eleven of the twenty published extension points shipped with nothing in
 * the demo wiring them, and three of those eleven were the *newest* public API in the
 * project. Nothing failed when that happened. The unit suites cover each token in isolation,
 * the demo is the only Playwright surface there is, and so a token the demo does not wire has
 * no end-to-end evidence at all — a state that is invisible until somebody asks the question.
 *
 * This asks it on every build. A token added later fails on the day it ships rather than the
 * day someone next goes looking.
 *
 * It reads source rather than rendering anything, in the same spirit as
 * `ui-text-reaches-templates.spec.ts` in the renderer package: rendering every extension
 * point would mean driving every state, and the states nobody thinks to drive are exactly the
 * ones where a point goes unused.
 *
 * The check is "referenced somewhere under the demo's source", which is weaker than "proven
 * by a test". It is deliberately the weaker check — the strong one is the Playwright suite,
 * and this exists to make sure the Playwright suite has something to bite on.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = process.cwd();
const RENDERER_TOKENS = join(ROOT, 'packages/ngx-dynamic-entity/src/lib/tokens/injection-tokens.ts');
const RENDERER_CONFIG = join(ROOT, 'packages/ngx-dynamic-entity/src/lib/providers/provide-ngx-dynamic-entity.ts');
const CORE_SRC = join(ROOT, 'packages/core/src');
const DEMO_SRC = join(ROOT, 'packages/demo-angular/src');

/**
 * Points the demo deliberately does not wire, each with the reason.
 *
 * An allowlist rather than a silent omission: "we chose not to" and "nobody noticed" look
 * identical in a passing build, and only one of them is acceptable. Adding an entry here is a
 * decision someone has to write down.
 */
const DELIBERATELY_UNDEMONSTRATED = {
  FIELD_TYPE_REGISTRY:
    'The consumer *override* map, and the option that fills it. The demo registers its ' +
    'custom type through provideFieldTypes instead: that is the composable seam — several ' +
    'calls merge, later sets win — and it is what keeps unregistered field components out ' +
    'of the bundle. Demonstrating the override map as well would only show a second way to ' +
    'do the same thing, with worse tree-shaking.',
  fieldTypes: 'See FIELD_TYPE_REGISTRY — the same decision, seen from the option side.',
  FIELD_TYPE_SETS:
    'The multi-provider behind provideFieldTypes/provideBuiltInFieldTypes. The demo calls ' +
    'both; naming the token directly is not something a consumer should ever need to do.',
  MASKED_ROLES:
    'Provided through provideNgxDynamicEntity({ maskedRoles }), which the demo does. The ' +
    'token is the plumbing under that option.',
  ENTITY_REF_REGISTRY: 'Plumbing under provideNgxDynamicEntity({ entityRefs }), which the demo uses.',
  LOOKUP_REGISTRY: 'Plumbing under provideNgxDynamicEntity({ lookups }), which the demo uses.',
  VALIDATION_MESSAGES: 'Plumbing under provideNgxDynamicEntity({ validationMessages }), which the demo uses.',
  VALIDATOR_REGISTRY: 'Plumbing under provideNgxDynamicEntity({ validators }), which the demo uses.',
  ASYNC_VALIDATOR_REGISTRY: 'Plumbing under provideNgxDynamicEntity({ asyncValidators }), which the demo uses.',
  HOOK_REGISTRY: 'Plumbing under provideNgxDynamicEntity({ hooks }), which the demo uses.',
  RECORD_MIGRATIONS: 'Plumbing under provideNgxDynamicEntity({ migrations }), which the demo uses.',
  UI_TEXT: 'Plumbing under provideNgxDynamicEntity({ uiText }), which the demo uses.',
  setValueByPath:
    'A path utility, not an extension point. It is caught by the `set*` naming rule below ' +
    'and named here so the rule can stay automatic — an exception written down beats a ' +
    'cleverer rule nobody can predict.',
  setTabData: 'A record-shape utility, not an extension point. See setValueByPath.',
};

/** Every `.ts` / `.html` file under a directory, excluding specs. */
function sources(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...sources(full));
    else if (/\.(ts|html)$/.test(entry) && !entry.includes('.spec.')) out.push(full);
  }
  return out;
}

/** Names exported as an `InjectionToken` by the renderer package. */
function publishedTokens() {
  const source = readFileSync(RENDERER_TOKENS, 'utf8');
  const names = [];
  const pattern = /export const (\w+) = new InjectionToken/g;
  for (let m = pattern.exec(source); m; m = pattern.exec(source)) names.push(m[1]);
  return names;
}

/**
 * The option keys of `NgxDynamicEntityConfig`.
 *
 * Read from the interface body rather than from a hand-kept list, so an option added to the
 * provider function is covered without this file being edited.
 */
function configOptions() {
  const source = readFileSync(RENDERER_CONFIG, 'utf8');
  const start = source.indexOf('export interface NgxDynamicEntityConfig {');
  if (start === -1) throw new Error('Could not find NgxDynamicEntityConfig — has it been renamed?');
  const body = source.slice(start, source.indexOf('\n}', start));
  const keys = [];
  const pattern = /^ {2}(\w+)\?:/gm;
  for (let m = pattern.exec(body); m; m = pattern.exec(body)) keys.push(m[1]);
  return keys;
}

/**
 * Core's module-level configuration functions.
 *
 * Not every extension point is an injection token. `setDateFormatters` and
 * `registerFieldType` are plain functions, because the code that reads them is framework
 * agnostic and has no injector — and being outside the DI graph is exactly why they are the
 * easiest kind to ship without a demo. Both shipped that way.
 *
 * The rule is the naming convention core already follows: an exported `set*` or `register*`.
 * It over-matches two path utilities, which are on the allowlist above.
 */
function coreConfigFunctions() {
  const names = [];
  for (const file of sources(CORE_SRC)) {
    const pattern = /^export function ((?:set|register)\w+)/gm;
    const source = readFileSync(file, 'utf8');
    for (let m = pattern.exec(source); m; m = pattern.exec(source)) names.push(m[1]);
  }
  return names;
}

/**
 * The same source with comments removed.
 *
 * Without this the check is satisfied by prose. "`MASKED_PLACEHOLDER` is presentation, see
 * SECURITY.md" in a doc comment would answer for the token as convincingly as providing it —
 * and "documented but not used" is the exact state this whole guard exists to detect, so
 * accepting a comment as evidence would make it agree with the thing it is checking.
 *
 * String and template literals are skipped, so a `'blob://…'` inside one is not mistaken for
 * the start of a line comment. `<!-- … -->` goes first, because a template's comments explain
 * its bindings and would otherwise answer for the tokens they name.
 */
function stripComments(source) {
  source = source.replace(/<!--[\s\S]*?-->/g, '');
  let out = '';
  for (let i = 0; i < source.length; i++) {
    const two = source.slice(i, i + 2);
    if (two === '//') {
      const nl = source.indexOf('\n', i);
      i = nl === -1 ? source.length : nl - 1;
    } else if (two === '/*') {
      const end = source.indexOf('*/', i + 2);
      i = end === -1 ? source.length : end + 1;
    } else if (source[i] === '"' || source[i] === "'" || source[i] === '`') {
      const quote = source[i];
      out += source[i];
      for (i++; i < source.length; i++) {
        out += source[i];
        if (source[i] === '\\') {
          out += source[++i] ?? '';
          continue;
        }
        if (source[i] === quote) break;
      }
    } else {
      out += source[i];
    }
  }
  return out;
}

const demoFiles = sources(DEMO_SRC);
/** Per file, so `usedIn` reports the same set the match was made against. */
const demoCode = new Map(demoFiles.map(file => [file, stripComments(readFileSync(file, 'utf8'))]));
const demoSource = [...demoCode.values()].join('\n');

/**
 * Just the argument to `provideNgxDynamicEntity({ … })`, so an option is only counted when
 * it is passed to the provider.
 *
 * Matching the whole demo would count `validators:` inside a field's schema — a different
 * thing with the same name, and a false pass on precisely the option a schema is most likely
 * to mention. Braces are balanced rather than regex-matched because the argument contains
 * nested objects and arrow functions.
 */
function providerArgument(source) {
  const at = source.indexOf('provideNgxDynamicEntity({');
  if (at === -1) return '';
  const from = source.indexOf('{', at);
  let depth = 0;
  for (let i = from; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}' && --depth === 0) return source.slice(from, i + 1);
  }
  return source.slice(from);
}

const providerCall = providerArgument(demoSource);

/** Where a name is used in the demo, for the report. */
function usedIn(name, pattern) {
  return demoFiles.filter(file => pattern.test(demoCode.get(file))).map(f => relative(ROOT, f));
}

const missing = [];
const covered = [];

for (const token of publishedTokens()) {
  if (token in DELIBERATELY_UNDEMONSTRATED) continue;
  // Word-bounded, so `UI_TEXT` is not matched by `BUILDER_TEXT` and `MASKED_ROLES` is not
  // matched by a comment about masked roles.
  const pattern = new RegExp(`\\b${token}\\b`);
  if (pattern.test(demoSource)) covered.push(`${token} (${usedIn(token, pattern).join(', ')})`);
  else missing.push(`token ${token}`);
}

for (const option of configOptions()) {
  if (option in DELIBERATELY_UNDEMONSTRATED) continue;
  // An option is used when it appears as a key of the provider's argument — not merely
  // somewhere in the demo, where a field's own `validators:` would answer for it.
  const pattern = new RegExp(`\\b${option}\\s*:`);
  if (pattern.test(providerCall)) covered.push(`${option} (provideNgxDynamicEntity option)`);
  else missing.push(`provideNgxDynamicEntity option "${option}"`);
}

for (const fn of coreConfigFunctions()) {
  if (fn in DELIBERATELY_UNDEMONSTRATED) continue;
  const pattern = new RegExp(`\\b${fn}\\s*\\(`);
  if (pattern.test(demoSource)) covered.push(`${fn} (${usedIn(fn, pattern).join(', ')})`);
  else missing.push(`core configuration function ${fn}()`);
}

if (missing.length) {
  console.error(`${missing.length} extension point(s) have no demo wiring them:\n`);
  for (const name of missing) console.error(`  ${name}`);
  console.error(
    '\nWire it into packages/demo-angular/src — the demo is the only end-to-end surface\n' +
      'this project has, so a point it does not use has no evidence that it works.\n' +
      'If it genuinely should not be demonstrated, add it to DELIBERATELY_UNDEMONSTRATED in\n' +
      'scripts/check-demo-coverage.mjs with the reason.',
  );
  process.exit(1);
}

console.log(
  `Every extension point is demonstrated: ${covered.length} wired, ` +
    `${Object.keys(DELIBERATELY_UNDEMONSTRATED).length} deliberately not.`,
);
