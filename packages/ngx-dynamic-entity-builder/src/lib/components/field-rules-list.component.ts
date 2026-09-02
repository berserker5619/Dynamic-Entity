import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatTooltipModule } from '@angular/material/tooltip';
import type { FormRule } from '@dynamic-entity/core';
import { toRefToken } from '@dynamic-entity/core';
import { BuilderStore } from '../builder-store.service';
import { deepClone } from '../clone';
import { RuleFormComponent } from './rule-form.component';
import { BuilderTextService } from '../builder-text';

/**
 * FieldRulesListComponent — the rules attached to the selected field: view, reorder,
 * enable/disable, edit, delete. `RuleFormComponent` authors one rule; this owns the set.
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'ngx-field-rules-list',
  standalone: true,
  imports: [MatButtonModule, MatIconModule, MatSlideToggleModule, MatTooltipModule, RuleFormComponent],
  template: `
    <div class="deb-rules">
      <div class="deb-rules__head">
        <span class="deb-section-title">{{ ui.text('rules') }}</span>
        <button
          mat-stroked-button
          type="button"
          data-testid="add-rule"
          [disabled]="!store.selectedFieldId()"
          (click)="startCreate()"
        >
          <mat-icon>add</mat-icon> {{ ui.text('rule') }}
        </button>
      </div>

      @if (editing(); as draft) {
        <ngx-rule-form [rule]="draft" (save)="commit($event)" (cancel)="editing.set(null)" />
      }

      @if (store.rulesForSelectedField().length === 0 && !editing()) {
        <p class="deb-hint" data-testid="rules-empty">{{ ui.text('noRulesOnField') }}</p>
      }

      @for (rule of store.rulesForSelectedField(); track rule.id) {
        <div class="deb-rule-item" [class.deb-rule-item--off]="!rule.enabled" data-testid="rule-item">
          <div class="deb-rule-item__body">
            <span class="deb-rule-item__summary">{{ summarize(rule) }}</span>
            <span class="deb-rule-item__meta">
              {{ ui.text('rulePriority', { priority: rule.priority, targets: rule.targets.length }) }}
            </span>
          </div>
          <div class="deb-rule-item__actions">
            <mat-slide-toggle
              [checked]="rule.enabled"
              [matTooltip]="ui.text('toggleRule')"
              (change)="store.toggleRule(rule.id!, $event.checked)"
            />
            <button
              mat-icon-button
              type="button"
              [matTooltip]="ui.text('moveUp')"
              [attr.aria-label]="ui.text('moveRuleUp')"
              [attr.data-testid]="'rule-up-' + rule.id"
              (click)="store.moveRule(rule.id!, -1)"
            >
              <mat-icon>arrow_upward</mat-icon>
            </button>
            <button
              mat-icon-button
              type="button"
              [matTooltip]="ui.text('moveDown')"
              [attr.aria-label]="ui.text('moveRuleDown')"
              [attr.data-testid]="'rule-down-' + rule.id"
              (click)="store.moveRule(rule.id!, 1)"
            >
              <mat-icon>arrow_downward</mat-icon>
            </button>
            <button
              mat-icon-button
              type="button"
              [matTooltip]="ui.text('editRule')"
              [attr.data-testid]="'rule-edit-' + rule.id"
              (click)="startEdit(rule)"
            >
              <mat-icon>edit</mat-icon>
            </button>
            <button
              mat-icon-button
              type="button"
              color="warn"
              [matTooltip]="ui.text('deleteRule')"
              [attr.data-testid]="'rule-delete-' + rule.id"
              (click)="store.removeRule(rule.id!)"
            >
              <mat-icon>delete</mat-icon>
            </button>
          </div>
        </div>
      }
    </div>
  `,
  styles: [
    `
      .deb-rules {
        display: flex;
        flex-direction: column;
        gap: 8px;
      }
      .deb-rules__head {
        display: flex;
        align-items: center;
        justify-content: space-between;
      }
      .deb-rule-item {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        border: 1px solid #e5e7eb;
        border-radius: 8px;
        padding: 8px 10px;
      }
      .deb-rule-item--off {
        opacity: 0.55;
      }
      .deb-rule-item__body {
        display: flex;
        flex-direction: column;
        min-width: 0;
      }
      .deb-rule-item__summary {
        font-size: 13px;
        font-weight: 600;
        overflow-wrap: anywhere;
      }
      .deb-rule-item__meta {
        font-size: 11px;
        color: #6b7280;
      }
      .deb-rule-item__actions {
        display: flex;
        align-items: center;
        flex: 0 0 auto;
      }
    `,
  ],
})
export class FieldRulesListComponent {
  /** Builder chrome, overridable via BUILDER_TEXT. */
  protected readonly ui = inject(BuilderTextService);
  protected readonly store = inject(BuilderStore);

  /** The rule currently open in the editor — a new draft or a copy of an existing rule. */
  protected readonly editing = signal<FormRule | null>(null);

  protected startCreate(): void {
    const fieldId = this.store.selectedFieldId();
    if (!fieldId) return;
    // Author the field's path, not its id. Ids are unique per scope, so `address` may exist
    // on two tabs and a bare id cannot say which one the rule is about; `[work.address]` can.
    // A rule written by hand may still use a bare id, and both resolve at runtime.
    const ref = this.store.selectedField()?.refererField;
    const name = ref ? toRefToken(ref) : fieldId;
    this.editing.set({
      formConfigId: this.store.config().entity || 'form-1',
      fieldId: name,
      conditions: [{ operator: 'EQUAL', compareType: 'value', value: '' }],
      action: { type: 'visibility', value: false },
      targets: [{ id: name, type: 'field' }],
      enabled: true,
      priority: this.store.rules().length + 1,
    });
  }

  protected startEdit(rule: FormRule): void {
    this.editing.set(deepClone(rule));
  }

  protected commit(rule: FormRule): void {
    if (rule.id) this.store.updateRule(rule.id, rule);
    else this.store.addRule(rule);
    this.editing.set(null);
  }

  /** One-line human summary: `status EQUAL "archived" → hide`. */
  protected summarize(rule: FormRule): string {
    const cond = rule.conditions
      .map(c => {
        const rhs = c.compareType === 'field' ? c.compareToField : JSON.stringify(c.value ?? '');
        return `${c.operator} ${rhs ?? ''}`.trim();
      })
      .join(' AND ');

    const action =
      rule.action.type === 'visibility'
        ? rule.action.value === false || rule.action.value === 'false'
          ? 'hide'
          : 'show'
        : `${rule.action.type}: ${rule.action.value}`;

    return `${rule.fieldId} ${cond} → ${action}`;
  }
}
