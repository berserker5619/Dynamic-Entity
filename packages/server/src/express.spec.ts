import express from 'express';
import { connect } from 'node:net';
import request from 'supertest';
import { parseCsv, type EntityFormConfig } from '@dynamic-entity/core';
import { createImportRouter, listNamesOf, sendFailure, templateFilename, type OnImport } from './express';
import { ImportError } from './errors';
import { safeFieldName } from './multipart';
import { CONFIG, CSV_TEXT, HEADERS, LOOKUPS, PLAN } from './sheet.fixtures';
import { workbook } from './workbook.fixtures';

/** A plan that is valid for CONFIG but names a field it does not have. */
const BROKEN_PLAN = { entity: 'employee', entries: [{ ref: 'personal.nonsense', column: 0 }] };

function app(
  overrides: Partial<Parameters<typeof createImportRouter>[0]> = {},
  written: Record<string, unknown>[] = [],
): express.Express {
  const onImport: OnImport = records => {
    written.push(...records);
  };
  const server = express();
  server.use(
    '/import',
    createImportRouter({ configs: { employee: CONFIG }, lookups: LOOKUPS, onImport, ...overrides }),
  );
  return server;
}

describe('createImportRouter — construction', () => {
  it('refuses to start when a listName has no list', () => {
    // The defect this prevents is one layer up from `282e668`: without the list, `coerceCell`
    // has nothing to match against and stores the raw cell text, which renders correctly and
    // compares wrong against every rule that names the option. Found in a database next
    // quarter is the expensive failure; an app that will not boot is the cheap one.
    expect(() => app({ lookups: undefined })).toThrow(/"statuses"/);
    expect(() => app({ lookups: undefined })).toThrow(/createImportRouter/);
  });

  it('starts when every list is supplied', () => {
    expect(() => app()).not.toThrow();
  });

  it('cannot check a loader at construction, so it checks it before a row is read', async () => {
    const server = express();
    server.use(
      '/import',
      createImportRouter({
        configs: () => CONFIG,
        onImport: () => undefined,
      }),
    );

    const response = await request(server)
      .post('/import/employee/preview')
      .attach('file', Buffer.from(CSV_TEXT), 'people.csv');

    expect(response.status).toBe(500);
    expect(response.body.error.code).toBe('INTERNAL');
  });
});

describe('listNamesOf', () => {
  it('finds the lists a config resolves against', () => {
    expect(listNamesOf(CONFIG)).toEqual(['statuses']);
  });

  it('finds none when a config has none', () => {
    const plain: EntityFormConfig = {
      entity: 'plain',
      version: 1,
      tabs: [{ id: 't', label: { en: 'T' }, fields: [{ id: 'a', type: 'text', label: { en: 'A' } }] }],
    };
    expect(listNamesOf(plain)).toEqual([]);
  });
});

describe('GET /:entity/template', () => {
  it('streams a CSV template', async () => {
    const response = await request(app()).get('/import/employee/template');

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('text/csv');
    expect(parseCsv(response.text).headers).toHaveLength(5);
  });

  it('names the download from the config, never from the client', async () => {
    const response = await request(app()).get('/import/employee/template');
    expect(response.headers['content-disposition']).toBe(
      'attachment; filename="employee-template.csv"',
    );
  });

  it('streams an xlsx template', async () => {
    const response = await request(app()).get('/import/employee/template?format=xlsx').buffer();
    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('spreadsheetml');
  });

  it('takes a field selection in either spelling', async () => {
    const commas = await request(app()).get(
      '/import/employee/template?fields=personal.firstName,personal.age',
    );
    const repeated = await request(app()).get(
      '/import/employee/template?fields=personal.firstName&fields=personal.age',
    );
    expect(parseCsv(commas.text).headers).toHaveLength(2);
    expect(parseCsv(repeated.text).headers).toEqual(parseCsv(commas.text).headers);
  });

  it('refuses a format it does not write rather than guessing one', async () => {
    const response = await request(app()).get('/import/employee/template?format=pdf');
    expect(response.status).toBe(415);
    expect(response.body.error.code).toBe('UNSUPPORTED_FORMAT');
  });

  it('404s an unknown entity without echoing what was asked for', async () => {
    // Reflecting the key back turns a 404 into a way to probe which entities exist, and into
    // an injection point anywhere the message is rendered.
    const response = await request(app()).get('/import/%3Cscript%3E/template');
    expect(response.status).toBe(404);
    expect(JSON.stringify(response.body)).not.toContain('script');
  });
});

