/**
 * header-grammar.ts — how people number the columns of a repeating field (spec §6).
 *
 * A template says `Phone / Number 1`, but a customer's own sheet says `Phone 1 Number`,
 * `phone_2_number`, `PhoneNumber3` or `Number (2)`. Suggestion and slot sizing must read
 * headers the same way, or the wizard offers six slots and then fills four.
 *
 * This is Dynamic Entity 2.3's grammar (`core/src/array-headers.ts`), moved unchanged as the
 * spec requires, and keyed by `ImportTarget` instead of DE's `ImportColumn`. A target's
 * `matchKeys` stand where DE used the field's label and id.
 *
 * Patterns are written over normalised text (lowercase alphanumerics), with `#` marking the
 * slot number, so spaces, underscores and brackets are irrelevant: `Number (2)` and `number_2`
 * are both `number2`.
 */
import type { ImportTarget } from './adapter.types';

/** Lowercase alphanumerics only, so "First Name", `first_name` and `firstName` collapse. */
export function normalizeHeader(text: string): string {
  return String(text ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

const SLOT = '#';

/** What one repeating child's patterns are built from. */
export interface SlotNames {
  arrayLabel?: string;
  arrayId?: string;
  /** The child's own names: its `matchKeys`. */
  childNames: readonly string[];
  /** The array has only this one child, so a bare `Phone 2` can only mean it. */
  onlyChild?: boolean;
}

/** A name and its trivially singular form, `-s` stripped when longer than 3 characters. */
function withSingular(name: string): string[] {
  return name.length > 3 && name.endsWith('s') ? [name, name.slice(0, -1)] : [name];
}

/** `{array} n {child}`, `{array} {child} n`, `{child} n`, and `{array} n` for an only child. `{child} (n)` normalises to `{child} n`. */
export function slotPatterns(names: SlotNames): string[] {
  const arrays = [names.arrayLabel, names.arrayId]
    .map(name => normalizeHeader(name ?? ''))
    .filter(Boolean)
    .flatMap(withSingular);
  const children = names.childNames.map(normalizeHeader).filter(Boolean);
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

/** A pattern with its slot filled in: the key a header for 1-based `slot` normalises to. */
export function slotKey(pattern: string, slot: number): string {
  return pattern.replace(SLOT, String(slot));
}

/** The 1-based slot a header names under `pattern`, or `null`. Read, never generated. */
export function matchSlot(header: string, pattern: string): number | null {
  const at = pattern.indexOf(SLOT);
  if (at < 0) return null;
  const key = normalizeHeader(header);
  const prefix = pattern.slice(0, at);
  const suffix = pattern.slice(at + 1);
  if (key.length <= prefix.length + suffix.length || !key.startsWith(prefix) || !key.endsWith(suffix)) return null;
  const digits = key.slice(prefix.length, key.length - suffix.length);
  return /^[1-9]\d{0,5}$/.test(digits) ? Number(digits) : null;
}

/** Each array's distinct children among `targets`, keyed by array ref. */
export function childCountByArray(targets: readonly ImportTarget[]): Map<string, number> {
  const children = new Map<string, Set<string>>();
  for (const target of targets) {
    if (target.arrayRef === undefined) continue;
    const set = children.get(target.arrayRef) ?? new Set<string>();
    set.add(target.shapeRef);
    children.set(target.arrayRef, set);
  }
  return new Map([...children].map(([arrayRef, set]) => [arrayRef, set.size]));
}

/**
 * The patterns one unrolled target answers to: the sheet spellings `slotPatterns` knows, plus
 * the engine's own — the generated header and the ref with the slot taken out — so a
 * template's own headers size the slots too.
 */
export function targetSlotPatterns(target: ImportTarget, childCount: ReadonlyMap<string, number>): string[] {
  if (target.arrayRef === undefined || target.arrayIndex === undefined) return [];
  const patterns = slotPatterns({
    arrayLabel: target.arrayLabel,
    arrayId: target.arrayRef.split('.').pop(),
    childNames: target.matchKeys ?? [],
    onlyChild: childCount.get(target.arrayRef) === 1,
  });
  const heading = target.header.replace(/\s*\d+$/, '');
  const tail = target.ref.slice(target.arrayRef.length + 1).replace(/^\d+\.?/, '');
  patterns.push(`${normalizeHeader(heading)}${SLOT}`, `${normalizeHeader(target.arrayRef)}${SLOT}${normalizeHeader(tail)}`);
  return patterns;
}
