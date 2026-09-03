import type { AbstractControl, AsyncValidatorFn, ValidationErrors, ValidatorFn } from '@angular/forms';
import type { EntityFormConfig, FileUploadHandler, RecordMigration, UploadResult } from '@dynamic-entity/core';
import type { HookFn } from 'ngx-dynamic-entity';
import { ASYNC_CHECK_MS, EXTENSIONS_ENTITY, REJECTED_TITLE, TAKEN_EMAILS } from './extensions-entity';

/**
 * The behaviour behind the `extensions` entity's schema.
 *
 * A schema names a validator, a hook or a migration; this is where the named thing lives.
 * Splitting them this way is the point of the registries — the config stays data that can be
 * authored in the builder and stored as JSON, and the code it refers to stays code.
 */

/** Four or more consecutive capitals reads as shouting. */
const SHOUTING = /[A-Z]{4,}/;

/**
 * Synchronous validators, named from a schema as `validators: { custom: ['noShouting'] }`.
 *
 * Note what the error key can and cannot do. Each built-in field type resolves its message
 * from a fixed, per-type list of error keys — text-field looks for `required`, `email`,
 * `minlength`, `maxlength`, `pattern` — so a custom key is not in that list and falls through
 * to the `invalid` fallback, which `app.config.ts` overrides and localizes. The validator
 * still does its job: the control is invalid and Save is blocked. Only the *wording* is
 * generic, and a field type of your own (see `rating-field.component.ts`) can name whatever
 * keys it likes.
 */
export const DEMO_VALIDATORS: Record<string, ValidatorFn> = {
  noShouting: (control: AbstractControl): ValidationErrors | null =>
    SHOUTING.test(String(control.value ?? '')) ? { shouting: true } : null,
};

/**
 * Async validators, named as `validators: { customAsync: ['uniqueEmail'] }`.
 *
 * The fixed delay is deliberate: it is what makes the pending window observable. Angular
 * holds the control `pending` until this settles, `DynamicFormComponent.submitBlocked` reads
 * `form.pending`, and so Save is disabled for the duration — the gate that stops a record
 * being saved in the gap before a uniqueness check comes back.
 */
export const DEMO_ASYNC_VALIDATORS: Record<string, AsyncValidatorFn> = {
  uniqueEmail: (control: AbstractControl): Promise<ValidationErrors | null> =>
    new Promise(resolve => {
      const value = String(control.value ?? '').trim().toLowerCase();
      setTimeout(() => resolve(value && TAKEN_EMAILS.includes(value) ? { emailTaken: true } : null), ASYNC_CHECK_MS);
    }),
};

/**
 * Hooks, keyed `<entity>:<point>`.
 *
 * `beforeSave` may return a replacement payload, or abort by returning `false` or throwing.
 * Aborting is the part that needs a demo: it is invisible unless the host binds
 * `(saveRejected)`, which is why `app.component.html` does.
 */
export const DEMO_HOOKS: Record<string, HookFn> = {
  [`${EXTENSIONS_ENTITY}:beforeSave`]: (data: any) =>
    String(data?.['title'] ?? '').trim().toLowerCase() === REJECTED_TITLE ? false : data,
};

/**
 * Record migrations, applied to `initialData` when a config's `version` is ahead of the
 * record's `_configVersion`.
 *
 * **The entity guard is not decoration.** `RECORD_MIGRATIONS` is a single flat list consulted
 * for every entity the application renders, so a step registered for one entity runs against
 * records of all of them. Without the guard, saving any config in the builder — which bumps
 * its version — would run this rewrite over that entity's records too.
 */
export const DEMO_MIGRATIONS: RecordMigration[] = [
  {
    from: 1,
    to: 2,
    description: 'extensions: the v1 `name` field became `title`',
    migrate: (record: Record<string, any>, config: EntityFormConfig) =>
      config?.entity === EXTENSIONS_ENTITY ? { ...record, title: record['title'] ?? record['name'] } : record,
  },
];

/**
 * `UPLOAD_HANDLER` — persist a chosen file and hand back a stable URL.
 *
 * Without one, `file` and `image` fields store `{ file, name, size, mimeType }` and the host
 * uploads at submit time; a `File` does not survive the trip through `JSON.stringify` into
 * localStorage, so a demo without a handler loses every attachment on save. With one, the
 * field stores `{ url, name, ... }` and the attachment survives.
 *
 * A data URL is what stands in for an upload endpoint here. It is a real, stable, viewable
 * URL — which keeps the image field's preview working — and it needs no server. A real
 * application returns the URL its storage service gives it.
 */
export const demoUploadHandler: FileUploadHandler = (file: File): Promise<UploadResult> =>
  new Promise<UploadResult>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error('Could not read the file.'));
    reader.onload = () => resolve({ url: String(reader.result), name: file.name });
    reader.readAsDataURL(file);
  });
