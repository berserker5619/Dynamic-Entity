/** loadOptional (`node/optional.ts`): a missing optional peer says what to install. */
import { loadOptional } from './optional';

const notFound = (code: string, message: string): Error => Object.assign(new Error(message), { code });

describe('loadOptional', () => {
  it('hands back what the import gave', async () => {
    await expect(loadOptional('exceljs', 'read .xlsx files', async () => ({ ok: true }))).resolves.toEqual({ ok: true });
  });

  it.each([
    ['MODULE_NOT_FOUND', "Cannot find module 'exceljs'\nRequire stack:\n- /app/node_modules/sheet-to-schema/dist/node/index.js"],
    ['ERR_MODULE_NOT_FOUND', "Cannot find package 'exceljs' imported from /app/node_modules/sheet-to-schema/dist/node/index.mjs"],
  ])('says what to install when the package is missing (%s)', async (code, message) => {
    const cause = notFound(code, message);
    const failure = await loadOptional('exceljs', 'read and write .xlsx files', () => Promise.reject(cause)).catch((error: Error) => error);
    expect(failure.message).toBe(
      'sheet-to-schema/node needs the "exceljs" package to read and write .xlsx files, and it is not installed. ' +
        'It is an optional peer dependency: run `npm install exceljs`.',
    );
    expect(failure.cause).toBe(cause);
  });

  it('really does fail that way for a package that is not there', async () => {
    const name = 'a-package-that-does-not-exist-anywhere';
    // A variable, so neither the compiler nor Jest's resolver looks for it ahead of time.
    await expect(loadOptional(name, 'do the impossible', () => import(name))).rejects.toThrow(
      `needs the "${name}" package to do the impossible`,
    );
  });

  it('does not mistake a package that is installed but broken for a missing one', async () => {
    // exceljs is there; something it needs is not. Telling the user to install exceljs would be wrong.
    const inner = notFound('MODULE_NOT_FOUND', "Cannot find module 'archiver'\nRequire stack:\n- /app/node_modules/exceljs/lib/exceljs.nodejs.js");
    await expect(loadOptional('exceljs', 'read .xlsx files', () => Promise.reject(inner))).rejects.toBe(inner);
  });

  it('rethrows anything else as it is', async () => {
    const boom = new SyntaxError('Unexpected token');
    await expect(loadOptional('exceljs', 'read .xlsx files', () => Promise.reject(boom))).rejects.toBe(boom);
    await expect(loadOptional('exceljs', 'read .xlsx files', () => Promise.reject('a string'))).rejects.toBe('a string');
    await expect(loadOptional('exceljs', 'read .xlsx files', () => Promise.reject(null))).rejects.toBeNull();
  });
});
