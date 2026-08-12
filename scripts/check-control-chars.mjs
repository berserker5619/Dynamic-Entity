#!/usr/bin/env node
/**
 * Fail the build if any source file contains a control character.
 *
 * Why this exists: a stray NUL inside a template literal compiles fine and passes every
 * test, but git and grep classify the file as binary — diffs stop rendering and searches
 * silently skip it. It happened three times while building the option-shape and cache
 * work, each time as an "invisible" separator inside a `${...}` string. Named constants
 * are the fix; this is the net that catches the next one.
 *
 * Allowed: tab (0x09), LF (0x0a), CR (0x0d). Everything else below 0x20, plus DEL, fails.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = process.cwd();
const SKIP_DIRS = new Set([
  'node_modules', 'dist', '.git', '.angular', '.turbo', '.nx',
  'coverage', 'test-results', 'playwright-report', 'out-tsc',
]);
const EXTENSIONS = ['.ts', '.js', '.mjs', '.html', '.css', '.scss', '.json', '.md'];
const ALLOWED = new Set([0x09, 0x0a, 0x0d]);

/** @returns {string[]} */
function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (EXTENSIONS.some(ext => entry.endsWith(ext))) out.push(full);
  }
  return out;
}

const failures = [];
for (const file of walk(ROOT)) {
  const buf = readFileSync(file);
  for (let i = 0; i < buf.length; i++) {
    const byte = buf[i];
    if ((byte < 0x20 && !ALLOWED.has(byte)) || byte === 0x7f) {
      const line = buf.subarray(0, i).toString('utf8').split('\n').length;
      failures.push(`${relative(ROOT, file)}:${line} contains 0x${byte.toString(16).padStart(2, '0')}`);
      break; // one report per file is enough to act on
    }
  }
}

if (failures.length) {
  console.error(`Control characters found in ${failures.length} file(s):\n`);
  for (const f of failures) console.error(`  ${f}`);
  console.error('\nUse a named constant instead of an inline separator inside a template literal.');
  process.exit(1);
}

console.log('No control characters in source.');
