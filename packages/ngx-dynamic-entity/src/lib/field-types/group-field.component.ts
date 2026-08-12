import { Component, Input, forwardRef } from '@angular/core';
import { AbstractControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import type { NestedFieldConfig, EntityFormConfig } from '@dynamic-entity/core';
import { resolveLabel } from '@dynamic-entity/core';
import { DynamicFieldComponent } from '../form/dynamic-field/dynamic-field.component';

/** ADR-008: GroupFieldComponent — renders nested fieldset container for group.children */
@Component({
  selector: 'ngx-group-field',
  standalone: true,
  imports: [ReactiveFormsModule, forwardRef(() => DynamicFieldComponent)],
  template: `
    <fieldset class="ngx-field ngx-field--group"
      [attr.data-testid]="'field-' + field.id" [attr.data-field-type]="field.type" [class.ngx-field--readonly]="readonly" [class.ngx-field--masked]="masked">
      <legend class="ngx-field__legend">{{ label }}</legend>
      @if (masked) {
        <span class="ngx-field__value ngx-field__value--masked" [attr.data-testid]="'field-' + field.id + '-masked'">XXXXXXXXX</span>
      } @else {
        <div class="ngx-field__group-children">
          @for (child of field.children ?? []; track child.id) {
            @if (child.visibility !== false) {
              <ngx-dynamic-field
                [field]="child"
                [control]="getChildControl(child.id)"
                [config]="config"
                [language]="language"
                [readonly]="readonly || !!child.readonly"
                [userRoles]="userRoles"
              />
            }
          }
        </div>
      }
    </fieldset>
  `,
  styles: [
    `
      .ngx-field--group {
        border: 1px solid #e2e8f0;
        border-radius: 8px;
        padding: 16px;
        margin-bottom: 16px;
        background: #fafafa;
      }
      .ngx-field__legend {
        font-weight: 600;
        font-size: 14px;
        padding: 0 8px;
        color: #334155;
      }
      .ngx-field__group-children {
        display: flex;
        flex-direction: column;
        gap: 12px;
      }
    `,
  ],
})
export class GroupFieldComponent {
  @Input() field!: NestedFieldConfig;
  @Input() control!: AbstractControl;
  @Input() config!: EntityFormConfig;
  @Input() language: string = 'en';
  @Input() readonly: boolean = false;
  @Input() masked: boolean = false;
  @Input() userRoles: string[] = [];

  get label(): string {
    return resolveLabel(this.field?.label, this.language);
  }

  getChildControl(childId: string): AbstractControl {
    const group = this.control as FormGroup;
    return group?.get(childId) as AbstractControl;
  }
}
