import type { AbstractControl } from '@angular/forms';
import type { NestedFieldConfig } from '@dynamic-entity/core';

/**
 * What a field component must accept to be registered with `provideFieldTypes`.
 *
 * The renderer instantiates a field component dynamically and assigns exactly these five
 * inputs — no more, no less — so any component satisfying this interface can stand in for a
 * built-in type or add a new one.
 *
 * Implement it explicitly and TypeScript will tell you when you have missed one:
 *
 * ```typescript
 * @Component({
 *   selector: 'app-signature-field',
 *   standalone: true,
 *   template: `<canvas [attr.aria-label]="field.id"></canvas>`,
 * })
 * export class SignatureFieldComponent implements DynamicFieldComponentContract {
 *   @Input() field!: NestedFieldConfig;
 *   @Input() control!: AbstractControl;
 *   @Input() language = 'en';
 *   @Input() readonly = false;
 *   @Input() masked = false;
 * }
 *
 * provideFieldTypes({ signature: SignatureFieldComponent });
 * ```
 *
 * Two implementation notes that are easy to get wrong:
 *
 * - Declare the inputs with definite assignment (`field!: …`) or an initialiser. The
 *   renderer sets them through `ComponentRef.setInput()` after construction, so they are
 *   genuinely undefined until the first assignment.
 * - `masked` means the value must not be displayed. Render a placeholder rather than the
 *   control's value. This is presentational: the real value stays in the control and is
 *   included in the submitted record, so it is not an access-control boundary.
 */
export interface DynamicFieldComponentContract {
  /** The field's schema entry: id, type, label, validators, options, and so on. */
  field: NestedFieldConfig;

  /** The reactive control backing this field. A `FormGroup` for `group`, `FormArray` for `array`. */
  control: AbstractControl;

  /** Active language, for resolving `LocalizedText` labels, placeholders and options. */
  language: string;

  /** Render the value as text rather than an editable control. */
  readonly: boolean;

  /** Hide the value from display. See the note above — presentational only. */
  masked: boolean;
}
