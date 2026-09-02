import { Component, DestroyRef, Input, OnInit, inject, signal, ChangeDetectionStrategy } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { AbstractControl, ReactiveFormsModule } from '@angular/forms';
import type { NestedFieldConfig, ReferenceOption } from '@dynamic-entity/core';
import { MASKED_PLACEHOLDER } from '../tokens/injection-tokens';
import { ValidationMessagesService } from '../services/validation-messages.service';
import { resolveLabel } from '@dynamic-entity/core';
import { CascadeDataService } from '../services/cascade-data.service';
import { EntityRefSelectionService } from '../services/entity-ref-selection.service';
import { UiTextService } from '../services/ui-text.service';

/**
 * EntityRefFieldComponent — a select populated from a consumer-registered loader.
 *
 * Cascades: when `entityReference.parentField` is set, the component watches that sibling
 * control (via `control.parent`) and reloads its own options on every parent change,
 * clearing a now-invalid selection. It publishes the picked record on
 * `EntityRefSelectionService` so the owning form can run `autoPatch`.
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'ngx-entity-ref-field',
  standalone: true,
  imports: [ReactiveFormsModule],
  template: `
    <div
      class="ngx-field ngx-field--entity-ref"
      [attr.data-testid]="'field-' + field.id"
      [attr.data-field-type]="field.type"
      [class.ngx-field--readonly]="readonly"
      [class.ngx-field--masked]="masked"
    >
      <label class="ngx-field__label" [attr.for]="'field-' + field.id">{{ label }}</label>
      @if (masked) {
        <span class="ngx-field__value ngx-field__value--masked" [attr.data-testid]="'field-' + field.id + '-masked'">{{
          maskedText
        }}</span>
      } @else if (readonly) {
        <span class="ngx-field__value" [attr.data-testid]="'field-' + field.id + '-value'">{{
          getLabel(control.value)
        }}</span>
      } @else {
        @if (loading()) {
          <span class="ngx-field__value" [attr.data-testid]="'field-' + field.id + '-loading'" role="status">{{
            ui.text('loading', language)
          }}</span>
        } @else {
          <select
            class="ngx-field__input"
            [attr.data-testid]="'field-' + field.id + '-input'"
            [id]="'field-' + field.id"
            [formControl]="$any(control)"
            [attr.disabled]="field.disabled ? true : null"
          >
            <option value="">{{ placeholder || ui.text('selectPlaceholder', language) }}</option>
            @for (option of options(); track option.value) {
              <option [value]="option.value">{{ option.label }}</option>
            }
          </select>
          @if (awaitingParent()) {
            <span class="ngx-field__hint" [attr.data-testid]="'field-' + field.id + '-hint'">{{
              ui.text('selectParentFirst', language, { field: parentFieldId ?? '' })
            }}</span>
          }
        }
        @if (errorMessage) {
          <span class="ngx-field__error" [attr.data-testid]="'field-' + field.id + '-error'">{{ errorMessage }}</span>
        }
      }
    </div>
  `,
})
export class EntityRefFieldComponent implements OnInit {
  /** Library chrome, overridable via UI_TEXT. */
  protected readonly ui = inject(UiTextService);
  /** Overridable via MASKED_PLACEHOLDER; the default is the historic literal. */
  protected readonly maskedText = inject(MASKED_PLACEHOLDER, { optional: true }) ?? 'XXXXXXXXX';
  private readonly messages = inject(ValidationMessagesService);
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
    this.control?.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(value => this.publishSelection(String(value ?? '')));
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
      this.options.set(await this.cascade.load(this.field, { parentValue, lang: this.language }));
    } finally {
      this.loading.set(false);
    }
  }

  /**
   * Publish the selected option so autoPatch can copy from its record.
   *
   * Driven from `valueChanges` rather than the select's `change` event: that event is the
   * same one the `formControl` directive listens to, so reading the control inside a
   * template `(change)` handler can see the previous value. `valueChanges` fires after the
   * model has updated — including Playwright `selectOption`, which updates the control
   * through the value accessor.
   */
  onSelectionChange(value?: string): void {
    this.publishSelection(value ?? String(this.control?.value ?? ''));
  }

  private publishSelection(current: string): void {
    const selected = this.options().find(o => String(o.value) === current);
    this.selectionBus.emit(this.field.id, selected ?? null);
  }

  getLabel(value: any): string {
    const option = this.options().find(o => String(o.value) === String(value));
    return option?.label ?? value ?? '—';
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

    parentControl.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => {
      if (this.control.value) {
        this.control.setValue('', { emitEvent: false });
        this.selectionBus.emit(this.field.id, null);
      }
      void this.reload();
    });
  }
  /**
   * Resolved through `ValidationMessagesService`, so `provideNgxDynamicEntity({
   * validationMessages })` reaches this field. It used to render a fixed
   * "This field has an error", which made a documented, configurable feature work on three
   * of fifteen field types.
   */
  get errorMessage(): string {
    if (!this.control?.errors || !this.control.touched) return '';
    return this.messages.resolve(this.control.errors, this.language, [
      'required',
      'email',
      'min',
      'max',
      'minlength',
      'maxlength',
      'pattern',
    ]);
  }
}
