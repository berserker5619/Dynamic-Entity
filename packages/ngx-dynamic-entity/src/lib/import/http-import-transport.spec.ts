import {
  buildTemplateSpec,
  CORE_VERSION,
  type EntityFormConfig,
  type MappingPlan,
  type TemplateSpec,
} from '@dynamic-entity/core';
import { IMPORT_TRANSPORT } from '../tokens/injection-tokens';
import { HttpImportTransport, provideHttpImportTransport } from './http-import-transport';
import type { ImportContext, ImportTransport } from './import-contracts';

const CONFIG: EntityFormConfig = {
  entity: 'employee',
  version: 3,
  tabs: [
    {
      id: 'personal',
      label: { en: 'Personal' },
      fields: [{ id: 'firstName', type: 'text', label: { en: 'First Name' } }],
    },
  ],
};

const CONTEXT: ImportContext = { config: CONFIG };

const PLAN: MappingPlan = {
  entity: 'employee',
  entries: [{ ref: 'personal.firstName', column: 0 }],
};

const SPEC = {
  entity: 'employee',
  sheetName: 'Employee',
  columns: [
    { ref: 'personal.firstName', scope: 'personal', field: CONFIG.tabs![0].fields![0], header: 'First Name', required: false },
  ],
  notes: [''],
  unsupported: [],
} as TemplateSpec;

const file = (): File => new File(['name\nAlice'], 'people.csv', { type: 'text/csv' });

/** A `fetch` that records what it was asked and answers with what the test says. */
function stubFetch(answer: (url: string, init: RequestInit) => Response | Promise<Response>): {
  fetch: typeof fetch;
  calls: { url: string; init: RequestInit }[];
} {
  const calls: { url: string; init: RequestInit }[] = [];
  const stub = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input);
    calls.push({ url, init });
    return answer(url, init);
  }) as unknown as typeof fetch;
  return { fetch: stub, calls };
}

/**
 * A stand-in for `Response`, because jsdom has neither `fetch` nor `Response`.
 *
 * Only what the transport actually reads: `ok`, `status`, `json()` and `blob()`. A fuller fake
 * would be a fuller thing to be wrong about.
 */
function reply(body: unknown, status = 200): Response {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => JSON.parse(text),
    text: async () => text,
    blob: async () => new Blob([text]),
  } as unknown as Response;
}

const json = (body: unknown, status = 200): Response => reply(body, status);

const PREVIEW_BODY = {
  headers: ['name'],
  sample: [['Alice']],
  suggestion: PLAN,
  rowCount: 1,
  engineVersion: CORE_VERSION,
};

const COMMIT_BODY = {
  written: true,
  imported: 400,
  skipped: 3,
  // 47 rows failed; one of their problems is retained. Counting the sample would say one.
  failed: 47,
  rowsRead: 450,
  errors: [{ row: 5, ref: 'personal.firstName', message: 'required' }],
  errorCount: 90,
  truncated: true,
  planProblems: [],
  engineVersion: CORE_VERSION,
};

describe('provideHttpImportTransport', () => {
  it('registers against the token the wizard already reads', () => {
    const provider = provideHttpImportTransport({ baseUrl: '/api/import' }) as {
      provide: unknown;
      useValue: ImportTransport;
    };
    expect(provider.provide).toBe(IMPORT_TRANSPORT);
    expect(typeof provider.useValue.preview).toBe('function');
    expect(typeof provider.useValue.commit).toBe('function');
    expect(typeof provider.useValue.template).toBe('function');
  });
});

