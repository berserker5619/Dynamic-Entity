/**
 * cell-text.ts — kept so `sampleText` stays where 2.2 exported it from.
 *
 * The rule itself moved to core as `cellText` in 2.3, because the browser renders typed cells
 * too now and two copies of a date rule are two places for it to be wrong.
 */
export { cellText as sampleText } from '@dynamic-entity/core';
