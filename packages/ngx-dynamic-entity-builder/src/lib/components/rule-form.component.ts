import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';

import type { FormRule, RuleActionType, RuleOperator } from '@dynamic-entity/core';

/**
 * RuleFormComponent — dialog/panel form for creating or editing a FormRule.
 */
@Component({
  selector: 'ngx-rule-form',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatButtonModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatSelectModule,
  ],
  template: `
    <div class="deb-rule-form">
      <h3 class="deb-rule-form__title">{{ rule.id ? 'Edit Rule' : 'New Form Rule' }}</h3>

      <!-- Trigger Field -->
      <mat-form-field appearance="outline" subscriptSizing="dynamic" class="deb-full">
        <mat-label>Trigger Field ID</mat-label>
        <input matInput [(ngModel)]="rule.fieldId" placeholder="e.g. status" />
      </mat-form-field>

      <!-- Conditions -->
      <div class="deb-rule-section">
        <h4>Conditions</h4>
        @for (cond of rule.conditions; track $index) {
          <div class="deb-rule-row">
            <mat-form-field appearance="outline" subscriptSizing="dynamic">
              <mat-label>Operator</mat-label>
              <mat-select [(ngModel)]="cond.operator">
                @for (op of operators; track op) {
                  <mat-option [value]="op">{{ op }}</mat-option>
                }
              </mat-select>
            </mat-form-field>
            <mat-form-field appearance="outline" subscriptSizing="dynamic">
              <mat-label>Value</mat-label>
              <input matInput [(ngModel)]="cond.value" placeholder="Condition value" />
            </mat-form-field>
            <button mat-icon-button color="warn" type="button" (click)="removeCondition($index)">
              <mat-icon>delete</mat-icon>
            </button>
          </div>
        }
        <button mat-stroked-button type="button" (click)="addCondition()">
          <mat-icon>add</mat-icon> Add Condition
        </button>
      </div>

      <!-- Action -->
      <div class="deb-rule-section">
        <h4>Action</h4>
        <div class="deb-rule-row">
          <mat-form-field appearance="outline" subscriptSizing="dynamic">
            <mat-label>Action Type</mat-label>
            <mat-select [(ngModel)]="rule.action.type">
              <mat-option value="visibility">Visibility (Show/Hide)</mat-option>
              <mat-option value="validation">Validation Message</mat-option>
              <mat-option value="info">Info Banner</mat-option>
            </mat-select>
          </mat-form-field>
          <mat-form-field appearance="outline" subscriptSizing="dynamic">
            <mat-label>Value / Message</mat-label>
            <input matInput [(ngModel)]="rule.action.value" placeholder="false to hide, or message text" />
          </mat-form-field>
        </div>
      </div>

      <div class="deb-rule-form__actions">
        <button mat-button type="button" (click)="cancel.emit()">Cancel</button>
        <button mat-raised-button color="primary" type="button" (click)="save.emit(rule)">Save Rule</button>
      </div>
    </div>
  `,
  styles: [
    `
      .deb-rule-form {
        display: flex;
        flex-direction: column;
        gap: 12px;
        background: #fafafa;
        border: 1px solid #e0e0e0;
        border-radius: 8px;
        padding: 16px;
      }
      .deb-rule-form__title {
        margin: 0 0 8px 0;
        font-size: 16px;
        font-weight: 600;
      }
      .deb-full {
        width: 100%;
      }
      .deb-rule-section {
        display: flex;
        flex-direction: column;
        gap: 8px;
      }
      .deb-rule-section h4 {
        margin: 0;
        font-size: 13px;
        font-weight: 600;
        color: #555;
      }
      .deb-rule-row {
        display: flex;
        gap: 8px;
        align-items: center;
      }
      .deb-rule-row > * {
        flex: 1;
      }
      .deb-rule-form__actions {
        display: flex;
        justify-content: flex-end;
        gap: 8px;
        margin-top: 8px;
      }
    `,
  ],
})
export class RuleFormComponent {
  @Input() rule: FormRule = {
    formConfigId: 'form-1',
    fieldId: '',
    conditions: [{ operator: 'EQUAL', compareType: 'value', value: '' }],
    action: { type: 'visibility', value: false },
    targets: [],
    enabled: true,
    priority: 1,
  };

  @Output() save = new EventEmitter<FormRule>();
  @Output() cancel = new EventEmitter<void>();

  readonly operators: RuleOperator[] = [
    'EQUAL',
    'NOT_EQUAL',
    'CONTAINS',
    'NOT_CONTAINS',
    'STARTS_WITH',
    'ENDS_WITH',
    'IS_EMPTY',
    'IS_NOT_EMPTY',
    'LESS_THAN',
    'MORE_THAN',
    'LESS_THAN_EQUAL',
    'MORE_THAN_EQUAL',
    'DATE_BEFORE',
    'DATE_AFTER',
    'IN',
    'NOT_IN',
    'HAS_ITEMS',
    'VALUE_CHANGED',
  ];

  addCondition(): void {
    this.rule.conditions.push({ operator: 'EQUAL', compareType: 'value', value: '' });
  }

  removeCondition(index: number): void {
    this.rule.conditions.splice(index, 1);
  }
}
