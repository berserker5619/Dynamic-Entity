#!/usr/bin/env node
/**
 * Fail the build if a visual baseline is missing its other-platform twin, or the two differ
 * in size.
 *
 * Why this exists: Playwright keeps one baseline per platform — `<name>-chromium-linux.png`
 * for CI, `<name>-chromium-win32.png` for local runs on Windows — and CI only ever compares
 * the Linux set. 9c1ddf1 added fields to the Clients form and refreshed the Windows images
 * but not the Linux ones, and E2E on main failed for days before anyone traced it. A pair that
 * is in sync renders the same element at the same size on both platforms, so a size mismatch
 * means one side was regenerated and the other was not.
 *
 * What it cannot catch: a same-size change on one platform. CI's pixel comparison covers the
 * Linux side; the Windows side is only as good as whoever regenerates it.
 *
 * Reads only the PNG header (width and height sit at bytes 16–23 of the IHDR chunk), so it
 * runs in milliseconds and needs no image library.
 */
import { closeSync, openSync, readdirSync, readSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = process.cwd();
const PACKAGES = join(ROOT, 'packages');
const PLATFORMS = ['linux', 'win32'];
const BASELINE = /^(.+)-(linux|win32)\.png$/;

/** @returns {string[]} every `*-snapshots` directory under packages/<pkg>/e2e */
function snapshotDirs() {
  const out = [];
  for (const pkg of readdirSync(PACKAGES)) {
    const e2e = join(PACKAGES, pkg, 'e2e');
    let entries;
    try {
      entries = readdirSync(e2e);
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = join(e2e, entry);
      if (entry.endsWith('-snapshots') && statSync(full).isDirectory()) out.push(full);
    }
  }
  return out;
}

/** @returns {string} `WxH`, read from the PNG's IHDR chunk */
function size(file) {
  const header = Buffer.alloc(24);
  const fd = openSync(file, 'r');
  try {
    readSync(fd, header, 0, 24, 0);
  } finally {
    closeSync(fd);
  }
  return `${header.readUInt32BE(16)}x${header.readUInt32BE(20)}`;
}

const failures = [];
let pairs = 0;
for (const dir of snapshotDirs()) {
  /** @type {Map<string, Map<string, string>>} stem → platform → size */
  const stems = new Map();
  for (const file of readdirSync(dir)) {
    const match = BASELINE.exec(file);
    if (!match) continue;
    const [, stem, platform] = match;
    if (!stems.has(stem)) stems.set(stem, new Map());
    stems.get(stem).set(platform, size(join(dir, file)));
  }
  for (const [stem, sizes] of stems) {
    const where = relative(ROOT, join(dir, stem));
    const missing = PLATFORMS.filter(p => !sizes.has(p));
    if (missing.length) {
      failures.push(`${where}: no ${missing.join(' or ')} baseline`);
      continue;
    }
    pairs++;
    const [linux, win32] = PLATFORMS.map(p => sizes.get(p));
    if (linux !== win32) failures.push(`${where}: linux ${linux}, win32 ${win32}`);
  }
}

if (failures.length) {
  console.error(`Visual baselines out of step in ${failures.length} place(s):\n`);
  for (const f of failures) console.error(`  ${f}`);
  console.error(
    '\nRegenerate both sets after a UI change: Windows locally with\n' +
      '  npx playwright test e2e/visual-regression.spec.ts --update-snapshots=all\n' +
      'and Linux by running the E2E workflow by hand with update_snapshots ticked.\n' +
      'Look at each image before committing it. Do not resize one to make this pass.',
  );
  process.exit(1);
}

console.log(`Visual baselines: ${pairs} Linux/Windows pair(s), all matching in size.`);
