/** planSlots, slotOf and shapeOf (`plan-slots.ts`): a plan sizing its own targets (spec §7). */
import { MAX_SLOTS, planSlots, shapeOf, slotOf } from './plan-slots';

const entries = (...refs: string[]) => ({ entries: refs.map((ref, column) => ({ ref, column })) });

describe('slotOf and shapeOf', () => {
  it.each([
    ['phones.2.number', { arrayRef: 'phones', slot: 2 }, 'phones.number'],
    ['customer.phones.0.number', { arrayRef: 'customer.phones', slot: 0 }, 'customer.phones.number'],
    ['tags.11', { arrayRef: 'tags', slot: 11 }, 'tags'],
    ['customer.name', null, 'customer.name'],
    ['phones.02.number', null, 'phones.02.number'],
    ['0.name', null, '0.name'],
  ])('reads %s', (ref, slot, shape) => {
    expect(slotOf(ref)).toEqual(slot);
    expect(shapeOf(ref)).toBe(shape);
  });
});

describe('planSlots', () => {
  it('counts slots per array, not one bound for the whole plan', () => {
    expect(planSlots(entries('name', 'phones.5.number', 'phones.0.kind', 'guardians.1.name'))).toEqual({
      phones: 6,
      guardians: 2,
    });
  });

  it('is empty for a plan that reaches no array', () => {
    expect(planSlots(entries('name', 'customer.email'))).toEqual({});
  });

  it('caps an absurd slot rather than unrolling a million targets', () => {
    expect(planSlots(entries('phones.999999.number'))).toEqual({ phones: MAX_SLOTS });
  });
});