describe('templateFilename', () => {
  it('keeps only characters that cannot mean anything in a header', () => {
    expect(templateFilename('people\r\nX-Injected: 1', 'csv')).toBe(
      'people--X-Injected--1-template.csv',
    );
    expect(templateFilename('../../etc/passwd', 'xlsx')).toBe('etc-passwd-template.xlsx');
  });

  it('falls back to a name rather than producing a bare extension', () => {
    expect(templateFilename('///', 'csv')).toBe('import-template.csv');
  });
});

describe('POST /:entity/preview', () => {
  it('answers with headers, a sample and a suggestion', async () => {
    const response = await request(app())
      .post('/import/employee/preview')
      .attach('file', Buffer.from(CSV_TEXT), 'people.csv');

    expect(response.status).toBe(200);
    expect(response.body.headers).toEqual(HEADERS);
    expect(response.body.rowCount).toBe(4);
    expect(response.body.sample[0][0]).toBe('Alice');
  });

  it('carries the engine version, so the client can notice the two halves have diverged', async () => {
    // `MappingPlan.configVersion` catches config drift and says nothing about engine drift.
    const response = await request(app())
      .post('/import/employee/preview')
      .attach('file', Buffer.from(CSV_TEXT), 'people.csv');
    expect(response.body.engineVersion).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('previews a workbook the same way', async () => {
    const response = await request(app())
      .post('/import/employee/preview')
      .attach('file', await workbook(), 'people.xlsx');

    expect(response.status).toBe(200);
    expect(response.body.headers).toEqual(HEADERS);
    expect(response.body.sample[0]).toEqual(['Alice', '34', '2024-03-07', 'true', 'Active']);
  });

  it('400s a request with no file', async () => {
    const response = await request(app()).post('/import/employee/preview').field('plan', '{}');
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('NO_FILE');
  });

  it('400s a body that is not multipart at all', async () => {
    const response = await request(app())
      .post('/import/employee/preview')
      .set('Content-Type', 'application/json')
      .send('{}');
    expect(response.status).toBe(400);
  });
});

describe('POST /:entity/import', () => {
  it('imports a file and reports what it did', async () => {
    const written: Record<string, unknown>[] = [];
    const response = await request(app({}, written))
      .post('/import/employee/import')
      .field('plan', JSON.stringify(PLAN))
      .attach('file', Buffer.from(CSV_TEXT), 'people.csv');

    expect(response.status).toBe(200);
    expect(response.body.imported).toBe(3);
    expect(response.body.skipped).toBe(1);
    expect(response.body.errors).toEqual([]);
    expect(written).toHaveLength(3);
    expect(written[0]).toMatchObject({ personal: { firstName: 'Alice' } });
  });

  it('resolves a listName field to the option object rather than the text', async () => {
    // The whole reason the lookup pre-flight exists: the record must hold the option, because
    // the displayed text *is* the stored value in this model.
    const written: Record<string, unknown>[] = [];
    await request(app({}, written))
      .post('/import/employee/import')
      .field('plan', JSON.stringify(PLAN))
      .attach('file', Buffer.from(CSV_TEXT), 'people.csv');

    expect((written[0] as { personal: { status: unknown } }).personal.status).toEqual({
      en: 'Active',
      de: 'Aktiv',
    });
  });

  it('imports a workbook to the same records as the same data in CSV', async () => {
    const fromCsv: Record<string, unknown>[] = [];
    await request(app({}, fromCsv))
      .post('/import/employee/import')
      .field('plan', JSON.stringify(PLAN))
      .attach('file', Buffer.from(CSV_TEXT), 'people.csv');

    const fromXlsx: Record<string, unknown>[] = [];
    await request(app({}, fromXlsx))
      .post('/import/employee/import')
      .field('plan', JSON.stringify(PLAN))
      .attach('file', await workbook(), 'people.xlsx');

    expect(fromXlsx).toEqual(fromCsv);
  });

  it('hands the consumer the entity and the request alongside the records', async () => {
    const seen: string[] = [];
    const server = express();
    server.use(
      '/import',
      createImportRouter({
        configs: { employee: CONFIG },
        lookups: LOOKUPS,
        onImport: (_records, context) => {
          seen.push(`${context.entity}:${context.firstRow}:${context.request.method}`);
        },
      }),
    );

    await request(server)
      .post('/import/employee/import')
      .field('plan', JSON.stringify(PLAN))
      .attach('file', Buffer.from(CSV_TEXT), 'people.csv');

    expect(seen).toEqual(['employee:2:POST']);
  });

  it('refuses a plan naming a field the config does not have, and writes nothing', async () => {
    const written: Record<string, unknown>[] = [];
    const response = await request(app({}, written))
      .post('/import/employee/import')
      .field('plan', JSON.stringify(BROKEN_PLAN))
      .attach('file', Buffer.from(CSV_TEXT), 'people.csv');

    expect(response.status).toBe(200);
    expect(response.body.imported).toBe(0);
    expect(response.body.planProblems.some((p: { level: string }) => p.level === 'error')).toBe(true);
    expect(written).toEqual([]);
  });

  it('400s a plan that is not JSON', async () => {
    const response = await request(app())
      .post('/import/employee/import')
      .field('plan', 'not json')
      .attach('file', Buffer.from(CSV_TEXT), 'people.csv');

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('INVALID_PLAN');
  });

  it('says so when the plan field is missing, naming the ordering it needs', async () => {
    const response = await request(app())
      .post('/import/employee/import')
      .attach('file', Buffer.from(CSV_TEXT), 'people.csv');

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('INVALID_PLAN');
    expect(response.body.error.message).toMatch(/before the file/);
  });

  it('a plan naming __proto__ cannot pollute anything', async () => {
    // The plan is attacker-supplied JSON now, so `isUnsafePath` stops being an inherited
    // assurance and starts needing a test.
    const hostile = {
      entity: 'employee',
      entries: [
        { ref: '__proto__.polluted', column: 0 },
        { ref: 'constructor.prototype.polluted', column: 1 },
        { ref: 'personal.firstName', column: 0 },
      ],
    };

    const written: Record<string, unknown>[] = [];
    const response = await request(app({}, written))
      .post('/import/employee/import')
      .field('plan', JSON.stringify(hostile))
      .attach('file', Buffer.from(CSV_TEXT), 'people.csv');

    expect(({} as { polluted?: unknown }).polluted).toBeUndefined();
    expect((Object.prototype as { polluted?: unknown }).polluted).toBeUndefined();
    // And the refs it did not recognise are reported rather than quietly dropped.
    expect(response.body.planProblems.some((p: { level: string }) => p.level === 'error')).toBe(true);
    expect(written).toEqual([]);
  });

  it('500s when the consumer writer throws, and says nothing about why', async () => {
    const server = express();
    server.use(
      '/import',
      createImportRouter({
        configs: { employee: CONFIG },
        lookups: LOOKUPS,
        onImport: () => {
          throw new Error('ECONNREFUSED 10.0.0.4:5432');
        },
      }),
    );

    const response = await request(server)
      .post('/import/employee/import')
      .field('plan', JSON.stringify(PLAN))
      .attach('file', Buffer.from(CSV_TEXT), 'people.csv');

    expect(response.status).toBe(500);
    expect(response.body.error.code).toBe('IMPORT_FAILED');
    expect(JSON.stringify(response.body)).not.toContain('ECONNREFUSED');
    // And it says the thing a consumer has to know about a non-transactional import.
    expect(response.body.error.message).toMatch(/not transactional/);
  });

  it('413s an upload past maxBytes without reading the whole body', async () => {
    const server = express();
    server.use(
      '/import',
      createImportRouter({
        configs: { employee: CONFIG },
        lookups: LOOKUPS,
        onImport: () => undefined,
        limits: { maxBytes: 1024 },
      }),
    );

    const big = Buffer.concat([
      Buffer.from(`${HEADERS.join(',')}\r\n`),
      Buffer.from('Alice,34,2024-03-07,true,Active\r\n'.repeat(5000)),
    ]);
    const response = await request(server)
      .post('/import/employee/import')
      .field('plan', JSON.stringify(PLAN))
      .attach('file', big, 'people.csv');

    expect(response.status).toBe(413);
    expect(response.body.error.code).toBe('TOO_LARGE');
  });

  it('413s an over-long plan field rather than failing to parse a truncated one', async () => {
    const server = express();
    server.use(
      '/import',
      createImportRouter({
        configs: { employee: CONFIG },
        lookups: LOOKUPS,
        onImport: () => undefined,
        limits: { maxFieldBytes: 32 },
      }),
    );

    const response = await request(server)
      .post('/import/employee/import')
      .field('plan', JSON.stringify(PLAN))
      .attach('file', Buffer.from(CSV_TEXT), 'people.csv');

    expect(response.status).toBe(413);
    expect(response.body.error.code).toBe('TOO_LARGE');
  });

  it('refuses a second file part', async () => {
    const server = express();
    server.use(
      '/import',
      createImportRouter({
        configs: { employee: CONFIG },
        lookups: LOOKUPS,
        onImport: () => undefined,
        limits: { maxFiles: 1 },
      }),
    );

    const response = await request(server)
      .post('/import/employee/import')
      .field('plan', JSON.stringify(PLAN))
      .attach('file', Buffer.from(CSV_TEXT), 'a.csv')
      .attach('other', Buffer.from(CSV_TEXT), 'b.csv');

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('TOO_MANY_FILES');
  });

  it('refuses a zip bomb with a limit-specific code', async () => {
    const { zipBomb } = await import('./workbook.fixtures');
    const server = express();
    server.use(
      '/import',
      createImportRouter({
        configs: { employee: CONFIG },
        lookups: LOOKUPS,
        onImport: () => undefined,
        limits: { maxUncompressedBytes: 1024 * 1024 },
      }),
    );

    const response = await request(server)
      .post('/import/employee/import')
      .field('plan', JSON.stringify(PLAN))
      .attach('file', await zipBomb(64 * 1024 * 1024), 'people.xlsx');

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('ARCHIVE_REFUSED');
  });
});

describe('POST /:entity/validate', () => {
  it('runs the identical pipeline and writes nothing', async () => {
    const written: Record<string, unknown>[] = [];
    const bad = `${HEADERS.join(',')}\r\nAlice,nonsense,2024-03-07,true,Active\r\n`;

    const response = await request(app({}, written))
      .post('/import/employee/validate')
      .field('plan', JSON.stringify(PLAN))
      .attach('file', Buffer.from(bad), 'people.csv');

    expect(response.status).toBe(200);
    expect(response.body.errorCount).toBe(1);
    expect(response.body.errors[0].ref).toBe('personal.age');
    expect(written).toEqual([]);
  });

  it('answers the same numbers an import would, minus the writing', async () => {
    const written: Record<string, unknown>[] = [];
    const validated = await request(app({}, written))
      .post('/import/employee/validate')
      .field('plan', JSON.stringify(PLAN))
      .attach('file', Buffer.from(CSV_TEXT), 'people.csv');

    const imported = await request(app({}, written))
      .post('/import/employee/import')
      .field('plan', JSON.stringify(PLAN))
      .attach('file', Buffer.from(CSV_TEXT), 'people.csv');

    expect(validated.body).toEqual(imported.body);
    expect(written).toHaveLength(3);
  });

  it('reports the true count when it retains only a sample', async () => {
    const server = express();
    server.use(
      '/import',
      createImportRouter({
        configs: { employee: CONFIG },
        lookups: LOOKUPS,
        onImport: () => undefined,
        limits: { maxReportedErrors: 5 },
      }),
    );

    const bad = `${HEADERS.join(',')}\r\n${'Alice,nonsense,,,\r\n'.repeat(50)}`;
    const response = await request(server)
      .post('/import/employee/validate')
      .field('plan', JSON.stringify(PLAN))
      .attach('file', Buffer.from(bad), 'people.csv');

    expect(response.body.errors).toHaveLength(5);
    expect(response.body.errorCount).toBe(50);
    expect(response.body.truncated).toBe(true);
  });
});

describe('the guards that need a socket rather than a client', () => {
  /** Open a raw connection, send whatever is given, and report how it ended. */
  function raw(
    server: express.Express,
    head: string,
    body: string,
    keepOpen: boolean,
  ): Promise<{ closed: boolean; response: string }> {
    return new Promise((resolve, reject) => {
      const listener = server.listen(0, () => {
        const port = (listener.address() as { port: number }).port;
        const socket = connect(port, '127.0.0.1', () => {
          socket.write(head.replace('{host}', `127.0.0.1:${port}`));
          socket.write(body);
          if (!keepOpen) socket.end();
        });

        let response = '';
        socket.setEncoding('utf8');
        socket.on('data', chunk => (response += chunk));
        const finish = (closed: boolean): void => {
          socket.destroy();
          listener.close(() => resolve({ closed, response }));
        };
        socket.on('close', () => finish(true));
        socket.on('error', () => finish(true));
        // Long enough to be past the timeouts under test, short enough not to stall the suite.
        setTimeout(() => finish(false), 3000).unref();
        listener.on('error', reject);
      });
    });
  }

  const BOUNDARY = 'xyzboundary';
  const headers = (length: number | null): string =>
    [
      'POST /import/employee/preview HTTP/1.1',
      'Host: {host}',
      `Content-Type: multipart/form-data; boundary=${BOUNDARY}`,
      length === null ? 'Transfer-Encoding: chunked' : `Content-Length: ${length}`,
      'Connection: close',
      '',
      '',
    ].join('\r\n');

  it('drops a connection that goes quiet mid-body', async () => {
    // Slowloris: a client that promises a body and then sends a byte a minute holds a socket
    // for as long as it likes. The reply it wants least is the connection going away.
    const server = app({ limits: { idleTimeoutMs: 300 } });
    const partial = `--${BOUNDARY}\r\nContent-Disposition: form-data; name="file"; filename="a.csv"\r\n\r\nname\r\n`;

    const start = Date.now();
    const { closed } = await raw(server, headers(100_000), partial, true);

    expect(closed).toBe(true);
    expect(Date.now() - start).toBeLessThan(2500);
  });

  it('drops a connection that never finishes, however chatty it is', async () => {
    const server = app({ limits: { idleTimeoutMs: 60_000, totalTimeoutMs: 300 } });
    const partial = `--${BOUNDARY}\r\nContent-Disposition: form-data; name="file"; filename="a.csv"\r\n\r\nname\r\n`;

    const { closed } = await raw(server, headers(100_000), partial, true);
    expect(closed).toBe(true);
  });

  it('400s a multipart body whose parts are malformed', async () => {
    const body = `--${BOUNDARY}\r\nnot-a-header-at-all\r\n\r\ndata\r\n--${BOUNDARY}--\r\n`;
    const { response } = await raw(app(), headers(body.length), body, false);
    expect(response).toMatch(/HTTP\/1\.1 400/);
  });

  it('refuses a second file part even when the parser was allowed one', async () => {
    // `maxFiles` decides when busboy gives up; this reader takes the first file and refuses a
    // second either way. Two files is a request whose author and whose reader disagree about
    // which one was imported.
    const response = await request(app({ limits: { maxFiles: 4 } }))
      .post('/import/employee/import')
      .field('plan', JSON.stringify(PLAN))
      .attach('file', Buffer.from(CSV_TEXT), 'a.csv')
      .attach('other', Buffer.from(CSV_TEXT), 'b.csv');

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('TOO_MANY_FILES');
  });
});

describe('sendFailure', () => {
  const fakeResponse = (headersSent: boolean): {
    headersSent: boolean;
    destroyed: boolean;
    code: number;
    body: unknown;
    status(code: number): unknown;
    json(body: unknown): void;
    destroy(): void;
  } => {
    const response = {
      headersSent,
      destroyed: false,
      code: 0,
      body: undefined as unknown,
      status(code: number) {
        response.code = code;
        return response;
      },
      json(body: unknown) {
        response.body = body;
      },
      destroy() {
        response.destroyed = true;
      },
    };
    return response;
  };

  it('answers with the envelope when nothing has been sent yet', () => {
    const response = fakeResponse(false);
    sendFailure(response as unknown as express.Response, new ImportError('NO_FILE', 'No file.'));
    expect(response.code).toBe(400);
    expect(response.body).toEqual({ error: { code: 'NO_FILE', message: 'No file.' } });
  });

  it('ends the connection when the response has already started', () => {
    // A template that failed part-way is already partly on the wire. A 200 with a truncated
    // body is a corrupt file that looks like a good one — the worst outcome available.
    const response = fakeResponse(true);
    sendFailure(response as unknown as express.Response, new Error('mid-write'));
    expect(response.destroyed).toBe(true);
    expect(response.code).toBe(0);
  });
});

describe('multipart abuse', () => {
  it('refuses a body of a thousand tiny fields', async () => {
    const server = app({ limits: { maxFields: 4 } });
    let call = request(server).post('/import/employee/import');
    for (let i = 0; i < 20; i++) call = call.field(`f${i}`, 'x');
    const response = await call.attach('file', Buffer.from(CSV_TEXT), 'a.csv');

    expect(response.status).toBe(413);
    expect(response.body.error.code).toBe('TOO_LARGE');
  });

  it('sanitises the field name it puts in the refusal, because a message is a log line', () => {
    expect(safeFieldName('a b!@#c')).toBe('abc');
    expect(safeFieldName('ev\\nil')).toBe('evnil');
    expect(safeFieldName('!!!')).toBe('unnamed');
    expect(safeFieldName('x'.repeat(200))).toHaveLength(40);
  });

  it('names an over-long field rather than failing to parse a truncated one', async () => {
    const response = await request(app({ limits: { maxFieldBytes: 8 } }))
      .post('/import/employee/import')
      .field('notes', 'a value that is comfortably too long')
      .attach('file', Buffer.from(CSV_TEXT), 'a.csv');

    expect(response.status).toBe(413);
    expect(response.body.error.message).toContain('notes');
  });
});
