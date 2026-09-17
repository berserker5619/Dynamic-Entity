/**
 * import-engine.ts — flat spreadsheet rows in, nested records out.
 *
 * The governing constraint for everything here: **an imported record must be
 * indistinguishable from one the form would have produced and accepted.** That is why
 * validation runs the rules engine rather than only the field validators (§`validateImportedRecord`),
 * why a `dropdown` cell becomes the option *object* rather than the text that was typed, and
 * why records are stamped with the config version on the way out.
 *
 * Pure and I/O-free, so the same functions run in a browser tab and in a server's stream
 * handler. Two implementations of this would drift, and the drift would be invisible: both
 * sides would import successfully and disagree about what they produced.
 */

import { collectLeafTargets, deriveImportColumns, type LeafTarget } from './import-columns';
import { ROOT_SCOPE } from './field-scopes';
import { stampRecord } from './migration';
import { evaluateFormRules, filterRulesForTab } from './rules-engine';
import {
  evaluateFieldVisibility,
  getTabData,
  getValueByPath,
  isUnsafePath,
  normalizeArrayStructures,
  resolveLabel,
  resolveOptionLabel,
  valuesMatch,
} from './form-logic';
import type {
  DropdownOption,
  EntityFormConfig,
  FormRule,
  NestedFieldConfig,
  NestedTabConfig,
} from './form-model.types';
import type {
  ImportColumn,
  ImportResult,
  ImportRowError,
  MappingEntry,
  MappingPlan,
} from './import-model.types';

/** Named lists a config's `listName` fields resolve against, already loaded by the caller. */
export type ImportLookups = Record<string, readonly DropdownOption[]>;

export interface CoerceOptions {
  /**
   * Language for **error message text only**.
   *
   * Not for matching: `valuesMatch` already compares across every language a `LocalizedText`
   * carries, so a German sheet resolves its options without being told what language it is in.
   * Threading a language through the match would make the same file import differently
   * depending on a setting nobody associates with it.
   */
  lang?: string;
  lookups?: ImportLookups;
}

/** A coerced cell, or the reason it could not be coerced. */
export type CoerceOutcome = { value: unknown } | { error: string };

const TRUE_TEXT = new Set(['true', 't', 'yes', 'y', '1']);
const FALSE_TEXT = new Set(['false', 'f', 'no', 'n', '0']);

/**
 * Approximates Angular's `Validators.email`, which is what the form applies.
 *
 * "Approximates" is the honest word: matching it exactly would mean vendoring Angular's regex
 * into a framework-agnostic package. The gap is cells this accepts that the form would reject,
 * which surfaces at save time rather than silently — the direction of the error that can be
 * seen is the one to prefer.
 */
const EMAIL_PATTERN =
  /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;

/** How a multiSelect cell separates its values. */
const MULTI_SEPARATOR = ';';

/**
 * Write a value at a dot-path, creating **arrays** for numeric segments.
 *
 * This exists because `setValueByPath` cannot be used for these paths. It creates `{}` for
 * every missing intermediate, so `contacts.0.email` produces an object with a `"0"` key rather
 * than an array, and `normalizeArrayStructures` then wraps that whole object into one bogus
 * row. Verified before this was written:
 *
 *     setValueByPath({}, 'contacts.0.email', 'x')
 *     → { contacts: { '0': { email: 'x' } } }        contacts is array? false
 *
 * A new function rather than a fix to that one: `setValueByPath` is called throughout the
 * renderer, and changing how it treats a numeric segment would alter behaviour for any config
 * whose `refererField` happens to contain one.
 *
 * The prototype guard is `isUnsafePath`, reused rather than re-derived — a path here comes
 * from config and from a stored mapping plan, both of which are data.
 */
export function setRecordValue(record: Record<string, unknown>, path: string, value: unknown): void {
  if (!record || !path || isUnsafePath(path)) return;

  const parts = path.split('.');
  let curr: Record<string, unknown> = record;

  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    const nextIsIndex = /^\d+$/.test(parts[i + 1]);
    const existing = curr[part];
    if (existing == null || typeof existing !== 'object') {
      curr[part] = nextIsIndex ? [] : {};
    }
    curr = curr[part] as Record<string, unknown>;
  }
  curr[parts[parts.length - 1]] = value;
}

/**
 * Remove the holes a sparse write leaves behind.
 *
 * Filling only "Contact 2" writes index 1 and leaves index 0 empty, so the array is
 * `[<hole>, {...}]`. A hole is not a row the user entered, and leaving it in produces a record
 * with a phantom blank entry that the form then renders as an empty row.
 */
