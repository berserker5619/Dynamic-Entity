import {
  Component,
  Input,
  Output,
  EventEmitter,
  OnChanges,
  SimpleChanges,
  signal,
  computed,
  ViewChild,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule } from '@angular/forms';
import type { EntityFormConfig, FormRule, NestedFieldConfig, NestedTabConfig } from '@dynamic-entity/core';
import { formatDisplayValue, resolveLabel } from '@dynamic-entity/core';
import { DynamicFormComponent } from './dynamic-form.component';

/**
 * DynamicRecordFormComponent — comprehensive tabbed record view & edit component.
 * Supports cross-tab rule evaluation, profile header, summary drawer (showOnMinimize),
 * interactive quick-jump links, and baseline modification tracking.
 */
@Component({
  selector: 'ngx-dynamic-record-form',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, DynamicFormComponent],
  templateUrl: './dynamic-record-form.component.html',
  styles: [
    `
      .ngx-record-editor {
        display: flex;
        flex-direction: column;
        gap: 16px;
        background: #ffffff;
        border: 1px solid #e5e7eb;
        border-radius: 12px;
        padding: 20px;
        box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05);
      }
      .ngx-record-editor__header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding-bottom: 16px;
        border-bottom: 1px solid #f3f4f6;
      }
      .ngx-record-editor__title-group {
        display: flex;
        align-items: center;
        gap: 12px;
      }
      .ngx-record-editor__avatar {
        width: 48px;
        height: 48px;
        border-radius: 50%;
        object-fit: cover;
        background: #e0e7ff;
        color: #4f46e5;
        display: flex;
        align-items: center;
        justify-content: center;
        font-weight: 700;
        font-size: 18px;
      }
      .ngx-record-editor__title {
        font-size: 20px;
        font-weight: 700;
        color: #111827;
        margin: 0;
      }
      .ngx-record-editor__subtitle {
        font-size: 13px;
        color: #6b7280;
      }
      .ngx-record-editor__banner {
        padding: 10px 14px;
        border-radius: 8px;
        font-size: 13px;
        font-weight: 500;
      }
      .ngx-record-editor__banner--warning {
        background: #fffbeb;
        border: 1px solid #fef3c7;
        color: #b45309;
      }
      .ngx-record-editor__summary-panel {
        background: #f9fafb;
        border: 1px solid #f3f4f6;
        border-radius: 8px;
        padding: 12px 16px;
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
        gap: 12px;
      }
      .ngx-record-editor__summary-item {
        display: flex;
        flex-direction: column;
        cursor: pointer;
        padding: 6px 10px;
        border-radius: 6px;
        transition: background 0.15s;
      }
      .ngx-record-editor__summary-item:hover {
        background: #eff6ff;
      }
      .ngx-record-editor__summary-label {
        font-size: 11px;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: #6b7280;
        font-weight: 600;
      }
      .ngx-record-editor__summary-val {
        font-size: 14px;
        font-weight: 600;
        color: #1f2937;
      }
    `,
  ],
})
export class DynamicRecordFormComponent implements OnChanges {
  @Input() config!: EntityFormConfig;
  @Input() rules?: FormRule[];
  @Input() initialData?: Record<string, any>;
  @Input() userRoles: string[] = [];
  @Input() language: string = 'en';
  @Input() readonly: boolean = false;
  @Input() loading: boolean = false;
  @Input() error: string | null = null;

  @Output() formSubmit = new EventEmitter<Record<string, any>>();
  @Output() formChange = new EventEmitter<Record<string, any>>();
  @Output() formReset = new EventEmitter<void>();

  @ViewChild(DynamicFormComponent) dynamicFormComp?: DynamicFormComponent;

  readonly currentData = signal<Record<string, any>>({});
  readonly originalBaseline = signal<Record<string, any>>({});

  /**
   * Seed the session baseline from the loaded record so `VALUE_CHANGED` rules and the
   * modification banner compare against the record as it was opened — not as it was
   * after the first keystroke.
   */
  ngOnChanges(changes: SimpleChanges): void {
    if (changes['initialData'] || changes['config']) {
      this.originalBaseline.set({ ...(this.initialData ?? {}) });
      this.currentData.set({ ...(this.initialData ?? {}) });
    }
  }

  get recordTitle(): string {
    if (!this.config) return 'Record';
    return this.config.name ? resolveLabel(this.config.name, this.language) : this.config.entity;
  }

  get avatarLetter(): string {
    return (this.recordTitle || 'R').charAt(0).toUpperCase();
  }

  readonly isModified = computed(() => {
    const orig = this.originalBaseline();
    const curr = this.currentData();
    if (!orig || !curr || Object.keys(orig).length === 0) return false;
    return JSON.stringify(orig) !== JSON.stringify(curr);
  });

  readonly summaryFields = computed<NestedFieldConfig[]>(() => {
    const fields: NestedFieldConfig[] = [];
    const walkTabs = (tabs: NestedTabConfig[] = []) => {
      for (const t of tabs) {
        for (const f of t.fields ?? []) {
          if (f.showOnMinimize) fields.push(f);
        }
        if (t.children) walkTabs(t.children);
      }
    };
    walkTabs(this.config?.tabs);
    return fields;
  });

  onFormChange(data: Record<string, any>): void {
    // Baseline is seeded from `initialData` in ngOnChanges; only fill it here when the
    // record was opened empty (create flow), so the first emitted shape becomes the baseline.
    if (Object.keys(this.originalBaseline()).length === 0) {
      this.originalBaseline.set({ ...data });
    }
    this.currentData.set(data);
    this.formChange.emit(data);
  }

  onFormSubmit(data: Record<string, any>): void {
    this.formSubmit.emit(data);
  }

  onFormReset(): void {
    this.formReset.emit();
  }

  formatFieldLabel(field: NestedFieldConfig): string {
    return resolveLabel(field.label, this.language);
  }

  /** Summary values render through the shared core formatter, not a local stringifier. */
  formatFieldValue(field: NestedFieldConfig): string {
    return formatDisplayValue(field.type, field.options, this.currentData()[field.id], this.language);
  }

  jumpToField(fieldId: string): void {
    // Find parent tab for field
    for (const tab of this.config?.tabs || []) {
      const hasField = (tab.fields || []).some(f => f.id === fieldId);
      if (hasField) {
        this.dynamicFormComp?.setActiveTab(tab.id);
        setTimeout(() => {
          const el = document.getElementById(`field-container-${fieldId}`);
          if (el) {
            el.scrollIntoView({ behavior: 'smooth', block: 'center' });
            el.focus();
          }
        }, 50);
        break;
      }
    }
  }
}
