import type { EntityFormConfig, RichFieldType } from 'ngx-dynamic-entity';

/**
 * `extensions` — the entity that exists so the remaining extension points have somewhere to
 * be *used* rather than only described.
 *
 * It is a new entity rather than a change to an existing one on purpose. Every point below
 * needs schema support — a named validator, an async validator, a file field, a custom field
 * type, a record one config version behind — and adding those to `clients` or
 * `insuranceClaims` would put the thirty-odd specs that assert on them at risk for nothing.
 * Adding an entity costs four lines in `LocalStore.ensureSeed`.
 */

/**
 * The version this schema declares. The seeded `ext_001` record is stamped one behind it, so
 * opening that record is what runs the registered migration — the only way to see
 * `EntityFormConfig.version` and `VersionedRecord._configVersion` actually mean something.
 */
export const EXTENSIONS_VERSION = 2;

/** The entity key, shared with the migration's guard so the two cannot drift apart. */
export const EXTENSIONS_ENTITY = 'extensions';

/**
 * The custom field type the demo registers on both sides of the library.
 *
 * `RichFieldType` is a closed union, so a type the library does not ship needs a cast at the
 * one place it enters a config. That is the honest cost of a custom type today and is left
 * visible rather than hidden behind an `any`.
 */
export const RATING_TYPE = 'rating' as RichFieldType;

/**
 * Addresses a remote uniqueness check would reject.
 *
 * A fixed list rather than a query against `LocalStore`: an `AsyncValidatorFn` receives the
 * control and nothing else, so it cannot tell "this address belongs to another record" from
 * "this address belongs to the record being edited". Checking the live store would therefore
 * make every saved record unsavable on reopening — a bug, not a demonstration. A real
 * implementation passes the record id to the server; a mock has nowhere to get it.
 */
export const TAKEN_EMAILS = ['taken@example.com', 'duplicate@example.com'];

/** The title that makes the `beforeSave` hook veto a save. */
export const REJECTED_TITLE = 'reject';

/** How long the mock uniqueness check takes. Fixed, so the pending window is assertable. */
export const ASYNC_CHECK_MS = 800;

export const EXTENSIONS_CONFIG: EntityFormConfig = {
  entity: EXTENSIONS_ENTITY,
  version: EXTENSIONS_VERSION,
  name: { en: 'Developer Extensions', de: 'Erweiterungen' },
  permissions: { edit: ['admin', 'manager', 'IT_SUPPORT'] },
  tabs: [
    {
      id: 'main',
      // Flat, so a record's values sit at the root and the seeds below read as records
      // rather than as a nesting puzzle.
      flatData: true,
      label: { en: 'Main', de: 'Allgemein' },
      fields: [
        {
          id: 'title',
          type: 'text',
          label: { en: 'Title', de: 'Titel' },
          // `custom` names a validator registered through `provideNgxDynamicEntity`.
          // `required` and `minLength` are the built-ins, and they are here so the
          // `validationMessages` pack has something to translate.
          validators: { required: true, minLength: 4, custom: ['noShouting'] },
          table: { visible: true, isName: true },
          visibility: true,
        },
        {
          id: 'email',
          type: 'email',
          label: { en: 'Email', de: 'E-Mail' },
          // Async validators are a separate key because Angular applies them separately:
          // they run only once the synchronous ones pass, and hold the control `pending`
          // meanwhile — which is what gates Save.
          validators: { customAsync: ['uniqueEmail'] },
          visibility: true,
        },
        {
          id: 'rating',
          type: RATING_TYPE,
          label: { en: 'Rating', de: 'Bewertung' },
          visibility: true,
        },
        {
          id: 'reviewedOn',
          type: 'date',
          label: { en: 'Reviewed On', de: 'Geprüft am' },
          // Summary fields render through core's `formatDisplayValue`, which is the path
          // `setDateFormatters` replaces.
          showOnMinimize: true,
          visibility: true,
        },
        {
          id: 'attachment',
          type: 'file',
          label: { en: 'Attachment', de: 'Anhang' },
          visibility: true,
        },
      ],
    },
  ],
};

/**
 * Two records, deliberately at different config versions.
 *
 * `ext_001` is stamped at version 1 and still carries the v1 field name (`name`). Opening it
 * runs the registered 1 → 2 migration, which is why its Title is populated at all. `ext_002`
 * is already current and passes through untouched.
 */
export const EXTENSIONS_RECORDS: Record<string, unknown>[] = [
  {
    _id: 'ext_001',
    _configVersion: 1,
    name: 'Legacy Sample',
    email: 'legacy@example.com',
    rating: 4,
    reviewedOn: '2020-01-15',
  },
  {
    _id: 'ext_002',
    _configVersion: EXTENSIONS_VERSION,
    title: 'Current Sample',
    email: 'current@example.com',
    rating: 2,
    reviewedOn: '2026-03-08',
  },
];
