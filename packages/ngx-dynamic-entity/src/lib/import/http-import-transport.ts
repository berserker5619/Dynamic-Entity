/**
 * http-import-transport.ts — the same wizard, with the work happening on a server.
 *
 * The components do not change at all: they already talk to an `ImportTransport`, which was
 * the point of the seam. Registering this one moves the mapping, coercion and validation from
 * the tab to a server that runs the *same* `@dynamic-entity/core` functions — so the reason to
 * do it is size, not behaviour.
 *
 * **Built on `fetch`, not `HttpClient`.** This package has no `@angular/common/http` dependency
 * today, and four requests is not the reason to acquire one — a consumer who wants interceptors
 * passes their own `fetch`, which is a smaller seam than a dependency.
 */

import {
  CORE_VERSION,
  deriveImportColumns,
  stripIndices,
  type ImportCommitResponse,
  type ImportErrorResponse,
  type ImportPreviewResponse,
  type ImportResult,
  type MappingPlan,
  type TemplateSpec,
} from '@dynamic-entity/core';
import type { Provider } from '@angular/core';
import { IMPORT_TRANSPORT } from '../tokens/injection-tokens';
import type {
  ImportContext,
  ImportPreview,
  ImportTransport,
  TemplateFormat,
} from './import-contracts';

export interface HttpImportTransportOptions {
  /** Where the router is mounted, e.g. `/api/import`. A trailing slash is ignored. */
  baseUrl: string;
  /** Supply one to add interceptors, retries, or credentials. Defaults to the global `fetch`. */
  fetch?: typeof fetch;
  /** Headers on every request — an `Authorization`, a tenant id. Never a `Content-Type`. */
  headers?: Record<string, string> | (() => Record<string, string>);
  /**
   * Where a warning goes. Defaults to `console.warn`.
   *
   * There is exactly one warning, and it is the engine-version mismatch below — which is a
   * developer's problem, not a user's, so it does not belong in the wizard's error banner.
   */
  warn?: (message: string) => void;
}

/** `Content-Type` is deliberately not settable: `fetch` must set the multipart boundary. */
function resolveHeaders(options: HttpImportTransportOptions): Record<string, string> {
  const headers = typeof options.headers === 'function' ? options.headers() : options.headers ?? {};
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    if (name.toLowerCase() === 'content-type') continue;
    out[name] = value;
  }
  return out;
}

const trimSlash = (url: string): string => String(url ?? '').replace(/\/+$/, '');

/** Same major and minor. Two engines a patch apart are the same engine. */
function sameLine(a: string, b: string): boolean {
  const line = (version: string): string => version.split('.').slice(0, 2).join('.');
  return line(a) === line(b);
}

/**
 * Turn a failed response into an `Error` the wizard can show.
 *
 * The server's envelope carries a code and a message it wrote itself; anything else — a proxy's
 * HTML error page, a network failure — has no message worth showing, so a status line is what
 * the user gets rather than a page of markup.
 */
async function failureOf(response: Response): Promise<Error> {
  let body: ImportErrorResponse | undefined;
  try {
    body = (await response.json()) as ImportErrorResponse;
  } catch {
    /* not our envelope */
  }
  const message = body?.error?.message;
  return new Error(message || `The import server answered ${response.status}.`);
}

/**
 * The field selection, as short as it can be said without changing what it means.
 *
 * Two reductions, and both are exact rather than approximate:
 *
 * - **Row numbers come off.** `buildTemplateSpec` matches a column by its ref *or* by its ref
 *   with indices stripped, and the picker that produced this selection worked in stripped refs
 *   to begin with — so `contacts.0.email, contacts.1.email, contacts.2.email` is the expansion
 *   of one choice, and collapsing it back recovers exactly what the user ticked.
 * - **A full selection is sent as no selection at all**, because omitting `fields` already
 *   means every column.
 *
 * Without them a wide config produced a query string of ten kilobytes or more — past the eight
 * nginx and Node default to — and the request most likely to hit it is "give me a template with
 * everything", which is the one this now sends as a bare `?format=`.
 */
function selectionOf(
  spec: TemplateSpec,
  context: ImportContext,
  fields?: readonly string[],
): string {
  // The caller's own selection when it gave one — the wizard does — and the expanded spec
  // reduced back to it otherwise, for a host calling `template` directly.
  const chosen = new Set(fields ?? spec.columns.map(column => stripIndices(column.ref)));
  const all = new Set(
    deriveImportColumns(context?.config, { lang: context?.lang }).columns.map(column =>
      stripIndices(column.ref),
    ),
  );

  if (all.size && chosen.size === all.size && [...all].every(ref => chosen.has(ref))) return '';
  return [...chosen].join(',');
}

/**
 * Not `@Injectable`, and registered by value rather than by class.
 *
 * Its constructor takes options rather than dependencies, so there is nothing for an injector
 * to resolve — and a consumer who wants two of them, pointed at two backends, gets that for
 * free.
 */
class HttpImportTransport implements ImportTransport {
  constructor(private readonly options: HttpImportTransportOptions) {}

