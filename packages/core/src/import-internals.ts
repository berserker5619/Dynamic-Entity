/**
 * import-internals.ts — what makes an imported record a Dynamic Entity record.
 *
 * Reading a cell as a field's value, checking a record as the form checks it, and giving it
 * the shape a saved record has. Until 3.0 this file was `import-engine.ts` and also held the
 * loop that turned rows into records. That loop is now sheet-to-schema's, and what is left
 * here is what `entityFormConfigAdapter` hands it. `import-engine.ts` re-exports all of this
 * and keeps `applyMapping` and `suggestMapping`.
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

import { collectLeafTargets, type LeafTarget } from './import-derive';
import {
  ROOT_SCOPE,
  collectFieldRefs,
  fieldRefFor,
  fieldsUnderTab,
  flattenFieldValues,
  namesOfField,
  type FieldScopeEntry,
} from './field-scopes';
import { evaluateFormRules } from './rules-engine';
import {
  evaluateFieldVisibility,
  getTabPath,
  getValueByPath,
  isUnsafePath,
  normalizeArrayStructures,
  placeTabFields,
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
  NestedTabConfig,
} from './form-model.types';
import type { ImportRowError } from './import-model.types';

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
  /**
   * The decimal mark text numbers use. Default `.`, with `,` grouping thousands: `1,234.5`.
   *
   * With `,` the roles swap — `1.234,5` — which is what a sheet saved with `;` between fields
   * almost always means, because Excel picks `;` exactly in the locales whose decimal mark is
   * the comma. Reading such a sheet with `.` turns `1,500` (one and a half) into 1500 with no
   * error at all, so a transport that detected `;` passes `,` here.
   */
  decimal?: '.' | ',';
  /**
   * The order of a date written in digits, such as `05/09/2026`: `DMY` for day first, `MDY` for
   * month first.
   *
   * Without it, a date that reads two ways (both of its first two parts are 12 or less) is an
   * error, never a guess. Until 2.5.0 such a date went to `Date`, which reads month first, so
   * a sheet of day-first dates imported as the wrong days with no error. State `MDY` to keep
   * reading them as before, two-digit years included. `YMD` says the sheet is year first, so
   * a date that is not is an error. An ISO date (`2026-09-05`), a typed date cell, and a date only one order fits are
   * read exactly as they always were, whatever is stated here.
   */
  dateOrder?: DateOrder;
}

/** The order of the parts in a date written in digits. */
export type DateOrder = 'DMY' | 'MDY' | 'YMD';

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

/**
 * A date written in digits that is not year first: `05/09/2026`, `5-9-26`, `05.09.2026`,
 * alone or leading a date and time. The year-first forms never read two ways, and are not this.
 */
const SLASH_DATE = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{1,4})(?![\d/.-])/;

/** What a cell's own text says to do about a date written in digits. */
type SlashDate =
  /** It is not one: read the text the way it always was. */
  | { read: 'as-before' }
  /** Both orders fit, and none was stated. */
  | { read: 'ambiguous' }
  /** An order was stated: these are its parts, or `null` when it names no date in that order. */
  | { read: 'stated'; date: { year: number; month: number; day: number } | null; rest: string };

/**
 * Decide how a date written in digits is read (2.5.0).
 *
 * `Date` reads `05/09/2026` as 9 May, whatever the sheet meant, and says nothing. So:
 * - with `order` stated, the parts are read in that order, and never through `Date`. A year
 *   of two digits takes the century `Date` has always given it, 00 to 49 in the 2000s and 50
 *   to 99 in the 1900s, so that stating month first reads `5/9/26` exactly as it was read
 *   before the order had to be stated;
 * - with none stated, a date both orders fit is ambiguous, and is refused;
 * - anything else is left to the reading it always had.
 */
