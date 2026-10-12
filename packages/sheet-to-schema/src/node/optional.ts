/**
 * optional.ts — loading a package this one only needs for some of what `/node` does.
 *
 * `exceljs` reads and writes workbooks and `busboy` reads a multipart upload. Neither is
 * needed to read a CSV, and neither belongs in a browser, so both are optional peer
 * dependencies and are loaded when first used. When one is missing, the failure has to say so:
 * Node's own "Cannot find module" names a file deep inside this package and not what to do.
 */

/** Node's two spellings of "that package is not installed", for `require` and for `import`. */
const MISSING = new Set(['MODULE_NOT_FOUND', 'ERR_MODULE_NOT_FOUND']);

/** Whether `error` says the package `name` itself is absent, not something inside it. */
function isMissing(error: unknown, name: string): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const { code, message } = error as { code?: unknown; message?: unknown };
  return MISSING.has(String(code)) && String(message).includes(`'${name}'`);
}

/**
 * Load an optional peer dependency, or fail with what to install and why.
 *
 * `load` is the import itself, written at the call site so a bundler can see it. Any other
 * failure, such as a broken install of the package, is rethrown as it is.
 */
export async function loadOptional<T>(name: string, neededTo: string, load: () => Promise<T>): Promise<T> {
  try {
    return await load();
  } catch (error) {
    if (!isMissing(error, name)) throw error;
    throw new Error(
      `sheet-to-schema/node needs the "${name}" package to ${neededTo}, and it is not installed. ` +
        `It is an optional peer dependency: run \`npm install ${name}\`.`,
      { cause: error },
    );
  }
}
