/**
 * router.ts — the import over HTTP, for any schema.
 *
 * Four routes on a router the caller made: a template to download, a preview, a validation
 * pass and the import itself. Moved from Dynamic Entity's server with its wiring taken out.
 * Where that resolved a config per entity, this resolves an adapter and the context it wants,
 * by the name in the path. Dynamic Entity's router is this one with a config behind each name.
 *
 * **The caller passes the router in.** `express` is an optional peer, and this file is part of
 * `/node`'s one entry, so importing `express` here would make reading a CSV depend on it.
 * Only its types are used, and types are gone by the time this runs.
 *
 * Every limit applies to every route, a refused request closes its body, and a failure
 * answers with a code and a message this library wrote and nothing from below it.
 */

import {
  DEFAULT_SLOTS,
  IMPORTER_VERSION,
  PLAN_VERSIONS,
  type AdapterStamp,
  type DateOrder,
  type ImportCommitResponse,
  type ImportPreviewResponse,
  type SchemaAdapter,
} from 'sheet-to-schema';
import type { Request, Response, Router } from 'express';
import { destroySource } from './bytes';
import { ImportError, toErrorBody } from './errors';
import { resolveLimits, type ImportLimits } from './limits';
import { receiveUpload, readPlanField } from './multipart';
import { previewSheet, runImport, type BatchInfo, type ImportRunResult, type SheetPreview } from './run-import';
import { writeTemplate, TEMPLATE_EXTENSION, TEMPLATE_MEDIA_TYPE, type TemplateFormat, type TemplateSheet } from './write-template';

/** What one name in the path imports into. */
export interface ImportBinding<TMeta = unknown, TCtx = unknown> {
  adapter: SchemaAdapter<TMeta, TCtx>;
  /** Handed to the adapter's `coerce`, `finalize` and `validate` for every row of a run. */
  ctx: TCtx;
  /**
   * What kind of adapter this is, for the `adapter` stamp on every answer: `json-schema`,
   * `dynamic-entity`. A client warns when it differs from its own at the major version.
   * Default `custom`.
   */
  kind?: string;
  /**
   * The template for this binding, in place of the one made from the adapter's targets: for
   * a schema with more to say about a column than its header. `fields` is the client's
   * selection, as shape refs, or `undefined` for everything.
   */
  template?: (request: { lang: string; fields: string[] | undefined }) => TemplateSheet;
  /** Fields added to a preview answer, for what this schema's clients expect beside the standard ones. */
  previewExtras?: (preview: SheetPreview) => Record<string, unknown>;
}

/**
 * Where bindings come from.
 *
 * A map **or** a function, because a real app keeps its schemas in a database and should not
 * need a restart to add one, and because the context may depend on who is asking. Returning
 * `undefined` is how a loader says "no such name"; throwing is how it says something went wrong.
 */
export type BindingSource =
  | Record<string, ImportBinding>
  | ((name: string, request: Request) => ImportBinding | undefined | Promise<ImportBinding | undefined>);

/** What the consumer does with a batch of records. Called once per batch, and awaited. */
export type OnImport = (
  records: Record<string, unknown>[],
  context: BatchInfo & {
    /** The name in the path. */
    name: string;
    binding: ImportBinding;
    /** For a tenant id, a user, a transaction — whatever the consumer's writer needs. */
    request: Request;
  },
) => void | Promise<void>;

export interface ImportRouterOptions {
  bindings: BindingSource;
  /**
   * Where records go.
   *
   * **It must be idempotent.** A stream that fails at row 30,000 has written 29,999 records,
   * and the client, or a proxy, or the user, will retry.
   */
  onImport: OnImport;
  limits?: Partial<ImportLimits>;
  /** The language adapters resolve labels in, fixed or read from the request. Default `en`. */
  lang?: string | ((request: Request) => string);
  /**
   * The order of a date written in digits, for every import and validation this router runs,
   * where a plan entry states none. Reported in each preview, so a client reads its sample the
   * same way. Without it, and without the entry's, a date that reads two ways fails its row.
   */
  dateOrder?: DateOrder;
}

/** A property of the map itself, never one it inherited: `constructor` is not a binding. */
function ownValue<T>(map: Readonly<Record<string, T>>, key: string): T | undefined {
  return Object.hasOwn(map, key) ? map[key] : undefined;
}

