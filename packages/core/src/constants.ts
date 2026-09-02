/**
 * constants.ts — shared constants and types used by the core library, renderer, and builder.
 */

export const DEFAULT_LANGUAGE = 'en';

export const SUPPORTED_LANGUAGES: ReadonlyArray<{ code: string; label: string }> = [
  { code: 'en', label: 'English' },
  { code: 'de', label: 'German' },
] as const;

/**
 * A component class, expressed without depending on `@angular/core`.
 *
 * This package is framework-agnostic — the CLI and the validator use it with no Angular
 * present — so it cannot name `Type<T>`. A constructor is what `Type<T>` is.
 */
export type ComponentClass = new (...args: never[]) => unknown;

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
 *     { id: 'documents', label: { en: 'Documents', de: 'Dokumente' }, component: DocumentsViewComponent },
 *     { id: 'audit',     label: { en: 'Audit Log', de: 'Audit-Protokoll' }, component: AuditLogComponent },
 *   ]
 * }
 */
export interface CommonModuleEntry {
  /** Unique identifier — matches `TabConfig.moduleName` in the form config. */
  id: string;
  /** Localized display label for the builder's module picker. */
  label: Record<string, string>;
  /**
   * The component to mount for this tab.
   *
   * A **class** for anything the renderer is expected to show: it goes to
   * `ngComponentOutlet`, which mounts a component type and cannot resolve a selector.
   *
   * A string is still accepted, because `COMMON_MODULES` below is a catalogue of names for
   * the builder's picker and has no classes to give. Registering one means the builder can
   * offer the module while the renderer has nothing to mount, and the renderer says so.
   */
  component: string | ComponentClass;
  /** Optional metadata forwarded as `moduleInputs` to the rendered component. */
  defaultInputs?: Record<string, unknown>;
}

/**
 * Built-in common module tab templates for the builder's module picker.
 * Consumers register real Angular components via `COMMON_MODULES_REGISTRY`.
 */
export const COMMON_MODULES: ReadonlyArray<CommonModuleEntry> = [
  { id: 'documents', label: { en: 'Documents', de: 'Dokumente' }, component: 'app-documents-view' },
  { id: 'audit', label: { en: 'Audit Log', de: 'Audit-Protokoll' }, component: 'app-audit' },
  { id: 'tasks', label: { en: 'Tasks', de: 'Aufgaben' }, component: 'app-tasks' },
  { id: 'notes', label: { en: 'Notes', de: 'Notizen' }, component: 'app-notes' },
  { id: 'attachments', label: { en: 'Attachments', de: 'Anhänge' }, component: 'app-attachments' },
  { id: 'timeline', label: { en: 'Timeline', de: 'Zeitachse' }, component: 'app-timeline' },
  { id: 'comments', label: { en: 'Comments', de: 'Kommentare' }, component: 'app-comments' },
  { id: 'relations', label: { en: 'Related Records', de: 'Verknüpfungen' }, component: 'app-relations' },
  { id: 'calendar', label: { en: 'Calendar', de: 'Kalender' }, component: 'app-calendar' },
  { id: 'workflow', label: { en: 'Workflow', de: 'Workflow' }, component: 'app-workflow' },
  { id: 'history', label: { en: 'Change History', de: 'Änderungsverlauf' }, component: 'app-history' },
  { id: 'notifications', label: { en: 'Notifications', de: 'Benachrichtigungen' }, component: 'app-notifications' },
  { id: 'activities', label: { en: 'Activities', de: 'Aktivitäten' }, component: 'app-activities' },
  { id: 'permissions', label: { en: 'Permissions', de: 'Berechtigungen' }, component: 'app-permissions' },
] as const;
