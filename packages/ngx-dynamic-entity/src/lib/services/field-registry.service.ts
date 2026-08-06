import { Injectable, Type, inject } from '@angular/core';
import { FIELD_TYPE_REGISTRY } from '../tokens/injection-tokens';

// Built-in field components — pre-registered in this service
import { TextFieldComponent } from '../field-types/text-field.component';
import { TextareaFieldComponent } from '../field-types/textarea-field.component';
import { NumberFieldComponent } from '../field-types/number-field.component';
import { CheckboxFieldComponent } from '../field-types/checkbox-field.component';
import { DateFieldComponent } from '../field-types/date-field.component';
import { DropdownFieldComponent } from '../field-types/dropdown-field.component';
import { MultiSelectFieldComponent } from '../field-types/multi-select-field.component';
import { EntityRefFieldComponent } from '../field-types/entity-ref-field.component';
import { GroupFieldComponent } from '../field-types/group-field.component';
import { ArrayFieldComponent } from '../field-types/array-field.component';

/**
 * FieldRegistryService — resolves field type strings to Angular component classes.
 * Open/Closed: open for extension via consumer fieldTypes config, closed for modification.
 * DynamicFieldComponent uses this to mount the right component via createComponent().
 */
@Injectable({ providedIn: 'root' })
export class FieldRegistryService {
  private readonly consumerRegistry = inject(FIELD_TYPE_REGISTRY, { optional: true }) ?? new Map();

  /** Built-in field type → component map. Never remove an entry. */
  private readonly builtInRegistry = new Map<string, Type<any>>([
    ['text', TextFieldComponent],
    ['textarea', TextareaFieldComponent],
    ['number', NumberFieldComponent],
    ['checkbox', CheckboxFieldComponent],
    ['date', DateFieldComponent],
    ['dropdown', DropdownFieldComponent],
    ['multiSelect', MultiSelectFieldComponent],
    ['entity-ref', EntityRefFieldComponent],
    ['group', GroupFieldComponent],
    ['array', ArrayFieldComponent],
  ]);

  /**
   * Resolve a field type string to a component class.
   * Consumer registry takes precedence over built-ins (open for extension).
   * Falls back to base input components for rich field types (email, password, currency, etc.).
   */
  resolve(fieldType: string): Type<any> | null {
    const comp = this.consumerRegistry.get(fieldType) ?? this.builtInRegistry.get(fieldType);
    if (comp) return comp;

    if (fieldType === 'email' || fieldType === 'password' || fieldType === 'currency') return TextFieldComponent;
    if (fieldType === 'boolean') return CheckboxFieldComponent;
    if (fieldType === 'datetime') return DateFieldComponent;
    if (fieldType === 'radio') return DropdownFieldComponent;

    return null;
  }

  /** Check if a field type has a registered component */
  has(fieldType: string): boolean {
    return this.consumerRegistry.has(fieldType) || this.builtInRegistry.has(fieldType) || this.resolve(fieldType) !== null;
  }
}
