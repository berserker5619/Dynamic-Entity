import { Injectable, Type, inject } from '@angular/core';
import { FIELD_TYPE_REGISTRY } from '../tokens/injection-tokens';

// ── Built-in field components (all 18 RichFieldType variants) ─────────────────
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
 * FieldRegistryService — resolves field type strings to Angular component classes.
 * Open/Closed: open for extension via consumer fieldTypes config, closed for modification.
 * DynamicFieldComponent uses this to mount the right component via createComponent().
 *
 * All 18 RichFieldType values have dedicated built-in components.
 * Consumer registry takes precedence (registered via provideDynamicEntity / FIELD_TYPE_REGISTRY).
 */
@Injectable({ providedIn: 'root' })
export class FieldRegistryService {
  private readonly consumerRegistry = inject(FIELD_TYPE_REGISTRY, { optional: true }) ?? new Map();

  /** Built-in field type → component map. All 18 RichFieldType variants covered. */
  private readonly builtInRegistry = new Map<string, Type<any>>([
    ['text',       TextFieldComponent],
    ['textarea',   TextareaFieldComponent],
    ['number',     NumberFieldComponent],
    ['currency',   CurrencyFieldComponent],
    ['email',      EmailFieldComponent],
    ['password',   PasswordFieldComponent],
    ['checkbox',   CheckboxFieldComponent],
    ['boolean',    BooleanFieldComponent],
    ['date',       DateFieldComponent],
    ['datetime',   DateFieldComponent],      // reuses date; datetime distinction is in format only
    ['monthYear',  MonthYearFieldComponent],
    ['dropdown',   DropdownFieldComponent],
    ['radio',      RadioFieldComponent],
    ['multiSelect',MultiSelectFieldComponent],
    ['entity-ref', EntityRefFieldComponent],
    ['group',      GroupFieldComponent],
    ['array',      ArrayFieldComponent],
    ['image',      ImageFieldComponent],
    ['file',       FileFieldComponent],
  ]);

  /**
   * Resolve a field type string to a component class.
   * Consumer registry takes precedence over built-ins.
   * Returns null if neither registry has a match (caller should show a fallback).
   */
  resolve(fieldType: string): Type<any> | null {
    return this.consumerRegistry.get(fieldType) ?? this.builtInRegistry.get(fieldType) ?? null;
  }

  /** Check if a field type has a registered component. */
  has(fieldType: string): boolean {
    return this.consumerRegistry.has(fieldType) || this.builtInRegistry.has(fieldType);
  }
}
