#!/usr/bin/env node
/**
 * Published as the `dynamic-entity` bin. Behaviour lives in src/cli.ts so tests do not
 * have to spawn this file; this wrapper only supplies Node I/O.
 *
 * It imports the `./cli` bundle rather than the root one, which is the point of that
 * subpath existing: the library a browser imports carries no argv parsing.
 */
import { readFileSync } from 'node:fs';
import { runValidateCli } from './cli.mjs';

const code = runValidateCli(process.argv.slice(2), {
  readFile: path => readFileSync(path, 'utf8'),
  stdout: text => process.stdout.write(text + '\n'),
  stderr: text => process.stderr.write(text + '\n'),
});
process.exit(code);
