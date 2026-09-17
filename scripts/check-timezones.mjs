#!/usr/bin/env node
/**
 * Run the date-sensitive tests once per timezone, with `TZ` in the real environment.
 *
 * Why this exists: `coerceCell` shipped reading a bare date through `new Date('2024-03-07')`,
 * which ECMAScript parses as UTC midnight, and formatting it back with local getters. Every
 * imported date moved a day earlier for anyone at a negative UTC offset. Nothing caught it —
 * the author's machine is UTC+5:30 and CI runs UTC, so the whole gate sat on the side of
 * Greenwich where the bug is invisible. The people it broke for were in the Americas.
 *
 * Setting `process.env.TZ` inside a test does not work and, worse, looks like it does: Jest
 * gives each test file its own copy of `process.env`, so the assignment never reaches the hook
 * Node uses to invalidate its timezone cache. The first attempt reported thirty passing zone
 * cases that had all run in one zone. The zone has to be set before the process starts, which
 * is what this does.
 *
 * Usage: node scripts/check-timezones.mjs
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CORE = path.join(ROOT, 'packages', 'core');

/**
 * Chosen to straddle Greenwich rather than to be exhaustive.
 *
 * Negative offsets are the ones that broke; the half-hour zone catches an arithmetic fix that
 * only handles whole hours; and UTC+14 is the far side, where a naive fix that simply shifted
 * the other way would fail instead.
 */
const ZONES = [
  'UTC',
  'America/Los_Angeles', // UTC-8, where the original defect showed
  'America/New_York', // UTC-5
  'Europe/Berlin', // UTC+1
  'Asia/Kolkata', // UTC+5:30 — half-hour offset
  'Pacific/Kiritimati', // UTC+14
];

/** The suites whose behaviour a timezone can change. */
const PATTERN = 'timezone|import-columns|import-engine';

const failures = [];

for (const zone of ZONES) {
  process.stdout.write(`  ${zone.padEnd(22)}`);

  const result = spawnSync(
    process.execPath,
    [path.join(ROOT, 'node_modules', 'jest', 'bin', 'jest.js'), '--silent', PATTERN],
    {
      cwd: CORE,
      env: { ...process.env, TZ: zone },
      encoding: 'utf8',
    },
  );

  if (result.status === 0) {
    console.log('ok');
    continue;
  }

  console.log('FAILED');
  failures.push({ zone, output: (result.stderr || result.stdout || '').trim() });
}

if (failures.length) {
  console.error(`\nDate handling differs by timezone in ${failures.length} zone(s):\n`);
  for (const failure of failures) {
    console.error(`── ${failure.zone} ${'─'.repeat(Math.max(0, 60 - failure.zone.length))}`);
    console.error(failure.output.split('\n').slice(-40).join('\n'));
    console.error('');
  }
  console.error(
    'A value with no timezone — a date, a month — must never round-trip through an instant.\n' +
      'Parse its text directly; reserve `new Date` for a datetime, which genuinely is one.',
  );
  process.exit(1);
}

console.log(`\nDates hold in all ${ZONES.length} timezones.`);
