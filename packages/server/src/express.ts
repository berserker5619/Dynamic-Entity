/**
 * express.ts — four routes over the framework-neutral core, and no privileges.
 *
 * Everything this file does, a Fastify, Nest or Next route could do in the same few lines:
 * find the config, read the upload, call `previewSheet` / `runImport` / `writeTemplate`, and
 * answer. It is one caller of the package rather than the package's shape.
 *
 * **Not this router's job, said out loud.** Concurrency limiting, authentication and
 * authorization are the consumer's. The router is mounted inside their app, behind their
 * middleware, and nothing here checks who is asking. SECURITY.md says so rather than leaving
 * a reader to assume the router protects them.
 *
 * This module is published as `@dynamic-entity/server/express` rather than from the package
 * root, so that it — and its `express` import — is reached only by someone who wants it. A
 * consumer wiring Fastify imports the root and never pays for a framework they do not use.
 */

import {
  buildTemplateSpec,
  CORE_VERSION,
  deriveImportColumns,
  type EntityFormConfig,
  type FormRule,
  type ImportCommitResponse,
  type ImportLookups,
  type ImportPreviewResponse,
} from '@dynamic-entity/core';
import express, { type Request, type Response, type Router } from 'express';
import { destroySource } from './bytes';
import { ImportError, toErrorBody } from './errors';
import { resolveLimits, type ImportLimits } from './limits';
import { receiveUpload, readPlanField } from './multipart';
import { previewSheet, runImport, type BatchInfo, type ImportRunResult } from './run-import';
import {
  writeTemplate,
  TEMPLATE_EXTENSION,
  TEMPLATE_MEDIA_TYPE,
  type TemplateFormat,
} from './write-template';

/** What the consumer does with a batch of records. Called once per batch, and awaited. */
export type OnImport = (
  records: Record<string, unknown>[],
  context: BatchInfo & {
    entity: string;
    config: EntityFormConfig;
    /** For a tenant id, a user, a transaction — whatever the consumer's writer needs. */
    request: Request;
  },
) => void | Promise<void>;

/**
 * Where the configs come from.
 *
 * A map **or** a function, because a real app keeps its configs in a database and should not
 * need a restart to add an entity. Returning `undefined` is how a loader says "no such
 * entity"; throwing is how it says something went wrong.
 */
export type ConfigSource =
  | Record<string, EntityFormConfig>
  | ((entity: string, request: Request) => EntityFormConfig | undefined | Promise<EntityFormConfig | undefined>);

export interface ImportRouterOptions {
  configs: ConfigSource;
  /** Rules per entity. Without them an import checks validators only, which the form does not. */
  rules?: Record<string, readonly FormRule[]>;
  /** Values for every `listName` any config mentions. A server has no `LOOKUP_REGISTRY`. */
  lookups?: ImportLookups;
  /**
   * Where records go.
   *
   * **It must be idempotent.** A stream that fails at row 30,000 has written 29,999 records,
   * and over HTTP a retry is likely rather than possible — a client, a proxy or a user will
   * send the same file again. This package does not deduplicate: the config has no natural-key
   * concept to deduplicate on. See SECURITY.md.
   */
  onImport: OnImport;
  limits?: Partial<ImportLimits>;
  /** Which language error text is produced in. Default `en`. */
  lang?: string | ((request: Request) => string);
}

/**
 * Every `listName` the importable columns of a config mention.
 *
 * Derived from the same column walk the import uses, so the set checked is exactly the set
 * that will be asked for — a field the sheet cannot carry cannot need a list.
 */
export function listNamesOf(config: EntityFormConfig): string[] {
  const names = new Set<string>();
  const { columns } = deriveImportColumns(config, {
    includeReadonly: true,
    includeSystemDefault: true,
  });
  for (const column of columns) {
    if (column.field.listName) names.add(column.field.listName);
  }
  return [...names];
}

/**
 * Refuse to start rather than store the wrong value at row 30,000.
 *
 * The browser resolves a `listName` field from `LOOKUP_REGISTRY`; a server has no such
 * registry, so an unsupplied list means `coerceCell` finds no options to match against and
 * passes the raw text straight through. The record then looks right and compares wrong against
 * every rule that names the option — the defect fixed in `282e668`, one layer up.
 *
 * So it is not left to vigilance. A silent wrong value found in a database next quarter is the
 * expensive failure; an app that will not boot is the cheap one.
 */