describe('HttpImportTransport.preview', () => {
  it('posts the file and maps the answer onto what the wizard expects', async () => {
    const { fetch, calls } = stubFetch(() => json(PREVIEW_BODY));
    const transport = new HttpImportTransport({ baseUrl: '/api/import/', fetch });

    const preview = await transport.preview(file(), CONTEXT);

    expect(calls[0].url).toBe('/api/import/employee/preview');
    expect(calls[0].init.method).toBe('POST');
    expect(preview).toEqual({
      headers: ['name'],
      sample: [['Alice']],
      suggestion: PLAN,
      rowCount: 1,
    });
  });

  it('never sets a Content-Type, which would break the multipart boundary', async () => {
    const { fetch, calls } = stubFetch(() => json(PREVIEW_BODY));
    const transport = new HttpImportTransport({
      baseUrl: '/api/import',
      fetch,
      headers: { Authorization: 'Bearer x', 'content-type': 'application/json' },
    });

    await transport.preview(file(), CONTEXT);

    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer x');
    expect(Object.keys(headers).map(key => key.toLowerCase())).not.toContain('content-type');
  });

  it('takes headers from a function, so a token can be read per request', async () => {
    let calls = 0;
    const { fetch, calls: sent } = stubFetch(() => json(PREVIEW_BODY));
    const transport = new HttpImportTransport({
      baseUrl: '/api/import',
      fetch,
      headers: () => ({ Authorization: `Bearer ${++calls}` }),
    });

    await transport.preview(file(), CONTEXT);
    await transport.preview(file(), CONTEXT);

    expect((sent[0].init.headers as Record<string, string>)['Authorization']).toBe('Bearer 1');
    expect((sent[1].init.headers as Record<string, string>)['Authorization']).toBe('Bearer 2');
  });

  it('warns when the server runs a different engine', async () => {
    // MappingPlan.configVersion catches config drift and says nothing about engine drift, so
    // "one engine, both sides" is only true if something checks.
    const warnings: string[] = [];
    const { fetch } = stubFetch(() =>
      json({ ...PREVIEW_BODY, engineVersion: '0.0.1-from-another-deploy' }),
    );
    const transport = new HttpImportTransport({
      baseUrl: '/api/import',
      fetch,
      warn: message => warnings.push(message),
    });

    const preview = await transport.preview(file(), CONTEXT);

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('0.0.1-from-another-deploy');
    expect(warnings[0]).toContain(CORE_VERSION);
    // A warning, not a refusal: a patch release is not a reason to stop somebody importing.
    expect(preview.rowCount).toBe(1);
  });

  it('says nothing about a patch difference between two deploys', async () => {
    // The normal state of a rolling release. Warning on it puts a line in the console on every
    // preview and every commit, which is how people learn to scroll past the one that matters.
    const [major, minor] = CORE_VERSION.split('.');
    const warnings: string[] = [];
    const { fetch } = stubFetch(() => reply({ ...PREVIEW_BODY, engineVersion: `${major}.${minor}.999` }));
    await new HttpImportTransport({
      baseUrl: '/api/import',
      fetch,
      warn: message => warnings.push(message),
    }).preview(file(), CONTEXT);
    expect(warnings).toEqual([]);
  });

  it('does say something about a minor difference', async () => {
    const [major, minor] = CORE_VERSION.split('.');
    const warnings: string[] = [];
    const drifted = `${major}.${Number(minor) + 1}.0`;
    const { fetch } = stubFetch(() => reply({ ...PREVIEW_BODY, engineVersion: drifted }));
    await new HttpImportTransport({
      baseUrl: '/api/import',
      fetch,
      warn: message => warnings.push(message),
    }).preview(file(), CONTEXT);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain(drifted);
  });

  it('says nothing when the two agree', async () => {
    const warnings: string[] = [];
    const { fetch } = stubFetch(() => json(PREVIEW_BODY));
    await new HttpImportTransport({
      baseUrl: '/api/import',
      fetch,
      warn: message => warnings.push(message),
    }).preview(file(), CONTEXT);
    expect(warnings).toEqual([]);
  });

  it('says nothing when the server did not report a version at all', async () => {
    const warnings: string[] = [];
    const { fetch } = stubFetch(() => json({ ...PREVIEW_BODY, engineVersion: undefined }));
    await new HttpImportTransport({
      baseUrl: '/api/import',
      fetch,
      warn: message => warnings.push(message),
    }).preview(file(), CONTEXT);
    expect(warnings).toEqual([]);
  });

  it('surfaces the message the server wrote', async () => {
    const { fetch } = stubFetch(() =>
      json({ error: { code: 'TOO_LARGE', message: 'The file is larger than the limit.' } }, 413),
    );
    await expect(
      new HttpImportTransport({ baseUrl: '/api/import', fetch }).preview(file(), CONTEXT),
    ).rejects.toThrow('The file is larger than the limit.');
  });

  it('falls back to the status when the body is not the envelope', async () => {
    // A proxy's HTML error page has no message worth showing a user.
    const { fetch } = stubFetch(() => reply('<html>502 Bad Gateway</html>', 502));
    await expect(
      new HttpImportTransport({ baseUrl: '/api/import', fetch }).preview(file(), CONTEXT),
    ).rejects.toThrow('answered 502');
  });
});

