#!/usr/bin/env node
/**
 * export-styles.mjs — list `styles.css` in the published `exports` map.
 *
 * ng-packagr copies the stylesheet into `dist/` as an asset but writes an `exports` map that
 * names only the entry point, and a subpath an `exports` map does not list cannot be imported:
 * `@import 'ngx-dynamic-entity/styles.css'`, the line the README gives, failed to resolve in
 * every consumer build.
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
fs.writeFileSync(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);