function readSlashDate(text: string, order: DateOrder | undefined): SlashDate {
  const match = SLASH_DATE.exec(text);
  if (!match) return { read: 'as-before' };
  const first = Number(match[1]);
  const second = Number(match[2]);
  const rest = text.slice(match[0].length);

  if (!order) return first <= 12 && second <= 12 ? { read: 'ambiguous' } : { read: 'as-before' };
  if (order === 'YMD' || (match[3].length !== 4 && match[3].length !== 2)) return { read: 'stated', date: null, rest };

  const written = Number(match[3]);
  const year = match[3].length === 4 ? written : written < 50 ? 2000 + written : 1900 + written;
  const [day, month] = order === 'DMY' ? [first, second] : [second, first];
  // Built in UTC purely to check the day exists; no local time is ever consulted.
  const probe = new Date(Date.UTC(year, month - 1, day));
  const real = probe.getUTCFullYear() === year && probe.getUTCMonth() === month - 1 && probe.getUTCDate() === day;
  return { read: 'stated', date: real ? { year, month, day } : null, rest };
}

/** The error for a date that reads two ways. Shared, so every field type words it alike. */
const ambiguousDate = (text: string): CoerceOutcome => ({
  error: `"${text}" could be day first or month first; state the import's date order (dateOrder: 'DMY' or 'MDY')`,
});

/** A number as a spreadsheet writes one, including 3-digit grouping and exponents. */
const NUMERIC = /^[+-]?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?(?:[eE][+-]?\d+)?$/;

/** The same shape with a decimal comma and `.` grouping: `1.234,5`. */
const NUMERIC_COMMA = /^[+-]?(?:\d+|\d{1,3}(?:\.\d{3})+)(?:,\d+)?(?:[eE][+-]?\d+)?$/;

/**
 * A number cell's text as a number, or `null` when it is not one.
 *
 * Matched against a shape rather than handed to `Number`, which is far more permissive than any
 * spreadsheet: it reads `0x10` as 16, and stripping commas first turned the plainly broken
 * `1,2,3` into 123. A malformed cell becoming a plausible wrong number is worse than one
 * becoming an error, because nobody goes looking for it.
 */
function parseNumberText(text: string, decimal: '.' | ',' = '.'): number | null {
  const canonical =
    decimal === ','
      ? NUMERIC_COMMA.test(text)
        ? text.replace(/\./g, '').replace(',', '.')
        : null
      : NUMERIC.test(text)
        ? text.replace(/,/g, '')
        : null;
  if (canonical === null) return null;
  const parsed = Number(canonical);
  return Number.isFinite(parsed) ? parsed : null;
}

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
 *
 * Returns `'ambiguous'` for a date written in digits that reads two ways when no `order` is
 * stated (`readSlashDate`). That is the one spelling `Date` must not be handed: it reads
 * `05/09/2026` month first and reports nothing.
 */
