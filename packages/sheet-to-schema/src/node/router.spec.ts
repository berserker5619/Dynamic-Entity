import express from 'express';
import { connect } from 'node:net';
import request from 'supertest';
import { IMPORTER_VERSION, jsonSchemaAdapter, parseCsv } from 'sheet-to-schema';
import { ImportError } from './errors';
import { safeFieldName } from './multipart';
import { createImportRouter, sendFailure, templateFilename, templateOf, type ImportBinding, type ImportRouterOptions, type OnImport } from './router';
import { GROUPING_NOT_STREAMED } from './run-import';
import { CSV_TEXT, EMPLOYEES, HEADERS, PLAN } from './sheet.fixtures';
import { workbook } from './workbook.fixtures';

/** A plan for the employee schema that names a field it does not have. */
const BROKEN_PLAN = { entity: 'employee', entries: [{ ref: 'personal.nonsense', column: 0 }] };

/** What the path's `employee` imports into. The adapter wants no context. */
const EMPLOYEE: ImportBinding = { adapter: EMPLOYEES, ctx: undefined, kind: 'json-schema' };

function app(overrides: Partial<ImportRouterOptions> = {}, written: Record<string, unknown>[] = []): express.Express {
  const onImport: OnImport = records => {
    written.push(...records);
  };
  const server = express();
  server.use('/import', createImportRouter(express.Router(), { bindings: { employee: EMPLOYEE }, onImport, ...overrides }));
  return server;
}

