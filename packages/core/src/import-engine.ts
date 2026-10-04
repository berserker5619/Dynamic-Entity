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

import {
  arrayBoundOf,
  collectLeafTargets,
  deriveImportColumns,
  stripIndices,
  upgradeLegacyRefs,
  validateMappingPlan,
  type LeafTarget,
} from './import-columns';
import { normalizeHeader, slotKey, slotPatterns } from './array-headers';
import {
  ROOT_SCOPE,
  collectFieldRefs,
  fieldRefFor,
  fieldsUnderTab,
  flattenFieldValues,
  namesOfField,
  type FieldScopeEntry,
} from './field-scopes';
import { stampRecord } from './migration';
import { evaluateFormRules } from './rules-engine';
import {
  evaluateFieldVisibility,
  getValueByPath,
  isUnsafePath,
  normalizeArrayStructures,
  resolveLabel,
  resolveOptionLabel,
  valuesMatch,
} from './form-logic';
import {
  isValidPhone,
  isValidUrl,
  normalizeHexColor,
  normalizeTags,
  ratingScale,
  sliderBounds,
} from './field-values';
import type {
  DropdownOption,
  EntityFormConfig,
  FormRule,
  NestedFieldConfig,
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

/** How a multiSelect or tags cell separates its values. */
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
 * A `{}` — not a `Date`, a `File`, or anything else with behaviour.
 *
 * The distinction matters twice below: such a value is opaque, so it is neither walked into
 * nor judged empty by looking at its keys. A `Date` has no enumerable own properties, so
 * treating every object alike quietly deleted one from an array.
 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * Remove the holes a sparse write leaves behind.
 *
 * Filling only "Contact 2" writes index 1 and leaves index 0 empty, so the array is
 * `[<hole>, {...}]`. A hole is not a row the user entered, and leaving it in produces a record
 * with a phantom blank entry that the form then renders as an empty row.
 *
 * **Returns the compacted value and does not mutate its argument**, for objects and arrays
 * alike.
 */
export function compactArrays<T>(value: T): T {
  if (Array.isArray(value)) {
    return value
      .map(item => compactArrays(item))
      .filter(item => !isEmptyValue(item)) as unknown as T;
  }
  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value)) out[key] = compactArrays(child);
    return out as unknown as T;
  }
  return value;
}

