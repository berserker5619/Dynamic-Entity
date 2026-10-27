#!/usr/bin/env node
/**
 * export-styles.mjs — post-build packaging patches for published package.json:
 *
 * 1. List `styles.css` in the published `exports` map.
 *    ng-packagr copies the stylesheet into `dist/` as an asset but writes an `exports` map that
 *    names only the entry point, and a subpath an `exports` map does not list cannot be imported:
 *    `@import 'ngx-dynamic-entity/styles.css'`, the line the README gives, failed to resolve in
 *    every consumer build.
 *
 * 2. Add `typesVersions` mapping each secondary entry point to its .d.ts file.
 *    Angular 17 defaults to "moduleResolution": "node" (Node10), which ignores the "exports" map.
 *    Without `typesVersions`, importing secondary entry points like `ngx-dynamic-entity/xlsx`
 *    fails with TS2307 under Node10 resolution.
 *
 * Patched here rather than declared in the source `package.json`, because ng-packagr would merge
 * a source `exports` map — and the workspace resolves this package through a symlink to the
 * source folder, where any `exports` map hides the root entry the builder's build imports.
 * `scripts/verify-consumer.mjs` checks the result from a packed tarball.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MANIFEST = path.join(HERE, 'dist', 'package.json');

if (!fs.existsSync(path.join(HERE, 'dist', 'styles.css'))) {
  console.error('error: dist/styles.css does not exist — run ng-packagr first.');
  process.exit(1);
}

const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
manifest.exports = { './styles.css': { default: './styles.css' }, ...manifest.exports };

// Map every secondary entry point in typesVersions for Node10 resolution (Angular 17 support)
const typesVersions = {};

// 1. Discover secondary entry points from ng-packagr exports map
if (manifest.exports) {
  for (const [subpath, target] of Object.entries(manifest.exports)) {
    if (subpath === '.' || subpath.endsWith('.json') || subpath.endsWith('.css')) continue;
    const types = typeof target === 'object' && target !== null ? target.types : undefined;
    if (types) {
      const entryName = subpath.replace(/^\.\//, '');
      typesVersions[entryName] = [types.replace(/^\.\//, '')];
    }
  }
}

// 2. Discover any secondary entry points from subdirectories containing ng-package.json
const IGNORE_DIRS = new Set(['dist', 'node_modules', 'src', 'coverage', '.turbo']);
function findEntryDirs(dir, relativeToHere = '') {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory() || IGNORE_DIRS.has(entry.name)) continue;
    const rel = relativeToHere ? `${relativeToHere}/${entry.name}` : entry.name;
    const full = path.join(dir, entry.name);
    if (fs.existsSync(path.join(full, 'ng-package.json'))) {
      if (!typesVersions[rel]) {
        const candidate = `types/ngx-dynamic-entity-${rel.replace(/\//g, '-')}.d.ts`;
        if (fs.existsSync(path.join(HERE, 'dist', candidate))) {
          typesVersions[rel] = [candidate];
        }
      }
    }
    findEntryDirs(full, rel);
  }
}
findEntryDirs(HERE);

if (Object.keys(typesVersions).length > 0) {
  manifest.typesVersions = {
    '*': typesVersions,
  };
}

// Fail build if any discovered secondary entry point is missing from typesVersions
const missingEntries = [];
function verifyEntries(dir, relativeToHere = '') {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory() || IGNORE_DIRS.has(entry.name)) continue;
    const rel = relativeToHere ? `${relativeToHere}/${entry.name}` : entry.name;
    const full = path.join(dir, entry.name);
    if (fs.existsSync(path.join(full, 'ng-package.json'))) {
      const mapped = manifest.typesVersions?.['*']?.[rel];
      if (!mapped || !Array.isArray(mapped) || mapped.length === 0) {
        missingEntries.push(`entry "${rel}" is missing from typesVersions`);
      } else {
        for (const target of mapped) {
          if (!fs.existsSync(path.join(HERE, 'dist', target))) {
            missingEntries.push(`entry "${rel}" target "${target}" does not exist in dist`);
          }
        }
      }
    }
    verifyEntries(full, rel);
  }
}
verifyEntries(HERE);

if (missingEntries.length > 0) {
  console.error('\nerror: Secondary entry point validation failed:');
  for (const err of missingEntries) console.error(`  - ${err}`);
  process.exit(1);
}

fs.writeFileSync(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);

