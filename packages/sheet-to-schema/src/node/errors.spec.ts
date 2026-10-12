import { ImportError, toErrorBody } from './errors';

describe('ImportError', () => {
  it('carries the status its code answers with', () => {
    expect(new ImportError('TOO_LARGE', 'x').status).toBe(413);
    expect(new ImportError('UNKNOWN_ENTITY', 'x').status).toBe(404);
    expect(new ImportError('IMPORT_FAILED', 'x').status).toBe(500);
  });

  it('keeps the real cause on the server, where a logger can reach it', () => {
    const cause = new Error('ECONNREFUSED 10.0.0.4:5432');
    const error = new ImportError('IMPORT_FAILED', 'The import stopped partway through.', { cause });
    expect((error as { cause?: unknown }).cause).toBe(cause);
  });

  it('is an Error, so an existing handler still catches it', () => {
    expect(new ImportError('INTERNAL', 'x')).toBeInstanceOf(Error);
  });
});

describe('toErrorBody', () => {
  it('reports a known failure with its code and message', () => {
    const { status, body } = toErrorBody(new ImportError('NO_FILE', 'No file was uploaded.'));
    expect(status).toBe(400);
    expect(body).toEqual({ error: { code: 'NO_FILE', message: 'No file was uploaded.' } });
  });

  it('carries plan problems, which describe the caller back to itself', () => {
    const details = [{ level: 'error', path: 'entries[0].ref', message: 'Unknown field.' }];
    const { body } = toErrorBody(new ImportError('INVALID_PLAN', 'The plan is not valid.', { details }));
    expect(body.error.details).toEqual(details);
  });

  it('tells an attacker nothing about anything below this package', () => {
    // The guard, not a nicety: a parser's own message names the parser and a filesystem error
    // names the filesystem. Neither belongs in a response.
    const leaky = new Error("ENOENT: no such file or directory, open '/srv/app/tmp/upload-91.xlsx'");
    const { status, body } = toErrorBody(leaky);

    expect(status).toBe(500);
    expect(body).toEqual({
      error: { code: 'INTERNAL', message: 'The import could not be completed.' },
    });
    expect(JSON.stringify(body)).not.toContain('/srv/app');
    expect(JSON.stringify(body)).not.toContain('ENOENT');
  });

  it('survives something thrown that is not an Error at all', () => {
    expect(toErrorBody('nope').body.error.code).toBe('INTERNAL');
    expect(toErrorBody(undefined).body.error.code).toBe('INTERNAL');
  });

  it('never carries a stack', () => {
    const body = toErrorBody(new ImportError('MALFORMED_FILE', 'Not a readable sheet.')).body;
    expect(JSON.stringify(body)).not.toContain('at ');
    expect('stack' in body.error).toBe(false);
  });
});
