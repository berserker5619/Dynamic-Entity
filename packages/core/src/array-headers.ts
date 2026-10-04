/**
 * array-headers.ts — how people number the columns of a repeating field.
 *
 * A template says `Phone / Number 1`, but a customer's own sheet says `Phone 1 Number`,
 * `phone_2_number`, `PhoneNumber3` or `Number (2)`. Suggestion has to recognise those, and so
 * does sizing the column list from a sheet — and if the two read headers differently, the
 * wizard offers six slots and then fills four. So this is the one grammar both use.
 *
 * Patterns are written over *normalised* text (lowercase alphanumerics, the same collapse
 * `suggestMapping` applies), with `#` marking the slot number. Normalising first is what makes
 * spaces, underscores and brackets irrelevant: `Number (2)` and `number_2` are both `number2`.
 */

import { MAX_ARRAY_BOUND, arrayBoundOf, deriveImportColumns, stripIndices } from './import-columns';
import { resolveLabel } from './form-logic';
import type { EntityFormConfig } from './form-model.types';
import type { ImportColumn, MappingPlan } from './import-model.types';

/** Lowercase alphanumerics only, so "First Name", `first_name` and `firstName` collapse. */
export function normalizeHeader(text: string): string {
  return String(text ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

const SLOT = '#';

/** What the patterns for one repeating field's child are built from. */
export interface SlotNames {
  /** The array's label, resolved — "Phone" or "Phones". */
  arrayLabel?: string;
  /** The array's id, or the last segment of its address. */
  arrayId?: string;
  /** The child's label, resolved. */
  childLabel?: string;
  childId?: string;
  /** The array has only this one child, so a bare `Phone 2` can only mean it. */
  onlyChild?: boolean;
}

/**
 * A name and its trivially singular form: "Phones" also answers as "Phone".
 *
 * Deliberately only a trailing `s`. A real inflector is language-specific, and a wrong
 * singular is a wrong guess; this one is right for the overwhelmingly common case and harmless
 * otherwise, because a key nobody's header spells simply never matches.
 */
function withSingular(name: string): string[] {
  return name.length > 3 && name.endsWith('s') ? [name, name.slice(0, -1)] : [name];
}

/**
 * Every normalised pattern a header for this child may follow, with `#` for the slot number.
 *
 * `{array} n {child}`, `{array} {child} n`, `{child} n`, and `{array} n` when the child is the
 * array's only one. `{child} (n)` needs no pattern of its own: it normalises to `{child} n`.
 */
export function slotPatterns(names: SlotNames): string[] {
  const arrays = [names.arrayLabel, names.arrayId]
    .map(name => normalizeHeader(name ?? ''))
    .filter(Boolean)
    .flatMap(withSingular);
  const children = [names.childLabel, names.childId].map(name => normalizeHeader(name ?? '')).filter(Boolean);

  const patterns = new Set<string>();
  for (const child of children) {
    patterns.add(`${child}${SLOT}`);
    for (const array of arrays) {
      patterns.add(`${array}${SLOT}${child}`);
      patterns.add(`${array}${child}${SLOT}`);
    }
  }
  if (names.onlyChild) for (const array of arrays) patterns.add(`${array}${SLOT}`);
  return [...patterns];
}

/** A pattern with its slot filled in: the key a header for row `slot` (1-based) normalises to. */
export function slotKey(pattern: string, slot: number): string {
  return pattern.replace(SLOT, String(slot));
}

/**
 * The 1-based slot a header names under `pattern`, or `null`.
 *
 * Read rather than generated: sizing a sheet cannot enumerate every slot up to the bound to
 * find out which one a header means.
 */
export function matchSlot(header: string, pattern: string): number | null {
  const at = pattern.indexOf(SLOT);
  if (at < 0) return null;
  const key = normalizeHeader(header);
  const prefix = pattern.slice(0, at);
  const suffix = pattern.slice(at + 1);
  if (key.length <= prefix.length + suffix.length || !key.startsWith(prefix) || !key.endsWith(suffix)) {
    return null;
  }
  const digits = key.slice(prefix.length, key.length - suffix.length);
  if (!/^[1-9]\d{0,5}$/.test(digits)) return null;
  return Number(digits);
}

/**
 * Each array's distinct children among `columns`, keyed by the array's address.
 *
 * `{array} n` is only a pattern for an array with one child, and that has to be decided over
 * the whole column list, not per column.
 */
export function childCountByArray(columns: readonly ImportColumn[]): Map<string, number> {
  const children = new Map<string, Set<string>>();
  for (const column of columns) {
    if (column.arrayRef === undefined) continue;
    const set = children.get(column.arrayRef) ?? new Set<string>();
    set.add(stripIndices(column.ref));
    children.set(column.arrayRef, set);
  }
  return new Map([...children].map(([arrayRef, set]) => [arrayRef, set.size]));
}

/**
 * The patterns one unrolled column answers to: the sheet spellings `slotPatterns` knows, plus
 * the engine's own — the generated heading and the ref — so a template's headers size the
 * column list too.
 */
export function columnSlotPatterns(column: ImportColumn, childCount: ReadonlyMap<string, number>): string[] {
  if (column.arrayRef === undefined || column.arrayIndex === undefined) return [];
  const label = resolveLabel(column.field.label) || '';
  const patterns = slotPatterns({
    arrayLabel: column.arrayLabel,
    arrayId: column.arrayRef.split('.').pop(),
    childLabel: label,
    childId: column.field.id,
    onlyChild: childCount.get(column.arrayRef) === 1,
  });
  // `Phones / Number 3` and `contact.phones.3.number`, with the number taken out.
  const heading = column.header.replace(/\s*\d+$/, '');
  const tail = column.ref.slice(column.arrayRef.length + 1).replace(/^\d+\./, '');
  patterns.push(`${normalizeHeader(heading)}${SLOT}`, `${normalizeHeader(column.arrayRef)}${SLOT}${normalizeHeader(tail)}`);
  return patterns;
}

/** The highest row number read from a header when the sheet itself is narrower. */
const PLAUSIBLE_ROWS = 100;

/**
 * The most rows of any repeating field a sheet's headers name, by any spelling
 * `suggestMapping` recognises. At least 1, at most `MAX_ARRAY_BOUND`.
 *
 * A ref-spelled header counts as its row number, which is 0-based — `phones.3.number` names
 * the fourth row — and every other spelling as the 1-based number a person writes.
 */
export function inferArrayBound(
  headers: readonly string[],
  config: EntityFormConfig | null | undefined,
  lang?: string,
): number {
  const { columns } = deriveImportColumns(config, {
    lang,
    maxArrayRows: 1,
    includeReadonly: true,
    includeSystemDefault: true,
  });
  const childCount = childCountByArray(columns);
  const patterns = columns.flatMap(column => columnSlotPatterns(column, childCount));
  const refPrefixes = columns
    .filter(column => column.arrayRef !== undefined)
    .map(column => `${column.arrayRef}.`);

  // A sheet with `Phone 1` and `Phone 4` names four rows, so a slot may exceed the column
  // count — but not by orders of magnitude: `Revenue 2024` is a year, not the 2024th row of a
  // `revenue` field.
  const reach = Math.max(headers.length, PLAUSIBLE_ROWS);
  let bound = 1;
  for (const header of headers) {
    const text = String(header ?? '').trim();
    // The ref spelling is read exactly, before normalising throws its dots away.
    const ref = refPrefixes.find(prefix => text.startsWith(prefix));
    const row = ref ? /^(\d+)\./.exec(text.slice(ref.length)) : null;
    if (row && Number(row[1]) < reach) {
      bound = Math.max(bound, Number(row[1]) + 1);
      continue;
    }
    for (const pattern of patterns) {
      const slot = matchSlot(text, pattern);
      if (slot !== null && slot <= reach) bound = Math.max(bound, slot);
    }
  }
  return Math.min(bound, MAX_ARRAY_BOUND);
}

/** The fewest rows the wizard offers for a repeating field, whatever the sheet says. */
export const DEFAULT_ARRAY_ROWS = 3;

/**
 * How many rows of each repeating field to derive columns for: enough for every row the sheet's
 * headers name, every row an existing plan maps, and never fewer than the default.
 *
 * The mapper, the local preview and the server preview all size from this one function, so
 * the same file offers the same slots wherever it is read.
 */
export function arrayBoundFor(
  headers: readonly string[],
  config: EntityFormConfig | null | undefined,
  plan?: MappingPlan | null,
  lang?: string,
): number {
  return Math.min(
    Math.max(DEFAULT_ARRAY_ROWS, inferArrayBound(headers, config, lang), arrayBoundOf(plan)),
    MAX_ARRAY_BOUND,
  );
}
