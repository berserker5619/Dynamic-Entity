/**
 * suggest.ts — sizing slots from a sheet, and guessing which column feeds which target (§6, §8).
 *
 * Dynamic Entity 2.3's `inferArrayBound`, `arrayBoundFor` (`core/src/array-headers.ts`) and
 * `suggestMapping` (`core/src/import-engine.ts`), over an adapter. One v2 change: slot counts
 * are per array, so a sheet naming `Phone 6` does not unroll six guardians.
 *
 * Headers alone give exactly 2.3's suggestion. Given sample rows as well, `suggestMapping`
 * also reads what only the data shows: the order a column's dates are written in, and that a
 * sheet carries one item of an array per row, grouped under a column whose value repeats.
 */
import type { ImportTarget, SchemaAdapter, ValueKind } from './adapter.types';
import { cellText } from './cell-text';
import { inferDateOrder } from './date-order';
import { childCountByArray, itemPatterns, matchSlot, normalizeHeader, slotKey, targetSlotPatterns, wordsOf } from './header-grammar';
import type { MappingEntry, MappingPlan, NormalizedPlan } from './plan.types';
import { MAX_SLOTS, planSlots } from './plan-slots';

/** The fewest slots a numbered-column array is offered, whatever the sheet says (2.3's `DEFAULT_ARRAY_ROWS`). */
export const DEFAULT_SLOTS = 3;

/** The highest slot a header may name when the sheet itself is narrower: `Revenue 2024` is a year, not slot 2024. */
const PLAUSIBLE_SLOTS = 100;

/** Words that make a column's name id-like, so it may be proposed as a group key (§5). */
const ID_WORDS = new Set(['id', 'no', 'number', 'code', 'key', 'ref']);

export interface SuggestOptions {
  /** Passed to the adapter's `targets`, which resolves labels in it. */
  lang?: string;
  /**
   * Data rows of the sheet, for what headers cannot say: the order a column's dates are
   * written in, and whether the sheet carries one item of an array per row. Any number of
   * rows; a preview's first few are enough. Without it the suggestion is 2.3's.
   */
  sample?: readonly (readonly unknown[])[];
}

/** A kind a date written in digits is read into, on its own or as a list's items. */
function holdsDate(kind: ValueKind): boolean {
  return kind.kind === 'date' || kind.kind === 'datetime' || kind.kind === 'month' || (kind.kind === 'list' && holdsDate(kind.of));
}

/** Every array the adapter has, each at one slot: enough to learn its patterns. */
function oneOfEach<TMeta, TCtx>(adapter: SchemaAdapter<TMeta, TCtx>, options: SuggestOptions) {
  const arrays = adapter.targets({ slots: {}, lang: options.lang }).arrays;
  const slots = Object.fromEntries(arrays.map(array => [array.ref, 1]));
  return adapter.targets({ slots, lang: options.lang });
}

/**
 * The highest slot the headers name for each array, or 0 when none numbers it. A header names
 * a slot by any spelling `suggestMapping` reads, or by its ref (`phones.3.number` is the
 * fourth slot).
 */
function namedSlots<TMeta, TCtx>(headers: readonly string[], adapter: SchemaAdapter<TMeta, TCtx>, options: SuggestOptions): Record<string, number> {
  const set = oneOfEach(adapter, options);
  const childCount = childCountByArray(set.targets);
  const reach = Math.max(headers.length, PLAUSIBLE_SLOTS);
  const named: Record<string, number> = {};

  for (const array of set.arrays) {
    const patterns = set.targets
      .filter(target => target.arrayRef === array.ref)
      .flatMap(target => targetSlotPatterns(target, childCount));
    const prefix = `${array.ref}.`;
    let highest = 0;
    for (const header of headers) {
      const text = String(header ?? '').trim();
      // The ref spelling is read exactly, before normalising throws its dots away.
      const ref = text.startsWith(prefix) ? /^(\d+)(?:\.|$)/.exec(text.slice(prefix.length)) : null;
      if (ref && Number(ref[1]) < reach) {
        highest = Math.max(highest, Number(ref[1]) + 1);
        continue;
      }
      for (const pattern of patterns) {
        const slot = matchSlot(text, pattern);
        if (slot !== null && slot <= reach) highest = Math.max(highest, slot);
      }
    }
    named[array.ref] = highest;
  }
  return named;
}

