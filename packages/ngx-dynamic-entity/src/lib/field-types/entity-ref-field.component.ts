import { Component, Input, OnInit, signal } from '@angular/core';
import { AbstractControl, ReactiveFormsModule } from '@angular/forms';
import type { NestedFieldConfig } from '@dynamic-entity/core';
import { resolveLabel } from '@dynamic-entity/core';
import { EntityRefRegistryService } from '../services/entity-ref-registry.service';
import { inject } from '@angular/core';

/**
 * EntityRefFieldComponent — renders a dropdown populated by a loader from EntityRefRegistryService.
 */
@Component({
  selector: 'ngx-entity-ref-field',
  standalone: true,
  imports: [ReactiveFormsModule],
  template: `
    <div class="ngx-field ngx-field--entity-ref" [class.ngx-field--readonly]="readonly" [class.ngx-field--masked]="masked">
      <label class="ngx-field__label">{{ label }}</label>
      @if (masked) {
        <span class="ngx-field__value ngx-field__value--masked">XXXXXXXXX</span>
      } @else if (readonly) {
        <span class="ngx-field__value">{{ getLabel(control.value) }}</span>
      } @else {
        @if (loading()) {
          <span class="ngx-field__value">Loading...</span>
        } @else {
          <select
            class="ngx-field__input"
            [formControl]="$any(control)"
            [attr.disabled]="field.disabled ? true : null"
          >
            <option value="">{{ placeholder || 'Select...' }}</option>
            @for (option of options(); track option.value) {
              <option [value]="option.value">{{ option.label }}</option>
            }
          </select>
        }
        @if (control.invalid && control.touched) {
          <span class="ngx-field__error">This field has an error</span>
        }
      }
    </div>
  `,
})
export class EntityRefFieldComponent implements OnInit {
  @Input() field!: NestedFieldConfig;
  @Input() control!: AbstractControl;
  @Input() language: string = 'en';
  @Input() readonly: boolean = false;
  @Input() masked: boolean = false;

  private readonly entityRefRegistry = inject(EntityRefRegistryService);

  readonly options = signal<Array<{ value: any; label: string }>>([]);
  readonly loading = signal(false);

  get label(): string {
    return resolveLabel(this.field?.label, this.language);
  }

  get placeholder(): string {
    return resolveLabel(this.field?.placeholder, this.language);
  }

  async ngOnInit(): Promise<void> {
    if (this.masked) return;
    const entityKey = this.field.entityReference?.linkedEntityKey ?? this.field.id;
    const loader = this.entityRefRegistry.resolve(entityKey);
    if (!loader) return;

    this.loading.set(true);
    try {
      const raw = await loader();
      this.options.set(raw);
    } finally {
      this.loading.set(false);
    }
  }

  getLabel(value: any): string {
    const option = this.options().find(o => o.value === value);
    return option?.label ?? (value ?? '—');
  }
}
