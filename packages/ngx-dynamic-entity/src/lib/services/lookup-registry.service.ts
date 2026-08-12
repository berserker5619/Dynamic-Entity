import { Injectable, inject, type WritableSignal } from '@angular/core';
import type {
  DropdownOption,
  LookupListLoader,
  LookupListResult,
  LookupListSource,
  LookupListValue,
  NestedFieldConfig,
  RawLookupListValue,
  Subscribable,
} from '@dynamic-entity/core';
import { lookupValuesToOptions, normalizeLookupValues, resolveLabel } from '@dynamic-entity/core';
import { LOOKUP_REGISTRY } from '../tokens/injection-tokens';

/** Cache-key field separator. Kept out of template literals so it stays visible in source. */
const SEP = '|';

/**
 * LookupRegistryService — the cache in front of consumer-registered master lists.
 *
 * Three layers, deliberately the same shape as `EntityReferenceService`, because the problem is
 * the same: one list is typically used by many fields across many entities.
 *  1. **options** — resolved `DropdownOption[]` per (list name, lang).
 *  2. **in-flight** — the pending Promise, so N fields on one list trigger one load, not N.
 *  3. **labels** — synchronous value → text (parity plan §6.2). This is not a nicety: since
 *     `viewMode` defaults to true a record opens read-only, so rendering a stored value as
 *     text is the *first* thing a `listName` field has to do. An async-only registry would
 *     paint the raw stored value and then flip, on every record open.
 *
 * A failed load rejects and caches nothing, so one transient error does not serve an empty
 * list forever — the same fix made for entity references in phase 5.
 */
@Injectable({ providedIn: 'root' })
export class LookupRegistryService {
  private readonly registry =
    inject(LOOKUP_REGISTRY, { optional: true }) ?? new Map<string, LookupListSource>();

  /** `listName|lang` -> resolved options. */
  private readonly options = new Map<string, DropdownOption[]>();
  /** `listName|lang` -> normalised values, so a consumer can reach `code` / `isSystemDefined`. */
  private readonly values = new Map<string, LookupListValue[]>();
  /** Loads in progress, keyed as above. */
  private readonly inFlight = new Map<string, Promise<DropdownOption[]>>();
  /** `listName|lang|text` -> display text, for the synchronous read-only path. */
  private readonly labels = new Map<string, string>();

  has(listName: string): boolean {
    return this.registry.has(listName);
  }

  /**
   * Options for a named list, from cache when present.
   * Concurrent callers with the same key share one load.
   */
  async load(listName: string, lang = 'en'): Promise<DropdownOption[]> {
    const key = this.cacheKey(listName, lang);

    const cached = this.options.get(key);
    if (cached) return cached;

    const pending = this.inFlight.get(key);
    if (pending) return pending;

    const source = this.registry.get(listName);
    if (source === undefined) return [];

    const load = this.invoke(source, lang).then(raw => {
      const values = normalizeLookupValues(raw);
      const options = lookupValuesToOptions(values);
      this.values.set(key, values);
      this.options.set(key, options);
      this.rememberLabels(listName, lang, options);
      return options;
    });

    // Only the `.then` above writes to the cache, and a rejection skips it: the caller still
    // gets an empty list, but the next call retries instead of reading a poisoned entry.
    const guarded = load
      .catch(() => [] as DropdownOption[])
      .finally(() => this.inFlight.delete(key));

    this.inFlight.set(key, guarded);
    return guarded;
  }

  /** Cached options without triggering a load. `undefined` when not loaded. */
  peek(listName: string, lang = 'en'): DropdownOption[] | undefined {
    return this.options.get(this.cacheKey(listName, lang));
  }

  /**
   * Cached list values, carrying `_id`, `code`, `isSystemDefined` and `from`.
   * The library never reads those; this is the seam for a consumer that needs them.
   */
  valuesFor(listName: string, lang = 'en'): LookupListValue[] | undefined {
    return this.values.get(this.cacheKey(listName, lang));
  }

  /**
   * Display text for a stored value, synchronously. `undefined` when the list has not loaded
   * or holds no matching value — the caller keeps its own fallback, which is the stored text.
   *
   * Every language of an option is indexed, so a record saved under one language renders in
   * another: a value stored as `'Aktiv'` resolves to `'Active'` under `lang: 'en'`.
   */
  labelFor(listName: string | undefined, value: unknown, lang = 'en'): string | undefined {
    if (!listName || value === null || value === undefined || value === '') return undefined;
    for (const text of this.candidateTexts(value, lang)) {
      const hit = this.labels.get(this.labelKey(listName, lang, text));
      if (hit) return hit;
    }
    return undefined;
  }

  // ─── Field-level resolution — inline options win, else `listName` ────────────

  /** True when this field's options have to come from the registry. */
  needsResolve(field: NestedFieldConfig | undefined): boolean {
    return !!field?.listName && !field.options?.length;
  }

  /**
   * The options to render right now, without awaiting: inline options, else whatever the
   * registry already holds. Empty on a cold miss — pair with `resolveOptions`.
   */
  optionsFor(field: NestedFieldConfig | undefined, lang = 'en'): DropdownOption[] {
    if (!field) return [];
    if (field.options?.length) return field.options;
    if (!field.listName) return [];
    return this.peek(field.listName, lang) ?? [];
  }