describe('HttpImportTransport.commit', () => {
  it('sends the plan before the file, which is the ordering the server needs', async () => {
    // The server starts importing while the file is still arriving — that is the whole reason
    // it exists — so the plan has to have arrived already.
    const { fetch, calls } = stubFetch(() => json(COMMIT_BODY));
    await new HttpImportTransport({ baseUrl: '/api/import', fetch }).commit(file(), PLAN, CONTEXT);

    const body = calls[0].init.body as FormData;
    // `FormData.keys()` is in the DOM lib but not in the `lib` this package compiles
    // against; the runtime under jsdom has it.
    expect([...(body as unknown as { keys(): Iterable<string> }).keys()]).toEqual(['plan', 'file']);
    expect(JSON.parse(body.get('plan') as string)).toEqual(PLAN);
  });

  it('reports the count and leaves records empty, which is the point of streaming', async () => {
    const { fetch } = stubFetch(() => json(COMMIT_BODY));
    const result = await new HttpImportTransport({ baseUrl: '/api/import', fetch }).commit(
      file(),
      PLAN,
      CONTEXT,
    );

    expect(result.records).toEqual([]);
    expect(result.imported).toBe(400);
    expect(result.skipped).toBe(3);
    expect(result.errorCount).toBe(90);
    expect(result.truncated).toBe(true);
    expect(result.errors).toHaveLength(1);
  });

  it('carries the true failed-row count, which the retained sample cannot give', async () => {
    // Counting distinct rows in a capped `errors` answers how many fitted in the cap. Here
    // that would be one, against forty-seven rows that actually failed.
    const { fetch } = stubFetch(() => reply(COMMIT_BODY));
    const result = await new HttpImportTransport({ baseUrl: '/api/import', fetch }).commit(
      file(),
      PLAN,
      CONTEXT,
    );

    expect(result.failed).toBe(47);
    expect(new Set(result.errors.map(error => error.row)).size).toBe(1);
  });

  it('carries plan problems through, so the wizard can send the user back to the mapping', async () => {
    const planProblems = [{ level: 'error', path: 'entries[0].ref', message: 'Unknown field.' }];
    const { fetch } = stubFetch(() => json({ ...COMMIT_BODY, imported: 0, planProblems }));
    const result = await new HttpImportTransport({ baseUrl: '/api/import', fetch }).commit(
      file(),
      PLAN,
      CONTEXT,
    );
    expect(result.planProblems).toEqual(planProblems);
  });

  it('copes with a server that omits the optional counts', async () => {
    const { fetch } = stubFetch(() =>
      json({ imported: 2, skipped: 0, errors: [], planProblems: [], engineVersion: CORE_VERSION }),
    );
    const result = await new HttpImportTransport({ baseUrl: '/api/import', fetch }).commit(
      file(),
      PLAN,
      CONTEXT,
    );
    expect(result.errorCount).toBe(0);
    expect(result.truncated).toBe(false);
  });
});