function checkLookups(entity: string, config: EntityFormConfig, lookups: ImportLookups | undefined): void {
  const missing = listNamesOf(config).filter(name => !lookups?.[name]);
  if (!missing.length) return;

  throw new Error(
    `@dynamic-entity/server: config "${entity}" has fields resolving against ` +
      `${missing.map(name => `"${name}"`).join(', ')}, and no such list was supplied.\n` +
      'Pass them as `lookups` to createImportRouter. Without them those columns would store ' +
      'the raw cell text, which renders correctly and matches nothing.',
  );
}

/** `csv` unless a valid `xlsx` was asked for; anything else is a refusal rather than a guess. */
function readFormat(value: unknown): TemplateFormat {
  if (value === undefined || value === 'csv') return 'csv';
  if (value === 'xlsx') return 'xlsx';
  throw new ImportError('UNSUPPORTED_FORMAT', 'Supported template formats are csv and xlsx.');
}

/**
 * `?fields=a,b&fields=c` and `?fields=a&fields=b` both mean the same thing, and **no `fields`
 * at all means every column** — which is what a client sends when the user picked everything,
 * rather than spelling out a selection long enough to outgrow the URL.
 *
 * A ref with its row numbers stripped selects every row of a repeating field, because
 * `buildTemplateSpec` matches on both spellings. That is the shape the picker works in.
 */
function readFields(value: unknown): string[] | undefined {
  const raw = value === undefined ? [] : Array.isArray(value) ? value : [value];
  const fields = raw.flatMap(item => String(item).split(',')).map(item => item.trim()).filter(Boolean);
  return fields.length ? fields : undefined;
}

/**
 * A download filename derived from the config, never from the client.
 *
 * A filename that reaches a `Content-Disposition` having come from a request is header
 * injection with extra steps: a newline in it ends the header and starts another. This takes
 * the entity and keeps only characters that cannot mean anything in a header.
 *
 * The caller passes `config.entity`, not the route segment. They are usually the same string,
 * and when they are not — a consumer mounting a plural route, `{ employees: employeeConfig }` —
 * the config is the one that names the data. Reading the route key instead made the map key
 * carry meaning it was never given, which is a footgun with no upside: the key is a route
 * segment and nothing else.
 */
export function templateFilename(entity: string, format: TemplateFormat): string {
  const safe = String(entity).replace(/[^A-Za-z0-9._-]/g, '-').replace(/^[-.]+/, '').slice(0, 64);
  return `${safe || 'import'}-template.${TEMPLATE_EXTENSION[format]}`;
}

/**
 * Give a request a clock.
 *
 * Two of them, because they answer different attacks: an idle timeout ends a connection that
 * has gone quiet mid-body — a byte a minute holds a socket indefinitely otherwise — and a
 * total timeout ends one that is perfectly chatty and never finishes.
 */
function applyTimeouts(request: Request, response: Response, limits: ImportLimits): void {
  // The connection is closed rather than answered. A client that has stopped sending is not
  // waiting for a status code, and an attacker holding a socket open is the case being
  // answered — the reply they want least is the connection going away.
  const abandon = (message: string) => (): void => {
    request.destroy(new ImportError('TIMEOUT', message));
  };

  request.setTimeout(limits.idleTimeoutMs, abandon('The upload stalled.'));
  const total = setTimeout(abandon('The upload took too long.'), limits.totalTimeoutMs);
  // `unref` so a pending timer never holds a process open past its work.
  total.unref?.();
  response.on('close', () => clearTimeout(total));
}

/**
 * Send whatever went wrong as the envelope, unless the response has already started.
 *
 * Exported so it can be tested against a response that has already begun: a template that
 * failed part-way is already partly on the wire, and the only honest thing left is to end the
 * connection abruptly. A 200 with a truncated body is a corrupt file that looks like a good
 * one, which is the worst of the available outcomes.
 */
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
  // body wearing `text/csv; charset=utf-8` and `attachment; filename="employee-template.csv"`,
  // which a browser dutifully saves as the template. Measured, not theorised.
  for (const header of ['Content-Type', 'Content-Disposition', 'Content-Length']) {
    response.removeHeader(header);
  }

  const { status, body } = toErrorBody(error);
  response.status(status).json(body);
}

