import { EnvironmentProviders, Type, makeEnvironmentProviders } from '@angular/core';
import { FIELD_TYPE_SETS } from '../tokens/injection-tokens';

import { TextFieldComponent } from '../field-types/text-field.component';
import { TextareaFieldComponent } from '../field-types/textarea-field.component';
import { NumberFieldComponent } from '../field-types/number-field.component';
import { CurrencyFieldComponent } from '../field-types/currency-field.component';
import { EmailFieldComponent } from '../field-types/email-field.component';
import { PasswordFieldComponent } from '../field-types/password-field.component';
import { CheckboxFieldComponent } from '../field-types/checkbox-field.component';
import { BooleanFieldComponent } from '../field-types/boolean-field.component';
import { DateFieldComponent } from '../field-types/date-field.component';
import { MonthYearFieldComponent } from '../field-types/month-year-field.component';
import { DropdownFieldComponent } from '../field-types/dropdown-field.component';
import { RadioFieldComponent } from '../field-types/radio-field.component';
import { MultiSelectFieldComponent } from '../field-types/multi-select-field.component';
import { EntityRefFieldComponent } from '../field-types/entity-ref-field.component';
import { GroupFieldComponent } from '../field-types/group-field.component';
import { ArrayFieldComponent } from '../field-types/array-field.component';
import { ImageFieldComponent } from '../field-types/image-field.component';
import { FileFieldComponent } from '../field-types/file-field.component';

/**
 * Field-type registration — the tree-shaking seam.
 *
 * `FieldRegistryService` imports no components. Whatever you register here is what gets
 * bundled, so an app that only uses text/number/dropdown pays for three components and
 * their imports, not nineteen.
 *
 * ```ts
 * // Everything (convenient; bundles all built-ins):
 * provideNgxDynamicEntity(), provideBuiltInFieldTypes()
 *
 * // Only what this app renders:
 * provideFieldTypes({ text: TextFieldComponent, number: NumberFieldComponent })
 * ```
 *
 * Both merge into `FIELD_TYPE_REGISTRY`; later registrations win on key collision.
 */

/** Map of every built-in field type key → component. Referencing this pulls in all of them. */
export function builtInFieldTypes(): Record<string, Type<any>> {
  return {
    text: TextFieldComponent,
    textarea: TextareaFieldComponent,
    number: NumberFieldComponent,
    currency: CurrencyFieldComponent,
    email: EmailFieldComponent,
    password: PasswordFieldComponent,
    checkbox: CheckboxFieldComponent,
    boolean: BooleanFieldComponent,
    date: DateFieldComponent,
    datetime: DateFieldComponent,
    monthYear: MonthYearFieldComponent,
    dropdown: DropdownFieldComponent,
    radio: RadioFieldComponent,
    multiSelect: MultiSelectFieldComponent,
    'entity-ref': EntityRefFieldComponent,
    group: GroupFieldComponent,
    array: ArrayFieldComponent,
    image: ImageFieldComponent,
    file: FileFieldComponent,
  };
}

/** Register a specific set of field types. Only the components you name are bundled. */
export function provideFieldTypes(types: Record<string, Type<any>>): EnvironmentProviders {
  return makeEnvironmentProviders([
    { provide: FIELD_TYPE_SETS, useValue: types, multi: true },
  ]);
}

/** Register all 19 built-in field type keys. Convenience for apps that use most of them. */
export function provideBuiltInFieldTypes(): EnvironmentProviders {
  return provideFieldTypes(builtInFieldTypes());
}
