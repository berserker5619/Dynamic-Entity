import { Component, Input, inject, forwardRef, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { AbstractControl, FormArray, FormBuilder, FormGroup, ReactiveFormsModule } from '@angular/forms';
import type { NestedFieldConfig, EntityFormConfig } from '@dynamic-entity/core';
import { resolveLabel } from '@dynamic-entity/core';
import { DynamicFieldComponent } from '../form/dynamic-field/dynamic-field.component';
import { ValidatorRegistryService } from '../services/validator-registry.service';

/** Renders repeating rows for a FormArray, with Add Item and Remove. */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'ngx-array-field',
  standalone: true,
  imports: [ReactiveFormsModule, forwardRef(() => DynamicFieldComponent)],
  template: `
    <div class="ngx-field ngx-field--array"
      [attr.data-testid]="'field-' + field.id" [attr.data-field-type]="field.type" [class.ngx-field--readonly]="readonly" [class.ngx-field--masked]="masked">
      <div class="ngx-field__array-header">
        <label class="ngx-field__label">{{ label }}</label>
        @if (!readonly && !masked) {
          <button type="button" class="ngx-field__array-add-btn"
            [attr.data-testid]="'field-' + field.id + '-add'" (click)="addItem()">
            + Add Item
          </button>
        }
      </div>

      @if (masked) {
        <span class="ngx-field__value ngx-field__value--masked" [attr.data-testid]="'field-' + field.id + '-masked'">XXXXXXXXX</span>
      } @else {
        <div class="ngx-field__array-list">
          @for (itemGroup of formArray.controls; track idx; let idx = $index) {
            <div class="ngx-field__array-item" [attr.data-testid]="'field-' + field.id + '-row'">
              <div class="ngx-field__array-item-header">
                <span class="ngx-field__array-item-title">Item #{{ idx + 1 }}</span>
                @if (!readonly) {
                  <button type="button" class="ngx-field__array-remove-btn"
                    [attr.data-testid]="'field-' + field.id + '-remove-' + idx" (click)="removeItem(idx)">
                    Remove
                  </button>
                }
              </div>
              <div class="ngx-field__array-item-fields">
                @for (child of field.children ?? []; track child.id) {
                  @if (child.visibility !== false) {
                    <ngx-dynamic-field
                      [field]="child"
                      [control]="getItemChildControl(itemGroup, child.id)"
                      [config]="config"
                      [language]="language"
                      [readonly]="readonly || !!child.readonly"
                      [userRoles]="userRoles"
                    />
                  }
                }
              </div>
            </div>
          }
          @if (formArray.controls.length === 0) {
            <div class="ngx-field__array-empty" [attr.data-testid]="'field-' + field.id + '-empty'">No items added yet.</div>
          }
        </div>
      }
    </div>
  `,
  styles: [
    `
      .ngx-field--array {
        border: 1px solid #e2e8f0;
        border-radius: 8px;
        padding: 16px;
        margin-bottom: 16px;
        background: #f8fafc;
      }
      .ngx-field__array-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 12px;
      }
      .ngx-field__array-add-btn {
        background: #2563eb;
        color: #fff;
        border: none;
        padding: 6px 12px;
        border-radius: 4px;
        font-weight: 500;
        cursor: pointer;
      }
      .ngx-field__array-add-btn:hover {
        background: #1d4ed8;
      }
      .ngx-field__array-list {
        display: flex;
        flex-direction: column;
        gap: 12px;
      }
      .ngx-field__array-item {
        background: #fff;
        border: 1px solid #cbd5e1;
        border-radius: 6px;
        padding: 12px;
      }
      .ngx-field__array-item-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 8px;
        border-bottom: 1px solid #f1f5f9;
        padding-bottom: 6px;
      }
      .ngx-field__array-item-title {
        font-weight: 600;
        font-size: 13px;
        color: #475569;
      }
      .ngx-field__array-remove-btn {
        background: #ef4444;
        color: #fff;
        border: none;
        padding: 4px 8px;
        border-radius: 4px;
        font-size: 12px;
        cursor: pointer;
      }
      .ngx-field__array-empty {
        color: #94a3b8;
        font-style: italic;
        font-size: 13px;
      }
    `,
  ],
})
export class ArrayFieldComponent {
  /**
   * addItem/removeItem are public and may be called from outside this component's template,
   * which under OnPush would not re-render. The host also watches the control, but this
   * keeps the component correct on its own.
   */
  private readonly cdr = inject(ChangeDetectorRef);
  @Input() field!: NestedFieldConfig;
  @Input() control!: AbstractControl;
  @Input() config!: EntityFormConfig;
  @Input() language: string = 'en';
  @Input() readonly: boolean = false;
  @Input() masked: boolean = false;
  @Input() userRoles: string[] = [];

  private readonly fb = inject(FormBuilder);
  private readonly validatorRegistry = inject(ValidatorRegistryService);

  get label(): string {
    return resolveLabel(this.field?.label, this.language);
  }

  get formArray(): FormArray {
    return this.control as FormArray;
  }

  getItemChildControl(itemGroup: AbstractControl, childId: string): AbstractControl {
    return (itemGroup as FormGroup).get(childId) as AbstractControl;
  }

  addItem(): void {
    const controls: Record<string, any> = {};
    for (const child of this.field.children ?? []) {
      const validators = this.validatorRegistry.resolveFromConfig(child.validators);
      controls[child.id] = [child.defaultValue ?? null, validators];
    }
    const group = this.fb.group(controls);
    this.formArray.push(group);
    this.cdr.markForCheck();
  }

  removeItem(index: number): void {
    this.formArray.removeAt(index);
    this.cdr.markForCheck();
  }
}
