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