describe('HttpImportTransport.template', () => {
  it('asks for the format and returns the bytes', async () => {
    const { fetch, calls } = stubFetch(
      () => reply('name\r\n'),
    );
    const blob = await new HttpImportTransport({ baseUrl: '/api/import', fetch }).template(
      SPEC,
      'csv',
      CONTEXT,
    );

    expect(calls[0].url).toContain('/api/import/employee/template?');
    expect(calls[0].url).toContain('format=csv');
    expect(calls[0].init.method).toBe('GET');
    // jsdom's Blob has no `text()`; its size is enough to say the bytes came through.
    expect(blob.size).toBe(6);
  });

  it('sends a partial selection, and only a partial one', async () => {
    const two: EntityFormConfig = {
      ...CONFIG,
      tabs: [
        {
          ...CONFIG.tabs![0],
          fields: [...CONFIG.tabs![0].fields!, { id: 'age', type: 'number', label: { en: 'Age' } }],
        },
      ],
    };
    const { fetch, calls } = stubFetch(() => reply(''));
    await new HttpImportTransport({ baseUrl: '/api/import', fetch }).template(SPEC, 'csv', {
      config: two,
    });
    expect(calls[0].url).toContain('fields=personal.firstName');
    expect(calls[0].url).not.toContain('personal.age');
  });

  it('says "everything" by saying nothing, so a wide config fits in a URL', async () => {
    // A selection of every column is what omitting `fields` already means. Spelling it out
    // produced ten kilobytes of query string for a wide config — past the eight nginx and Node
    // default to — on the request most likely to be made: give me a template with everything.
    const wide: EntityFormConfig = {
      entity: 'wide',
      version: 1,
      tabs: [
        {
          id: 'tab',
          label: { en: 'Tab' },
          fields: Array.from({ length: 300 }, (_unused, i) => ({
            id: `someReasonablyLongFieldName${i}`,
            type: 'text' as const,
            label: { en: `Field ${i}` },
          })),
        },
      ],
    };
    const spec = buildTemplateSpec(wide);
    expect(spec.columns.length).toBe(300);

    const { fetch, calls } = stubFetch(() => reply(''));
    await new HttpImportTransport({ baseUrl: '/api/import', fetch }).template(spec, 'csv', {
      config: wide,
    });

    expect(calls[0].url).toBe('/api/import/wide/template?format=csv');
  });

  it('sends the selection the caller gave, rather than recovering it from the expansion', async () => {
    // The wizard knows what the user ticked. Reconstructing it from the expanded spec worked
    // only because `stripIndices` happens to invert the expansion exactly, which is a property
    // to rely on when there is no choice and not when the caller can simply say.
    const { fetch, calls } = stubFetch(() => reply(''));
    await new HttpImportTransport({ baseUrl: '/api/import', fetch }).template(
      SPEC,
      'csv',
      CONTEXT,
      ['personal.firstName'],
    );
    const fields = new URL(calls[0].url, 'http://x').searchParams.get('fields');
    // The only column there is, so "everything" — sent as nothing, which is what it means.
    expect(fields).toBeNull();
  });

  it('honours a caller selection that is narrower than the config', async () => {
    const two: EntityFormConfig = {
      ...CONFIG,
      tabs: [
        {
          ...CONFIG.tabs![0],
          fields: [...CONFIG.tabs![0].fields!, { id: 'age', type: 'number', label: { en: 'Age' } }],
        },
      ],
    };
    const { fetch, calls } = stubFetch(() => reply(''));
    await new HttpImportTransport({ baseUrl: '/api/import', fetch }).template(
      SPEC,
      'csv',
      { config: two },
      ['personal.firstName'],
    );
    expect(calls[0].url).toContain('fields=personal.firstName');
  });

  it('collapses a repeating field back to the one choice the picker offered', async () => {
    // `contacts.0.email, contacts.1.email, contacts.2.email` is the expansion of a single tick.
    // Sending the expansion back is both longer and a different sentence from the one the user
    // said, and `buildTemplateSpec` matches on the stripped ref anyway.
    const repeating: EntityFormConfig = {
      entity: 'people',
      version: 1,
      tabs: [
        {
          id: 'tab',
          label: { en: 'Tab' },
          fields: [
            { id: 'name', type: 'text', label: { en: 'Name' } },
            {
              id: 'contacts',
              type: 'array',
              label: { en: 'Contacts' },
              // An `array` carries its row columns in `children`, not `fields`.
              children: [{ id: 'email', type: 'text', label: { en: 'Email' } }],
            },
          ],
        },
      ],
    };
    const spec = buildTemplateSpec(repeating, { fields: ['tab.contacts.email'] });
    expect(spec.columns.length).toBeGreaterThan(1);

    const { fetch, calls } = stubFetch(() => reply(''));
    await new HttpImportTransport({ baseUrl: '/api/import', fetch }).template(spec, 'csv', {
      config: repeating,
    });

    const fields = new URL(calls[0].url, 'http://x').searchParams.get('fields');
    expect(fields).toBe('tab.contacts.email');
  });

  it('sends only the selection, never the headers themselves', async () => {
    // The server has the config; letting a client choose the headers of a file the server
    // signs its name to would be handing it a pen.
    const { fetch, calls } = stubFetch(() => reply(''));
    await new HttpImportTransport({ baseUrl: '/api/import', fetch }).template(SPEC, 'xlsx', CONTEXT);
    expect(calls[0].url).not.toContain('First Name');
  });

  it('omits the selection entirely when a spec selects nothing', async () => {
    const { fetch, calls } = stubFetch(() => reply(''));
    await new HttpImportTransport({ baseUrl: '/api/import', fetch }).template(
      { ...SPEC, columns: [] },
      'csv',
      CONTEXT,
    );
    expect(calls[0].url).not.toContain('fields=');
  });

  it('surfaces a refusal rather than handing back an error page as a file', async () => {
    const { fetch } = stubFetch(() =>
      json({ error: { code: 'UNSUPPORTED_FORMAT', message: 'Supported formats are csv and xlsx.' } }, 415),
    );
    await expect(
      new HttpImportTransport({ baseUrl: '/api/import', fetch }).template(SPEC, 'xlsx', CONTEXT),
    ).rejects.toThrow('Supported formats are csv and xlsx.');
  });
});

