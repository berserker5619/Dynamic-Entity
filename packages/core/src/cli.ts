/**
 * cli.ts — behaviour of the `dynamic-entity` bin, without Node builtins.
 *
 * The published command is a 15-line wrapper (`cli.mjs`) that injects `fs` and stdio.
 * Keeping I/O out of this file means importing `@dynamic-entity/core` in a browser
 * never pulls `node:fs`. Tests call `runValidateCli` directly so they do not depend
 * on `dist/` existing.
 */

import { formatConfigProblems, isConfigValid, validateConfig } from './validate-config';

export interface ValidateCliIo {
  readFile(path: string): string;
  stdout(text: string): void;
  stderr(text: string): void;
}

const USAGE = `Usage: dynamic-entity validate <file.json> [options]

Check an EntityFormConfig before anything renders or stores it.

Exit 0 when there are no errors (warnings still print). Exit 1 on errors.
Exit 2 when the command, the file, or the JSON is unusable.

Options:
  --additional-field-types <a,b>  Types registered with provideFieldTypes
  --fail-on-warnings              Treat warnings as errors
  -h, --help                      Show this message
`;

function isHelp(arg: string): boolean {
  return arg === '-h' || arg === '--help' || arg === 'help';
}

/**
 * Run the `validate` subcommand. `argv` is `process.argv` with the node binary and
 * script path already removed — so it starts at `validate` (or `--help`).
 */
export function runValidateCli(argv: readonly string[], io: ValidateCliIo): number {
  if (argv.length === 0 || argv.some(isHelp)) {
    io.stdout(USAGE.trimEnd());
    return argv.length === 0 ? 2 : 0;
  }

  if (argv[0] !== 'validate') {
    io.stderr(`Unknown command "${argv[0]}". Expected "validate".`);
    io.stderr(USAGE.trimEnd());
    return 2;
  }

  let file: string | undefined;
  let additionalFieldTypes: string[] | undefined;
  let failOnWarnings = false;

  for (let i = 1; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--fail-on-warnings') {
      failOnWarnings = true;
      continue;
    }
    if (arg === '--additional-field-types') {
      const value = argv[++i];
      if (!value || value.startsWith('-')) {
        io.stderr('--additional-field-types needs a comma-separated list.');
        return 2;
      }
      additionalFieldTypes = value
        .split(',')
        .map(s => s.trim())
        .filter(Boolean);
      continue;
    }
    if (arg.startsWith('--additional-field-types=')) {
      additionalFieldTypes = arg
        .slice('--additional-field-types='.length)
        .split(',')
        .map(s => s.trim())
        .filter(Boolean);
      continue;
    }
    if (arg.startsWith('-')) {
      io.stderr(`Unknown option "${arg}".`);
      io.stderr(USAGE.trimEnd());
      return 2;
    }
    if (file) {
      io.stderr(`Unexpected extra argument "${arg}".`);
      return 2;
    }
    file = arg;
  }

  if (!file) {
    io.stderr('validate needs a JSON file path.');
    io.stderr(USAGE.trimEnd());
    return 2;
  }

  let raw: string;
  try {
    raw = io.readFile(file);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    io.stderr(`Could not read ${file}: ${reason}`);
    return 2;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    io.stderr(`${file} is not valid JSON: ${reason}`);
    return 2;
  }

  const problems = validateConfig(parsed as Parameters<typeof validateConfig>[0], {
    additionalFieldTypes,
  });

  if (problems.length) io.stdout(formatConfigProblems(problems));

  const failed =
    !isConfigValid(parsed as Parameters<typeof validateConfig>[0], { additionalFieldTypes }) ||
    (failOnWarnings && problems.some(p => p.level === 'warning'));

  return failed ? 1 : 0;
}
