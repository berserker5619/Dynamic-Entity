#!/usr/bin/env node
/**
 * build-manifest.mjs — write the manifest that @dynamic-entity/server publishes.
 *
 * The same reasoning as packages/core/build-manifest.mjs: tsup emits code but no
 * package.json, so publishing the source manifest verbatim would carry `scripts` and every
 * devDependency — tsup, jest, ts-jest, express, jszip — into a consumer's node_modules.
 * ng-packagr strips both for the Angular packages and calls published scripts "a potential
 * security vulnerability"; the bundled packages need the equivalent written by hand.
 *
 * `dependencies`, `peerDependencies` and `engines` *are* carried through when present,
 * because unlike core this package has runtime dependencies and a consumer's installer needs
 * every one of them.
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
  engines: source.engines,
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
    './package.json': './package.json',
  },
  ...(source.dependencies ? { dependencies: source.dependencies } : {}),
  peerDependencies: source.peerDependencies,
  ...(source.peerDependenciesMeta ? { peerDependenciesMeta: source.peerDependenciesMeta } : {}),
};

fs.writeFileSync(path.join(DIST, 'package.json'), JSON.stringify(published, null, 2) + '\n');

// The README is part of what ships, so it is copied in rather than referenced out.
for (const file of ['README.md']) {
  const from = path.join(HERE, file);
  if (fs.existsSync(from)) fs.copyFileSync(from, path.join(DIST, file));
}

const missing = ['index.js', 'index.mjs', 'index.d.ts'].filter(
  f => !fs.existsSync(path.join(DIST, f)),
);
if (missing.length) {
  console.error(`error: dist/ is missing ${missing.join(', ')}`);
  process.exit(1);
}

// The workspace resolves @dynamic-entity/core through a symlink, so a stale peer range here
// is invisible until a consumer installs the tarball. Checked at build time instead.
const corePeer = published.peerDependencies['@dynamic-entity/core'];
const coreVersion = JSON.parse(
  fs.readFileSync(path.join(HERE, '..', 'core', 'package.json'), 'utf8'),
).version;
if (corePeer !== `^${coreVersion}`) {
  console.error(
    `error: peerDependencies["@dynamic-entity/core"] is ${corePeer} but core is ${coreVersion}.\n` +
      'The packages share a version train — bump both.',
  );
  process.exit(1);
}

console.log(`@dynamic-entity/server ${published.version} — dist/ manifest written`);
