/**
 * express.ts — four routes, and no privileges.
 *
 * Since 3.0 the routes are sheet-to-schema's (`createImportRouter` in `sheet-to-schema/node`),
 * which resolves a schema adapter by the name in the path. This is that router with a config
 * behind each name: it finds the config, checks its lookups were supplied, turns it into
 * `entityFormConfigAdapter` with the entity's rules, and answers a preview with the same
 * suggestion the browser makes. Reading the upload, the limits, the timeouts and the failure
 * envelope are the router's own, and are the code this file had until 3.0.
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
  entityFormConfigAdapter,
  planForConfig,
  type DateOrder,
  type EntityFormConfig,
  type FormRule,
  type ImportLookups,
} from '@dynamic-entity/core';
import express, { type Request, type Router } from 'express';
import {
  createImportRouter as createRouterOverAdapters,
  ImportError,
  sendFailure as sendImportFailure,
  templateFilename as importerTemplateFilename,
  type ImportBinding,
} from 'sheet-to-schema/node';
import type { ImportLimits } from './limits';
import { suggestionFor, type BatchInfo } from './run-import';
import { templateSheetOf } from './write-template';

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
   * The order of a date written in digits, for every import and validation this router runs:
   * `DMY` for day first, `MDY` for month first. Without it, a date that reads two ways
   * (`05/09/2026`) fails its row. See `RunImportOptions.dateOrder`.
   */
  dateOrder?: DateOrder;
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
 * every rule that names the option.
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

/** A map's own entry for `key`, never one inherited from `Object.prototype`. */
function ownValue<T>(map: Readonly<Record<string, T>>, key: string): T | undefined {
  return Object.hasOwn(map, key) ? map[key] : undefined;
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
 * the config is the one that names the data.
 */
export const templateFilename = importerTemplateFilename;

/**
 * Send whatever went wrong as the envelope, unless the response has already started.
 *
 * A template that failed part-way is already partly on the wire, and the only honest thing
 * left is to end the connection abruptly. A 200 with a truncated body is a corrupt file that
 * looks like a good one, which is the worst of the available outcomes.
 */
export const sendFailure = sendImportFailure;

/** The config a binding was made from, for the writer, which is handed the config and not the binding. */
type ConfigBinding = ImportBinding & { config: EntityFormConfig };

export function createImportRouter(options: ImportRouterOptions): Router {
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
   * Resolve `:entity` to what it imports into, or to nothing, which the router answers 404
   * without echoing what was asked for.
   *
   * The key is a lookup into a map the consumer supplied — never a path segment, never
   * interpolated into anything. An own-property check, not `configs[entity]`: `constructor`,
   * `__proto__` or `toString` would otherwise resolve to a built-in and run an import against it.
   */
  const bindingFor = async (entity: string, request: Request): Promise<ConfigBinding | undefined> => {
    const config =
      typeof options.configs === 'function' ? await options.configs(entity, request) : ownValue(options.configs, entity);
    if (!config) throw new ImportError('UNKNOWN_ENTITY', 'No import is configured for that entity.');
    // A loader can return a config the router never saw at construction, so the boot-time
    // check gets a second chance here — before a row is read, which is the point of it.
    if (typeof options.configs === 'function') checkLookups(entity, config, options.lookups);

    const lang = languageOf(request);
    const adapter = entityFormConfigAdapter(config, {
      rules: options.rules && ownValue(options.rules, entity),
      lookups: options.lookups,
    });
    return {
      adapter: adapter as ImportBinding['adapter'],
      ctx: { lang },
      kind: 'dynamic-entity',
      config,
      // Named from the config. The route segment only when the config names nothing.
      templateName: config.entity || entity,
      template: ({ lang: language, fields }) => templateSheetOf(buildTemplateSpec(config, { lang: language, fields })),
      // What the browser suggests for the same headers, and the one number it was sized with.
      previewExtras: preview => suggestionFor(preview.headers, config, lang),
      // A 2.x plan that names no entity is read against this config, as 2.x read it.
      plan: plan => planForConfig(plan, config),
    };
  };

  return createRouterOverAdapters(express.Router(), {
    bindings: bindingFor,
    param: 'entity',
    // What a Dynamic Entity client compares with its own `CORE_VERSION`, as it always has.
    engineVersion: CORE_VERSION,
    dateOrder: options.dateOrder,
    limits: options.limits,
    lang: options.lang,
    onImport: (records, { index, firstRow, imported, name, binding, request }) =>
      options.onImport(records, { index, firstRow, imported, entity: name, config: (binding as ConfigBinding).config, request }),
  });
}
