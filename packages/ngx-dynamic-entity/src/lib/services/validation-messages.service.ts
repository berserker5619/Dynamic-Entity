import { Injectable, inject } from '@angular/core';
import type { ValidationErrors } from '@angular/forms';
import { VALIDATION_MESSAGES } from '../tokens/injection-tokens';

/**
 * Resolves an Angular `ValidationErrors` object to the message shown under a field.
 *
 * These strings used to be hardcoded English literals inside each field component, so a
 * German form meant re-implementing every field type — the labels honoured `language` while
 * the errors underneath them did not.
 *
 * A message is a plain string, or a function when it needs the error's own detail
 * (`minlength.requiredLength`, `min.min`, and so on). The active `language` is passed
 * through, so one registration can serve every locale:
 *
 * ```typescript
 * provideNgxDynamicEntity({
 *   validationMessages: {
 *     required: lang => (lang === 'de' ? 'Pflichtfeld.' : 'This field is required.'),
 *     minlength: (lang, err) => `Mindestens ${err['requiredLength']} Zeichen.`,
 *   },
 * });
 * ```
 *
 * Unregistered keys fall back to the defaults below, so overriding one message does not
 * mean supplying them all.
 */
export type ValidationMessage = string | ((language: string, error: any) => string);

/** The built-in English messages. Every key here can be overridden individually. */
export const DEFAULT_VALIDATION_MESSAGES: Record<string, ValidationMessage> = {
  required: 'This field is required.',
  requiredSelection: 'Please select an option.',
  email: 'Please enter a valid email address.',
  pattern: 'Invalid format.',
  minlength: (_lang, err) => `Minimum ${err?.requiredLength} characters required.`,
  maxlength: (_lang, err) => `Maximum ${err?.requiredLength} characters allowed.`,
  min: (_lang, err) => `Value must be at least ${err?.min}.`,
  max: (_lang, err) => `Value must not exceed ${err?.max}.`,
  invalid: 'Invalid value.',
  invalidNumber: 'Invalid number.',
  invalidSelection: 'Invalid selection.',
};

@Injectable({ providedIn: 'root' })
export class ValidationMessagesService {
  private readonly overrides = inject(VALIDATION_MESSAGES, { optional: true }) ?? {};

  /**
   * The message for the first error present, in the order the caller lists.
   *
   * Order is the caller's because it is field-specific: a dropdown wants
   * `requiredSelection` where a text input wants `required`, and the first match wins so the
   * most specific message is the one shown.
   */
  resolve(
    errors: ValidationErrors | null | undefined,
    language: string,
    order: readonly (string | readonly [errorKey: string, messageKey: string])[],
    fallbackKey = 'invalid',
  ): string {
    if (!errors) return '';

    for (const entry of order) {
      // A tuple maps an Angular error key to a different message key: a dropdown raises the
      // standard `required` error but reads better as "Please select an option", and both
      // messages stay independently overridable.
      const [errorKey, messageKey] = typeof entry === 'string' ? [entry, entry] : entry;
      // `errors[errorKey]` is usually an object of detail, but `required` is simply `true`.
      if (errors[errorKey] === undefined) continue;
      return this.messageFor(messageKey, language, errors[errorKey]);
    }
    return this.messageFor(fallbackKey, language, null);
  }

  /** One message by key, honouring an override before the default. */
  messageFor(key: string, language: string, error: unknown): string {
    const message = this.overrides[key] ?? DEFAULT_VALIDATION_MESSAGES[key];
    if (message === undefined) return '';
    return typeof message === 'function' ? message(language, error) : message;
  }
}
