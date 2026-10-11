/**
 * plan-slots.ts — how many slots of each array a plan reaches (spec §7, "Rules").
 *
 * `applyMapping` receives no headers, so a plan sizes its own targets: per array, the highest
 * slot it maps plus one. Dynamic Entity 2.3's `arrayBoundOf` did this for the whole config at
 * once; v2 does it per array, so a plan reaching `phones.5` does not unroll six guardians.
 */
import type { MappingPlan } from './plan.types';

/** The most slots any one array is unrolled to, as in 2.3. An absurd index is capped, not honoured. */
export const MAX_SLOTS = 1000;

const SLOT_SEGMENT = /^(?:0|[1-9]\d*)$/;

/**
 * Where the slot is in a concrete ref: the first numeric segment. Nested repeating lists are
 * not supported (spec, "Non-goals"), so a ref has at most one.
 */
export function slotOf(ref: string): { arrayRef: string; slot: number } | null {
  const segments = ref.split('.');
  const at = segments.findIndex(segment => SLOT_SEGMENT.test(segment));
  if (at <= 0) return null;
  return { arrayRef: segments.slice(0, at).join('.'), slot: Number(segments[at]) };
}

/** The ref with its slot index removed: `phones.2.number` → `phones.number`. */
export function shapeOf(ref: string): string {
  const found = slotOf(ref);
  if (!found) return ref;
  return `${found.arrayRef}${ref.slice(found.arrayRef.length + 1 + String(found.slot).length)}`;
}

/** Slot count per array shape ref that `plan`'s entries reach, capped at `MAX_SLOTS`. */
export function planSlots(plan: Pick<MappingPlan, 'entries'>): Record<string, number> {
  const slots: Record<string, number> = {};
  for (const entry of plan.entries) {
    const found = slotOf(entry.ref);
    if (!found) continue;
    slots[found.arrayRef] = Math.min(Math.max(slots[found.arrayRef] ?? 0, found.slot + 1), MAX_SLOTS);
  }
  return slots;
}