function readFormat(value: unknown): TemplateFormat {
  if (value === undefined || value === 'csv') return 'csv';
  if (value === 'xlsx') return 'xlsx';
  throw new ImportError('UNSUPPORTED_FORMAT', 'Supported template formats are csv and xlsx.');
}

/** `?fields=a,b` and `?fields=a&fields=b` are the same selection. */
function readFields(value: unknown): string[] | undefined {
  const raw = value === undefined ? [] : Array.isArray(value) ? value : [value];
  const fields = raw.flatMap(item => String(item).split(',')).map(item => item.trim()).filter(Boolean);
  return fields.length ? fields : undefined;
}

/**
 * The name a template is downloaded under. Built from the schema's own name, never from the
 * request, and reduced to characters that cannot break out of a `Content-Disposition` header.
 */
export function templateFilename(name: string, format: TemplateFormat): string {
  const safe = String(name).replace(/[^A-Za-z0-9._-]/g, '-').replace(/^[-.]+/, '').slice(0, 64);
  return `${safe || 'import'}-template.${TEMPLATE_EXTENSION[format]}`;
}

/** The template an adapter's own targets make: every target, each array at the default slots. */
export function templateOf(adapter: SchemaAdapter, lang: string, fields: string[] | undefined): TemplateSheet {
  const arrays = adapter.targets({ slots: {}, lang }).arrays;
  const slots = Object.fromEntries(arrays.map(array => [array.ref, DEFAULT_SLOTS]));
  const chosen = fields && new Set(fields);
  const targets = adapter.targets({ slots, lang }).targets.filter(target => !chosen || chosen.has(target.shapeRef));
  return {
    sheetName: adapter.id,
    headers: targets.map(target => target.header),
    notes: targets.map(target => [target.required ? 'Required' : '', target.format ?? ''].filter(Boolean).join('. ')),
  };
}

function applyTimeouts(request: Request, response: Response, limits: ImportLimits): void {
  // The connection is closed rather than answered. A client that has stopped sending is not
  // waiting for a status code, and an attacker holding a socket open is the case being
  // answered — the reply they want least is the connection going away.
  const abandon = (message: string) => (): void => {
    request.destroy(new ImportError('TIMEOUT', message));
  };

  // `setTimeout` on a request sets it on the *socket*, which a keep-alive connection reuses
  // for whatever request comes next — so an import's thirty seconds would quietly become the
  // idle bound for every later request on that connection, including ones outside this router.
  // The previous value goes back when the response closes.
  const socket = request.socket;
  const previous = socket?.timeout;
  request.setTimeout(limits.idleTimeoutMs, abandon('The upload stalled.'));

  const total = setTimeout(abandon('The upload took too long.'), limits.totalTimeoutMs);
  // `unref` so a pending timer never holds a process open past its work.
  total.unref?.();
  response.on('close', () => {
    clearTimeout(total);
    if (socket && !socket.destroyed) socket.setTimeout(previous ?? 0);
  });
}

/** Answer a failed request, in the one shape every failure has. */
export function sendFailure(response: Response, error: unknown): void {
  if (response.headersSent) {
    // A template that failed part-way through is already partly on the wire, and there is no
    // way to take it back. Ending the response abruptly is what tells the client the file is
    // not whole; a 200 with a truncated body would not.
    response.destroy();
    return;
  }

  // **The download's headers have to come off first.** The template route sets `Content-Type`
  // and `Content-Disposition` before it starts writing, and `res.json` only sets a content type
  // when one is *not* already there — so a failure after that point answered 413 with a JSON
  // body wearing `text/csv; charset=utf-8` and `attachment; filename="…-template.csv"`, which
  // a browser dutifully saves as the template.
  for (const header of ['Content-Type', 'Content-Disposition', 'Content-Length']) {
    response.removeHeader(header);
  }

  const { status, body } = toErrorBody(error);
  response.status(status).json(body);
}

/**
 * Add the import routes to `router`, and hand it back.
 *
 *     app.use('/import', createImportRouter(express.Router(), { bindings, onImport }));
 *
 * `GET /:name/template`, `POST /:name/preview`, `POST /:name/validate`, `POST /:name/import`.
 */