export function compactArrays<T>(value: T): T {
  if (Array.isArray(value)) {
    const compacted = value
      .filter(item => item !== undefined && item !== null)
      .map(item => compactArrays(item))
      .filter(item => !isEmptyValue(item));
    return compacted as unknown as T;
  }
  if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      (value as Record<string, unknown>)[key] = compactArrays(child);
    }
  }
  return value;
}

/** Empty for the purpose of "did the user put anything here". */
function isEmptyValue(value: unknown): boolean {
  if (value === undefined || value === null || value === '') return true;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === 'object') {
    return Object.values(value as Record<string, unknown>).every(isEmptyValue);
  }
  return false;
}

/** The options a field offers, inline or through a named list. */
function optionsFor(field: NestedFieldConfig, lookups?: ImportLookups): readonly DropdownOption[] {
  if (Array.isArray(field.options) && field.options.length) return field.options;
  if (field.listName && lookups?.[field.listName]) return lookups[field.listName];
  return [];
}

/**
 * Resolve a cell's text to the option object a record stores.
 *
 * This is the subtle one. In this model **the displayed text is the stored value**: an option
 * is a `LocalizedText` and the record holds that whole object, not a scalar. Writing the raw
 * string produces a record that renders correctly — `formatDisplayValue` falls back to the
 * stored text — and then silently fails to match every rule and every option comparison that
 * names it. A value that looks right and compares wrong is worse than one that looks wrong.
 */
function matchOption(
  text: string,
  field: NestedFieldConfig,
  lookups: ImportLookups | undefined,
  lang: string,
): CoerceOutcome {
  const options = optionsFor(field, lookups);
  if (!options.length) {
    // No option list to match against — an `entity-ref`, or a `listName` the caller did not
    // load. The text is passed through rather than rejected: rejecting would make the field
    // unimportable for a reason the sheet's author cannot see or fix.
    return { value: text };
  }
  const match = options.find(option => valuesMatch(option, text, lang));
  if (match) return { value: match };

  const allowed = options.map(option => resolveOptionLabel(option, lang)).filter(Boolean);
  return { error: `"${text}" is not one of: ${allowed.join(', ')}` };
}

