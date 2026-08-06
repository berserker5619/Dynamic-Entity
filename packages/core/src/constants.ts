/**
 * constants.ts — shared constants and types used by the core library, renderer, and builder.
 */

export const DEFAULT_LANGUAGE = 'en';

export const SUPPORTED_LANGUAGES: ReadonlyArray<{ code: string; label: string }> = [
  { code: 'en', label: 'English' },
  { code: 'de', label: 'German' },
] as const;

/**
 * Describes a consumer-registered "common module" — a shared Angular component
 * that can be rendered as a tab inside a dynamic form.
 *
 * The library ships no implementations. Consumers register their own modules
 * via the `COMMON_MODULES_REGISTRY` injection token in `provideDynamicEntity()`
 * or directly in their Angular providers.
 *
 * @example
 * // In your app's providers:
 * {
 *   provide: COMMON_MODULES_REGISTRY,
 *   useValue: [
 *     { id: 'documents', label: { en: 'Documents', de: 'Dokumente' }, component: 'app-documents-view' },
 *     { id: 'audit',     label: { en: 'Audit Log', de: 'Audit-Protokoll' }, component: 'app-audit' },
 *   ]
 * }
 */
export interface CommonModuleEntry {
  /** Unique identifier — matches `TabConfig.moduleName` in the form config. */
  id: string;
  /** Localized display label for the builder's module picker. */
  label: Record<string, string>;
  /** Angular component selector that the consumer maps to a real component. */
  component: string;
  /** Optional metadata forwarded as `moduleInputs` to the rendered component. */
  defaultInputs?: Record<string, unknown>;
}

