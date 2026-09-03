import type { EntityReferenceLoader } from 'ngx-dynamic-entity';
import { ORDER_REFERENCE_DATA } from './sample-data';

/**
 * How many times each registered loader has actually run.
 *
 * Published on `window` because it is the only honest way to test a cache: the options
 * appear either way, so "the list is populated" proves nothing. What
 * `ENTITY_REF_CACHE_STORE` changes is whether the loader is *called* — and after a reload,
 * an in-memory store means called again while a sessionStorage-backed one means not.
 *
 * A demo-only diagnostic. Nothing in either library reads it.
 */
export interface LoaderCallCounts {
  companies: number;
  countries: number;
  cities: number;
}

declare global {
  interface Window {
    __refLoaderCalls?: LoaderCallCounts;
  }
}

const counts: LoaderCallCounts = { companies: 0, countries: 0, cities: 0 };
if (typeof window !== 'undefined') window.__refLoaderCalls = counts;

/**
 * The three loader shapes the registry accepts, one each, so the demo covers the whole
 * contract rather than the convenient case:
 *
 *   - `companies` returns an array directly.
 *   - `countries` returns a Promise.
 *   - `cities` is a cascade: it filters on `ctx.parentValue`, which is what a server-side
 *     dependent list does. The renderer would also apply `lookupFilter` on its side, so this
 *     stays correct either way.
 */
export const DEMO_ENTITY_REF_LOADERS: Record<string, EntityReferenceLoader> = {
  companies: () => {
    counts.companies++;
    return ORDER_REFERENCE_DATA.companies;
  },
  countries: () => {
    counts.countries++;
    return Promise.resolve(ORDER_REFERENCE_DATA.countries);
  },
  cities: ctx => {
    counts.cities++;
    return Promise.resolve(
      ORDER_REFERENCE_DATA.cities.filter(c => !ctx?.parentValue || c.record.country === ctx.parentValue),
    );
  },
};