/** `2024-03-07` from a Date, in local terms — a `date` field carries no time and no zone. */
function toIsoDate(date: Date): string {
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * Turn one cell into the value its field stores.
 *
 * An empty cell is not an error and not a value: it returns `{ value: undefined }`, and the
 * caller writes nothing. Writing `''` instead would turn every blank cell into a present-but-
 * empty field, which is a different record from one where the user said nothing — and it would
 * defeat `required`, because `''` is a value that exists.
 */
export function coerceCell(
  field: NestedFieldConfig,
  raw: unknown,
  options: CoerceOptions = {},
): CoerceOutcome {
  const lang = options.lang ?? 'en';
  if (!field || typeof field !== 'object') return { value: undefined };

  if (raw === null || raw === undefined) return { value: undefined };
  const text = typeof raw === 'string' ? raw.trim() : String(raw).trim();
  if (text === '') return { value: undefined };

  switch (field.type) {
    case 'number':
    case 'currency': {
      // Thousands separators are what a spreadsheet shows, so they are what gets pasted.
      const cleaned = text.replace(/,/g, '');
      const parsed = Number(cleaned);
      if (cleaned === '' || !Number.isFinite(parsed)) return { error: `"${text}" is not a number` };
      return { value: parsed };
    }

    case 'boolean':
    case 'checkbox': {
      const lower = text.toLowerCase();
      if (TRUE_TEXT.has(lower)) return { value: true };
      if (FALSE_TEXT.has(lower)) return { value: false };
      return { error: `"${text}" is not true or false` };
    }

    case 'date': {
      const parsed = new Date(text);
      if (Number.isNaN(parsed.getTime())) return { error: `"${text}" is not a date` };
      return { value: toIsoDate(parsed) };
    }

    case 'datetime': {
      const parsed = new Date(text);
      if (Number.isNaN(parsed.getTime())) return { error: `"${text}" is not a date and time` };
      return { value: parsed.toISOString() };
    }

    case 'monthYear': {
      const match = /^(\d{4})-(\d{1,2})$/.exec(text);
      if (match) {
        const month = Number(match[2]);
        if (month >= 1 && month <= 12) return { value: `${match[1]}-${String(month).padStart(2, '0')}` };
        return { error: `"${text}" is not a month` };
      }
      const parsed = new Date(text);
      if (Number.isNaN(parsed.getTime())) return { error: `"${text}" is not a month and year` };
      return { value: `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, '0')}` };
    }

    case 'time': {
      // Stored as `HH:mm` with no date and no zone, which is how the renderer stores it.
      const match = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(text);
      if (!match) return { error: `"${text}" is not a time (HH:mm)` };
      const hours = Number(match[1]);
      const minutes = Number(match[2]);
      if (hours > 23 || minutes > 59) return { error: `"${text}" is not a time (HH:mm)` };
      return { value: `${String(hours).padStart(2, '0')}:${match[2]}` };
    }

    case 'dropdown':
    case 'radio':
      return matchOption(text, field, options.lookups, lang);

    case 'multiSelect': {
      const parts = text
        .split(MULTI_SEPARATOR)
        .map(part => part.trim())
        .filter(Boolean);
      const values: unknown[] = [];
      for (const part of parts) {
        const outcome = matchOption(part, field, options.lookups, lang);
        if ('error' in outcome) return outcome;
        values.push(outcome.value);
      }
      return { value: values };
    }

    default:
      return { value: text };
  }
}

/** Lowercase alphanumerics only, so "First Name", `first_name` and `firstName` collapse. */
function normalizeHeader(text: string): string {
  return String(text ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

/**
 * Guess which sheet column feeds which field.
 *
 * Exact matches first — a header that *is* a ref, or that matches a generated template's
 * heading — then a normalised text match against the field's label and id. Anything inferred
 * is tagged `guess` so the UI can mark it: a mapping the user was never shown is one they
 * cannot correct, and a wrong guess silently importing into the wrong field is the worst
 * outcome this feature has.
 *
 * Each header feeds at most one field and each field takes at most one header. A sheet with
 * two "Notes" columns therefore maps one of them and leaves the other for the user.
 */
export function suggestMapping(
  headers: readonly string[],
  columns: readonly ImportColumn[],
  entity = '',
): MappingPlan {
  const entries: MappingEntry[] = [];
  const takenColumns = new Set<number>();
  const takenRefs = new Set<string>();

  const claim = (index: number, column: ImportColumn, confidence: 'exact' | 'guess'): void => {
    if (takenColumns.has(index) || takenRefs.has(column.ref)) return;
    takenColumns.add(index);
    takenRefs.add(column.ref);
    entries.push({ ref: column.ref, column: index, header: headers[index], confidence });
  };

  const candidates = (column: ImportColumn): { exact: string[]; loose: string[] } => ({
    exact: [column.ref, column.header],
    loose: [resolveLabel(column.field.label) || '', column.field.id],
  });

  // Two passes, so an exact match never loses its column to an earlier field's guess.
  for (const pass of ['exact', 'loose'] as const) {
    for (const column of columns) {
      if (takenRefs.has(column.ref)) continue;
      const wanted = candidates(column)[pass].filter(Boolean).map(normalizeHeader);
      const index = headers.findIndex(
        (header, i) => !takenColumns.has(i) && wanted.includes(normalizeHeader(header)),
      );
      if (index >= 0) claim(index, column, pass === 'exact' ? 'exact' : 'guess');
    }
  }

  return { entity, sourceHeaders: [...headers], entries };
}

// ─── Validation ───────────────────────────────────────────────────────────────

/** One problem with one field of one record, before a row number is attached. */
export type RecordProblem = Omit<ImportRowError, 'row'>;

export interface ValidateRecordOptions {
  lang?: string;
  /** Rules that apply to this entity. Without them, rule-driven validation is not checked. */
  rules?: readonly FormRule[];
}

/**
 * Which fields a rule or a `showWhen` has hidden, and which rules have raised an error.
 *
 * Rules are evaluated the way the renderer evaluates them — per tab, against that tab's own
 * flat values — because `evaluateFormRules` takes a `Record<string, unknown>` keyed by bare
 * `fieldId`, which is exactly what `getTabData` returns and exactly what the renderer hands it.
 * Evaluating them against the nested record instead would silently match nothing.
 */
function evaluateRuleState(
  record: Record<string, unknown>,
  config: EntityFormConfig,
  rules: readonly FormRule[] | undefined,
): { hiddenIds: Set<string>; ruleErrors: Map<string, string> } {
  const hiddenIds = new Set<string>();
  const ruleErrors = new Map<string, string>();
  if (!rules?.length) return { hiddenIds, ruleErrors };

  const walk = (tabs: NestedTabConfig[] | undefined): void => {
    for (const tab of tabs ?? []) {
      if (!tab?.id) continue;
      const values = (getTabData(tab.id, record, config) ?? {}) as Record<string, unknown>;
      const result = evaluateFormRules(filterRulesForTab([...rules], tab.id, config), values);

      for (const id of result.hiddenFields) hiddenIds.add(id);
      // A hidden tab hides everything on it; a required field the user cannot see must not
      // fail the import.
      if (result.hiddenTabs.includes(tab.id)) {
        for (const field of tab.fields ?? []) if (field?.id) hiddenIds.add(field.id);
      }
      for (const [id, message] of Object.entries(result.validationErrors)) {
        ruleErrors.set(id, message);
      }
      walk(tab.children);
    }
  };
  walk(config.tabs);

  return { hiddenIds, ruleErrors };
}

/** Apply a field's declared validators to a coerced value. */
function applyFieldValidators(field: NestedFieldConfig, value: unknown, lang: string): string[] {
  const messages: string[] = [];
  const validators = field.validators;
  if (!validators) return messages;

  const label = resolveLabel(field.label, lang) || field.id;
  const absent = value === undefined || value === null || value === '' ||
    (Array.isArray(value) && value.length === 0);

  if (validators.required && absent) {
    messages.push(`${label} is required`);
    // Every other validator describes a value, and there is not one.
    return messages;
  }
  if (absent) return messages;

  if (typeof value === 'number') {
    if (typeof validators.min === 'number' && value < validators.min) {
      messages.push(`${label} must be at least ${validators.min}`);
    }
    if (typeof validators.max === 'number' && value > validators.max) {
      messages.push(`${label} must be at most ${validators.max}`);
    }
  }

  if (typeof value === 'string') {
    if (typeof validators.minLength === 'number' && value.length < validators.minLength) {
      messages.push(`${label} must be at least ${validators.minLength} characters`);
    }
    if (typeof validators.maxLength === 'number' && value.length > validators.maxLength) {
      messages.push(`${label} must be at most ${validators.maxLength} characters`);
    }
    if (validators.pattern) {
      // A pattern comes from config, which is authored data — an unparseable one is a config
      // problem for `validateConfig` to report, not a reason to throw mid-import.
      try {
        if (!new RegExp(validators.pattern).test(value)) {
          messages.push(`${label} does not match the required format`);
        }
      } catch {
        /* reported by validateConfig */
      }
    }
    if (validators.email && !EMAIL_PATTERN.test(value)) {
      messages.push(`${label} is not a valid email address`);
    }
  }

  return messages;
}

/**
 * Check a built record the way the form would check it.
 *
 * `FieldValidators` **plus** the rules engine, because that is the renderer's actual contract:
 * a `validation` rule attaches an error, and a `visibility` rule hides a field, which must
 * relax `required`. Checking only the validators would accept records the form rejects *and*
 * reject records the form accepts — a required field hidden by a rule being the case that
 * bites first.
 *
 * **What this cannot check:** `validators.custom` and `validators.customAsync` name functions
 * in the renderer's Angular registries, which a framework-agnostic package has no way to call.
 * Parity here means "everything the schema and the rules express", not "everything the form
 * enforces". A consumer who needs the rest registers equivalents on whichever side runs the
 * import.
 */
export function validateImportedRecord(
  record: Record<string, unknown>,
  config: EntityFormConfig,
  options: ValidateRecordOptions = {},
): RecordProblem[] {
  const lang = options.lang ?? 'en';
  const problems: RecordProblem[] = [];
  if (!record || !config) return problems;

  const { hiddenIds, ruleErrors } = evaluateRuleState(record, config, options.rules);

  const check = (target: LeafTarget, value: unknown, ref: string, scopeValues: Record<string, unknown>): void => {
    const field = target.field;
    if (hiddenIds.has(field.id)) return;
    // Static `showWhen` is evaluated against the values in the field's own scope, which is
    // where its sibling lives — the same comparison the renderer makes.
    if (!evaluateFieldVisibility(field, scopeValues)) return;

    for (const message of applyFieldValidators(field, value, lang)) {
      problems.push({ ref, message, raw: value });
    }
    const ruleMessage = ruleErrors.get(field.id);
    if (ruleMessage) problems.push({ ref, message: ruleMessage, raw: value });
  };

  for (const target of collectLeafTargets(config)) {
    if (target.nested) continue;

    if (!target.arrayRef) {
      // A scope *is* a path into the record — that is what `collectFieldScopes` computes, and
      // it already accounts for a `flatData` tab by not adding the tab's id. Reading it
      // directly is exact where going back through `getTabData` would only approximate it for
      // a field nested inside a `group`.
      const scopeValues =
        target.scope === ROOT_SCOPE
          ? record
          : ((getValueByPath(record, target.scope) ?? {}) as Record<string, unknown>);
      check(target, getValueByPath(record, target.ref), target.ref, scopeValues);
      continue;
    }

    // A repeating field is validated per row that actually exists. An empty array is not a
    // failure: "the user added no rows" is a claim about the array, which a `HAS_ITEMS` rule
    // on the array itself expresses — requiring a child of a row nobody added would make an
    // empty optional list impossible.
    const rows = getValueByPath(record, target.arrayRef);
    if (!Array.isArray(rows)) continue;
    rows.forEach((row, index) => {
      const values = (row ?? {}) as Record<string, unknown>;
      check(target, getValueByPath(values, target.tail), `${target.arrayRef}.${index}.${target.tail}`, values);
    });
  }

  return problems;
}

// ─── Applying a plan ──────────────────────────────────────────────────────────

export interface ApplyMappingOptions extends CoerceOptions, ValidateRecordOptions {
  /** Stamp each record with the config's version. Default `true`. */
  stamp?: boolean;
  /**
   * The row number the first data row has in the user's spreadsheet. Default 2, because the
   * header is row 1 and that is the number they see in the gutter.
   */
  firstRowNumber?: number;
  /** Must match what the columns were derived with, or indexed refs will not line up. */
  maxArrayRows?: number;
}

/**
 * Turn mapped rows into records.
 *
 * A row that fails is **collected, not thrown** — the same choice `validateConfig` makes in
 * returning every problem rather than the first. An import of 400 rows that stops at row 3
 * makes the user fix one thing and run it again, 40 times.
 *
 * Rows are positional (`string[][]`), matching what `parseCsv` and the `SHEET_PARSER` contract
 * produce, because a mapping entry addresses a column by index.
 */
export function applyMapping(
  rows: readonly (readonly unknown[])[],
  plan: MappingPlan,
  config: EntityFormConfig,
  options: ApplyMappingOptions = {},
): ImportResult {
  const firstRowNumber = options.firstRowNumber ?? 2;
  const stamp = options.stamp ?? true;
  const records: Record<string, unknown>[] = [];
  const errors: ImportRowError[] = [];
  let skipped = 0;

  const byRef = new Map(
    deriveImportColumns(config, {
      lang: options.lang,
      maxArrayRows: options.maxArrayRows,
      includeReadonly: true,
      includeSystemDefault: true,
    }).columns.map(column => [column.ref, column]),
  );

  const entries = (plan?.entries ?? []).filter(entry => entry && byRef.has(entry.ref));

  rows.forEach((row, i) => {
    const rowNumber = firstRowNumber + i;
    const record: Record<string, unknown> = {};
    const rowErrors: ImportRowError[] = [];
    let sawValue = false;

    for (const entry of entries) {
      const column = byRef.get(entry.ref);
      if (!column) continue;

      const isConstant = entry.column === undefined;
      const raw = entry.column === undefined ? entry.constant : row[entry.column];

      // A non-text constant is already a record value — an option object, a number, a boolean
      // — authored against the config rather than typed into a cell. Putting it through
      // `coerceCell` would stringify it to `[object Object]` and then fail to parse it back.
      // A constant the user typed *is* text, and goes through coercion like any cell.
      const outcome: CoerceOutcome =
        isConstant && typeof raw !== 'string'
          ? { value: raw }
          : coerceCell(column.field, raw, options);

      if ('error' in outcome) {
        rowErrors.push({
          row: rowNumber,
          ref: entry.ref,
          ...(entry.column === undefined ? {} : { column: entry.column }),
          message: outcome.error,
          raw,
        });
        sawValue = true;
        continue;
      }
      if (outcome.value === undefined) continue;

      // A constant is not evidence the user put anything in this row; a blank row carrying
      // only constants is still a blank row.
      if (entry.column !== undefined) sawValue = true;
      setRecordValue(record, entry.ref, outcome.value);
    }

    if (!sawValue) {
      skipped++;
      return;
    }

    compactArrays(record);
    normalizeArrayStructures(record, config);

    for (const problem of validateImportedRecord(record, config, options)) {
      rowErrors.push({ row: rowNumber, ...problem });
    }

    if (rowErrors.length) {
      errors.push(...rowErrors);
      return;
    }
    records.push(stamp ? (stampRecord(record, config) as Record<string, unknown>) : record);
  });

  return { records, errors, skipped };
}
