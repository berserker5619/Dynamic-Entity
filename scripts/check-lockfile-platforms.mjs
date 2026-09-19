#!/usr/bin/env node
/**
 * Fail the build when `package-lock.json` has lost another platform's binaries.
 *
 * Why this exists: `19b3676` turned every CI workflow red with `Cannot find module
 * @rollup/rollup-linux-x64-gnu`. The lockfile had been deleted and regenerated on Windows,
 * and npm writes only the *resolving* platform's optional dependencies into a tree it
 * resolves from scratch — so the Linux binaries the runner installs were simply not in the
 * file. Every local gate passed, because on Windows the lock was correct. The defect exists
 * only across a platform boundary, which is the one thing a single-platform verification
 * cannot see, and the first thing that noticed was a red main.
 *
 * Nothing about that was subtle in hindsight and nothing about it was visible in advance,
 * which is the definition of a check worth automating. This runs in `npm run lint`, costs a
 * file read, and answers on the machine that made the mistake rather than on the one that
 * inherits it.
 *
 * The fix, when this fires, is **not** to hand-edit the lockfile. Restore it
 * (`git checkout package-lock.json`) and apply what you wanted with `npm install` or
 * `npm audit fix`, both of which mutate the existing tree and keep the foreign-platform
 * entries. Deleting the file is what loses them.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const LOCK = join(ROOT, 'package-lock.json');

/**
 * The platforms CI and a consumer's install actually need.
 *
 * Deliberately not "every platform npm has ever heard of": the point is to notice a lockfile
 * resolved on one machine, and three families spread across the developer/CI/contributor
 * split is enough to notice that. Each entry names a package that genuinely ships per-platform
 * binaries, so a missing one is a broken install rather than a cosmetic gap.
 */
const REQUIRED = [
  { label: 'Linux (CI runners)', pattern: /(@rollup\/rollup-linux-|@esbuild\/linux-)/ },
  { label: 'macOS (contributors)', pattern: /(@rollup\/rollup-darwin-|@esbuild\/darwin-)/ },
  { label: 'Windows (contributors)', pattern: /(@rollup\/rollup-win32-|@esbuild\/win32-)/ },
];

let lock;
try {
  lock = JSON.parse(readFileSync(LOCK, 'utf8'));
} catch (error) {
  console.error(`Could not read package-lock.json: ${error.message}`);
  process.exit(1);
}

const packages = Object.keys(lock.packages ?? {});
if (!packages.length) {
  console.error('package-lock.json has no "packages" map — is it lockfileVersion 1?');
  process.exit(1);
}

const missing = REQUIRED.filter(({ pattern }) => !packages.some(name => pattern.test(name)));

if (missing.length) {
  console.error('\npackage-lock.json is missing binaries for:\n');
  for (const { label } of missing) console.error(`  - ${label}`);
  console.error(
    '\nThis happens when the lockfile is deleted and regenerated: npm writes only the\n' +
      'resolving machine\'s optional dependencies. `npm ci` then fails on every other\n' +
      'platform — which, for this repository, means CI.\n\n' +
      'Do not hand-edit the file. Restore it and re-apply the change in place:\n\n' +
      '    git checkout package-lock.json\n' +
      '    npm install        # or: npm audit fix\n',
  );
  process.exit(1);
}

const counts = REQUIRED.map(({ label, pattern }) => {
  const n = packages.filter(name => pattern.test(name)).length;
  return `${label.split(' ')[0]} ${n}`;
}).join(', ');

console.log(`Lockfile carries every platform's binaries (${counts}).`);
