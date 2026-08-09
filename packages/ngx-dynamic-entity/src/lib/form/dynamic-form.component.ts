import {
  Component,
  Input,
  Output,
  EventEmitter,
  OnChanges,
  OnDestroy,
  OnInit,
  SimpleChanges,
  signal,
  computed,
  inject,
  HostListener,
} from '@angular/core';
import { AbstractControl, FormArray, FormBuilder, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { Subscription } from 'rxjs';
import type {
  AutoPatchConfig,
  EntityFormConfig,
  FormRule,
  NestedFieldConfig,
  NestedTabConfig,
} from '@dynamic-entity/core';
import {
  applyAutoPatch,
  applyPatchOnTrue,
  evaluateFieldVisibility,
  findTab,
  resolveLabel,
} from '@dynamic-entity/core';
import { DynamicFieldComponent } from './dynamic-field/dynamic-field.component';
import { ValidatorRegistryService } from '../services/validator-registry.service';
import { HookRegistryService } from '../services/hook-registry.service';
import { RbacService } from '../services/rbac.service';
import { RulesEvaluationService } from '../services/rules-evaluation.service';
import { EntityRefSelectionService } from '../services/entity-ref-selection.service';

/**
 * DynamicFormComponent — the main form component.
 * Renders a reactive form from EntityFormConfig with tab support, responsive 12-col grid,
 * rules evaluation, conditional visibility, autoPatch/patchOnTrue, criticalField locking,
 * keyboard shortcuts (Ctrl+S, Esc), and RBAC-gated submission.
 */
@Component({
  selector: 'ngx-dynamic-form',
  standalone: true,
  imports: [ReactiveFormsModule, DynamicFieldComponent],
  // Scoped per form instance: entity-ref selections must not leak between concurrent forms.
  providers: [EntityRefSelectionService],
  templateUrl: './dynamic-form.component.html',
  styles: [
    `
      .ngx-form__panel {
        display: grid;
        grid-template-columns: repeat(12, minmax(0, 1fr));
        gap: 16px 20px;
        align-items: start;
      }
      .ngx-form__field-slot {
        display: flex;
        align-items: flex-start;
        gap: 6px;
        min-width: 0;
      }
      .ngx-form__field-slot ngx-dynamic-field {
        flex: 1;
        min-width: 0;
      }
      .ngx-form__lock {
        flex: 0 0 auto;
        margin-top: 22px;
        background: none;
        border: 1px solid transparent;
        border-radius: 6px;
        cursor: pointer;
        font-size: 14px;
        line-height: 1;
        padding: 4px 6px;
      }
      .ngx-form__lock:hover {
        border-color: #d1d5db;
        background: #f9fafb;
      }
      @media (max-width: 768px) {
        .ngx-form__panel {
          grid-template-columns: 1fr;
        }
        .ngx-form__field-slot {
          grid-column: span 12 !important;
        }
      }
    `,
  ],
})
export class DynamicFormComponent implements OnInit, OnChanges, OnDestroy {
  // ─── Inputs ───────────────────────────────────────────────────────────────
  @Input() config!: EntityFormConfig;
  @Input() rules?: FormRule[];
  @Input() initialData?: Record<string, any>;
  /** Session-original values for `VALUE_CHANGED` rules. Captured from the first build when omitted. */
  @Input() originalData?: Record<string, any>;
  @Input() userRoles: string[] = [];
  @Input() language: string = 'en';
  @Input() readonly: boolean = false;
  @Input() loading: boolean = false;
  @Input() error: string | null = null;

  // ─── Outputs ──────────────────────────────────────────────────────────────
  @Output() formSubmit = new EventEmitter<Record<string, any>>();
  @Output() formChange = new EventEmitter<Record<string, any>>();
  @Output() formReset = new EventEmitter<void>();

  // ─── Services ─────────────────────────────────────────────────────────────
  private readonly fb = inject(FormBuilder);
  private readonly validatorRegistry = inject(ValidatorRegistryService);
  private readonly hookRegistry = inject(HookRegistryService);
  private readonly rbacService = inject(RbacService);
  private readonly rulesEvaluation = inject(RulesEvaluationService);
  private readonly entityRefSelection = inject(EntityRefSelectionService);

  protected readonly Object = Object;

  // ─── Signals (local reactive state) ───────────────────────────────────────
  readonly activeTab = signal<string>('');
  readonly isSaving = signal(false);
  readonly formValues = signal<Record<string, any>>({});
  /** Baseline captured at first build, used when `originalData` is not supplied. */
  readonly sessionBaseline = signal<Record<string, any>>({});
  /** Critical fields the user has explicitly unlocked for editing. */
  readonly unlockedFields = signal<ReadonlySet<string>>(new Set<string>());

  // ─── Form ─────────────────────────────────────────────────────────────────
  form!: FormGroup;

  private valueSub?: Subscription;
  private selectionSub?: Subscription;
  /** Previous values, for detecting `patchOnTrue` false→true transitions. */
  private previousValues: Record<string, any> = {};

  // ─── Keyboard Shortcuts ───────────────────────────────────────────────────
  @HostListener('window:keydown', ['$event'])
  handleKeyboardEvent(event: KeyboardEvent): void {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
      event.preventDefault();
      if (!this.readonly && this.canSubmit && this.form?.valid) {
        this.submit();
      }
    }
  }

  // ─── Computed ─────────────────────────────────────────────────────────────
  readonly ruleResult = computed(() =>
    this.rulesEvaluation.evaluate(this.rules, this.formValues(), this.baseline()),
  );

  /**
   * Critical fields whose value differs from the session baseline.
   * These drive the deferred `VALUE_CHANGED` banner — a critical edit is announced once,
   * against the value the record had when the session started, not per keystroke.
   */
  readonly changedCriticalFields = computed<NestedFieldConfig[]>(() => {
    const baseline = this.baseline();
    if (!baseline || Object.keys(baseline).length === 0) return [];
    const values = this.formValues();
    return this.allFields().filter(
      f => f.criticalField && !this.sameValue(values[f.id], baseline[f.id]),
    );
  });

  get tabs(): NestedTabConfig[] {
    return this.config?.tabs || [];
  }

  get visibleTabs(): NestedTabConfig[] {
    const hidden = this.ruleResult().hiddenTabs;
    return this.tabs.filter(tab => tab.visibility !== false && !hidden.includes(tab.id));
  }

  get activeTabConfig(): NestedTabConfig | null {
    const tabId = this.activeTab();
    if (!tabId) return this.visibleTabs[0] ?? null;
    return findTab(this.tabs, tabId);
  }

  get fieldsForActiveTab(): NestedFieldConfig[] {
    const active = this.activeTabConfig;
    const rawFields = active ? (active.fields || []) : ((this.config?.tabs || []).flatMap(t => t.fields || []));
    const currentValues = this.formValues();
    const hiddenFields = this.ruleResult().hiddenFields;

    return rawFields.filter(
      field => evaluateFieldVisibility(field, currentValues) && !hiddenFields.includes(field.id),
    );
  }

  get permissions() {
    return this.rbacService.getPermissions(this.config, this.userRoles);
  }

  get canSubmit(): boolean {
    return this.permissions.canEdit && !this.readonly;
  }

  ngOnInit(): void {
    this.selectionSub = this.entityRefSelection.selection$.subscribe(({ fieldId, option }) => {
      this.runAutoPatch(fieldId, option?.record);
    });
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['config'] || changes['initialData']) {
      this.buildForm();
      if (this.visibleTabs.length > 0 && !this.activeTab()) {
        this.activeTab.set(this.visibleTabs[0].id);
      }
    }
  }

  ngOnDestroy(): void {
    this.valueSub?.unsubscribe();
    this.selectionSub?.unsubscribe();
  }

  setActiveTab(tabId: string): void {
    this.activeTab.set(tabId);
  }

  getFieldSpan(field: NestedFieldConfig): string {
    const span = field.colSpan ?? 12;
    return `span ${Math.min(12, Math.max(1, span))}`;
  }

  // ─── criticalField locking ────────────────────────────────────────────────

  /** A critical field stays read-only until the user deliberately unlocks it. */
  isFieldLocked(field: NestedFieldConfig): boolean {
    return !!field.criticalField && !this.unlockedFields().has(field.id);
  }

  toggleFieldLock(field: NestedFieldConfig): void {
    if (!field.criticalField || this.readonly) return;
    const next = new Set(this.unlockedFields());
    if (next.has(field.id)) next.delete(field.id);
    else next.add(field.id);
    this.unlockedFields.set(next);
  }

  resolveFieldLabel(field: NestedFieldConfig): string {
    return resolveLabel(field.label, this.language);
  }

  // ─── Form construction ────────────────────────────────────────────────────

  private buildForm(): void {
    if (!this.config) return;
    const group: Record<string, AbstractControl> = {};

    const walkTabs = (tabs: NestedTabConfig[]) => {
      for (const tab of tabs) {
        for (const field of tab.fields || []) {
          this.buildFieldControl(field, group);
        }
        if (tab.children) walkTabs(tab.children);
      }
    };
    walkTabs(this.config.tabs || []);

    this.form = this.fb.group(group);

    if (this.initialData) {
      this.patchForm(this.initialData);
    }

    const initialValues = this.form.value || {};
    this.formValues.set(initialValues);
    this.previousValues = { ...initialValues };
    this.sessionBaseline.set({ ...initialValues });
    this.unlockedFields.set(new Set<string>());

    // Rebuilding must not stack subscriptions on successive config/data changes.
    this.valueSub?.unsubscribe();
    this.valueSub = this.form.valueChanges.subscribe(val => {
      const values = val || {};
      this.formValues.set(values);
      this.runPatchOnTrue(values);
      this.previousValues = { ...values };
      this.formChange.emit(values);
    });
  }

  private buildFieldControl(field: NestedFieldConfig, group: Record<string, AbstractControl>): void {
    if (field.type === 'group') {
      const subGroup: Record<string, AbstractControl> = {};
      for (const child of field.children || []) {
        this.buildFieldControl(child, subGroup);
      }
      group[field.id] = this.fb.group(subGroup);
    } else if (field.type === 'array') {
      group[field.id] = this.fb.array([]);
    } else {
      const validators = this.validatorRegistry.resolveFromConfig(field.validators);
      group[field.id] = this.fb.control(
        { value: field.defaultValue ?? null, disabled: field.disabled ?? false },
        validators,
      );
    }
  }

  /** One row of an `array` field: a FormGroup when the field declares columns, else a bare control. */
  private buildArrayRow(field: NestedFieldConfig | undefined, item: unknown): AbstractControl {
    if (!field?.children?.length) return this.fb.control(item);

    const rowGroup: Record<string, AbstractControl> = {};
    for (const child of field.children) {
      this.buildFieldControl(child, rowGroup);
    }
    const group = this.fb.group(rowGroup);
    if (item && typeof item === 'object') group.patchValue(item as Record<string, unknown>);
    return group;
  }

  private patchForm(data: Record<string, any>): void {
    const fieldsById = new Map(this.allFields().map(f => [f.id, f]));

    for (const [key, val] of Object.entries(data)) {
      const ctrl = this.form.get(key);
      if (!ctrl) continue;
      if (ctrl instanceof FormArray && Array.isArray(val)) {
        ctrl.clear();
        for (const item of val) {
          ctrl.push(this.buildArrayRow(fieldsById.get(key), item));
        }
      } else {
        ctrl.patchValue(val, { emitEvent: false });
      }
    }
  }

  // ─── autoPatch / patchOnTrue ──────────────────────────────────────────────

  /**
   * `autoPatch` — copy mapped fields out of the record the user just selected in an
   * entity-ref field into the configured target tab's controls.
   */
  private runAutoPatch(fieldId: string, record: Record<string, unknown> | undefined): void {
    if (!record) return;
    const field = this.allFields().find(f => f.id === fieldId);
    const autoPatch = field?.autoPatch;
    if (!autoPatch) return;

    const patch = applyAutoPatch(autoPatch, record);
    for (const [targetId, value] of Object.entries(patch)) {
      const control = this.resolveTargetControl(autoPatch, targetId);
      control?.patchValue(value);
    }
  }

  /**
   * `patchOnTrue` — when a boolean/checkbox field transitions to `true`,
   * copy `from` → `to` within the current record.
   */
  private runPatchOnTrue(values: Record<string, any>): void {
    for (const field of this.allFields()) {
      const mappings = field.patchOnTrue;
      if (!mappings?.length) continue;

      const wasTrue = this.previousValues[field.id] === true;
      const isTrue = values[field.id] === true;
      if (!isTrue || wasTrue) continue;

      const patch = applyPatchOnTrue(mappings, values);
      for (const [targetId, value] of Object.entries(patch)) {
        this.form.get(targetId)?.patchValue(value, { emitEvent: false });
      }
    }
  }

  /** Prefer a control declared on the configured target tab; fall back to a top-level control. */
  private resolveTargetControl(autoPatch: AutoPatchConfig, targetId: string): AbstractControl | null {
    const tab = findTab(this.tabs, autoPatch.targetTab);
    const inTargetTab = (tab?.fields ?? []).some(f => f.id === targetId);
    if (tab && !inTargetTab) return null;
    return this.form.get(targetId);
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  /** Every field in the config, including `group`/`array` children. */
  private allFields(): NestedFieldConfig[] {
    const out: NestedFieldConfig[] = [];
    const walkFields = (fields: NestedFieldConfig[] | undefined) => {
      for (const f of fields ?? []) {
        out.push(f);
        if (f.children?.length) walkFields(f.children);
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

  /** An empty `originalData` counts as "not supplied" — fall back to the captured baseline. */
  private baseline(): Record<string, any> {
    const supplied = this.originalData;
    if (supplied && Object.keys(supplied).length > 0) return supplied;
    return this.sessionBaseline();
  }

  private sameValue(a: unknown, b: unknown): boolean {
    if (a === b) return true;
    const aEmpty = a === null || a === undefined || a === '';
    const bEmpty = b === null || b === undefined || b === '';
    if (aEmpty && bEmpty) return true;
    if (typeof a === 'object' || typeof b === 'object') {
      return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
    }
    return false;
  }

  getControl(fieldId: string): AbstractControl | null {
    return this.form?.get(fieldId) ?? null;
  }

  resolveTabLabel(tab: NestedTabConfig): string {
    return resolveLabel(tab.label, this.language);
  }

  async submit(): Promise<void> {
    if (!this.canSubmit || this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    const rawData = this.form.getRawValue();
    let processedData = rawData;

    const hookKey = `${this.config?.entity}:beforeSave`;
    if (this.hookRegistry.has(hookKey)) {
      processedData = await this.hookRegistry.run(hookKey, processedData);
    }

    this.isSaving.set(true);
    try {
      this.formSubmit.emit(processedData);
    } finally {
      this.isSaving.set(false);
    }
  }

  reset(): void {
    this.form.reset();
    if (this.initialData) this.patchForm(this.initialData);
    const values = this.form.value || {};
    this.formValues.set(values);
    this.previousValues = { ...values };
    this.unlockedFields.set(new Set<string>());
    this.formReset.emit();
  }
}