export function createImportRouter(router: Router, options: ImportRouterOptions): Router {
  const limits = resolveLimits(options.limits);

  const languageOf = (request: Request): string =>
    typeof options.lang === 'function' ? options.lang(request) : options.lang ?? 'en';

  const bindingFor = async (request: Request): Promise<{ name: string; binding: ImportBinding }> => {
    const name = String(request.params['name'] ?? '');
    const binding =
      typeof options.bindings === 'function' ? await options.bindings(name, request) : ownValue(options.bindings, name);
    // The wire code is Dynamic Entity's, kept because clients branch on it (`errors.ts`).
    if (!binding) throw new ImportError('UNKNOWN_ENTITY', 'No import is configured for that name.');
    return { name, binding };
  };

  const stampOf = (binding: ImportBinding): AdapterStamp => ({
    name: binding.kind ?? 'custom',
    version: binding.adapter.adapterVersion,
  });

  const respond = (result: ImportRunResult, written: boolean, binding: ImportBinding): ImportCommitResponse => ({
    written,
    imported: result.imported,
    skipped: result.skipped,
    failed: result.failed,
    rowsRead: result.rowsRead,
    rowsInImported: result.rowsInImported,
    errors: result.errors,
    errorCount: result.errorCount,
    truncated: result.truncated,
    warnings: result.warnings,
    warningCount: result.warningCount,
    planProblems: result.planProblems,
    engineVersion: IMPORTER_VERSION,
    adapter: stampOf(binding),
  });

  const route =
    (handler: (request: Request, response: Response) => Promise<void>) =>
    (request: Request, response: Response): void => {
      applyTimeouts(request, response, limits);
      handler(request, response).catch(error => sendFailure(response, error));
    };

  router.get(
    '/:name/template',
    route(async (request, response) => {
      const { binding } = await bindingFor(request);
      const format = readFormat(request.query['format']);
      const fields = readFields(request.query['fields']);
      const lang = languageOf(request);
      const sheet = binding.template ? binding.template({ lang, fields }) : templateOf(binding.adapter, lang, fields);

      response.setHeader('Content-Type', TEMPLATE_MEDIA_TYPE[format]);
      // Named from the schema, never from the path: the path is the client's.
      response.setHeader('Content-Disposition', `attachment; filename="${templateFilename(binding.adapter.id, format)}"`);
      await writeTemplate({ sheet, format, out: response, limits });
    }),
  );

  router.post(
    '/:name/preview',
    route(async (request, response) => {
      const { binding } = await bindingFor(request);
      const upload = await receiveUpload(request, limits);

      const preview = await previewSheet({
        stream: upload.stream,
        filename: upload.filename,
        adapter: binding.adapter,
        lang: languageOf(request),
        limits,
      });

      const body: ImportPreviewResponse = {
        headers: preview.headers,
        sample: preview.sample,
        suggestion: preview.suggestion,
        rowCount: preview.rowCount,
        slots: preview.slots,
        ...(preview.delimiter ? { delimiter: preview.delimiter } : {}),
        ...(options.dateOrder ? { dateOrder: options.dateOrder } : {}),
        ...binding.previewExtras?.(preview),
        // After the extras, so nothing a binding adds can restate what this server is.
        planVersions: [...PLAN_VERSIONS],
        engineVersion: IMPORTER_VERSION,
        adapter: stampOf(binding),
      };
      response.json(body);
    }),
  );

  /**
   * The identical pipeline with no writer: every row read, every error found, nothing stored.
   *
   * This is what makes a non-transactional import liveable. A user can see every problem in
   * the file before anything at all is stored, which is the answer to "what if it fails
   * halfway" that does not require a transaction.
   */
  router.post(
    '/:name/validate',
    route(async (request, response) => {
      response.json(await execute(request, false));
    }),
  );

  router.post(
    '/:name/import',
    route(async (request, response) => {
      response.json(await execute(request, true));
    }),
  );

  async function execute(request: Request, write: boolean): Promise<ImportCommitResponse> {
    const { name, binding } = await bindingFor(request);
    const upload = await receiveUpload(request, limits);

    let plan: unknown;
    try {
      plan = readPlanField(upload.fields);
    } catch (error) {
      // The plan is wrong and the file is still arriving. Draining it would be reading a body
      // there is no longer any reason to read.
      destroySource(upload.stream);
      throw error;
    }

    const result = await runImport({
      stream: upload.stream,
      filename: upload.filename,
      plan,
      adapter: binding.adapter,
      ctx: binding.ctx,
      dateOrder: options.dateOrder,
      limits,
      ...(write ? { onBatch: (records, info) => options.onImport(records, { ...info, name, binding, request }) } : {}),
    });

    return respond(result, write, binding);
  }

  return router;
}