/**
 * Slot count per array (§6): the highest slot the headers name for it, the highest slot `plan`
 * maps, and never fewer than `DEFAULT_SLOTS`, capped at `MAX_SLOTS`.
 */
export function slotsFor<TMeta, TCtx>(
  headers: readonly string[],
  adapter: SchemaAdapter<TMeta, TCtx>,
  plan?: Pick<MappingPlan, 'entries'>,
  options: SuggestOptions = {},
): Record<string, number> {
  const fromPlan = plan ? planSlots(plan) : {};
  return Object.fromEntries(
    Object.entries(namedSlots(headers, adapter, options)).map(([ref, named]) => [
      ref,
      Math.min(Math.max(DEFAULT_SLOTS, named, fromPlan[ref] ?? 0), MAX_SLOTS),
    ]),
  );
}

/** One thing a column may feed: a target, or one child of an array carried one item per row. */
interface Offer<TMeta> {
  target: ImportTarget<TMeta>;
  /** The ref the entry is written with: the target's, or its shape ref for an item. */
  ref: string;
  /** A child of an array no header numbers, offered once and mapped by shape (§6). */
  item: boolean;
  exact: string[];
  loose: string[];
}

/**
 * Guess which column feeds which target, as a v2 plan (§4, "Writing").
 *
 * Exact matches first — a header that is a target's ref or its generated header — then a
 * normalised match against its `matchKeys` and every numbered spelling of its slot. Each header
 * feeds at most one target and each target takes at most one header. Every inferred match is
 * `guess`, so a UI can mark it. A loose key two targets answer to matches neither: guessing
 * one would resolve the ambiguity by walk order, silently.
 *
 * With `options.sample` (§8), three things more, each a `guess`:
 * - an array of objects that no header numbers is offered one item per row: its children are
 *   mapped by shape ref (`items.sku`), and the array is proposed in `group.collect`;
 * - `group.key` is a column outside any array, with an id-like name, whose sample values
 *   repeat. With no such column there is no group, and the items go in slot 0;
 * - a header still unmapped is matched by its words (`Product` and `productName`), when
 *   exactly one target and one header fit each other.
 */
