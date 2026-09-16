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

/** An error key, or a pair mapping one to a different message key. */
export type MessageOrderEntry = string | readonly [errorKey: string, messageKey: string];

/**
 * The keys a plain input can raise, most specific first.
 *
 * A type that cannot raise one of these is unaffected by its presence — `resolve` returns the
 * first error actually on the control — so the shared list costs nothing and spares every
 * field component a near-identical copy of it.
 */
const COMMON_ORDER: readonly MessageOrderEntry[] = ['required', 'email', 'min', 'max', 'minlength', 'maxlength', 'pattern'];

/**
 * Where a field type disagrees with the common list.
 *
 * Only three do, and each for a reason about how the control reads rather than what it can
 * raise: a select says "Please select an option" where an input says "This field is
 * required"; a number that is neither required nor out of range is not "invalid", it is not a
 * number; and a control with no text in it cannot fail a length or format rule.
 */
const ORDER_BY_FIELD_TYPE: Readonly<Record<string, { order: readonly MessageOrderEntry[]; fallback: string }>> = {
  dropdown: { order: [['required', 'requiredSelection']], fallback: 'invalidSelection' },
  number: { order: ['required', 'min', 'max'], fallback: 'invalidNumber' },
  boolean: { order: ['required', 'pattern'], fallback: 'invalid' },
  checkbox: { order: ['required', 'pattern'], fallback: 'invalid' },
  file: { order: ['required', 'pattern'], fallback: 'invalid' },
  image: { order: ['required', 'pattern'], fallback: 'invalid' },
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

  /**
   * The message for a field, chosen by its **type** rather than by a list the caller supplies.
   *
   * Every field component used to pass its own copy of the key order, and the copies were
   * near-identical — which was tolerable while the field itself was the only thing that
   * rendered a message. It stopped being tolerable when the error summary above the form
   * started naming what is wrong with each field: the summary has no field component to ask
   * (the offending field is usually on a tab that is not rendered), so it would have needed a
   * second copy of the same table, and a dropdown would have said "This field is required" in
   * the summary and "Please select an option" under the control.
   *
   * One table, read from both places, is what keeps those two sentences the same sentence.
   */
  resolveForField(errors: ValidationErrors | null | undefined, language: string, fieldType: string): string {
    const { order, fallback } = this.orderFor(fieldType);
    return this.resolve(errors, language, order, fallback);
  }

  /** A field type's key order. An unrecognised type — a consumer's own — gets the common list. */
  orderFor(fieldType: string): { order: readonly MessageOrderEntry[]; fallback: string } {
    return ORDER_BY_FIELD_TYPE[fieldType] ?? { order: COMMON_ORDER, fallback: 'invalid' };
  }

  /** One message by key, honouring an override before the default. */
  messageFor(key: string, language: string, error: unknown): string {
    const message = this.overrides[key] ?? DEFAULT_VALIDATION_MESSAGES[key];
    if (message === undefined) return '';
    return typeof message === 'function' ? message(language, error) : message;
  }
}
