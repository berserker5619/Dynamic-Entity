#!/usr/bin/env node
/**
 * `node scripts/semver-lt.mjs A B` exits 0 when version A is lower than version B under
 * SemVer 2.0.0 precedence, and 1 otherwise (including equal). The release workflow uses it to
 * decide whether a dist-tag points at an older version than the one just published.
 *
 * Build metadata (`+...`) is ignored, as precedence requires. Written out rather than taken
 * from a package so the release job needs nothing it has not already installed.
 */
import { pathToFileURL } from 'node:url';

/** Negative when a < b, zero when equal, positive when a > b. */
export function compare(a, b) {
  const parse = version => {
    const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(String(version).trim());
    if (!match) throw new Error(`not a semantic version: "${version}"`);
    return { core: match.slice(1, 4).map(Number), pre: match[4] ? match[4].split('.') : [] };
  };
  const x = parse(a);
  const y = parse(b);
  for (let i = 0; i < 3; i++) if (x.core[i] !== y.core[i]) return x.core[i] - y.core[i];
  // A version without a prerelease outranks the same version with one.
  if (!x.pre.length || !y.pre.length) return y.pre.length - x.pre.length;
  for (let i = 0; i < Math.max(x.pre.length, y.pre.length); i++) {
    if (i >= x.pre.length) return -1;
    if (i >= y.pre.length) return 1;
    const [p, q] = [x.pre[i], y.pre[i]];
    const [pn, qn] = [/^\d+$/.test(p), /^\d+$/.test(q)];
    if (pn && qn && Number(p) !== Number(q)) return Number(p) - Number(q);
    if (pn !== qn) return pn ? -1 : 1; // numeric identifiers rank below alphanumeric ones
    if (!pn && p !== q) return p < q ? -1 : 1;
  }
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [a, b] = process.argv.slice(2);
  process.exit(compare(a, b) < 0 ? 0 : 1);
}
