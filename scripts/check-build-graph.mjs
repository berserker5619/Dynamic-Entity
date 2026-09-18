#!/usr/bin/env node
/**
 * Fail the build when a package imports a sibling that turbo will not build first.
 *
 * Why this exists: `ngx-dynamic-entity` declared `@dynamic-entity/core` in
 * **`peerDependencies` only**, and turbo builds its task graph from `dependencies` and
 * `devDependencies` — it does not read `peerDependencies`. So `dependsOn: ["^build"]` had no
 * edge to add, and `ngx-dynamic-entity#build` ran *concurrently* with
 * `@dynamic-entity/core#build`.
 *
 * On a tree that already had `packages/core/dist` the race was invisible, because the types
 * were on disk from a previous run. On a clean checkout it was deterministic: ng-packagr
 * compiled before core's `index.d.ts` existed, `@dynamic-entity/core` resolved to nothing, and
 * the failure surfaced a long way from its cause —
 *
 *     import-mapper.component.ts:198 - error TS2339:
 *     Property 'column' does not exist on type 'unknown'.
 *
 * `new Map(entries.map(e => [e.ref, e]))` infers `Map<unknown, unknown>` once `MappingEntry`
 * stops resolving, so a missing *build order* was reported as a type error in application code.
 * Nobody reading that line would look at a package manifest.
 *
 * The graph is asked of turbo rather than recomputed here. Reimplementing "which manifest
 * fields count" would leave this gate agreeing with a rule turbo might change, which is the
 * failure it exists to prevent.
 *
 * Usage: node scripts/check-build-graph.mjs
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = process.cwd();
const PACKAGES = join(ROOT, 'packages');

/** Every workspace package, by the name its manifest declares. */
function workspaces() {
  const out = new Map();
  for (const dir of readdirSync(PACKAGES)) {
    const manifest = join(PACKAGES, dir, 'package.json');
    try {
      const pkg = JSON.parse(readFileSync(manifest, 'utf8'));
      if (pkg.name) out.set(pkg.name, { dir: join(PACKAGES, dir), manifest, pkg });
    } catch {
      // Not a package. A stray directory under packages/ is not this script's business.
    }
  }
  return out;
}

/** Every `.ts` file under a directory, specs included — a spec's import needs the same order. */
function sources(dir) {
  const found = [];
  const walk = current => {
    let entries;
    try {
      entries = readdirSync(current);
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry === 'node_modules' || entry === 'dist') continue;
      const path = join(current, entry);
      if (statSync(path).isDirectory()) walk(path);
      else if (entry.endsWith('.ts')) found.push(path);
    }
  };
  walk(dir);
  return found;
}

const packages = workspaces();
const names = [...packages.keys()];

/** Which siblings a package's source actually imports, and one file that proves it. */
function importedSiblings(name, dir) {
  const hits = new Map();
  for (const file of sources(join(dir, 'src'))) {
    const text = readFileSync(file, 'utf8');
    for (const sibling of names) {
      if (sibling === name || hits.has(sibling)) continue;
      // `from 'x'` and `import('x')`, and the subpath forms of either.
      const pattern = new RegExp(`from\\s+['"]${sibling}(/[^'"]*)?['"]|import\\(['"]${sibling}(/[^'"]*)?['"]\\)`);
      if (pattern.test(text)) hits.set(sibling, relative(ROOT, file));
    }
  }
  return hits;
}

/** Turbo's own build graph, asked of turbo. */
function buildGraph() {
  const raw = execFileSync(
    process.platform === 'win32' ? 'npx.cmd' : 'npx',
    ['turbo', 'run', 'build', '--dry=json'],
    { cwd: ROOT, encoding: 'utf8', shell: process.platform === 'win32', maxBuffer: 32 * 1024 * 1024 },
  );
  // turbo prints the JSON object; anything before it is progress noise.
  const json = JSON.parse(raw.slice(raw.indexOf('{')));
  const direct = new Map();
  for (const task of json.tasks) direct.set(task.taskId, task.dependencies ?? []);
  return direct;
}

/** Everything a task depends on, however many hops away. */
function reaches(direct, from, target, seen = new Set()) {
  for (const next of direct.get(from) ?? []) {
    if (next === target) return true;
    if (seen.has(next)) continue;
    seen.add(next);
    if (reaches(direct, next, target, seen)) return true;
  }
  return false;
}

const direct = buildGraph();
const problems = [];
const checked = [];

for (const [name, { dir }] of packages) {
  const task = `${name}#build`;
  if (!direct.has(task)) continue;

  for (const [sibling, proof] of importedSiblings(name, dir)) {
    if (!direct.has(`${sibling}#build`)) continue;
    if (reaches(direct, task, `${sibling}#build`)) {
      checked.push(`${name} → ${sibling}`);
      continue;
    }
    problems.push({ name, sibling, proof });
  }
}

if (problems.length) {
  console.error('A package imports a sibling that turbo will not build first:\n');
  for (const { name, sibling, proof } of problems) {
    console.error(`  ${name} imports ${sibling}`);
    console.error(`    seen in ${proof}`);
    console.error(`    but ${name}#build does not depend on ${sibling}#build\n`);
  }
  console.error(
    'turbo builds its graph from `dependencies` and `devDependencies`. It does NOT read\n' +
      '`peerDependencies`, so declaring a sibling there alone leaves `dependsOn: ["^build"]`\n' +
      'with no edge to add and the two tasks run concurrently. It looks fine on a tree that\n' +
      'still has the other package\'s dist from a previous run, and fails on every clean\n' +
      'checkout — as a type error in application code, a long way from the manifest at fault.\n\n' +
      'Add the sibling to `devDependencies`. ng-packagr strips that section from the published\n' +
      'manifest, so the published contract does not change.',
  );
  process.exit(1);
}

console.log(`Build order holds: ${checked.length} sibling import(s), every one built first.`);