function parseCalendarDate(
  text: string,
  order?: DateOrder,
): { year: number; month: number; day: number } | 'ambiguous' | null {
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

  const slash = readSlashDate(text, order);
  if (slash.read === 'ambiguous') return 'ambiguous';
  // A date field holds a date: anything after it in a stated order is not one.
  if (slash.read === 'stated') return slash.rest === '' ? slash.date : null;

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
      const parsed = parseNumberText(text, options.decimal);
      return parsed === null ? { error: `"${text}" is not a number` } : { value: parsed };
    }

    case 'slider':
    case 'rating': {
      const parsed = parseNumberText(text, options.decimal);
      return parsed === null ? { error: `"${text}" is not a number` } : checkScale(field, parsed, text);
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
      const parsed = parseCalendarDate(text, options.dateOrder);
      if (parsed === 'ambiguous') return ambiguousDate(text);
      if (!parsed) return { error: `"${text}" is not a date` };
      return { value: `${parsed.year}-${pad2(parsed.month)}-${pad2(parsed.day)}` };
    }

    // The one field here that genuinely *is* an instant, so it is the one that may go through
    // `Date` and come back as UTC.
    case 'datetime': {
      // Unless its date is written in digits: `Date` would read that month first.
      const slash = readSlashDate(text, options.dateOrder);
      if (slash.read === 'ambiguous') return ambiguousDate(text);
      if (slash.read === 'stated' && !slash.date) return { error: `"${text}" is not a date and time` };
      // `Date` reads digits month first, so it is handed the stated date that way round and
      // reads the rest of the cell, the time and all its spellings, exactly as it always did.
      const parsed = new Date(
        slash.read === 'stated' && slash.date ? `${slash.date.month}/${slash.date.day}/${slash.date.year}${slash.rest}` : text,
      );
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
      const parsed = parseCalendarDate(text, options.dateOrder);
      if (parsed === 'ambiguous') return ambiguousDate(text);
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

/** A tab and the record address each of its own fields is imported to. */
interface TabPlacement {
  tab: NestedTabConfig;
  fields: { id: string; ref: string }[];
}

/**
 * Every tab, parents before sub-tabs, with where each of its direct fields was written.
 *
 * The address is `collectFieldRefs`'s: the position, or the override for a moved container or
 * an authored leaf. Config-level, so `applyMapping` works it out once rather than per row.
 */
function tabPlacements(config: EntityFormConfig | null | undefined): TabPlacement[] {
  const addressOf = new Map<string, string>();
  for (const entry of collectFieldRefs(config)) {
    if (entry.tabLevel && entry.field?.id) addressOf.set(fieldRefFor(entry.scope, entry.field.id), entry.ref);
  }
  const placements: TabPlacement[] = [];
  const walk = (tabs: NestedTabConfig[] | undefined): void => {
    for (const tab of tabs ?? []) {
      if (!tab?.id) continue;
      const scope = (getTabPath(config?.tabs, tab.id) ?? [tab.id]).join('.') || ROOT_SCOPE;
      const fields = (tab.fields ?? [])
        .filter(field => field?.id)
        .map(field => {
          const position = fieldRefFor(scope, field.id);
          return { id: field.id, ref: addressOf.get(position) ?? position };
        });
      placements.push({ tab, fields });
      walk(tab.children);
    }
  };
  walk(config?.tabs);
  return placements;
}

/** Why a record was judged wrong: the importer's record codes a validator or a rule can raise. */
export type RecordCheckCode = 'RECORD_REQUIRED' | 'RECORD_FORMAT' | 'RECORD_RANGE' | 'RECORD_RULE';

/** A `RecordProblem` with its code, for the schema adapter. Not part of the package's API. */
export type CodedRecordProblem = RecordProblem & { code: RecordCheckCode };

/** Apply a field's declared validators to a coerced value. */
function applyFieldValidators(
  field: NestedFieldConfig,
  value: unknown,
  lang: string,
): { message: string; code: RecordCheckCode }[] {
  const messages: { message: string; code: RecordCheckCode }[] = [];
  const add = (code: RecordCheckCode, message: string): void => {
    messages.push({ message, code });
  };
  const validators = field.validators;
  if (!validators) return messages;

  const label = resolveLabel(field.label, lang) || field.id;
  const absent = value === undefined || value === null || value === '' ||
    (Array.isArray(value) && value.length === 0);

  if (validators.required && absent) {
    add('RECORD_REQUIRED', `${label} is required`);
    // Every other validator describes a value, and there is not one.
    return messages;
  }
  if (absent) return messages;

  if (typeof value === 'number') {
    if (typeof validators.min === 'number' && value < validators.min) {
      add('RECORD_RANGE', `${label} must be at least ${validators.min}`);
    }
    if (typeof validators.max === 'number' && value > validators.max) {
      add('RECORD_RANGE', `${label} must be at most ${validators.max}`);
    }
  }

  // Angular's `minLength`/`maxLength` count an array's items as well as a string's characters,
  // and the form applies them to both. Checking only strings passed rows the form refuses.
  if (Array.isArray(value)) {
    if (typeof validators.minLength === 'number' && value.length < validators.minLength) {
      add('RECORD_RANGE', `${label} must have at least ${validators.minLength} items`);
    }
    if (typeof validators.maxLength === 'number' && value.length > validators.maxLength) {
      add('RECORD_RANGE', `${label} must have at most ${validators.maxLength} items`);
    }
  }

  if (typeof value === 'string') {
    if (typeof validators.minLength === 'number' && value.length < validators.minLength) {
      add('RECORD_RANGE', `${label} must be at least ${validators.minLength} characters`);
    }
    if (typeof validators.maxLength === 'number' && value.length > validators.maxLength) {
      add('RECORD_RANGE', `${label} must be at most ${validators.maxLength} characters`);
    }
    if (validators.pattern) {
      // A pattern comes from config, which is authored data — an unparseable one is a config
      // problem for `validateConfig` to report, not a reason to throw mid-import.
      try {
        if (!new RegExp(validators.pattern).test(value)) {
          add('RECORD_FORMAT', `${label} does not match the required format`);
        }
      } catch {
        /* reported by validateConfig */
      }
    }
    if (validators.email && !EMAIL_PATTERN.test(value)) {
      add('RECORD_FORMAT', `${label} is not a valid email address`);
    }
    if (validators.url && !isValidUrl(value)) {
      add('RECORD_FORMAT', `${label} is not a valid web address`);
    }
    if (validators.phone && !isValidPhone(value)) {
      add('RECORD_FORMAT', `${label} is not a valid phone number`);
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
  // Row errors carry no code in 2.x; the coded form is what the schema adapter reads.
  return validateImportedRecordCoded(record, config, options).map(({ ref, message, raw }) => ({ ref, message, raw }));
}

/**
 * `validateImportedRecord`, with each problem's code: which validator failed, or that a rule
 * raised it. For `entityFormConfigAdapter`; not exported from the package.
 */
export function validateImportedRecordCoded(
  record: Record<string, unknown>,
  config: EntityFormConfig,
  options: ValidateRecordOptions = {},
): CodedRecordProblem[] {
  const lang = options.lang ?? 'en';
  const problems: CodedRecordProblem[] = [];
  if (!record || !config) return problems;

  const rules = evaluateRuleState(record, config, options.rules);

  const check = (target: LeafTarget, value: unknown, ref: string, scopeValues: Record<string, unknown>): void => {
    const field = target.field;
    // The form's precedence: a hide beats everything, a show beats static visibility.
    if (rules.hidden.has(field)) return;
    // Static `showWhen` reads the form's flat map, with the field's own scope over it so that
    // a bare sibling id means the sibling beside it — in an array row, the same row's.
    if (!rules.shown.has(field) && !evaluateFieldVisibility(field, { ...rules.values, ...scopeValues })) return;

    for (const { message, code } of applyFieldValidators(field, value, lang)) {
      problems.push({ ref, message, raw: value, code });
    }
    const ruleMessage = rules.ruleErrors.get(field);
    if (ruleMessage) problems.push({ ref, message: ruleMessage, raw: value, code: 'RECORD_RULE' });
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

// ─── Shaping a record ─────────────────────────────────────────────────────────

/**
 * Give a mapped row the shape a saved record has: holes compacted, arrays as arrays, and each
 * tab's own fields placed where the form places them.
 *
 * The config-level work is done once, here, and the returned function is applied per record.
 * `applyMapping` and `entityFormConfigAdapter`'s `finalize` both call it, so an imported
 * record has one shape whichever engine built it. Does not mutate its argument.
 */
export function recordShaper(
  config: EntityFormConfig,
): (record: Record<string, unknown>) => Record<string, unknown> {
  // `normalizeArrayStructures` walks by id, so it finds an array where its id puts it. A moved
  // array lives at its override instead, which is where the renderer reads it from.
  const movedArrays = collectFieldRefs(config)
    .filter(entry => entry.field?.type === 'array' && entry.ref !== fieldRefFor(entry.scope, entry.field.id))
    .map(entry => entry.ref);
  const placements = tabPlacements(config);

  return record => {
    const cleaned = compactArrays(record);
    normalizeArrayStructures(cleaned, config);
    for (const ref of movedArrays) {
      const value = getValueByPath(cleaned, ref);
      if (!Array.isArray(value)) setRecordValue(cleaned, ref, value == null ? [] : [value]);
    }
    // Then each tab's own fields where a saved record holds them: at the position and at the
    // `refererField` both, through the placement the form saves with. Values were written at
    // their record address above, which for a moved container is the override only.
    for (const { tab, fields } of placements) {
      const values: Record<string, unknown> = {};
      for (const { id, ref } of fields) {
        const value = getValueByPath(cleaned, ref);
        if (value !== undefined) values[id] = value;
      }
      if (Object.keys(values).length) placeTabFields(cleaned, tab, values, config);
    }
    return cleaned;
  };
}