/** Empty for the purpose of "did the user put anything here". */
function isEmptyValue(value: unknown): boolean {
  if (value === undefined || value === null || value === '') return true;
  if (Array.isArray(value)) return value.length === 0;
  // Anything else with an identity — a Date, a File — is a value, whatever its keys look like.
  if (isPlainObject(value)) return Object.values(value).every(isEmptyValue);
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

const pad2 = (n: number): string => String(n).padStart(2, '0');

/** A bare calendar date: no time, no zone, so no instant is involved. */
const BARE_DATE = /^(\d{4})-(\d{1,2})-(\d{1,2})$/;

/**
 * A full ISO instant in UTC, which is how a spreadsheet's time-only cell renders as text.
 *
 * A time cell in a workbook is a fraction of a day against an epoch date, so a reader hands
 * back `1899-12-30T09:05:00.000Z` and anything that stringifies it produces exactly this. The
 * clock reading is in the UTC components — the same components `coerceTypedCell` reads from
 * the `Date` itself — so accepting this shape is what makes a preview's text and an import's
 * typed cell agree instead of one erroring while the other succeeds.
 *
 * Deliberately `Z` only. `09:30+05:00` in a field that stores no zone is ambiguous between the
 * clock the author read and the clock UTC would show, and guessing is how a time moves.
 */
const UTC_INSTANT = /^\d{4}-\d{2}-\d{2}T(\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?Z$/;

/** A number as a spreadsheet writes one, including 3-digit grouping and exponents. */
const NUMERIC = /^[+-]?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?(?:[eE][+-]?\d+)?$/;

/**
 * Read a cell as a calendar date — a year, a month and a day, with no instant in sight.
 *
 * `new Date('2024-03-07')` is the trap this exists to avoid. ECMAScript parses a bare
 * ISO date as **UTC midnight**, so reading it back with local getters moves it to the
 * previous day everywhere west of Greenwich:
 *
 *     TZ=America/New_York  new Date('2024-03-07')  →  local date part 2024-3-6
 *
 * A date field carries no timezone, so it must never round-trip through an instant. The ISO
 * shape is therefore read textually, and `Date` is used only for the other spellings a person
 * might type (`03/07/2024`, `March 7, 2024`) — which ECMAScript parses as *local* time, so
 * local getters are the right ones there.
 *
 * Returns `null` when the text is not a date at all, including a well-formed impossible one
 * like `2024-02-30`, which `Date` would silently roll forward to March.
 */
function parseCalendarDate(text: string): { year: number; month: number; day: number } | null {
  const bare = BARE_DATE.exec(text);
  if (bare) {
    const year = Number(bare[1]);
    const month = Number(bare[2]);
    const day = Number(bare[3]);
    // Built in UTC purely to check the day exists; no local time is ever consulted.
    const probe = new Date(Date.UTC(year, month - 1, day));
    const real =
      probe.getUTCFullYear() === year &&
      probe.getUTCMonth() === month - 1 &&
      probe.getUTCDate() === day;
    return real ? { year, month, day } : null;
  }

  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return null;
  return { year: parsed.getFullYear(), month: parsed.getMonth() + 1, day: parsed.getDate() };
}

/**
 * Read a cell that already carries a type, rather than stringifying it and parsing it back.
 *
 * A spreadsheet cell is not a string. An xlsx carries numbers, booleans and dates as typed
 * values, and a streaming reader hands back a JS `Date` for a date cell — so `coerceCell`
 * receives `unknown`, not `string`, the moment anything other than CSV is involved.
 *
 * **Why this is a defect and not a nicety.** `String(date)` renders *local* time, which is
 * exactly the trap `parseCalendarDate` exists to avoid, arriving through a door the timezone
 * gate did not watch because the gate only ever passed strings:
 *
 *     cell value from xlsx : 2024-03-07T00:00:00.000Z   (an .xlsx date cell is UTC midnight)
 *     String(raw)          : Wed Mar 06 2024 19:00:00 GMT-0500
 *     without this          : { value: '2024-03-06' }   ← a day early
 *
 * So a `Date` is read by its **UTC** components for the field types that carry no zone. An
 * Excel date cell is a calendar date with no zone, which is precisely why it is stored at UTC
 * midnight; `datetime` is the one type that genuinely is an instant and normalises to ISO.
 *
 * Returns `null` when the value is not one this can decide, and the text path takes over.
 */
function coerceTypedCell(field: NestedFieldConfig, raw: unknown): CoerceOutcome | null {
  if (raw instanceof Date) {
    if (Number.isNaN(raw.getTime())) return { error: 'Cell is not a valid date' };
    const ymd = `${raw.getUTCFullYear()}-${pad2(raw.getUTCMonth() + 1)}-${pad2(raw.getUTCDate())}`;

    switch (field.type) {
      case 'date':
        return { value: ymd };
      case 'monthYear':
        return { value: ymd.slice(0, 7) };
      case 'datetime':
        return { value: raw.toISOString() };
      case 'time':
        // A time-only cell is stored as a fraction of a day against an epoch date, so the
        // clock reading is in its UTC components too.
        return { value: `${pad2(raw.getUTCHours())}:${pad2(raw.getUTCMinutes())}` };
      default:
        // Any other field given a date cell — a `text` column someone typed dates into, a
        // `dropdown` whose options are dates. Rendering it locally is what this function
        // exists to prevent, so a midnight-UTC instant reads as the calendar date it is and
        // anything else keeps its full ISO form rather than silently losing its time.
        return { value: raw.getTime() % 86_400_000 === 0 ? ymd : raw.toISOString() };
    }
  }

  if (typeof raw === 'number' && (field.type === 'number' || field.type === 'currency')) {
    // Taken as-is. Stringifying first loses precision at the edges and re-parses a perfectly
    // good number through a regex that was written for what a person types.
    if (!Number.isFinite(raw)) return { error: `"${String(raw)}" is not a number` };
    return { value: raw };
  }

  if (typeof raw === 'number' && (field.type === 'slider' || field.type === 'rating')) {
    if (!Number.isFinite(raw)) return { error: `"${String(raw)}" is not a number` };
    return checkScale(field, raw, String(raw));
  }

  if (typeof raw === 'boolean' && (field.type === 'boolean' || field.type === 'checkbox')) {
    return { value: raw };
  }

  return null;
}

/**
 * Turn one cell into the value its field stores.
 *
 * An empty cell is not an error and not a value: it returns `{ value: undefined }`, and the
 * caller writes nothing. Writing `''` instead would turn every blank cell into a present-but-
 * empty field, which is a different record from one where the user said nothing — and it would
 * defeat `required`, because `''` is a value that exists.
 *
 * `raw` is `unknown` because a cell genuinely is: CSV yields text, an xlsx yields numbers,
 * booleans and `Date`s. Typed values are read as their type by `coerceTypedCell`; everything
 * else is trimmed text from here down.
 */
export function coerceCell(
  field: NestedFieldConfig,
  raw: unknown,
  options: CoerceOptions = {},
): CoerceOutcome {
  const lang = options.lang ?? 'en';
  if (!field || typeof field !== 'object') return { value: undefined };

  if (raw === null || raw === undefined) return { value: undefined };

  // Before anything is stringified: a cell that already has a type is read as that type.
  const typed = coerceTypedCell(field, raw);
  if (typed) return typed;

  const text = typeof raw === 'string' ? raw.trim() : String(raw).trim();
  if (text === '') return { value: undefined };

  switch (field.type) {
    case 'number':
    case 'currency': {
      // Matched against a shape rather than handed to `Number`, which is far more permissive
      // than any spreadsheet: it reads `0x10` as 16, and stripping commas first turned the
      // plainly broken `1,2,3` into 123. A malformed cell becoming a plausible wrong number is
      // worse than one becoming an error, because nobody goes looking for it.
      if (!NUMERIC.test(text)) return { error: `"${text}" is not a number` };
      const parsed = Number(text.replace(/,/g, ''));
      if (!Number.isFinite(parsed)) return { error: `"${text}" is not a number` };
      return { value: parsed };
    }

    case 'slider':
    case 'rating': {
      if (!NUMERIC.test(text)) return { error: `"${text}" is not a number` };
      const parsed = Number(text.replace(/,/g, ''));
      if (!Number.isFinite(parsed)) return { error: `"${text}" is not a number` };
      return checkScale(field, parsed, text);
    }

    case 'color': {
      const hex = normalizeHexColor(text);
      return hex ? { value: hex } : { error: `"${text}" is not a colour (#RRGGBB)` };
    }

    case 'tags': {
      const tags = normalizeTags(text.split(MULTI_SEPARATOR));
      return { value: tags.length ? tags : undefined };
    }

    case 'boolean':
    case 'checkbox': {
      const lower = text.toLowerCase();
      if (TRUE_TEXT.has(lower)) return { value: true };
      if (FALSE_TEXT.has(lower)) return { value: false };
      return { error: `"${text}" is not true or false` };
    }

    case 'date': {
      const parsed = parseCalendarDate(text);
      if (!parsed) return { error: `"${text}" is not a date` };
      return { value: `${parsed.year}-${pad2(parsed.month)}-${pad2(parsed.day)}` };
    }

    // The one field here that genuinely *is* an instant, so it is the one that may go through
    // `Date` and come back as UTC.
    case 'datetime': {
      const parsed = new Date(text);
      if (Number.isNaN(parsed.getTime())) return { error: `"${text}" is not a date and time` };
      return { value: parsed.toISOString() };
    }

    case 'monthYear': {
      const match = /^(\d{4})-(\d{1,2})$/.exec(text);
      if (match) {
        const month = Number(match[2]);
        if (month >= 1 && month <= 12) return { value: `${match[1]}-${pad2(month)}` };
        return { error: `"${text}" is not a month` };
      }
      // A full date given to a month field goes through the same calendar reader, so it does
      // not shift a month at the turn of one.
      const parsed = parseCalendarDate(text);
      if (!parsed) return { error: `"${text}" is not a month and year` };
      return { value: `${parsed.year}-${pad2(parsed.month)}` };
    }

    case 'time': {
      // Stored as `HH:mm` with no date and no zone, which is how the renderer stores it.
      const match = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(text) ?? UTC_INSTANT.exec(text);
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

/**
 * A `slider` or `rating` value checked against the scale the control draws.
 *
 * The form cannot produce a value off the track or a fraction of a star, so an import that
 * accepted one would save a record the form cannot display. This is separate from
 * `validators.min`/`max`: those still apply afterwards and report in the same words they use
 * for a `number`.
 */
function checkScale(field: NestedFieldConfig, value: number, text: string): CoerceOutcome {
  if (field.type === 'rating') {
    const scale = ratingScale(field);
    if (!Number.isInteger(value) || value < 1 || value > scale) {
      return { error: `"${text}" is not a whole number from 1 to ${scale}` };
    }
    return { value };
  }
  const { min, max } = sliderBounds(field);
  if (value < min || value > max) return { error: `"${text}" is outside ${min} to ${max}` };
  return { value };
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

  // How many children each array has, so a bare `Phone 2` is only read as the one child of
  // an array that has one.
  const childrenOf = new Map<string, Set<string>>();
  for (const column of columns) {
    if (column.arrayRef === undefined) continue;
    const children = childrenOf.get(column.arrayRef) ?? new Set<string>();
    children.add(stripIndices(column.ref));
    childrenOf.set(column.arrayRef, children);
  }

  /**
   * A field's own label and id, and for a row of a repeating field every numbered spelling
   * of it a sheet might use — `Phone 2 Number`, `phone_2_number`, `Number (2)`. Before these
   * existed every slot shared one label and one id, tripped the ambiguity guard below, and
   * matched only its own ref or generated heading.
   */
  const candidates = (column: ImportColumn): { exact: string[]; loose: string[] } => {
    const label = resolveLabel(column.field.label) || '';
    const loose = [label, column.field.id];
    if (column.arrayRef !== undefined && column.arrayIndex !== undefined) {
      const patterns = slotPatterns({
        arrayLabel: column.arrayLabel,
        arrayId: column.arrayRef.split('.').pop(),
        childLabel: label,
        childId: column.field.id,
        onlyChild: childrenOf.get(column.arrayRef)?.size === 1,
      });
      loose.push(...patterns.map(pattern => slotKey(pattern, column.arrayIndex! + 1)));
    }
    return { exact: [column.ref, column.header], loose };
  };

  /**
   * Loose keys that more than one field answers to.
   *
   * "Address" on Personal Details and "Address" on Work Details are two fields with one label
   * — which is the whole reason a field's identity is its path. Guessing one of them for a
   * bare "Address" column resolves the ambiguity by walk order, silently and invisibly, and
   * the user is shown a mapping that looks considered. Matching neither is the honest answer:
   * the column is left unmapped and they pick.
   */
  const ambiguousLooseKeys = new Set<string>();
  const looseSeen = new Set<string>();
  for (const column of columns) {
    // Deduplicated per column first. A field's label and its id normalise to the same key far
    // more often than not — "First Name" and `firstName` are both `firstname` — so counting
    // them separately made every such field collide with itself and match nothing.
    const keys = new Set(candidates(column).loose.filter(Boolean).map(normalizeHeader));
    for (const key of keys) {
      if (looseSeen.has(key)) ambiguousLooseKeys.add(key);
      looseSeen.add(key);
    }
  }

  // Two passes, so an exact match never loses its column to an earlier field's guess.
  for (const pass of ['exact', 'loose'] as const) {
    for (const column of columns) {
      if (takenRefs.has(column.ref)) continue;
      const wanted = candidates(column)[pass]
        .filter(Boolean)
        .map(normalizeHeader)
        .filter(key => pass === 'exact' || !ambiguousLooseKeys.has(key));
      if (!wanted.length) continue;
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
  /**
   * A precomputed `collectLeafTargets(config)`, for a caller validating many records.
   *
   * Deriving it here means re-walking the whole config once per record, which is the
   * difference between linear work and linear work times the size of the schema on a file
   * with fifty thousand rows. Omit it and it is derived, so a one-off call stays a one-liner.
   */
  targets?: readonly LeafTarget[];
}

/** What the rules and `showWhen` make of one record. */
interface RuleState {
  /** The flat map `showWhen` is evaluated against — see `flattenFieldValues`. */
  values: Record<string, unknown>;
  /** Fields that do not count: hidden by a rule, inside a hidden container, or on a hidden tab. */
  hidden: Set<NestedFieldConfig>;
  /** Fields a rule explicitly showed, which beats a static `showWhen` or `visibility: false`. */
  shown: Set<NestedFieldConfig>;
  /** A rule's validation message per field. */
  ruleErrors: Map<NestedFieldConfig, string>;
}

/**
 * Which fields the rules hide or show, and which rules have raised an error.
 *
 * Evaluated exactly the way the form evaluates them: every rule at once, against one flat map
 * in which each field answers to its bare id and to its `[ref]`. A rule names a field either
 * way — the builder writes refs — so a field is hidden when *either* of its names is, and a
 * hidden container hides everything inside it. Anything less, and a required field the form
 * hides would reject a row the form itself would save.
 *
 * Only the static part — which values there are — differs from the form: here they come from
 * the record, at the address `collectFieldRefs` gives, rather than from controls. A field inside
 * an array row has no single value, in the form or here, and is left out of the map.
 */
function evaluateRuleState(
  record: Record<string, unknown>,
  config: EntityFormConfig,
  rules: readonly FormRule[] | undefined,
): RuleState {
  const entries = collectFieldRefs(config);
  const arrays = entries
    .filter(entry => entry.field?.type === 'array' && entry.field.id)
    .map(entry => fieldRefFor(entry.scope, entry.field.id));
  const inArray = (entry: FieldScopeEntry): boolean => {
    const position = fieldRefFor(entry.scope, entry.field.id);
    return arrays.some(arrayRef => position.startsWith(`${arrayRef}.`));
  };
  const values = flattenFieldValues(entries, entry =>
    inArray(entry) ? undefined : { value: getValueByPath(record, entry.ref) },
  );

  const state: RuleState = { values, hidden: new Set(), shown: new Set(), ruleErrors: new Map() };
  if (!rules?.length) return state;

  const result = evaluateFormRules(rules as FormRule[], values);
  const hiddenNames = new Set(result.hiddenFields);
  const shownNames = new Set(result.shownFields);

  // A hidden tab hides everything it owns, sub-tabs and container children included; a
  // required field the user cannot see must not fail the import.
  for (const tabId of result.hiddenTabs) {
    for (const entry of fieldsUnderTab(config, tabId)) state.hidden.add(entry.field);
  }

  // Entries arrive parent-first, so a hidden container is known before its children are.
  const hiddenContainers: string[] = [];
  for (const entry of entries) {
    const field = entry.field;
    if (!field?.id) continue;
    const position = fieldRefFor(entry.scope, field.id);
    const names = namesOfField(field, entry.scope);

    const hidden =
      hiddenContainers.some(prefix => position.startsWith(`${prefix}.`)) ||
      names.some(name => hiddenNames.has(name));
    if (hidden) {
      state.hidden.add(field);
      if (field.type === 'group' || field.type === 'array') hiddenContainers.push(position);
    } else if (names.some(name => shownNames.has(name))) {
      state.shown.add(field);
    }

    const message = names.map(name => result.validationErrors[name]).find(Boolean);
    if (message) state.ruleErrors.set(field, message);
  }
  return state;
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

  // Angular's `minLength`/`maxLength` count an array's items as well as a string's characters,
  // and the form applies them to both. Checking only strings passed rows the form refuses.
  if (Array.isArray(value)) {
    if (typeof validators.minLength === 'number' && value.length < validators.minLength) {
      messages.push(`${label} must have at least ${validators.minLength} items`);
    }
    if (typeof validators.maxLength === 'number' && value.length > validators.maxLength) {
      messages.push(`${label} must have at most ${validators.maxLength} items`);
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
    if (validators.url && !isValidUrl(value)) {
      messages.push(`${label} is not a valid web address`);
    }
    if (validators.phone && !isValidPhone(value)) {
      messages.push(`${label} is not a valid phone number`);
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

  const rules = evaluateRuleState(record, config, options.rules);

  const check = (target: LeafTarget, value: unknown, ref: string, scopeValues: Record<string, unknown>): void => {
    const field = target.field;
    // The form's precedence: a hide beats everything, a show beats static visibility.
    if (rules.hidden.has(field)) return;
    // Static `showWhen` reads the form's flat map, with the field's own scope over it so that
    // a bare sibling id means the sibling beside it — in an array row, the same row's.
    if (!rules.shown.has(field) && !evaluateFieldVisibility(field, { ...rules.values, ...scopeValues })) return;

    for (const message of applyFieldValidators(field, value, lang)) {
      problems.push({ ref, message, raw: value });
    }
    const ruleMessage = rules.ruleErrors.get(field);
    if (ruleMessage) problems.push({ ref, message: ruleMessage, raw: value });
  };

  for (const target of options.targets ?? collectLeafTargets(config)) {
    if (target.nested) continue;

    if (!target.arrayRef) {
      // A scope *is* a path into the record — that is what `collectFieldScopes` computes, and
      // it already accounts for a `flatData` tab by not adding the tab's id. Reading it
      // directly is exact where going back through `getTabData` would only approximate it for
      // a field nested inside a `group`.
      const scopeValues =
        target.recordScope === ROOT_SCOPE
          ? record
          : ((getValueByPath(record, target.recordScope) ?? {}) as Record<string, unknown>);
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

  const derive = {
    lang: options.lang,
    // The plan's own row numbers decide how far the column list reaches. Taking this from the
    // caller meant a plan authored for five array rows, applied with the default three, had
    // two of its columns silently discarded by the filter below — a clean-looking import that
    // dropped real data.
    maxArrayRows: Math.max(arrayBoundOf(plan), 1),
    includeReadonly: true,
    includeSystemDefault: true,
  };

  // The plan is checked once, before a single row is read. Refusing here rather than
  // per-row is the point: a plan naming a field the config does not have is wrong about
  // every row, and importing the part of it that happens to resolve is how columns go
  // missing without anyone being told.
  const planProblems = validateMappingPlan(plan, config, derive);
  if (planProblems.some(problem => problem.level === 'error')) {
    return { records: [], errors: [], skipped: 0, planProblems };
  }
  // Already warned about above; from here on a 2.2 ref is simply its current address.
  const upgraded = upgradeLegacyRefs(plan, config);

  const byRef = new Map(
    deriveImportColumns(config, derive).columns.map(column => [column.ref, column]),
  );
  const targets = collectLeafTargets(config);
  const entries = (upgraded?.entries ?? []).filter(entry => entry && byRef.has(entry.ref));
  // `normalizeArrayStructures` walks by id, so it finds an array where its id puts it. A moved
  // array lives at its override instead, which is where the renderer reads it from.
  const movedArrays = collectFieldRefs(config)
    .filter(entry => entry.field?.type === 'array' && entry.ref !== fieldRefFor(entry.scope, entry.field.id))
    .map(entry => entry.ref);

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

    const cleaned = compactArrays(record);
    normalizeArrayStructures(cleaned, config);
    for (const ref of movedArrays) {
      const value = getValueByPath(cleaned, ref);
      if (!Array.isArray(value)) setRecordValue(cleaned, ref, value == null ? [] : [value]);
    }

    // `targets` is hoisted out of the loop: deriving it per row re-walked the whole config
    // once per row, which is pure waste on the large files the streaming path exists for.
    for (const problem of validateImportedRecord(cleaned, config, { ...options, targets })) {
      rowErrors.push({ row: rowNumber, ...problem });
    }

    if (rowErrors.length) {
      errors.push(...rowErrors);
      return;
    }
    records.push(stamp ? (stampRecord(cleaned, config) as Record<string, unknown>) : cleaned);
  });

  return { records, errors, skipped, planProblems };
}