describe('HttpImportTransport — the URL it builds', () => {
  it('escapes an entity rather than pasting it into a path', async () => {
    const { fetch, calls } = stubFetch(() => json(PREVIEW_BODY));
    await new HttpImportTransport({ baseUrl: '/api/import', fetch }).preview(file(), {
      config: { ...CONFIG, entity: 'a/../b' },
    });
    expect(calls[0].url).toBe('/api/import/a%2F..%2Fb/preview');
  });

  it('tolerates a trailing slash on the base', async () => {
    const { fetch, calls } = stubFetch(() => json(PREVIEW_BODY));
    await new HttpImportTransport({ baseUrl: '/api/import///', fetch }).preview(file(), CONTEXT);
    expect(calls[0].url).toBe('/api/import/employee/preview');
  });
});

describe('HttpImportTransport — the defaults', () => {
  it('uses the global fetch when none is supplied', async () => {
    const original = (globalThis as { fetch?: typeof fetch }).fetch;
    const seen: string[] = [];
    (globalThis as { fetch?: typeof fetch }).fetch = (async (input: RequestInfo | URL) => {
      seen.push(String(input));
      return reply(PREVIEW_BODY);
    }) as unknown as typeof fetch;

    try {
      await new HttpImportTransport({ baseUrl: '/api/import' }).preview(file(), CONTEXT);
      expect(seen).toEqual(['/api/import/employee/preview']);
    } finally {
      (globalThis as { fetch?: typeof fetch }).fetch = original;
    }
  });

  it('warns through the console when no warn hook is given', async () => {
    const spy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { fetch } = stubFetch(() => reply({ ...PREVIEW_BODY, engineVersion: '9.9.9' }));

    try {
      await new HttpImportTransport({ baseUrl: '/api/import', fetch }).preview(file(), CONTEXT);
      expect(spy).toHaveBeenCalledTimes(1);
      expect(String(spy.mock.calls[0][0])).toContain('9.9.9');
    } finally {
      spy.mockRestore();
    }
  });

  it('copes with a context that carries no config', async () => {
    const { fetch, calls } = stubFetch(() => reply(PREVIEW_BODY));
    await new HttpImportTransport({ baseUrl: '/api/import', fetch }).preview(
      file(),
      {} as ImportContext,
    );
    expect(calls[0].url).toBe('/api/import//preview');
  });

  it('copes with a base URL that is not a string', async () => {
    const { fetch, calls } = stubFetch(() => reply(PREVIEW_BODY));
    await new HttpImportTransport({
      baseUrl: undefined as unknown as string,
      fetch,
    }).preview(file(), CONTEXT);
    expect(calls[0].url).toBe('/employee/preview');
  });

  it('names an unnamed file rather than sending an empty filename', async () => {
    const { fetch, calls } = stubFetch(url => reply(url.endsWith('preview') ? PREVIEW_BODY : COMMIT_BODY));
    const nameless = new File(['a'], '', { type: 'text/csv' });
    await new HttpImportTransport({ baseUrl: '/api/import', fetch }).commit(
      nameless,
      PLAN,
      CONTEXT,
    );
    const body = calls[0].init.body as FormData;
    expect((body.get('file') as File).name).toBe('upload');

    // And on the way in as well, not only on the way out.
    await new HttpImportTransport({ baseUrl: '/api/import', fetch }).preview(nameless, CONTEXT);
    expect(((calls[1].init.body as FormData).get('file') as File).name).toBe('upload');
  });

  it('fills in a preview whose optional fields the server left out', async () => {
    const { fetch } = stubFetch(() => reply({ suggestion: PLAN, engineVersion: CORE_VERSION }));
    const preview = await new HttpImportTransport({ baseUrl: '/api/import', fetch }).preview(
      file(),
      CONTEXT,
    );
    expect(preview).toEqual({ headers: [], sample: [], suggestion: PLAN, rowCount: 0 });
  });

  it('fills in a commit whose optional fields the server left out', async () => {
    const { fetch } = stubFetch(() => reply({ engineVersion: CORE_VERSION }));
    const result = await new HttpImportTransport({ baseUrl: '/api/import', fetch }).commit(
      file(),
      PLAN,
      CONTEXT,
    );
    expect(result).toEqual({
      records: [],
      imported: 0,
      skipped: 0,
      failed: 0,
      errors: [],
      errorCount: 0,
      truncated: false,
      planProblems: [],
    });
  });

  it('sends no headers at all when none were configured', async () => {
    const { fetch, calls } = stubFetch(() => reply(PREVIEW_BODY));
    await new HttpImportTransport({ baseUrl: '/api/import', fetch }).preview(file(), CONTEXT);
    expect(calls[0].init.headers).toEqual({});
  });
});