describe('GET /:name/template', () => {
  it('streams a CSV template', async () => {
    const response = await request(app()).get('/import/employee/template');

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('text/csv');
    expect(parseCsv(response.text).headers).toHaveLength(5);
  });

  it('names the download from the schema, never from the client', async () => {
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

  it('does not answer a refusal wearing the download it was about to send', async () => {
    // A 413 whose headers say `text/csv` and `attachment; filename=…` is an error a browser
    // saves as the template. The format refusal above takes a path that throws before the
    // headers are set; this one takes the path that does not.
    const wide = app({ limits: { maxColumns: 2 } });
    const response = await request(wide).get('/import/employee/template');

    expect(response.status).toBe(413);
    expect(response.headers['content-type']).toContain('application/json');
    expect(response.headers['content-disposition']).toBeUndefined();
    expect(response.body.error.code).toBe('SHEET_TOO_LARGE');
  });

  it('names the download from the schema, not from the route it was mounted at', async () => {
    // A consumer mounting a plural route gets a file named after the data, not after the URL.
    // The map key is a route segment and carries no other meaning.
    const server = express();
    server.use(
      '/import',
      createImportRouter(express.Router(), {
        bindings: { employees: EMPLOYEE },
        onImport: () => undefined,
      }),
    );
    const response = await request(server).get('/import/employees/template');
    expect(response.headers['content-disposition']).toBe(
      'attachment; filename="employee-template.csv"',
    );
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

describe('POST /:name/preview', () => {
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

  it('reads a .tsv upload by tabs, by the name the client sent', async () => {
    // The multipart filename (`multipart.ts`) reaches `readSheet` through `previewSheet`. The
    // header has more commas than tabs, so only the name can make this a tab split.
    const response = await request(app())
      .post('/import/employee/preview')
      .attach('file', Buffer.from('First Name\tNote, if any\nAlice\tfine\n'), 'people.tsv');

    expect(response.status).toBe(200);
    expect(response.body.delimiter).toBe('\t');
    expect(response.body.headers).toEqual(['First Name', 'Note, if any']);
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

describe('POST /:name/import', () => {
  it('imports a file and reports what it did', async () => {
    const written: Record<string, unknown>[] = [];
    const response = await request(app({}, written))
      .post('/import/employee/import')
      .field('plan', JSON.stringify(PLAN))
      .attach('file', Buffer.from(CSV_TEXT), 'people.csv');

    expect(response.status).toBe(200);
    expect(response.body.imported).toBe(3);
    expect(response.body.skipped).toBe(1);
    expect(response.body.failed).toBe(0);
    expect(response.body.errors).toEqual([]);
    // The counts reconcile against what was read, which is the point of reporting them.
    expect(response.body.imported + response.body.skipped + response.body.failed).toBe(
      response.body.rowsRead,
    );
    expect(written).toHaveLength(3);
    expect(written[0]).toMatchObject({ personal: { firstName: 'Alice' } });
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
      createImportRouter(express.Router(), {
        bindings: { employee: EMPLOYEE },
        onImport: (_records, context) => {
          seen.push(`${context.name}:${context.firstRow}:${context.request.method}`);
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
    // The code crosses the wire with the problem.
    expect(response.body.planProblems.map((p: { code?: string }) => p.code)).toContain('PLAN_UNKNOWN_REF');
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
    // And the refs are reported, by the reader's own code for a reserved key, rather than
    // quietly dropped. (Dynamic Entity 2.x has no such code and calls them unknown refs.)
    expect(response.body.planProblems.some((p: { level: string }) => p.level === 'error')).toBe(true);
    expect(
      response.body.planProblems.filter((p: { code?: string }) => p.code === 'PLAN_UNSAFE_PATH').map((p: { path: string }) => p.path),
    ).toEqual(['entries[0].ref', 'entries[1].ref']);
    expect(written).toEqual([]);
  });

  it('500s when the consumer writer throws, and says nothing about why', async () => {
    const server = express();
    server.use(
      '/import',
      createImportRouter(express.Router(), {
        bindings: { employee: EMPLOYEE },
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
      createImportRouter(express.Router(), {
        bindings: { employee: EMPLOYEE },
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
      createImportRouter(express.Router(), {
        bindings: { employee: EMPLOYEE },
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
      createImportRouter(express.Router(), {
        bindings: { employee: EMPLOYEE },
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
      createImportRouter(express.Router(), {
        bindings: { employee: EMPLOYEE },
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

describe('POST /:name/validate', () => {
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

  it('answers the same numbers an import would, and says it wrote none of them', async () => {
    const written: Record<string, unknown>[] = [];
    const validated = await request(app({}, written))
      .post('/import/employee/validate')
      .field('plan', JSON.stringify(PLAN))
      .attach('file', Buffer.from(CSV_TEXT), 'people.csv');

    const imported = await request(app({}, written))
      .post('/import/employee/import')
      .field('plan', JSON.stringify(PLAN))
      .attach('file', Buffer.from(CSV_TEXT), 'people.csv');

    // Identical in every count — that is what "the identical pipeline" means — and different
    // in the one field that says whether anything was stored. Without `written`, `imported`
    // reads as a count of records written on the route where nothing was.
    expect({ ...validated.body, written: undefined }).toEqual({ ...imported.body, written: undefined });
    expect(validated.body.written).toBe(false);
    expect(imported.body.written).toBe(true);
    expect(written).toHaveLength(3);
  });

  it('reports the true count when it retains only a sample', async () => {
    const server = express();
    server.use(
      '/import',
      createImportRouter(express.Router(), {
        bindings: { employee: EMPLOYEE },
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
  const fakeResponse = (headersSent: boolean, headers: Record<string, string> = {}) => {
    const response = {
      headersSent,
      destroyed: false,
      code: 0,
      body: undefined as unknown,
      headers: { ...headers },
      status(code: number) {
        response.code = code;
        return response;
      },
      json(body: unknown) {
        response.body = body;
      },
      removeHeader(name: string) {
        delete response.headers[name];
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

  it('takes off the headers of the download it was about to send', () => {
    // Measured, not theorised: `res.json` only sets a content type when one is not already
    // there, so a template that failed after its headers were set answered 413 with a JSON
    // body wearing `text/csv` and an `attachment` filename — which a browser saves as the
    // template it asked for.
    const response = fakeResponse(false, {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="employee-template.csv"',
      'X-Consumer-Header': 'kept',
    });
    sendFailure(response as unknown as express.Response, new ImportError('SHEET_TOO_LARGE', 'Too wide.'));

    expect(response.headers).toEqual({ 'X-Consumer-Header': 'kept' });
    expect(response.code).toBe(413);
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

  it('refuses a repeated part rather than quietly taking the last one', async () => {
    // Last-one-wins is a rule this code would be choosing on a client's behalf, and anything
    // upstream that read the *first* plan would be acting on a different plan from the one
    // imported.
    const response = await request(app())
      .post('/import/employee/import')
      .field('plan', JSON.stringify(PLAN))
      .field('plan', JSON.stringify(BROKEN_PLAN))
      .attach('file', Buffer.from(CSV_TEXT), 'people.csv');

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('MALFORMED_FILE');
    expect(response.body.error.message).toContain('plan');
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

/**
 * `bindings` is a plain object, so `bindings['constructor']` is `Object`, not `undefined`. An
 * inherited key must 404 like any other unknown name rather than run against a built-in.
 */
describe('createImportRouter — entity names that are Object.prototype keys', () => {
  for (const entity of ['constructor', '__proto__', 'toString', 'hasOwnProperty']) {
    it(`404s for "${entity}"`, async () => {
      const template = await request(app()).get(`/import/${entity}/template`);
      expect(template.status).toBe(404);
      expect(template.body.error.code).toBe('UNKNOWN_ENTITY');

      const preview = await request(app())
        .post(`/import/${entity}/preview`)
        .attach('file', Buffer.from('a,b\n1,2\n'), 'x.csv');
      expect(preview.status).toBe(404);
    });
  }
});

// ─── What the generic router adds ─────────────────────────────────────────────

describe('what every answer says about the server', () => {
  const preview = (server = app()) => request(server).post('/import/employee/preview').attach('file', Buffer.from(CSV_TEXT), 'people.csv');
  const commit = (route: string, plan: unknown = PLAN) =>
    request(app()).post(`/import/employee/${route}`).field('plan', JSON.stringify(plan)).attach('file', Buffer.from(CSV_TEXT), 'people.csv');

  it('stamps a preview with the importer version, the adapter and the plan versions it reads', async () => {
    const { body } = await preview();
    expect(body.engineVersion).toBe(IMPORTER_VERSION);
    expect(body.adapter).toEqual({ name: 'json-schema', version: EMPLOYEES.adapterVersion });
    // A client must not commit a v2-only plan to a server that does not list 2 (spec §4).
    expect(body.planVersions).toEqual([1, 2]);
    expect(body.slots).toEqual({});
    expect(body.suggestion).toMatchObject({ planVersion: 2, target: 'employee' });
  });

  it('stamps an import and a validation the same way, and reports warnings beside errors', async () => {
    for (const route of ['import', 'validate']) {
      const { body } = await commit(route);
      expect(body).toMatchObject({
        written: route === 'import',
        engineVersion: IMPORTER_VERSION,
        adapter: { name: 'json-schema', version: EMPLOYEES.adapterVersion },
        imported: 3,
        rowsInImported: 3,
        warnings: [],
        warningCount: 0,
      });
    }
  });

  it('calls an adapter it was told nothing about "custom"', async () => {
    const server = express();
    server.use('/import', createImportRouter(express.Router(), { bindings: { employee: { adapter: EMPLOYEES, ctx: undefined } }, onImport: () => undefined }));
    expect((await preview(server)).body.adapter.name).toBe('custom');
  });

  it('gives every error a code, which a 2.x server did not', async () => {
    const text = `${HEADERS.join(',')}\r\nAlice,old,2024-03-07,true,Active\r\n,34,,,\r\n`;
    const { body } = await request(app()).post('/import/employee/validate').field('plan', JSON.stringify(PLAN)).attach('file', Buffer.from(text), 'p.csv');
    expect(body.errors.map((error: { row: number; ref: string; code: string }) => [error.row, error.ref, error.code])).toEqual([
      [2, 'personal.age', 'CELL_FORMAT'],
      [3, 'personal.firstName', 'RECORD_REQUIRED'],
    ]);
    expect(body.failed).toBe(2);
  });
});

describe('a plan that groups rows, over HTTP', () => {
  const ORDERS = jsonSchemaAdapter({
    $id: 'order',
    type: 'object',
    properties: { orderId: { type: 'string' }, items: { type: 'array', items: { type: 'object', properties: { sku: { type: 'string' } } } } },
  });
  const grouped = { planVersion: 2, target: 'order', entries: [{ ref: 'orderId', column: 0 }, { ref: 'items.sku', column: 1 }], group: { key: [0], collect: ['items'] } };

  it('is refused as INVALID_PLAN, saying this server does not group yet and the browser does, and writes nothing', async () => {
    const written: Record<string, unknown>[] = [];
    for (const route of ['import', 'validate']) {
      const response = await request(app({ bindings: { order: { adapter: ORDERS, ctx: undefined } } }, written))
        .post(`/import/order/${route}`)
        .field('plan', JSON.stringify(grouped))
        .attach('file', Buffer.from('orderId,sku\r\nA,S1\r\nA,S2\r\n'), 'orders.csv');
      expect(response.status).toBe(400);
      expect(response.body.error).toEqual({
        code: 'INVALID_PLAN',
        message: GROUPING_NOT_STREAMED,
        details: [{ level: 'error', code: 'PLAN_GROUP', path: 'group', message: GROUPING_NOT_STREAMED }],
      });
    }
    expect(written).toEqual([]);
  });
});

describe('bindings', () => {
  it('come from a function, which sees the request and can say there is no such name', async () => {
    const seen: string[] = [];
    const server = express();
    server.use(
      '/import',
      createImportRouter(express.Router(), {
        bindings: (name, incoming) => {
          seen.push(`${name}:${incoming.method}`);
          return name === 'staff' ? EMPLOYEE : undefined;
        },
        onImport: () => undefined,
      }),
    );
    expect((await request(server).get('/import/staff/template')).status).toBe(200);
    const missing = await request(server).get('/import/nobody/template');
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe('UNKNOWN_ENTITY');
    expect(seen).toEqual(['staff:GET', 'nobody:GET']);
  });

  it('answer 500 with nothing of the cause when the function throws', async () => {
    const server = express();
    server.use('/import', createImportRouter(express.Router(), { bindings: () => Promise.reject(new Error('db down at 10.0.0.4')), onImport: () => undefined }));
    const response = await request(server).get('/import/staff/template');
    expect(response.status).toBe(500);
    expect(JSON.stringify(response.body)).not.toContain('10.0.0.4');
  });

  it('hand the writer the name, the binding and the request', async () => {
    const seen: unknown[] = [];
    const server = express();
    server.use(
      '/import',
      createImportRouter(express.Router(), {
        bindings: { employee: EMPLOYEE },
        onImport: (_records, context) => void seen.push([context.name, context.binding === EMPLOYEE, context.request.method, context.index]),
      }),
    );
    await request(server).post('/import/employee/import').field('plan', JSON.stringify(PLAN)).attach('file', Buffer.from(CSV_TEXT), 'p.csv');
    expect(seen).toEqual([['employee', true, 'POST', 0]]);
  });

  it('may write their own template, and add their own fields to a preview', async () => {
    const asked: unknown[] = [];
    const binding: ImportBinding = {
      ...EMPLOYEE,
      template: selection => {
        asked.push(selection);
        return { sheetName: 'Staff', headers: ['Name'], notes: ['Required'] };
      },
      // An extra may not restate what the server is: the stamps are written after it.
      previewExtras: preview => ({ arrayBound: 3, widest: preview.headers.length, engineVersion: 'spoofed', planVersions: [9] }),
    };
    const server = express();
    server.use('/import', createImportRouter(express.Router(), { bindings: { employee: binding }, onImport: () => undefined, lang: incoming => String(incoming.query['lang'] ?? 'en') }));

    const template = await request(server).get('/import/employee/template?fields=a,b&lang=de');
    expect(parseCsv(template.text).headers).toEqual(['Name']);
    expect(asked).toEqual([{ lang: 'de', fields: ['a', 'b'] }]);

    const preview = await request(server).post('/import/employee/preview').attach('file', Buffer.from(CSV_TEXT), 'p.csv');
    expect(preview.body).toMatchObject({ arrayBound: 3, widest: 5, engineVersion: IMPORTER_VERSION, planVersions: [1, 2] });
  });
});

describe('templateOf', () => {
  const people = jsonSchemaAdapter({
    $id: 'people',
    type: 'object',
    required: ['name'],
    properties: {
      name: { type: 'string', title: 'Name' },
      born: { type: 'string', format: 'date', title: 'Born' },
      phones: { type: 'array', title: 'Phone', items: { type: 'object', properties: { number: { type: 'string', title: 'Number' } } } },
    },
  });

  it('offers every target, with each array at the default number of slots', () => {
    expect(templateOf(people, 'en', undefined)).toEqual({
      sheetName: 'people',
      headers: ['Name', 'Born', 'Phone / Number 1', 'Phone / Number 2', 'Phone / Number 3'],
      notes: ['Required', 'YYYY-MM-DD', '', '', ''],
    });
  });

  it('keeps a selection, named by shape ref, and joins what it has to say about a column', () => {
    const required = jsonSchemaAdapter({ $id: 'x', type: 'object', required: ['born'], properties: { born: { type: 'string', format: 'date' }, name: { type: 'string' } } });
    expect(templateOf(required, 'en', ['born'])).toEqual({ sheetName: 'x', headers: ['born'], notes: ['Required. YYYY-MM-DD'] });
    expect(templateOf(people, 'en', ['phones.number']).headers).toEqual(['Phone / Number 1', 'Phone / Number 2', 'Phone / Number 3']);
    expect(templateOf(people, 'en', ['nothing']).headers).toEqual([]);
  });
});

describe('the router\'s date order', () => {
  const EVENTS = jsonSchemaAdapter({ $id: 'events', type: 'object', properties: { name: { type: 'string' }, starts: { type: 'string', format: 'date' } } });
  const SHEET = 'name,starts\r\nLaunch,05/09/2026\r\n';
  const plan = { planVersion: 2, target: 'events', entries: [{ ref: 'name', column: 0 }, { ref: 'starts', column: 1 }] };
  const server = (dateOrder: 'DMY' | 'MDY' | undefined, written: Record<string, unknown>[] = []) =>
    app({ bindings: { events: { adapter: EVENTS, ctx: undefined } }, ...(dateOrder ? { dateOrder } : {}) }, written);
  const post = (route: string, target: express.Express) => request(target).post(`/import/events/${route}`).field('plan', JSON.stringify(plan)).attach('file', Buffer.from(SHEET), 'e.csv');

  it('is what every import and validation is read with, where a plan entry states none', async () => {
    const written: Record<string, unknown>[] = [];
    expect((await post('import', server('DMY', written))).body).toMatchObject({ imported: 1, failed: 0 });
    expect(written).toEqual([{ name: 'Launch', starts: '2026-09-05' }]);
    expect((await post('validate', server('MDY'))).body).toMatchObject({ imported: 1, failed: 0 });
    expect((await post('validate', server(undefined))).body).toMatchObject({ imported: 0, failed: 1 });
  });

  it('is reported in the preview, so a client reads its sample the same way, and left out when there is none', async () => {
    const preview = (target: express.Express) => request(target).post('/import/events/preview').attach('file', Buffer.from(SHEET), 'e.csv');
    expect((await preview(server('DMY'))).body.dateOrder).toBe('DMY');
    expect((await preview(server(undefined))).body).not.toHaveProperty('dateOrder');
  });
});
