#!/usr/bin/env node
/**
 * build-manifest.mjs — write the manifest that @dynamic-entity/core publishes.
 *
 * tsup emits code but no package.json, so core used to publish its source manifest verbatim
 * — carrying `scripts` and `devDependencies` (tsup, jest, ts-jest, typescript) into every
 * consumer's node_modules. ng-packagr strips both for the two Angular packages, calling
 * published scripts "a potential security vulnerability", and core had no equivalent step.
 *
 * Publishing from `dist/` matches how the Angular packages already work: the source manifest
 * stays a development file, and what ships is derived from it and contains only what a
 * consumer needs. Paths flatten accordingly — `dist/index.js` at the package root becomes
 * `index.js`, because the tarball root *is* dist.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(HERE, 'dist');

const source = JSON.parse(fs.readFileSync(path.join(HERE, 'package.json'), 'utf8'));

if (!fs.existsSync(DIST)) {
  console.error('error: dist/ does not exist — run the bundler first.');
  process.exit(1);
}

// Only what a consumer needs. Anything not listed here is deliberately absent, so adding a
// field to the source manifest does not silently start publishing it.
const published = {
  name: source.name,
  version: source.version,
  description: source.description,
  keywords: source.keywords,
  license: source.license,
  author: source.author,
  repository: source.repository,
  homepage: source.homepage,
  bugs: source.bugs,
  sideEffects: false,
  // Paths are relative to the tarball root, which is this directory.
  main: 'index.js',
  module: 'index.mjs',
  types: 'index.d.ts',
  exports: {
    '.': {
      types: './index.d.ts',
      import: './index.mjs',
      require: './index.js',
    },
    './schema': './entity-form-config.schema.json',
    './package.json': './package.json',
  },
};

fs.writeFileSync(path.join(DIST, 'package.json'), JSON.stringify(published, null, 2) + '\n');

// The README and the JSON Schema are part of what ships, so they are copied in rather than
// referenced out of the package root.
for (const file of ['README.md', 'entity-form-config.schema.json']) {
  const from = path.join(HERE, file);
  if (fs.existsSync(from)) fs.copyFileSync(from, path.join(DIST, file));
}

const missing = ['index.js', 'index.mjs', 'index.d.ts', 'entity-form-config.schema.json'].filter(
  f => !fs.existsSync(path.join(DIST, f)),
);
if (missing.length) {
  console.error(`error: dist/ is missing ${missing.join(', ')}`);
  process.exit(1);
}

console.log(`@dynamic-entity/core ${published.version} — dist/ manifest written`);