  /** The options for a field, loading the named list if needed. */
  resolveOptions(field: NestedFieldConfig | undefined, lang = 'en'): Promise<DropdownOption[]> {
    if (!this.needsResolve(field)) return Promise.resolve(this.optionsFor(field, lang));
    return this.load(field!.listName!, lang);
  }

  /** Drop everything cached for one list, leaving other lists intact. */
  invalidate(listName: string): void {
    const prefix = `${listName}${SEP}`;
    for (const map of [this.options, this.values, this.inFlight]) {
      for (const key of [...map.keys()]) {
        if (key.startsWith(prefix)) map.delete(key);
      }
    }
    for (const key of [...this.labels.keys()]) {
      if (key.startsWith(prefix)) this.labels.delete(key);
    }
  }

  clear(): void {
    this.options.clear();
    this.values.clear();
    this.inFlight.clear();
    this.labels.clear();
  }

  // ─── Internals ──────────────────────────────────────────────────────────────

  private cacheKey(listName: string, lang: string): string {
    return [listName, lang].join(SEP);
  }

  private labelKey(listName: string, lang: string, text: string): string {
    return [listName, lang, text].join(SEP);
  }

  /** Index an option under every language it carries, so any stored spelling finds it. */
  private rememberLabels(listName: string, lang: string, options: DropdownOption[]): void {
    for (const option of options) {
      const display = resolveLabel(option, lang);
      if (!display) continue;
      for (const text of Object.values(option)) {
        if (typeof text === 'string' && text !== '') {
          this.labels.set(this.labelKey(listName, lang, text), display);
        }
      }
    }
  }

  /** The texts a stored value could have been indexed under. */
  private candidateTexts(value: unknown, lang: string): string[] {
    if (typeof value === 'object') {
      const texts = Object.values(value as Record<string, unknown>).filter(
        (v): v is string => typeof v === 'string' && v !== '',
      );
      const resolved = resolveLabel(value as Record<string, string>, lang);
      return resolved ? [resolved, ...texts] : texts;
    }
    return [String(value)];
  }

  // ─── Source coercion (values | loader, array | Promise | Observable) ─────────

  private invoke(source: LookupListSource, lang: string): Promise<RawLookupListValue[]> {
    let result: LookupListResult;
    try {
      result = typeof source === 'function' ? (source as LookupListLoader)({ lang }) : source;
    } catch (err) {
      // Reject rather than resolve empty: `load` must be able to tell failure from an empty
      // list, or it would cache the failure.
      return Promise.reject(err);
    }
    return this.toPromise(result);
  }

  private toPromise(result: LookupListResult): Promise<RawLookupListValue[]> {
    if (Array.isArray(result)) return Promise.resolve(result);
    if (this.isSubscribable(result)) {
      // First emission wins, so a stream that stays open still resolves the load.
      return new Promise<RawLookupListValue[]>((resolve, reject) => {
        let settled = false;
        const settle = (fn: () => void) => {
          if (settled) return;
          settled = true;
          fn();
        };
        result.subscribe({
          next: value => settle(() => resolve(value ?? [])),
          error: err => settle(() => reject(err)),
          // Completing without emitting is a legitimate empty list, and is cached.
          complete: () => settle(() => resolve([])),
        });
      });
    }
    return Promise.resolve(result as Promise<RawLookupListValue[]>);
  }

  private isSubscribable(value: unknown): value is Subscribable<RawLookupListValue[]> {
    return (
      typeof value === 'object' &&
      value !== null &&
      typeof (value as Subscribable<RawLookupListValue[]>).subscribe === 'function'
    );
  }
}

/** A choice field component, as far as option resolution is concerned. */
export interface ChoiceOptionHost {
  readonly field: NestedFieldConfig | undefined;
  readonly language: string;
  readonly options: WritableSignal<DropdownOption[]>;
}

/**
 * Point a choice component's `options` signal at the right source (parity plan §6.3).
 *
 * Called from the `field` / `language` input setters of `dropdown`, `radio` and `multiSelect` —
 * the wiring is theirs, the decision is the service's, which is what keeps the ADR-008
 * five-input contract intact: options are never pushed in as a sixth input.
 *
 * Setters rather than `ngOnChanges` on purpose. `ngOnChanges` only fires for inputs Angular
 * itself sets, so a component whose `field` is assigned directly — which the field specs do,
 * and any consumer holding a `ComponentRef` may do — would render no options at all.
 *
 * Paints synchronously first (inline options, or a warm list), then fills in when a cold list
 * lands. The late result is dropped if the field or language changed while it was in flight.
 */
export function refreshChoiceOptions(host: ChoiceOptionHost, lookups: LookupRegistryService): void {
  host.options.set(lookups.optionsFor(host.field, host.language));
  if (!lookups.needsResolve(host.field)) return;

  const listName = host.field?.listName;
  const lang = host.language;
  void lookups.resolveOptions(host.field, host.language).then(options => {
    if (host.field?.listName === listName && host.language === lang) host.options.set(options);
  });
}
