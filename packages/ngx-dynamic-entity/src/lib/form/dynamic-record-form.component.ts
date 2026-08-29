import { ChangeDetectionStrategy, Component, Input, Output, EventEmitter, OnChanges, SimpleChanges, signal, computed, inject, afterNextRender, ElementRef, Injector, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AbstractControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import type { EntityFormConfig, FormRule, NestedFieldConfig, NestedTabConfig } from '@dynamic-entity/core';
import { findTab, formatDisplayValue, getTabData, resolveLabel } from '@dynamic-entity/core';
import { DynamicFormComponent } from './dynamic-form.component';
import { DynamicFieldComponent } from './dynamic-field/dynamic-field.component';
import { RulesEvaluationService } from '../services/rules-evaluation.service';

/**
 * Distinguishes "no tab holds this field" from "the field holds undefined", so the tab walk
 * can keep searching in the first case and stop in the second.
 */
const FIELD_NOT_FOUND = Symbol('field-not-found');

/**
 * DynamicRecordFormComponent — comprehensive tabbed record view & edit component.
 * Supports cross-tab rule evaluation, profile header, summary drawer (showOnMinimize),
 * interactive quick-jump links, and baseline modification tracking.
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'ngx-dynamic-record-form',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, DynamicFormComponent, DynamicFieldComponent],
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
      .ngx-record-editor__header-toggle {
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: 13px;
        color: #374151;
      }
      .ngx-record-editor__header-toggle-text {
        font-weight: 600;
      }
      .ngx-record-editor__banner {
        padding: 10px 14px;
        border-radius: 8px;
        font-size: 13px;
        font-weight: 500;
      }
      .ngx-record-editor__banner--info {
        background: #eff6ff;
        border: 1px solid #dbeafe;
        color: #1d4ed8;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
      }
      .ngx-record-editor__banner-dismiss {
        background: none;
        border: none;
        cursor: pointer;
        color: inherit;
        font-size: 14px;
        line-height: 1;
        padding: 2px 6px;
        border-radius: 4px;
      }
      .ngx-record-editor__banner-dismiss:hover {
        background: rgba(0, 0, 0, 0.06);
      }
      .ngx-record-editor__banner--error {
        background: #fef2f2;
        border: 1px solid #fecaca;
        color: #b91c1c;
      }
      .ngx-record-editor__section-bar {
        display: flex;
        align-items: center;
        justify-content: flex-end;
        gap: 8px;
      }
      .ngx-record-editor__section-hint {
        margin-right: auto;
        font-size: 12px;
        color: #6b7280;
      }
      .ngx-record-editor__banner--warning {
        background: #fffbeb;
        border: 1px solid #fef3c7;
        color: #b45309;
      }
      .ngx-record-editor__rows {
        border: 1px solid #f3f4f6;
        border-radius: 8px;
        padding: 12px 14px;
        display: flex;
        flex-direction: column;
        gap: 6px;
      }
      .ngx-record-editor__rows-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
      }
      .ngx-record-editor__row {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 6px 8px;
        border-radius: 6px;
        background: #f9fafb;
      }
      .ngx-record-editor__row-text {
        flex: 1;
        font-size: 13px;
        overflow-wrap: anywhere;
      }
      .ngx-record-editor__row-btn {
        background: none;
        border: 1px solid #e5e7eb;
        border-radius: 6px;
        cursor: pointer;
        font-size: 12px;
        padding: 2px 8px;
      }
      .ngx-record-editor__row-empty {
        font-size: 12px;
        color: #6b7280;
        margin: 0;
      }
      .ngx-record-editor__drawer {
        border: 1px solid #dbeafe;
        background: #f8fafc;
        border-radius: 8px;
        padding: 14px;
        display: flex;
        flex-direction: column;
        gap: 12px;
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
  /** Whole record read-only, regardless of RBAC. Equivalent to the reference's `isReadOnly`. */
  @Input() isReadOnly: boolean = false;
  /** Specific field ids forced read-only while the rest of the record stays editable. */
  @Input() readOnlyFields: string[] = [];
  /**
   * Open the record read-only, with a per-tab "Edit section" flow — one tab is edited and
   * validated at a time. This is the framework's `EntityRecordComponent` model and the
   * default here.
   *
   * Set false for a directly editable record with no view/edit distinction.
   */
  @Input() viewMode: boolean = true;

  @Output() formSubmit = new EventEmitter<Record<string, any>>();
  @Output() formChange = new EventEmitter<Record<string, any>>();
  @Output() formReset = new EventEmitter<void>();
  /** One tab section was saved. Carries the whole record, plus which tab was edited. */
  @Output() sectionSave = new EventEmitter<{ tabId: string; record: Record<string, any> }>();

  @ViewChild(DynamicFormComponent) dynamicFormComp?: DynamicFormComponent;

  private readonly rulesEvaluation = inject(RulesEvaluationService);
  private readonly host: ElementRef<HTMLElement> = inject(ElementRef);
  private readonly injector = inject(Injector);

  readonly currentData = signal<Record<string, any>>({});
  readonly originalBaseline = signal<Record<string, any>>({});

  /**
   * Info banners the user has dismissed, by field id.
   *
   * The reference's contract: an info banner persists until dismissed, **not** until the
   * value changes. Dismissal is keyed by field so re-triggering a different field's rule
   * still shows. Re-armed when a different record is loaded.
   */
  private readonly dismissed = signal<ReadonlySet<string>>(new Set<string>());

  /**
   * Info banners from the rules engine that are still showing.
   *
   * A getter, not a `computed`: the source is `dynamicFormComp`, a ViewChild. A computed
   * evaluated before the view initialises would capture no dependency on the child's
   * `ruleResult` signal and then never recompute. Read per change-detection pass instead.
   */
  get infoBanners(): { fieldId: string; message: string }[] {
    const result = this.dynamicFormComp?.ruleResult();
    const gone = this.dismissed();
    return Object.entries(result?.infoBanners ?? {})
      .filter(([fieldId]) => !gone.has(fieldId))
      .map(([fieldId, message]) => ({ fieldId, message: String(message) }));
  }

  dismissInfoBanner(fieldId: string): void {
    this.dismissed.set(new Set(this.dismissed()).add(fieldId));
  }

  /** True when nothing in the record may be edited. */
  get recordReadOnly(): boolean {
    return this.readonly || this.isReadOnly;
  }

  // ─── Inline array-row editing ───────────────────────────────────────────────

  /**
   * A row of an `array` field is edited in a drawer, not inline in the tab panel.
   *
   * The drawer is rendered outside the tab container on purpose: the reference found that
   * building a row's FormGroup inside the tab view races the tab's own initialisation, so
   * the row form is kept detached and only pushed into the FormArray on save.
   */
  readonly inlineRowField = signal<NestedFieldConfig | null>(null);
  readonly inlineRowIndex = signal<number | null>(null);
  inlineRowForm: FormGroup | null = null;

  /** `array` fields on the tab currently shown, so the template can list their rows. */
  get arrayFieldsForActiveTab(): NestedFieldConfig[] {
    const tabId = this.activeTabId;
    const tab = tabId ? findTab(this.config?.tabs, tabId) : null;
    return (tab?.fields ?? []).filter(f => f.type === 'array');
  }

  /**
   * Rows currently held by an `array` field, read from the record value.
   *
   * Deliberately not read off the child's FormArray: that control only exists once the
   * child has initialised, so rendering from it changed value mid-pass. `currentData` is a
   * signal seeded from `initialData` and kept current by the child's `formChange`.
   */
  rowsOf(field: NestedFieldConfig): Record<string, unknown>[] {
    const tabId = this.activeTabId;
    const tabData = tabId ? getTabData(tabId, this.currentData(), this.config) : null;
    const rows = (tabData as Record<string, unknown> | null)?.[field.id];
    return Array.isArray(rows) ? (rows as Record<string, unknown>[]) : [];
  }

  /** One row rendered as text, so the list is readable without opening the drawer. */
  rowSummary(field: NestedFieldConfig, row: Record<string, unknown>): string {
    const value = row ?? {};
    const parts = (field.children ?? [])
      .map(child => value[child.id])
      .filter(v => v !== null && v !== undefined && v !== '')
      .map(v => (typeof v === 'object' ? JSON.stringify(v) : String(v)));
    return parts.length ? parts.join(' · ') : '(empty)';
  }

  openAddRow(field: NestedFieldConfig): void {
    if (this.sectionReadOnly) return;
    this.inlineRowField.set(field);
    this.inlineRowIndex.set(null);
    this.inlineRowForm = this.dynamicFormComp?.createArrayRow(field) as FormGroup;
  }

  openEditRow(field: NestedFieldConfig, index: number): void {
    if (this.sectionReadOnly) return;
    this.inlineRowField.set(field);
    this.inlineRowIndex.set(index);
    this.inlineRowForm = this.dynamicFormComp?.createArrayRow(field, this.rowsOf(field)[index]) as FormGroup;
  }

  cancelRow(): void {
    this.inlineRowField.set(null);
    this.inlineRowIndex.set(null);
    this.inlineRowForm = null;
  }

  /** Commit the drawer into the FormArray. Rules re-evaluate off the resulting value change. */
  saveRow(): void {
    const field = this.inlineRowField();
    const form = this.dynamicFormComp;
    if (!field || !form || !this.inlineRowForm) return;

    if (this.inlineRowForm.invalid) {
      this.inlineRowForm.markAllAsTouched();
      return;
    }

    const array = form.getArrayControl(field.id, this.activeTabId ?? undefined);
    if (!array) return;

    const index = this.inlineRowIndex();
    if (index === null) array.push(form.createArrayRow(field, this.inlineRowForm.value));
    else array.at(index).patchValue(this.inlineRowForm.value);

    array.updateValueAndValidity();
    this.currentData.set(form.extractRecord());
    this.cancelRow();
  }

  deleteRow(field: NestedFieldConfig, index: number): void {
    if (this.sectionReadOnly) return;
    const array = this.dynamicFormComp?.getArrayControl(field.id, this.activeTabId ?? undefined);
    array?.removeAt(index);
    array?.updateValueAndValidity();
    if (this.dynamicFormComp) this.currentData.set(this.dynamicFormComp.extractRecord());
    if (this.inlineRowIndex() === index) this.cancelRow();
  }

  // ─── Per-tab section editing ────────────────────────────────────────────────

  /**
   * The tab currently open for editing, or null when the record is being viewed.
   *
   * The reference edits one tab section at a time rather than the whole record, and
   * validates only that section on save — a required field on an untouched tab must not
   * block saving the tab you are actually working on.
   */
  readonly editingTabId = signal<string | null>(null);

  /**
   * The tab the inner form is showing.
   *
   * Tracked here rather than read off the ViewChild. The child resolves its first tab as
   * part of its own initialisation, so reading it during this component's render changed
   * value mid-pass — an ExpressionChangedAfterItHasBeenChecked error. Seeded from the
   * config and kept in step by the child's `activeTabChange` output.
   */
  private readonly activeTabIdSig = signal<string | null>(null);

  get activeTabId(): string | null {
    return this.activeTabIdSig();
  }

  onActiveTabChange(tabId: string): void {
    if (this.activeTabIdSig() === tabId) return;
    this.activeTabIdSig.set(tabId);
    // Editing does not follow the user to another tab.
    this.editingTabId.set(null);
    this.cancelRow();
  }

  /** First tab a user can see, used to seed the active tab before the child reports one. */
  private firstVisibleTabId(): string | null {
    return this.config?.tabs?.find(t => t.visibility !== false)?.id ?? null;
  }

  /** Errors from the last save attempt, by field id. */
  readonly sectionErrors = signal<Record<string, string>>({});

  /** Template access to `Object.keys` for iterating the error map. */
  protected readonly Object = Object;

  get isEditingActiveTab(): boolean {
    // Without view mode there is no view/edit distinction — everything is always editable.
    if (!this.viewMode) return true;
    return !!this.activeTabId && this.editingTabId() === this.activeTabId;
  }

  /** Fields render read-only unless their own tab is the one being edited. */
  get sectionReadOnly(): boolean {
    return this.recordReadOnly || !this.isEditingActiveTab;
  }

  editSection(): void {
    if (!this.viewMode || this.recordReadOnly || !this.activeTabId) return;
    this.sectionErrors.set({});
    this.editingTabId.set(this.activeTabId);
  }

  /** Discard this section's edits, restoring each field from the session baseline. */
  cancelSection(): void {
    const tabId = this.editingTabId();
    const form = this.dynamicFormComp;
    if (tabId && form) {
      const tab = findTab(this.config?.tabs, tabId);
      const baselineTab = (getTabData(tabId, this.originalBaseline(), this.config) ?? {}) as Record<string, unknown>;
      for (const field of tab?.fields ?? []) {
        const baselineValue = baselineTab[field.id];

        // A FormArray cannot be restored with setValue — that demands a value shaped exactly
        // like the current rows. Rebuild it from the baseline rows instead.
        const array = form.getArrayControl(field.id, tabId);
        if (array) {
          array.clear();
          for (const row of Array.isArray(baselineValue) ? baselineValue : []) {
            array.push(form.createArrayRow(field, row));
          }
          array.updateValueAndValidity();
          continue;
        }

        form.getControl(field.id, tabId)?.setValue(baselineValue ?? null);
      }
      this.currentData.set(form.extractRecord());
    }
    this.sectionErrors.set({});
    this.editingTabId.set(null);
  }

  /**
   * Validate this section only, then emit it. Validation is scoped two ways: Angular
   * validity of the tab's own controls, and rules filtered to this tab — a rule targeting
   * a hidden tab must not block the save (the reference's OV0-968 fix).
   */
  saveSection(): void {
    const tabId = this.editingTabId();
    const form = this.dynamicFormComp;
    if (!tabId || !form) return;

    const tab = findTab(this.config?.tabs, tabId);
    const errors: Record<string, string> = {};

    for (const field of tab?.fields ?? []) {
      const ctrl = form.getControl(field.id, tabId);
      if (ctrl?.invalid) {
        ctrl.markAsTouched();
        errors[field.id] = `${resolveLabel(field.label, this.language)} is invalid.`;
      }
    }

    const scoped = this.rulesEvaluation.filterForTab(this.rules, tabId, this.config);
    const ruleErrors = this.rulesEvaluation.evaluate(scoped, form.formValues(), this.originalBaseline())
      .validationErrors;
    Object.assign(errors, ruleErrors);

    if (Object.keys(errors).length > 0) {
      this.sectionErrors.set(errors);
      return;
    }

    this.sectionErrors.set({});
    this.editingTabId.set(null);

    const record = form.extractRecord();
    this.currentData.set(record);
    this.sectionSave.emit({ tabId, record });
  }

  /**
   * Seed the session baseline from the loaded record so `VALUE_CHANGED` rules and the
   * modification banner compare against the record as it was opened — not as it was
   * after the first keystroke.
   */
  ngOnChanges(changes: SimpleChanges): void {
    if (changes['initialData'] || changes['config']) {
      this.originalBaseline.set({ ...(this.initialData ?? {}) });
      this.currentData.set({ ...(this.initialData ?? {}) });
      this.activeTabIdSig.set(this.firstVisibleTabId());
      // A different record is a different set of banners — re-arm them.
      this.dismissed.set(new Set<string>());
    }
  }

  get recordTitle(): string {
    if (!this.config) return 'Record';
    return this.config.name ? resolveLabel(this.config.name, this.language) : this.config.entity;
  }

  get avatarLetter(): string {
    return (this.recordTitle || 'R').charAt(0).toUpperCase();
  }

  // ─── Header fields (isProfileImage / isHeaderToggle) ────────────────────────

  /** Every field in the config, at any depth. */
  private allFields(): NestedFieldConfig[] {
    const out: NestedFieldConfig[] = [];
    const walkFields = (fields: NestedFieldConfig[] | undefined) => {
      for (const f of fields ?? []) {
        out.push(f);
        walkFields(f.children);
      }
    };
    const walkTabs = (tabs: NestedTabConfig[] | undefined) => {
      for (const t of tabs ?? []) {
        walkFields(t.fields);
        walkTabs(t.children);
      }
    };
    walkTabs(this.config?.tabs);
    return out;
  }

  /** The field flagged `isProfileImage`, rendered as the record avatar. */
  get headerProfileField(): NestedFieldConfig | null {
    return this.allFields().find(f => f.isProfileImage) ?? null;
  }

  /** The field flagged `isHeaderToggle`, rendered as a status switch in the header. */
  get headerToggleField(): NestedFieldConfig | null {
    return this.allFields().find(f => f.isHeaderToggle) ?? null;
  }

  /** Avatar image URL, when the profile field holds a persisted FileRef. */
  get profileImageUrl(): string | null {
    const field = this.headerProfileField;
    if (!field) return null;
    const value = this.fieldValue(field.id) as { url?: string } | null;
    return value?.url ?? null;
  }

  get headerToggleValue(): boolean {
    const field = this.headerToggleField;
    return field ? this.fieldValue(field.id) === true : false;
  }

  /**
   * Flip the header toggle. It writes straight to the control rather than going through
   * section editing — the reference treats it as a record-level status switch, not part of
   * any one tab's section.
   */
  toggleHeaderStatus(): void {
    const field = this.headerToggleField;
    if (!field || this.recordReadOnly) return;
    const ctrl = this.controlFor(field.id);
    if (!ctrl) return;
    ctrl.setValue(!this.headerToggleValue);
    if (this.dynamicFormComp) this.currentData.set(this.dynamicFormComp.extractRecord());
  }

  /** Locate a field's control wherever it lives, since header fields may be on any tab. */
  private controlFor(fieldId: string): AbstractControl | null {
    return this.dynamicFormComp?.getControl(fieldId) ?? null;
  }

  /**
   * A field's current value, read from the record so it is stable during render.
   *
   * Resolved through `getTabData` so it honours exactly the nesting contract the form
   * patches with — `{ tabId: { fieldId } }`, or the record root when the tab sets
   * `flatData`. Reading the record flat instead is not a shortcut: it makes the summary
   * display values the form never loaded, which reads as "the data is there" while every
   * control behind it is empty.
   *
   * Walks sub-tabs as well: a summary, header, or profile field may sit on any tab at any
   * depth.
   */
  private fieldValue(fieldId: string): unknown {
    const visit = (tabs: NestedTabConfig[] = []): unknown => {
      for (const tab of tabs) {
        const data = getTabData(tab.id, this.currentData(), this.config) as Record<string, unknown> | null;
        if (data && fieldId in data) return data[fieldId];
        if (tab.children) {
          const found = visit(tab.children);
          if (found !== FIELD_NOT_FOUND) return found;
        }
      }
      return FIELD_NOT_FOUND;
    };

    const result = visit(this.config?.tabs);
    return result === FIELD_NOT_FOUND ? undefined : result;
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
    return formatDisplayValue(field.type, field.options, this.fieldValue(field.id), this.language);
  }

  /**
   * Finds which tab — and, where the field lives one level down, which sub-tab — owns a
   * field. The walk used to check top-level `fields` only, so every field in a sub-tab was
   * simply not found and the jump did nothing at all.
   */
  private locateField(fieldId: string): { tabId: string; subTabId?: string } | null {
    for (const tab of this.config?.tabs || []) {
      if ((tab.fields || []).some(f => f.id === fieldId)) return { tabId: tab.id };
      for (const child of tab.children || []) {
        if ((child.fields || []).some(f => f.id === fieldId)) {
          return { tabId: tab.id, subTabId: child.id };
        }
      }
    }
    return null;
  }

  /**
   * Switches to the tab holding `fieldId`, then scrolls it into view and moves focus to it.
   *
   * The wait for the new tab to render used to be a 50 ms `setTimeout`, which was wrong three
   * ways: `document` is undefined on a server render, 50 ms is a guess that a large tab can
   * outrun, and nothing cancelled the timer if the component went away first.
   * `afterNextRender` fixes all three — it never runs on the server, it runs when the panel
   * has actually rendered rather than when a guess expires, and it is tied to the injector so
   * destroying the component cancels it. The query is scoped to this component's own element,
   * so the library no longer reaches for the global `document` at all.
   */
  jumpToField(fieldId: string): void {
    const location = this.locateField(fieldId);
    if (!location) return;

    this.dynamicFormComp?.setActiveTab(location.tabId);
    // `setActiveTab` resets to a tab's first child, so the sub-tab has to be selected after
    // it, not before. Without this the walk found sub-tab fields and then rendered the wrong
    // panel, so the element the callback below looks for never existed.
    if (location.subTabId) this.dynamicFormComp?.setActiveSubTab(location.subTabId);

    afterNextRender(
      () => {
        // The field id comes from config, so it never goes into a selector string: no
        // escaping to get wrong, and no need for `CSS.escape`, which jsdom and older
        // browsers do not provide and whose absence throws silently inside a render hook.
        const wanted = `field-container-${fieldId}`;
        const el = Array.from(
          this.host.nativeElement.querySelectorAll<HTMLElement>('[id^="field-container-"]'),
        ).find(slot => slot.id === wanted);
        if (!el) return;
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        // The slot carries tabindex="-1" so this actually moves focus. Without it the jump
        // scrolled the field into view and left focus behind on the link.
        el.focus();
      },
      { injector: this.injector },
    );
  }
}
