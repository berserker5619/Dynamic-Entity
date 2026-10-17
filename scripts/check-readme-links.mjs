#!/usr/bin/env node
/**
 * Fail on a relative link in a README that is published to npm.
 *
 * npmjs.com renders a package's README away from its repository, so `./docs/x.md`,
 * `../server` or `CHANGELOG.md` lead nowhere there. Every link in a published README must be
 * absolute (`https://`, `http://`, `mailto:`) or an anchor within the same page (`#...`).
 *
 * Which READMEs are published is asked of `npm pack --dry-run`, not assumed, so a README that
 * starts shipping is checked from then on. Pass package directories as arguments; the default
 * is the current directory. An argument ending in `.md` is checked as that file instead, for a
 * README that is copied into a build directory before it is published, so it can be checked
 * before anything is built. Fenced and inline code are skipped: a link written as an example
 * of code is not a link.
 *
 * Usage: node scripts/check-readme-links.mjs [packageDir | README.md ...]
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

// npm's own CLI through node: under `npm run` it is npm_execpath; run directly, it is the copy
// installed beside node. No shell either way, so it also works on Windows.
const BUNDLED_NPM = join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
const NPM = process.env.npm_execpath
  ? [process.execPath, process.env.npm_execpath]
  : existsSync(BUNDLED_NPM)
    ? [process.execPath, BUNDLED_NPM]
    : ['npm'];
const ALLOWED = /^(https?:\/\/|mailto:|#)/i;

function publishedReadmes(dir) {
  const [bin, ...pre] = NPM;
  const out = execFileSync(bin, [...pre, 'pack', '--dry-run', '--json', '--ignore-scripts'], { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  return JSON.parse(out)[0].files.map(file => file.path).filter(path => /(^|\/)readme(\.[a-z]+)?$/i.test(path)).map(path => join(dir, path));
}

/** Blank out fenced blocks and inline code, keeping line numbers. */
function withoutCode(text) {
  const lines = text.split(/\r?\n/);
  let fence = null;
  return lines.map(line => {
    const marker = /^\s*(`{3,}|~{3,})/.exec(line);
    if (fence) {
      if (marker && marker[1][0] === fence[0] && marker[1].length >= fence.length) fence = null;
      return '';
    }
    if (marker) {
      fence = marker[1];
      return '';
    }
    return line.replace(/(`+)[\s\S]*?\1/g, '');
  });
}

function linksIn(line) {
  const found = [];
  for (const m of line.matchAll(/\]\(\s*<?([^)\s>]+)>?(?:\s+["'(][^)]*)?\)/g)) found.push(m[1]); // [text](target) and ![alt](target)
  for (const m of line.matchAll(/^\s{0,3}\[[^\]]+\]:\s*<?(\S+?)>?(?:\s|$)/g)) found.push(m[1]); // [ref]: target
  for (const m of line.matchAll(/\b(?:href|src)\s*=\s*["']([^"']+)["']/gi)) found.push(m[1]); // <a href>, <img src>
  return found;
}

const dirs = process.argv.slice(2).length ? process.argv.slice(2) : ['.'];
const problems = [];
let checked = 0;
for (const target of dirs.map(d => resolve(d))) {
  const files = /\.md$/i.test(target) && existsSync(target) && statSync(target).isFile() ? [target] : publishedReadmes(target);
  for (const file of files) {
    checked++;
    withoutCode(readFileSync(file, 'utf8')).forEach((line, i) => {
      for (const target of linksIn(line)) {
        if (!ALLOWED.test(target)) problems.push(`${relative(process.cwd(), file)}:${i + 1} links to "${target}"`);
      }
    });
  }
}

if (problems.length) {
  console.error('Relative links in a README that is published to npm (they do not resolve on npmjs.com):\n');
  for (const problem of problems) console.error(`  - ${problem}`);
  console.error('\nUse an absolute URL, e.g. https://github.com/<owner>/<repo>/blob/main/<path>.');
  process.exit(1);
}
if (!checked) {
  console.error('No published README found: is the package directory right?');
  process.exit(1);
}
console.log(`Published READMEs link only absolutely (${checked} checked).`);