export function suggestMapping<TMeta, TCtx>(
  headers: readonly string[],
  adapter: SchemaAdapter<TMeta, TCtx>,
  options: SuggestOptions = {},
): NormalizedPlan {
  const sample = options.sample;
  const named = namedSlots(headers, adapter, options);
  const set = adapter.targets({ slots: slotsFor(headers, adapter, undefined, options), lang: options.lang });
  const childCount = childCountByArray(set.targets);
  // Only the data can show that rows repeat, so without a sample every array stays numbered columns.
  const perRow = new Set(sample ? set.arrays.filter(array => array.itemKind === 'object' && !named[array.ref]).map(array => array.ref) : []);

  const offers: Offer<TMeta>[] = [];
  for (const target of set.targets) {
    const keys = [...(target.matchKeys ?? [])];
    if (target.arrayRef !== undefined && perRow.has(target.arrayRef)) {
      if (target.arrayIndex !== 0) continue;
      const heading = target.header.replace(/\s*\d+$/, '');
      offers.push({ target, ref: target.shapeRef, item: true, exact: [target.shapeRef, heading], loose: [...keys, ...itemPatterns(target, childCount)] });
      continue;
    }
    for (const pattern of targetSlotPatterns(target, childCount)) keys.push(slotKey(pattern, (target.arrayIndex as number) + 1));
    // A ref with a slot in it is matched only as written (`isSlotRef`); any other ref, normalised.
    offers.push({ target, ref: target.ref, item: false, exact: target.arrayIndex === undefined ? [target.ref, target.header] : [target.header], loose: keys });
  }

  const entries: MappingEntry[] = [];
  const claimed = new Map<string, Offer<TMeta>>();
  const takenColumns = new Set<number>();
  const claim = (offer: Offer<TMeta>, index: number, confidence: 'exact' | 'guess'): void => {
    takenColumns.add(index);
    claimed.set(offer.ref, offer);
    const kind = offer.target.value;
    // The order of a column's dates is read from the sample, or left unset: never assumed (§8).
    const dateOrder =
      sample && holdsDate(kind)
        ? inferDateOrder(
            sample.map(row => row[index]),
            kind.kind === 'list' ? kind.separator : undefined,
          )
        : undefined;
    entries.push({ ref: offer.ref, column: index, header: headers[index], confidence, ...(dateOrder ? { dateOrder } : {}) });
  };

  /**
   * Normalised, `phones.1.number` is `phones1number`, which is also how "Phones 1 Number" —
   * slot 1, counted from one — reads, so that header would be claimed, as exact, for the slot
   * after the one it names. The same rule as Dynamic Entity 2.4.1.
   */
  const isSlotRef = (header: string, target: ImportTarget<TMeta>): boolean =>
    target.arrayIndex !== undefined && String(header ?? '').trim() === target.ref;

  // Counted once per offer: a label and an id normalise alike more often than not, and
  // counting them twice would make every such target collide with itself.
  const ambiguous = new Set<string>();
  const seen = new Set<string>();
  for (const offer of offers) {
    for (const key of new Set(offer.loose.filter(Boolean).map(normalizeHeader))) {
      if (seen.has(key)) ambiguous.add(key);
      seen.add(key);
    }
  }

  // Two passes, so an exact match never loses its column to an earlier target's guess.
  for (const pass of ['exact', 'loose'] as const) {
    for (const offer of offers) {
      if (claimed.has(offer.ref)) continue;
      const wanted = offer[pass]
        .filter(Boolean)
        .map(normalizeHeader)
        .filter(key => pass === 'exact' || !ambiguous.has(key));
      const index = headers.findIndex(
        (header, i) =>
          !takenColumns.has(i) &&
          ((pass === 'exact' && !offer.item && isSlotRef(header, offer.target)) || wanted.includes(normalizeHeader(header))),
      );
      // An item is read from the sheet's shape, never from a header that says so: always a guess.
      if (index >= 0) claim(offer, index, pass === 'exact' && !offer.item ? 'exact' : 'guess');
    }
  }

  if (sample) {
    // A third pass, by words: `Product` for `productName`, `First Name` for `name.first`. A
    // numbered slot is left out, since a slot needs its number. Decided on the columns and
    // targets still free before the pass, so one match cannot make room for another.
    const fits = (header: string, offer: Offer<TMeta>): boolean => {
      const words = wordsOf(header);
      const within = (a: string[], b: string[]): boolean => a.length > 0 && a.every(word => b.includes(word));
      return [...(offer.target.matchKeys ?? []), offer.target.shapeRef].map(wordsOf).some(key => within(words, key) || within(key, words));
    };
    const freeOffers = offers.filter(offer => !claimed.has(offer.ref) && (offer.item || offer.target.arrayIndex === undefined));
    const freeColumns = headers.map((_, i) => i).filter(i => !takenColumns.has(i));
    for (const index of freeColumns) {
      const fitting = freeOffers.filter(offer => fits(headers[index], offer));
      if (fitting.length === 1 && freeColumns.filter(i => fits(headers[i], fitting[0])).length === 1) claim(fitting[0], index, 'guess');
    }
  }

  // §5: a group needs something to collect and a key to collect it under.
  const collect = set.arrays.map(array => array.ref).filter(ref => [...claimed.values()].some(offer => offer.item && offer.target.arrayRef === ref));
  const key = collect.length
    ? entries
        .filter(entry => claimed.get(entry.ref)?.target.arrayRef === undefined)
        .map(entry => entry.column as number)
        .sort((a, b) => a - b)
        .find(column => {
          const values = (sample ?? []).map(row => cellText(row[column]).trim()).filter(Boolean);
          return wordsOf(headers[column]).some(word => ID_WORDS.has(word)) && new Set(values).size < values.length;
        })
    : undefined;
  if (key === undefined) {
    // No group: each row is a record, and its one item is the array's first.
    for (const entry of entries) {
      const offer = claimed.get(entry.ref) as Offer<TMeta>;
      if (offer.item) entry.ref = offer.target.ref;
    }
  }

  return {
    planVersion: 2,
    target: adapter.id,
    ...(adapter.version !== undefined ? { schemaVersion: adapter.version } : {}),
    sourceHeaders: [...headers],
    entries,
    ...(key !== undefined ? { group: { key: [key], collect, contiguous: true } } : {}),
  };
}
