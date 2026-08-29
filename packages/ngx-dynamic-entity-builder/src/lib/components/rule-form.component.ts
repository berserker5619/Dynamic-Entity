import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output, computed, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';

import type { FormRule, RuleOperator } from '@dynamic-entity/core';
import { collectFieldScopes, refOf, resolveLabel, toRefToken } from '@dynamic-entity/core';
import { BuilderStore } from '../builder-store.service';

/** One choosable field: the reference stored, the label shown, and the path behind it. */
interface RuleFieldOption {
  value: string;
  label: string;
  path: string;
}

/**
 * RuleFormComponent — dialog/panel form for creating or editing a FormRule.
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
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
        <mat-label>Trigger Field</mat-label>
        <mat-select [(ngModel)]="rule.fieldId" data-testid="rule-trigger">
          @for (option of triggerOptions(); track option.value) {
            <mat-option [value]="option.value">
              {{ option.label }} <span class="deb-rule-path">{{ option.path }}</span>
            </mat-option>
          }
        </mat-select>
      </mat-form-field>

      <!-- Targets: the fields this rule acts on -->
      <mat-form-field appearance="outline" subscriptSizing="dynamic" class="deb-full">
        <mat-label>Apply to fields</mat-label>
        <mat-select
          multiple
          data-testid="rule-targets"
          [ngModel]="targetValues()"
          (ngModelChange)="setTargets($event)"
        >
          @for (option of targetOptions(); track option.value) {
            <mat-option [value]="option.value">
              {{ option.label }} <span class="deb-rule-path">{{ option.path }}</span>
            </mat-option>
          }
        </mat-select>
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
      .deb-rule-path {
        color: #888;
        font-size: 11px;
        margin-left: 6px;
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
  private readonly store = inject(BuilderStore);

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

  /**
   * Every field in the config, offered by path.
   *
   * Both pickers used to be free text — the trigger was typed by hand and the targets could
   * not be edited at all, so a rule only ever acted on the field it triggered from. Typing an
   * id is also the one way left to write an ambiguous reference: ids are unique per scope, so
   * `address` names nothing in particular once two tabs have one. Choosing from this list
   * always yields a path.
   */
  protected readonly fieldOptions = computed<RuleFieldOption[]>(() => {
    const language = this.store.activeLanguage();
    // `collectFieldScopes` rather than `fieldGroups`: it reaches fields nested inside a
    // `group` too, and it carries each field's scope, so `refOf` always has a path to fall
    // back to and this component needs no fallback of its own.
    return collectFieldScopes(this.store.config()).map(entry => {
      const path = refOf(entry.field, entry.scope);
      return {
        value: toRefToken(path),
        label: resolveLabel(entry.field.label, language) || entry.field.id,
        path,
      };
    });
  });

  /**
   * The options plus whatever the rule already names.
   *
   * A rule written before paths existed holds a bare id, and one written against a field that
   * has since been deleted holds a path nothing answers to. Neither appears in the list, and a
   * `mat-select` silently drops a value it has no option for — so opening such a rule and
   * saving it would quietly erase the reference. They are kept, and shown as they are.
   */
  private withExisting(options: RuleFieldOption[], current: readonly string[]): RuleFieldOption[] {
    const known = new Set(options.map(o => o.value));
    const extra = current
      .filter(value => value && !known.has(value))
      .map(value => ({ value, label: value, path: 'not in this config' }));
    return [...options, ...extra];
  }

  /**
   * Methods, not `computed`. Both read `rule`, which is a plain `@Input` object mutated in
   * place rather than a signal — a computed would cache the first evaluation and never see a
   * different rule being edited.
   */
  protected triggerOptions(): RuleFieldOption[] {
    return this.withExisting(this.fieldOptions(), [this.rule.fieldId]);
  }

  protected targetOptions(): RuleFieldOption[] {
    return this.withExisting(this.fieldOptions(), this.targetValues());
  }

  /** Field targets only — a rule may also target a tab, which this picker does not manage. */
  protected targetValues(): string[] {
    return this.rule.targets.filter(t => t.type === 'field').map(t => t.id);
  }

  /**
   * Replaces the field targets, leaving any tab target untouched.
   *
   * Rebuilding `targets` wholesale from this picker would drop tab targets, which it never
   * offered and so cannot know about.
   */
  protected setTargets(ids: string[]): void {
    const others = this.rule.targets.filter(t => t.type !== 'field');
    this.rule.targets = [...others, ...ids.map(id => ({ id, type: 'field' as const }))];
  }

  addCondition(): void {
    this.rule.conditions.push({ operator: 'EQUAL', compareType: 'value', value: '' });
  }

  removeCondition(index: number): void {
    this.rule.conditions.splice(index, 1);
  }
}