  private get base(): string {
    return trimSlash(this.options.baseUrl);
  }

  private get send(): typeof fetch {
    // Bound rather than referenced: a bare `globalThis.fetch` passed around as a value throws
    // "Illegal invocation" in a browser, because it needs `window` as its receiver.
    return this.options.fetch ?? globalThis.fetch.bind(globalThis);
  }

  private entityOf(context: ImportContext): string {
    return encodeURIComponent(context?.config?.entity ?? '');
  }

  /**
   * Warn when the server's engine is not the one this bundle was built against.
   *
   * The two halves are separately deployed and may differ. `MappingPlan.configVersion` catches
   * *config* drift and says nothing about *engine* drift, so "one engine, both sides" is only
   * true if something checks — and this is the something. A warning rather than a refusal: a
   * patch release is not a reason to stop somebody importing.
   */
  private checkEngine(version: string | undefined): void {
    // Compared at major.minor. A patch difference between two deploys is the normal state of
    // a rolling release and says nothing about whether the engines agree; warning on it puts a
    // line in the console on every preview and every commit, which is how people learn to
    // scroll past the warning that does matter.
    if (!version || sameLine(version, CORE_VERSION)) return;
    const warn = this.options.warn ?? ((message: string) => console.warn(message));
    warn(
      `[ngx-dynamic-entity] The import server runs @dynamic-entity/core ${version}; this app ` +
        `was built against ${CORE_VERSION}. The two halves of an import are supposed to be the ` +
        'same engine — bring them into step before trusting a difference in what they produce.',
    );
  }

  async preview(file: File, context: ImportContext): Promise<ImportPreview> {
    const body = new FormData();
    body.append('file', file, file.name || 'upload');

    const response = await this.send(`${this.base}/${this.entityOf(context)}/preview`, {
      method: 'POST',
      headers: resolveHeaders(this.options),
      body,
    });
    if (!response.ok) throw await failureOf(response);

    const preview = (await response.json()) as ImportPreviewResponse;
    this.checkEngine(preview.engineVersion);

    return {
      headers: preview.headers ?? [],
      sample: preview.sample ?? [],
      suggestion: preview.suggestion,
      rowCount: preview.rowCount ?? 0,
    };
  }

  async commit(file: File, plan: MappingPlan, context: ImportContext): Promise<ImportResult> {
    const body = new FormData();
    // **The plan first, and the file second.** The server starts importing while the file is
    // still arriving — that is the whole reason it exists — so the plan has to have arrived
    // already. `FormData` preserves append order, so this ordering is the contract.
    body.append('plan', JSON.stringify(plan));
    body.append('file', file, file.name || 'upload');

    const response = await this.send(`${this.base}/${this.entityOf(context)}/import`, {
      method: 'POST',
      headers: resolveHeaders(this.options),
      body,
    });
    if (!response.ok) throw await failureOf(response);

    const result = (await response.json()) as ImportCommitResponse;
    this.checkEngine(result.engineVersion);

    return {
      // Empty, and not because nothing was imported. The server streamed the file precisely so
      // that fifty thousand records never had to exist at once; sending them back would undo
      // that on the way out. `imported` is the count, and the records are in the consumer's
      // database.
      records: [],
      imported: result.imported ?? 0,
      skipped: result.skipped ?? 0,
      failed: result.failed ?? 0,
      errors: result.errors ?? [],
      errorCount: result.errorCount ?? result.errors?.length ?? 0,
      truncated: result.truncated ?? false,
      planProblems: result.planProblems ?? [],
    };
  }

  async template(
    spec: TemplateSpec,
    format: TemplateFormat,
    context: ImportContext,
    fields?: readonly string[],
  ): Promise<Blob> {
    // The server rebuilds the spec from its own config; only the selection crosses the wire.
    // Posting a whole spec would let a client choose the headers of a file the server signs
    // its name to, and the server has the config anyway.
    const query = new URLSearchParams({ format });
    const selection = selectionOf(spec, context, fields);
    if (selection) query.set('fields', selection);

    const response = await this.send(
      `${this.base}/${this.entityOf(context)}/template?${query.toString()}`,
      { method: 'GET', headers: resolveHeaders(this.options) },
    );
    if (!response.ok) throw await failureOf(response);
    return response.blob();
  }
}

/**
 * Register the HTTP transport.
 *
 * ```ts
 * provideNgxDynamicEntity({}),
 * provideHttpImportTransport({ baseUrl: '/api/import' }),
 * ```
 *
 * A plain `Provider` rather than `EnvironmentProviders`, so it composes inside a component's
 * or a route's `providers` array as well as at the root — which is how a consumer points one
 * part of an app at a different backend.
 */
export function provideHttpImportTransport(options: HttpImportTransportOptions): Provider {
  return { provide: IMPORT_TRANSPORT, useValue: new HttpImportTransport(options) };
}

/** Exported for a consumer who wants to subclass or wrap it; most should use the provider. */
export { HttpImportTransport };
