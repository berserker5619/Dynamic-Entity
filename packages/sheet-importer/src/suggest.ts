/**
 * suggest.ts — sizing slots from a sheet, and guessing which column feeds which target (§6, §8).
 *
 * Dynamic Entity 2.3's `inferArrayBound`, `arrayBoundFor` (`core/src/array-headers.ts`) and
 * `suggestMapping` (`core/src/import-engine.ts`), over an adapter. One v2 change: slot counts
 * are per array, so a sheet naming `Phone 6` does not unroll six guardians.
 */
import type { ImportTarget, SchemaAdapter } from './adapter.types';
import { childCountByArray, normalizeHeader, matchSlot, slotKey, targetSlotPatterns } from './header-grammar';
import type { MappingEntry, MappingPlan, NormalizedPlan } from './plan.types';
import { MAX_SLOTS, planSlots } from './plan-slots';

/** The fewest slots a numbered-column array is offered, whatever the sheet says (2.3's `DEFAULT_ARRAY_ROWS`). */
export const DEFAULT_SLOTS = 3;

/** The highest slot a header may name when the sheet itself is narrower: `Revenue 2024` is a year, not slot 2024. */
const PLAUSIBLE_SLOTS = 100;

export interface SuggestOptions {
  /** Passed to the adapter's `targets`, which resolves labels in it. */
  lang?: string;
}

/** Every array the adapter has, each at one slot: enough to learn its patterns. */
function oneOfEach<TMeta, TCtx>(adapter: SchemaAdapter<TMeta, TCtx>, options: SuggestOptions) {
  const arrays = adapter.targets({ slots: {}, lang: options.lang }).arrays;
  const slots = Object.fromEntries(arrays.map(array => [array.ref, 1]));
  return adapter.targets({ slots, lang: options.lang });
}

/**
 * Slot count per array (§6): the highest slot the headers name for it, the highest slot `plan`
 * maps, and never fewer than `DEFAULT_SLOTS`, capped at `MAX_SLOTS`. A header names a slot by
 * any spelling `suggestMapping` reads, or by its ref (`phones.3.number` is the fourth slot).
 */
export function slotsFor<TMeta, TCtx>(
  headers: readonly string[],
  adapter: SchemaAdapter<TMeta, TCtx>,
  plan?: Pick<MappingPlan, 'entries'>,
  options: SuggestOptions = {},
): Record<string, number> {
  const set = oneOfEach(adapter, options);
  const childCount = childCountByArray(set.targets);
  const fromPlan = plan ? planSlots(plan) : {};
  const reach = Math.max(headers.length, PLAUSIBLE_SLOTS);
  const slots: Record<string, number> = {};

  for (const array of set.arrays) {
    const patterns = set.targets
      .filter(target => target.arrayRef === array.ref)
      .flatMap(target => targetSlotPatterns(target, childCount));
    const prefix = `${array.ref}.`;
    let named = 0;
    for (const header of headers) {
      const text = String(header ?? '').trim();
      // The ref spelling is read exactly, before normalising throws its dots away.
      const ref = text.startsWith(prefix) ? /^(\d+)(?:\.|$)/.exec(text.slice(prefix.length)) : null;
      if (ref && Number(ref[1]) < reach) {
        named = Math.max(named, Number(ref[1]) + 1);
        continue;
      }
      for (const pattern of patterns) {
        const slot = matchSlot(text, pattern);
        if (slot !== null && slot <= reach) named = Math.max(named, slot);
      }
    }
    slots[array.ref] = Math.min(Math.max(DEFAULT_SLOTS, named, fromPlan[array.ref] ?? 0), MAX_SLOTS);
  }
  return slots;
}

/**
 * Guess which column feeds which target, as a v2 plan (§4, "Writing").
 *
 * Exact matches first — a header that is a target's ref or its generated header — then a
 * normalised match against its `matchKeys` and every numbered spelling of its slot. Each header
 * feeds at most one target and each target takes at most one header. Every inferred match is
 * `guess`, so a UI can mark it. A loose key two targets answer to matches neither: guessing
 * one would resolve the ambiguity by walk order, silently.
 */
export function suggestMapping<TMeta, TCtx>(
  headers: readonly string[],
  adapter: SchemaAdapter<TMeta, TCtx>,
  options: SuggestOptions = {},
): NormalizedPlan {
  const set = adapter.targets({ slots: slotsFor(headers, adapter, undefined, options), lang: options.lang });
  const childCount = childCountByArray(set.targets);
  const entries: MappingEntry[] = [];
  const takenColumns = new Set<number>();
  const takenRefs = new Set<string>();

  const candidates = (target: ImportTarget<TMeta>): { exact: string[]; loose: string[] } => {
    const loose = [...(target.matchKeys ?? [])];
    for (const pattern of targetSlotPatterns(target, childCount)) loose.push(slotKey(pattern, (target.arrayIndex as number) + 1));
    // The ref is matched as written, never normalised. Normalised, `phones.1.number` is
    // `phones1number`, which is also how "Phones 1 Number" — slot 1, counted from one — reads,
    // and the header would be claimed, as exact, for the slot after the one it names.
    return { exact: [target.header], loose };
  };
  const isRef = (header: string, target: ImportTarget<TMeta>): boolean => String(header ?? '').trim() === target.ref;

  // Counted once per target: a label and an id normalise alike more often than not, and
  // counting them twice would make every such target collide with itself.
  const ambiguous = new Set<string>();
  const seen = new Set<string>();
  for (const target of set.targets) {
    for (const key of new Set(candidates(target).loose.filter(Boolean).map(normalizeHeader))) {
      if (seen.has(key)) ambiguous.add(key);
      seen.add(key);
    }
  }

  // Two passes, so an exact match never loses its column to an earlier target's guess.
  for (const pass of ['exact', 'loose'] as const) {
    for (const target of set.targets) {
      if (takenRefs.has(target.ref)) continue;
      const wanted = candidates(target)[pass]
        .filter(Boolean)
        .map(normalizeHeader)
        .filter(key => pass === 'exact' || !ambiguous.has(key));
      const index = headers.findIndex(
        (header, i) =>
          !takenColumns.has(i) && ((pass === 'exact' && isRef(header, target)) || wanted.includes(normalizeHeader(header))),
      );
      if (index < 0) continue;
      takenColumns.add(index);
      takenRefs.add(target.ref);
      entries.push({ ref: target.ref, column: index, header: headers[index], confidence: pass === 'exact' ? 'exact' : 'guess' });
    }
  }

  return {
    planVersion: 2,
    target: adapter.id,
    ...(adapter.version !== undefined ? { schemaVersion: adapter.version } : {}),
    sourceHeaders: [...headers],
    entries,
  };
}