export function createImportRouter(options: ImportRouterOptions): Router {
  const limits = resolveLimits(options.limits);
  const router = express.Router();

  // At construction, not at first use: a map is knowable now, and an app that refuses to start
  // is cheaper than a column that silently stored the wrong thing.
  if (typeof options.configs !== 'function') {
    for (const [entity, config] of Object.entries(options.configs)) {
      checkLookups(entity, config, options.lookups);
    }
  }

  const languageOf = (request: Request): string =>
    typeof options.lang === 'function' ? options.lang(request) : options.lang ?? 'en';

  /**
   * Resolve `:entity`, or 404 without echoing what was asked for.
   *
   * The key is a lookup into a map the consumer supplied — never a path segment, never
   * interpolated into anything. Reflecting it back would turn a 404 into a way to probe which
   * entities exist and, if a browser ever rendered the message, into a way to inject into it.
   */
  const configFor = async (request: Request): Promise<{ entity: string; config: EntityFormConfig }> => {
    const entity = String(request.params['entity'] ?? '');
    const config =
      typeof options.configs === 'function'
        ? await options.configs(entity, request)
        : options.configs[entity];

    if (!config) throw new ImportError('UNKNOWN_ENTITY', 'No import is configured for that entity.');
    // A loader can return a config the router never saw at construction, so the boot-time
    // check gets a second chance here — before a row is read, which is the point of it.
    if (typeof options.configs === 'function') checkLookups(entity, config, options.lookups);
    return { entity, config };
  };

  const respond = (result: ImportRunResult, written: boolean): ImportCommitResponse => ({
    written,
    imported: result.imported,
    skipped: result.skipped,
    failed: result.failed,
    rowsRead: result.rowsRead,
    errors: result.errors,
    errorCount: result.errorCount,
    truncated: result.truncated,
    planProblems: result.planProblems,
    engineVersion: CORE_VERSION,
  });

  /**
   * Wrap a handler so a rejection becomes the envelope rather than Express's default page.
   *
   * The error is answered here and **not** passed to `next`. Doing both would run the
   * consumer's error middleware over a response that has already been sent, which in Express
   * is a warning in their logs about a problem they did not cause.
   */
  const route =
    (handler: (request: Request, response: Response) => Promise<void>) =>
    (request: Request, response: Response): void => {
      applyTimeouts(request, response, limits);
      handler(request, response).catch(error => sendFailure(response, error));
    };

  router.get(
    '/:entity/template',
    route(async (request, response) => {
      const { entity, config } = await configFor(request);
      const format = readFormat(request.query['format']);
      const spec = buildTemplateSpec(config, {
        lang: languageOf(request),
        fields: readFields(request.query['fields']),
      });

      response.setHeader('Content-Type', TEMPLATE_MEDIA_TYPE[format]);
      response.setHeader(
        'Content-Disposition',
        `attachment; filename="${templateFilename(config.entity || entity, format)}"`,
      );
      await writeTemplate({ spec, format, out: response, limits });
    }),
  );

  router.post(
    '/:entity/preview',
    route(async (request, response) => {
      const { config } = await configFor(request);
      const upload = await receiveUpload(request, limits);

      const preview = await previewSheet({
        stream: upload.stream,
        filename: upload.filename,
        config,
        lang: languageOf(request),
        limits,
      });

      const body: ImportPreviewResponse = {
        headers: preview.headers,
        sample: preview.sample,
        suggestion: preview.suggestion,
        rowCount: preview.rowCount,
        engineVersion: CORE_VERSION,
      };
      response.json(body);
    }),
  );

  /**
   * The identical pipeline with no `onBatch`: every row read, every error found, nothing
   * written.
   *
   * This is what makes a non-transactional import liveable. A user can see every problem in
   * the file before anything at all is stored, which is the answer to "what if it fails
   * halfway" that does not require a transaction.
   */
  router.post(
    '/:entity/validate',
    route(async (request, response) => {
      response.json(await execute(request, options, limits, languageOf, undefined));
    }),
  );

  router.post(
    '/:entity/import',
    route(async (request, response) => {
      const onBatch = async (
        records: Record<string, unknown>[],
        info: BatchInfo,
        entity: string,
        config: EntityFormConfig,
      ): Promise<void> => {
        await options.onImport(records, { ...info, entity, config, request });
      };
      response.json(await execute(request, options, limits, languageOf, onBatch));
    }),
  );

  /** Shared by `/validate` and `/import`, which differ only in whether anything is written. */
  async function execute(
    request: Request,
    routerOptions: ImportRouterOptions,
    resolved: ImportLimits,
    language: (request: Request) => string,
    write:
      | ((
          records: Record<string, unknown>[],
          info: BatchInfo,
          entity: string,
          config: EntityFormConfig,
        ) => Promise<void>)
      | undefined,
  ): Promise<ImportCommitResponse> {
    const { entity, config } = await configFor(request);
    const upload = await receiveUpload(request, resolved);

    let plan: ReturnType<typeof readPlanField>;
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
      plan: plan as never,
      config,
      rules: routerOptions.rules?.[entity],
      lookups: routerOptions.lookups,
      lang: language(request),
      limits: resolved,
      onBatch: write && ((records, info) => write(records, info, entity, config)),
    });

    return respond(result, write !== undefined);
  }

  return router;
}
