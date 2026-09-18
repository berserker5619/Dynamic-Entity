/**
 * import-contracts.ts — the two seams the import wizard hangs on.
 *
 * Both follow the pattern the rest of this package already uses for anything the library
 * cannot decide for a consumer — `FileUploadHandler`, `EntityReferenceLoader`,
 * `LookupListLoader`: a function type here, a token to register it against, and a default
 * that works without registering anything.
 *
 * **Why two rather than one.** Reading a file and deciding where the work happens are
 * different questions with different answers. A consumer may want `.xlsx` support in a
 * wizard that still runs entirely in the browser, or plain CSV that is nonetheless processed
 * on a server because their files have fifty thousand rows. Collapsing them into one option
 * would make each answer imply the other.
 */

import type {
  EntityFormConfig,
  FormRule,
  ImportLookups,
  ImportResult,
  MappingPlan,
  SheetData,
  TemplateSpec,
} from '@dynamic-entity/core';

/**
 * Reads an uploaded file into headers and positional rows.
 *
 * Positional (`string[][]`), not keyed by header, because a real sheet carries duplicate
 * headers and blank ones — and because a mapping entry addresses a column by index for
 * exactly that reason. A parser that returned objects keyed by header would silently lose
 * the second of two columns both called "Notes".
 *
 * The library ships a CSV implementation and no more. Registering one that understands
 * `.xlsx` is how a consumer adds it, and which spreadsheet library they use stays their
 * choice — this package has no runtime dependency and gains none here.
 *
 * @example
 * provideNgxDynamicEntity({
 *   sheetParser: async file => {
 *     const workbook = XLSX.read(await file.arrayBuffer());
 *     const rows = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], {
 *       header: 1, raw: false, defval: '',
 *     }) as string[][];
 *     return { headers: rows[0] ?? [], rows: rows.slice(1) };
 *   },
 * })
 */
export type SheetParser = (file: File) => SheetData | Promise<SheetData>;

/** The formats a generated template can be written in. CSV needs no dependency. */
export type TemplateFormat = 'csv' | 'xlsx';

/** What the wizard needs to know about the entity it is importing into. */
export interface ImportContext {
  config: EntityFormConfig;
  /**
   * Rules that apply to this entity.
   *
   * Without them an import checks field validators only, which is **not** what the form
   * enforces: a rule can attach an error, and a rule can hide a field, which must relax
   * `required`. Pass the same rules the form is rendered with or the two disagree.
   */
  rules?: readonly FormRule[];
  /** Values for any `listName` field, already resolved — core cannot reach `LOOKUP_REGISTRY`. */
  lookups?: ImportLookups;
  lang?: string;
}

/** What a first look at an uploaded file yields. */
export interface ImportPreview {
  headers: string[];
  /** The first few rows, for the mapping screen to show under each column. */
  sample: string[][];
  /** Where the suggester got to. Every inferred match is tagged `guess`. */
  suggestion: MappingPlan;
  /** Total data rows in the file, which may be far more than `sample` holds. */
  rowCount: number;
}

/**
 * Where the work happens.
 *
 * The default implementation does everything in the browser with `@dynamic-entity/core` and
 * never touches the network, so the wizard is fully usable with no backend at all. Register
 * an implementation that posts to a server and the same components drive it instead — the
 * engine underneath is the same code either way, which is the point of it being pure.
 *
 * This is the real answer to "should parsing happen on the client or the server?": both,
 * chosen at registration, without a second implementation of the mapping rules.
 */
export interface ImportTransport {
  /** Headers, a sample, and a suggested mapping for a freshly chosen file. */
  preview(file: File, context: ImportContext): Promise<ImportPreview>;
  /** Apply a plan to the whole file. */
  commit(file: File, plan: MappingPlan, context: ImportContext): Promise<ImportResult>;
  /**
   * Render a template for download.
   *
   * `fields` is the selection the user actually made — refs with row numbers stripped, one per
   * choice — and `spec` is that selection already expanded against the config. A transport that
   * renders locally wants the spec; one that asks a server wants the selection, because the
   * server has the config and only the choice needs to cross the wire. Passing both means
   * neither has to reconstruct the other: the HTTP transport used to recover the selection from
   * the expanded spec, which worked only because `stripIndices` happens to be exactly the
   * inverse of the expansion. Optional, so an existing implementation keeps compiling.
   */
  template(
    spec: TemplateSpec,
    format: TemplateFormat,
    context: ImportContext,
    fields?: readonly string[],
  ): Promise<Blob>;
}
