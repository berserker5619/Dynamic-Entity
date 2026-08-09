import { Component, DestroyRef, Input, OnInit, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { AbstractControl, ReactiveFormsModule } from '@angular/forms';
import type { NestedFieldConfig, ReferenceOption } from '@dynamic-entity/core';
import { resolveLabel } from '@dynamic-entity/core';
import { CascadeDataService } from '../services/cascade-data.service';
import { EntityRefSelectionService } from '../services/entity-ref-selection.service';

/**
 * EntityRefFieldComponent — a select populated from a consumer-registered loader.
 *
 * Cascades: when `entityReference.parentField` is set, the component watches that sibling
 * control (via `control.parent`) and reloads its own options on every parent change,
 * clearing a now-invalid selection. It publishes the picked record on
 * `EntityRefSelectionService` so the owning form can run `autoPatch`.
 */
@Component({
  selector: 'ngx-entity-ref-field',
  standalone: true,
  imports: [ReactiveFormsModule],
  template: `
    <div class="ngx-field ngx-field--entity-ref" [class.ngx-field--readonly]="readonly" [class.ngx-field--masked]="masked">
      <label class="ngx-field__label" [attr.for]="'field-' + field.id">{{ label }}</label>
      @if (masked) {
        <span class="ngx-field__value ngx-field__value--masked">XXXXXXXXX</span>
      } @else if (readonly) {
        <span class="ngx-field__value">{{ getLabel(control.value) }}</span>
      } @else {
        @if (loading()) {
          <span class="ngx-field__value" role="status">Loading…</span>
        } @else {
          <select
            class="ngx-field__input"
            [id]="'field-' + field.id"
            [formControl]="$any(control)"
            [attr.disabled]="field.disabled ? true : null"
            (change)="onSelectionChange()"
          >
            <option value="">{{ placeholder || 'Select...' }}</option>
            @for (option of options(); track option.value) {
              <option [value]="option.value">{{ option.label }}</option>
            }
          </select>
          @if (awaitingParent()) {
            <span class="ngx-field__hint">Select {{ parentFieldId }} first.</span>
          }
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

  private readonly cascade = inject(CascadeDataService);
  private readonly selectionBus = inject(EntityRefSelectionService);
  private readonly destroyRef = inject(DestroyRef);

  readonly options = signal<ReferenceOption[]>([]);
  readonly loading = signal(false);
  /** True when this field cascades but its parent has no value yet. */
  readonly awaitingParent = signal(false);

  get label(): string {
    return resolveLabel(this.field?.label, this.language);
  }

  get placeholder(): string {
    return resolveLabel(this.field?.placeholder, this.language);
  }

  get parentFieldId(): string | undefined {
    return this.field?.entityReference?.parentField;
  }

  ngOnInit(): void {
    if (this.masked) return;
    void this.reload();
    this.watchParent();
  }

  /** Reload options against the parent's current value. */
  async reload(): Promise<void> {
    const parentValue = this.parentValue();
    this.awaitingParent.set(
      !!this.parentFieldId && (parentValue === null || parentValue === undefined || parentValue === ''),
    );

    if (!this.cascade.canLoad(this.field)) {
      this.options.set([]);
      return;
    }

    this.loading.set(true);
    try {
      this.options.set(
        await this.cascade.load(this.field, { parentValue, lang: this.language }),
      );
    } finally {
      this.loading.set(false);
    }
  }

  onSelectionChange(): void {
    const selected = this.options().find(o => String(o.value) === String(this.control.value));
    this.selectionBus.emit(this.field.id, selected ?? null);
  }

  getLabel(value: any): string {
    const option = this.options().find(o => String(o.value) === String(value));
    return option?.label ?? (value ?? '—');
  }

  private parentValue(): unknown {
    const parentId = this.parentFieldId;
    if (!parentId) return undefined;
    return this.control?.parent?.get(parentId)?.value;
  }

  /** Reload (and drop a stale selection) whenever the parent control changes. */
  private watchParent(): void {
    const parentId = this.parentFieldId;
    if (!parentId) return;
    const parentControl = this.control?.parent?.get(parentId);
    if (!parentControl) return;

    parentControl.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        if (this.control.value) {
          this.control.setValue('', { emitEvent: false });
          this.selectionBus.emit(this.field.id, null);
        }
        void this.reload();
      });
  }
}
