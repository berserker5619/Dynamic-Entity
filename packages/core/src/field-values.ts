/**
 * field-values.ts — what a value of each newer field type looks like, stated once.
 *
 * The renderer and the import engine both need these answers. When each has its own copy, a
 * spreadsheet import accepts a phone number the form then refuses at save, or the other way
 * round, and neither side looks wrong on its own. Everything here is pure and has no DOM, so
 * the renderer, the builder and a Node import can all call it.
 */
import type { NestedFieldConfig } from './form-model.types';

/**
 * An absolute `http:` or `https:` URL with a host.
 *
 * Parsed with `URL` rather than matched by a regex. URL grammar is too large to capture in a
 * pattern, and a hand-written one either rejects real addresses or accepts `http://`. Other
 * schemes are refused because a read-only `url` field renders its value as a link.
 */
export function isValidUrl(value: string): boolean {
  if (typeof value !== 'string' || /\s/.test(value)) return false;
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }
  return (parsed.protocol === 'http:' || parsed.protocol === 'https:') && parsed.hostname.length > 0;
}

const PHONE_CHARS = /^\+?[0-9\s().-]+$/;

/**
 * Digits with the usual separators and an optional leading `+`, holding 7 to 15 digits.
 *
 * Loose on purpose; see `FieldValidators.phone`.
 */
export function isValidPhone(value: string): boolean {
  if (typeof value !== 'string' || !PHONE_CHARS.test(value)) return false;
  const digits = value.replace(/\D/g, '').length;
  return digits >= 7 && digits <= 15;
}

/**
 * A colour as `#rrggbb`, or `null` when the text is not one.
 *
 * Accepts `#rgb`, `rrggbb` without the hash, and either case, because that is how people write
 * colours in a spreadsheet. Always returns the form `<input type="color">` produces, so an
 * imported colour and a picked one compare equal.
 */
export function normalizeHexColor(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const match = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value.trim());
  if (!match) return null;
  const hex = match[1].length === 3 ? [...match[1]].map(c => c + c).join('') : match[1];
  return `#${hex.toLowerCase()}`;
}

/**
 * A `tags` value as the list it should be: trimmed, non-empty, first occurrence kept.
 *
 * Takes `unknown` because a record can hold anything. A field that was retyped from `text`
 * keeps a single string, and that string becomes one tag rather than being dropped.
 */
export function normalizeTags(value: unknown): string[] {
  const items = Array.isArray(value) ? value : typeof value === 'string' ? [value] : [];
  const out: string[] = [];
  for (const item of items) {
    if (item === null || item === undefined || typeof item === 'object') continue;
    const tag = String(item).trim();
    if (tag && !out.includes(tag)) out.push(tag);
  }
  return out;
}

/** The most stars a `rating` renders. More than this is a slider. */
export const MAX_RATING_SCALE = 10;

/**
 * How many stars a `rating` field has: `validators.max`, default 5, between 1 and 10.
 *
 * Read from `max` because that is the number the value must not exceed anyway, so the scale
 * the user sees and the check the form runs come from one number.
 */
export function ratingScale(field: Pick<NestedFieldConfig, 'validators'> | null | undefined): number {
  const max = field?.validators?.max;
  if (typeof max !== 'number' || !Number.isFinite(max)) return 5;
  return Math.min(MAX_RATING_SCALE, Math.max(1, Math.floor(max)));
}

/** A `slider`'s range and increment. */
export interface SliderBounds {
  min: number;
  max: number;
  step: number;
}

/**
 * A `slider`'s track: `validators.min` to `validators.max` (0 to 100 when absent) in
 * increments of `step` (1 when absent).
 *
 * If min and max are the wrong way round the default range is used. Otherwise the track would
 * have no length and every value would be out of range.
 */
export function sliderBounds(field: Pick<NestedFieldConfig, 'validators' | 'step'> | null | undefined): SliderBounds {
  const rawMin = field?.validators?.min;
  const rawMax = field?.validators?.max;
  let min = typeof rawMin === 'number' && Number.isFinite(rawMin) ? rawMin : 0;
  let max = typeof rawMax === 'number' && Number.isFinite(rawMax) ? rawMax : 100;
  if (max <= min) {
    min = 0;
    max = 100;
  }
  const rawStep = field?.step;
  const step = typeof rawStep === 'number' && Number.isFinite(rawStep) && rawStep > 0 ? rawStep : 1;
  return { min, max, step };
}
