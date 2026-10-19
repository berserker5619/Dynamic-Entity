#!/usr/bin/env node
/**
 * Which sheet-to-schema the drift workflow tests.
 *
 *     node scripts/drift-resolve.mjs range
 *         the sheet-to-schema range core, server and ngx-dynamic-entity declare. They must
 *         agree: a workspace on another range would be tested at a version it never declared.
 *     npm view "sheet-to-schema@<range or dist-tag>" version --json | node scripts/drift-resolve.mjs newest
 *         the newest version npm listed (one string, or a list for a range).
 *
 * npm runs in the workflow, not here, so a range's `^` never meets a Windows shell.
 */
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { compare } from './semver-lt.mjs';

const WORKSPACES = ['core', 'server', 'ngx-dynamic-entity'];

export function declaredRange(read = p => JSON.parse(readFileSync(p, 'utf8'))) {
  const ranges = WORKSPACES.map(ws => [ws, read(`packages/${ws}/package.json`).dependencies?.['sheet-to-schema']]);
  const missing = ranges.filter(([, r]) => !r).map(([ws]) => ws);
  if (missing.length) throw new Error(`No sheet-to-schema dependency in ${missing.join(', ')}.`);
  if (new Set(ranges.map(([, r]) => r)).size !== 1) {
    throw new Error(`The workspaces declare different sheet-to-schema ranges: ${ranges.map(([ws, r]) => `${ws} ${r}`).join(', ')}.`);
  }
  return ranges[0][1];
}

/** The newest of what `npm view name@range version --json` printed: one string, or a list. */
export function newest(viewJson) {
  if (!viewJson.trim()) throw new Error('No published version satisfies the range.');
  const parsed = JSON.parse(viewJson);
  const versions = (Array.isArray(parsed) ? parsed : [parsed]).filter(Boolean);
  if (!versions.length) throw new Error('No published version satisfies the range.');
  return versions.sort(compare).at(-1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const mode = process.argv[2];
  try {
    if (mode === 'range') console.log(declaredRange());
    else if (mode === 'newest') console.log(newest(readFileSync(0, 'utf8')));
    else {
      console.error('usage: drift-resolve.mjs range | newest  (newest reads `npm view … version --json` on stdin)');
      process.exit(2);
    }
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
