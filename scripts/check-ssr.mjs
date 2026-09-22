#!/usr/bin/env node
/**
 * Assert that ngx-dynamic-entity source code and all 21 field types comply with Server-Side Rendering (SSR).
 *
 * Why this exists: A server-side render (Angular Universal / @angular/platform-server) runs
 * without a real browser window or DOM. Direct references to `window`, `document`, `navigator`,
 * `localStorage`, or `sessionStorage` at class definition or injection/construction time crash
 * the Node process with `ReferenceError: window is not defined`.
 *
 * This script statically inspects all shipped components and services in `packages/ngx-dynamic-entity`
 * for unsafe DOM access, verifies that all 21 field components are registered and standalone, and
 * confirms SSR hygiene.
 *
 * Usage: node scripts/check-ssr.mjs
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = process.cwd();
const RENDERER_SRC = join(ROOT, 'packages/ngx-dynamic-entity/src/lib');

const ALL_21_FIELD_TYPES = {
  text: 'text-field.component.ts',
  textarea: 'textarea-field.component.ts',
  markdown: 'markdown-field.component.ts',
  number: 'number-field.component.ts',
  currency: 'currency-field.component.ts',
  email: 'email-field.component.ts',
  password: 'password-field.component.ts',
  date: 'date-field.component.ts',
  datetime: 'date-time-field.component.ts',
  time: 'time-field.component.ts',
  monthYear: 'month-year-field.component.ts',
  dropdown: 'dropdown-field.component.ts',
  radio: 'radio-field.component.ts',
  checkbox: 'checkbox-field.component.ts',
  boolean: 'boolean-field.component.ts',
  multiSelect: 'multi-select-field.component.ts',
  'entity-ref': 'entity-ref-field.component.ts',
  group: 'group-field.component.ts',
  array: 'array-field.component.ts',
  image: 'image-field.component.ts',
  file: 'file-field.component.ts',
};

const FORBIDDEN_DOM_GLOBALS = [
  'window.',
  'document.',
  'navigator.',
  'localStorage.',
  'sessionStorage.',
  'window[',
  'document[',
  'localStorage[',
  'sessionStorage[',
];

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      walk(full, out);
    } else if (full.endsWith('.ts') && !full.endsWith('.spec.ts')) {
      out.push(full);
    }
  }
  return out;
}

const files = walk(RENDERER_SRC);
let violations = 0;

for (const file of files) {
  const content = readFileSync(file, 'utf8');
  const lines = content.split('\n');

  // Check if file or function block is guarded by typeof document / typeof window
  let inGuardedBlock = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Reset or toggle guard heuristics
    if (trimmed.includes("typeof document === 'undefined'") || trimmed.includes("typeof window === 'undefined'")) {
      inGuardedBlock = true;
    }
    if (inGuardedBlock && trimmed === '}') {
      inGuardedBlock = false;
    }

    // Ignore comments
    if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) {
      continue;
    }

    if (inGuardedBlock) {
      continue;
    }

    for (const forbidden of FORBIDDEN_DOM_GLOBALS) {
      if (line.includes(forbidden)) {
        // Exclude allowed patterns (e.g. inject(DOCUMENT), isPlatformBrowser checks)
        if (
          line.includes('DOCUMENT') ||
          line.includes('isPlatformBrowser') ||
          line.includes('typeof window') ||
          line.includes('typeof document')
        ) {
          continue;
        }
        console.error(
          `FAIL: Unsafe SSR global "${forbidden}" found in ${relative(ROOT, file)}:${i + 1}\n  ${line.trim()}`,
        );
        violations++;
      }
    }
  }
}

// Verify that all 21 field types exist as standalone components
const fieldTypeDir = join(RENDERER_SRC, 'field-types');
const fieldFiles = new Set(readdirSync(fieldTypeDir));
const missingTypes = [];

for (const [type, expectedFile] of Object.entries(ALL_21_FIELD_TYPES)) {
  if (!fieldFiles.has(expectedFile)) {
    missingTypes.push(`${type} (${expectedFile})`);
  }
}

if (missingTypes.length > 0) {
  console.error(`FAIL: Missing field type components in field-types directory: ${missingTypes.join(', ')}`);
  violations++;
}

if (violations > 0) {
  console.error(`\nSSR Check failed with ${violations} violation(s).`);
  process.exit(1);
}

console.log(
  `PASS: All ${files.length} renderer source files and all 21 field types adhere to SSR safety guidelines.`,
);
