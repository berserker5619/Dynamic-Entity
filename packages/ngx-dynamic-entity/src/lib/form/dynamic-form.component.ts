import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  Input,
  Output,
  EventEmitter,
  OnChanges,
  OnDestroy,
  OnInit,
  SimpleChange,
  SimpleChanges,
  signal,
  computed,
  inject,
  isDevMode,
  ElementRef,
  ViewChild,
  ViewChildren,
  QueryList,
  HostListener,
} from '@angular/core';
import { NgComponentOutlet } from '@angular/common';
import { AbstractControl, FormArray, FormBuilder, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { Subscription } from 'rxjs';
import { debounceTime } from 'rxjs/operators';
import type {
  AutoPatchConfig,
  EntityFormConfig,
  FormRule,
  NestedFieldConfig,
  NestedTabConfig,
} from '@dynamic-entity/core';
import {
  ambiguousFieldIds,
  collectFieldScopes,
  fieldRefFor,
  parseFieldRef,
  refOf,
  toRefToken,
  applyAutoPatch,
  applyPatchOnTrue,
  migrateRecord,
  evaluateFieldVisibility,
  findTab,
  getTabData,
  getTabPath,
  getValueByPath,
  normalizeArrayStructures,
  normalizeConfigOptions,
  resolveLabel,
  setTabData,
  setValueByPath,
} from '@dynamic-entity/core';
import { DynamicFieldComponent } from './dynamic-field/dynamic-field.component';
import { COMMON_MODULES_REGISTRY, RECORD_MIGRATIONS } from '../tokens/injection-tokens';
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
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'ngx-dynamic-form',
  standalone: true,
  imports: [ReactiveFormsModule, DynamicFieldComponent, NgComponentOutlet],
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
  /**
   * The schema to render.
   *
   * An accessor pair rather than a plain field: `ngOnChanges` normalises the option shape,
   * and that result is kept here instead of being written back over the input. Reassigning
   * an `@Input` works, but it mutates what the parent handed us — and a parent using OnPush
   * or signals would never observe the replacement anyway.
   *
   * Reads of `this.config` get the normalised copy once it exists, so every internal caller
   * is unaffected.
   */
  @Input()
  set config(value: EntityFormConfig) {
    this.rawConfig = value;
    this.normalizedConfig = undefined; // re-normalised in ngOnChanges
  }
  get config(): EntityFormConfig {
    return this.normalizedConfig ?? this.rawConfig;
  }
  private rawConfig!: EntityFormConfig;
  private normalizedConfig?: EntityFormConfig;
  @Input() rules?: FormRule[];
  @Input() initialData?: Record<string, any>;
  /** Session-original values for `VALUE_CHANGED` rules. Captured from the first build when omitted. */
  @Input() originalData?: Record<string, any>;
  @Input() userRoles: string[] = [];
  @Input() language: string = 'en';
  @Input() readonly: boolean = false;
  /** Field ids forced read-only while the rest of the form stays editable. */
  @Input() readOnlyFields: string[] = [];
  /**
   * Render rule `info` banners inline. The record editor sets this false and renders its
   * own dismissible versions, so the two do not double up.
   */
  @Input() showInfoBanners: boolean = true;
  @Input() loading: boolean = false;
  @Input() error: string | null = null;
  /**
   * Milliseconds to debounce `formChange`. The reference debounces at 300ms so a consumer
   * re-rendering on every value change is not driven per keystroke. Zero emits
   * synchronously, which the record editor relies on for its own bookkeeping.
   */
  @Input() changeDebounceMs: number = 0;
  /**
   * Preview mode: seed one empty row per `array` field so the structure is visible, then
   * disable the form. Used by the builder's live preview.
   */
  @Input() preview: boolean = false;

  // ─── Outputs ──────────────────────────────────────────────────────────────
  @Output() formSubmit = new EventEmitter<Record<string, any>>();
  @Output() formChange = new EventEmitter<Record<string, any>>();
  @Output() formReset = new EventEmitter<void>();
  /** The visible tab changed. Lets a host track it without reaching into this component. */
  @Output() activeTabChange = new EventEmitter<string>();
  /**
   * Emitted when a `beforeSave` hook aborted the save — by returning false or throwing.
   * `formSubmit` does not fire in that case.
   */
  @Output() saveRejected = new EventEmitter<{ reason: string; error?: unknown }>();

  // ─── Services ─────────────────────────────────────────────────────────────
  private readonly cdr = inject(ChangeDetectorRef);
  private readonly fb = inject(FormBuilder);
  private readonly validatorRegistry = inject(ValidatorRegistryService);
  private readonly hookRegistry = inject(HookRegistryService);
  private readonly rbacService = inject(RbacService);
  private readonly rulesEvaluation = inject(RulesEvaluationService);
  private readonly entityRefSelection = inject(EntityRefSelectionService);
  private readonly commonModulesRegistry = inject(COMMON_MODULES_REGISTRY, { optional: true });
  private readonly migrations = inject(RECORD_MIGRATIONS, { optional: true }) ?? [];

  protected readonly Object = Object;

  // ─── Signals (local reactive state) ───────────────────────────────────────
  readonly activeTab = signal<string>('');
  readonly activeSubTab = signal<string>('');
  readonly isSaving = signal(false);
  readonly formValues = signal<Record<string, any>>({});
  /** Baseline captured at first build, used when `originalData` is not supplied. */
  readonly sessionBaseline = signal<Record<string, any>>({});
  /** Critical fields the user has explicitly unlocked for editing. */
  readonly unlockedFields = signal<ReadonlySet<string>>(new Set<string>());

  /** The active tab's field panel, focused after a tab switch. */
  @ViewChild('formPanel') private formPanel?: ElementRef<HTMLElement>;

  /** The hosted field components, so an external control-state change can reach them. */
  @ViewChildren(DynamicFieldComponent) private fieldHosts?: QueryList<DynamicFieldComponent>;

  // ─── Form ─────────────────────────────────────────────────────────────────
  form!: FormGroup;

  private valueSub?: Subscription;
  private statusSub?: Subscription;
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

  get visibleSubTabs(): NestedTabConfig[] {
    const active = this.activeTabConfig;
    if (!active?.children || active.children.length === 0) return [];
    const hidden = this.ruleResult().hiddenTabs;
    return active.children.filter(tab => tab.visibility !== false && !hidden.includes(tab.id));
  }

  get activeSubTabConfig(): NestedTabConfig | null {
    const subTabs = this.visibleSubTabs;
    if (!subTabs.length) return null;
    const subId = this.activeSubTab();
    return subTabs.find(s => s.id === subId) ?? subTabs[0];
  }

  get activeTabModuleComponent(): any | null {
    const active = this.activeSubTabConfig ?? this.activeTabConfig;
    if (!active?.moduleName || !this.commonModulesRegistry) return null;
    const entry = this.commonModulesRegistry.find(
      m => m.id === active.moduleName || m.component === active.moduleName,
    );
    return entry ? entry.component : null;
  }

  get fieldsForActiveTab(): NestedFieldConfig[] {
    const active = this.activeSubTabConfig ?? this.activeTabConfig;
    if (active?.moduleName) return [];
    const rawFields = active ? (active.fields || []) : ((this.config?.tabs || []).flatMap(t => t.fields || []));
    const currentValues = this.formValues();
    const hiddenFields = new Set<string>(this.ruleResult().hiddenFields);

    return rawFields.filter(
      field => evaluateFieldVisibility(field, currentValues) && !this.namesField(hiddenFields, field),
    );
  }

  /**
   * Entity-level permissions for the current roles.
   *
   * Cached rather than recomputed: this is read from the template several times per change
   * detection pass, and a fresh object each time is both wasted allocation and a new
   * identity for anything comparing by reference. Invalidated in `ngOnChanges` when
   * `config` or `userRoles` change, which are its only inputs.
   */
  get permissions(): ReturnType<RbacService['getPermissions']> {
    return (this.permissionsCache ??= this.rbacService.getPermissions(this.config, this.userRoles));
  }

  private permissionsCache: ReturnType<RbacService['getPermissions']> | null = null;

  /**
   * Whether the current roles may see this record at all.
   *
   * `permissions.view` used to be computed and thrown away — a user whose roles failed it
   * still received the complete form with every value in the DOM. It is honoured now.
   *
   * As with masking, this is presentational: it stops the browser rendering data, it does
   * not stop the data reaching the browser. Authorize on the server.
   */
  get canView(): boolean {
    return this.permissions.canView;
  }

  /**
   * Whether the current roles may delete this record.
   *
   * The library ships no delete affordance, so this is surfaced for the consumer to gate
   * their own — exposed rather than dropped, because a permission the schema declares
   * should be answerable.
   */
  get canDelete(): boolean {
    return this.permissions.canDelete;
  }

  get canSubmit(): boolean {
    return this.canView && this.permissions.canEdit && !this.readonly;
  }

  /**
   * Errors raised by `validation` rules, keyed by the target they point at.
   *
   * A rule can declare the record invalid independently of Angular's validators, so form
   * validity alone is not the whole picture. `DynamicRecordFormComponent.saveSection()`
   * has always honoured these; `submit()` did not, which meant the same rule blocked one
   * save path and merely painted a banner on the other — and anything wiring
   * `(formSubmit)` to persistence wrote records the rules engine had already rejected.
   */
  get ruleValidationErrors(): Record<string, string> {
    return this.ruleResult().validationErrors;
  }

  /** True when a `validation` rule is currently blocking submission. */
  get hasRuleErrors(): boolean {
    return Object.keys(this.ruleValidationErrors).length > 0;
  }

  /**
   * True while an async validator is still running.
   *
   * Angular reports a control with an outstanding async check as `pending`, and `invalid` is
   * false until it settles — so without this a form could be submitted in the gap before a
   * uniqueness check came back.
   */
  get isValidating(): boolean {
    return this.form.pending;
  }

  /** Single source of truth for both the submit guard and the button's disabled state. */
  get submitBlocked(): boolean {
    return this.form.invalid || this.form.pending || this.hasRuleErrors;
  }

  ngOnInit(): void {
    this.selectionSub = this.entityRefSelection.selection$.subscribe(({ fieldId, option }) => {
      this.runAutoPatch(fieldId, option?.record);
    });
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['config'] || changes['userRoles']) {
      this.permissionsCache = null;
    }
    if (changes['config'] && this.rawConfig) {
      // Configs arrive as plain JSON from storage or an API, where TypeScript cannot enforce
      // the option shape. Normalise here, at the library boundary, so everything downstream
      // can rely on an option being a LocalizedText. Returns the same object when it already
      // is, so a well-formed config costs nothing.
      // Kept in a field of our own rather than written back to the @Input. Reassigning an
      // input works, but it surprises a parent that holds the same object — and a parent
      // using OnPush or signals would not see the replacement anyway.
      this.normalizedConfig = normalizeConfigOptions(this.config);
    }
    if (changes['config'] || changes['initialData']) {
      this.buildForm();

      // Clear *before* the guard below, not after it.
      //
      // The reset used to sit behind `if (visibleTabs.length === 0) return`, so a swap that
      // arrived while no tab was visible — a config still being applied, or every tab hidden
      // by a rule at that instant — skipped it entirely and the previous record's tab
      // survived into the next one. Clearing is unconditional and cheap, and safe on its own
      // because `activeTabConfig` already falls back to the first visible tab when nothing
      // is selected. Selecting the tab is what needs tabs to exist; forgetting the old one
      // does not.
      if (changes['config'] || this.isRecordSwap(changes['initialData'])) {
        this.activeTab.set('');
        this.activeSubTab.set('');
      }

      if (this.visibleTabs.length === 0) return;

      // The first tab used to be chosen only when no tab was active yet, and nothing ever
      // cleared `activeTab` — so a form that stays mounted while `initialData` is swapped
      // opened the next record on the tab the previous one was left on. The demo escaped it
      // by destroying the form between records; a host that keeps it mounted did not.
      //
      // Resetting here is consistent with what already happens: `buildForm` assigns a brand
      // new FormGroup, so a changed `initialData` has already discarded every control and
      // all validation state. The tab was the one thing pretending nothing had changed.
      if (!this.activeTab()) {
        // No focus steal: the panel gains focus when a *user* picks a tab, not when a host
        // swaps the record underneath them.
        this.setActiveTab(this.visibleTabs[0].id, { focusPanel: false });
      }
    }
  }

  /**
   * Whether an `initialData` change represents loading a different record.
   *
   * Not every change does. A template binding like `[initialData]="record() || {}"` yields a
   * fresh object literal on each evaluation, so `ngOnChanges` fires with two empty objects
   * and nothing has actually been loaded — resetting there would drag someone back to the
   * first tab while they were filling in a new record on the third.
   */
  private isRecordSwap(change: SimpleChange | undefined): boolean {
    if (!change || change.isFirstChange()) return false;
    const empty = (v: unknown): boolean =>
      v === null || v === undefined || (typeof v === 'object' && Object.keys(v as object).length === 0);
    return !(empty(change.previousValue) && empty(change.currentValue));
  }

  ngOnDestroy(): void {
    this.valueSub?.unsubscribe();
    this.statusSub?.unsubscribe();
    this.selectionSub?.unsubscribe();
  }

  /**
   * `focusPanel: false` is for a caller that is about to focus something more specific.
   *
   * Activating a tab moves focus into its panel, which is right for a keyboard user pressing
   * a tab. A quick-jump also switches tabs, but then focuses the field it was aiming at — and
   * the panel focus runs on `requestAnimationFrame`, after `afterNextRender`, so it landed
   * second and took the focus back every time. Saying so is better than out-timing it.
   */
  setActiveTab(tabId: string, options?: { focusPanel?: boolean }): void {
    const changed = this.activeTab() !== tabId;
    if (changed) this.activeTabChange.emit(tabId);
    this.activeTab.set(tabId);
    if (changed && options?.focusPanel !== false) this.focusActivePanel();
    const parent = findTab(this.tabs, tabId);
    if (parent?.children?.length) {
      this.activeSubTab.set(parent.children[0].id);
    } else {
      this.activeSubTab.set('');
    }
  }

  setActiveSubTab(subTabId: string, options?: { focusPanel?: boolean }): void {
    const changed = this.activeSubTab() !== subTabId;
    this.activeSubTab.set(subTabId);
    if (changed && options?.focusPanel !== false) this.focusActivePanel();
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

  /**
   * Whether this field renders read-only, from any of the four reasons: the whole form,
   * the field's own flag, a caller-supplied `readOnlyFields` entry, or a criticalField lock.
   */
  isFieldReadonly(field: NestedFieldConfig): boolean {
    return (
      this.readonly ||
      // `permissions.edit` gated the Save button and nothing else, so a role without edit
      // rights received a fully editable form: it could type into every field, and only
      // discovered the record was not theirs to change when no Save button appeared. The
      // permission means the record may not be edited, so the fields say so.
      !this.permissions.canEdit ||
      !!field.readonly ||
      this.readOnlyFields.includes(field.id) ||
      this.isFieldLocked(field)
    );
  }

  toggleFieldLock(field: NestedFieldConfig): void {
    // Unlocking is an edit. Without the permission check a viewer could open the lock on a
    // critical field, which is the one control that exists to make editing deliberate.
    if (!field.criticalField || this.readonly || !this.permissions.canEdit) return;
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

    const buildTabControls = (tabs: NestedTabConfig[], parentGroup: Record<string, AbstractControl>) => {
      for (const tab of tabs) {
        if (tab.flatData) {
          for (const field of tab.fields || []) {
            this.buildFieldControl(field, parentGroup);
          }
          if (tab.children) buildTabControls(tab.children, parentGroup);
        } else {
          const tabGroup: Record<string, AbstractControl> = {};
          for (const field of tab.fields || []) {
            this.buildFieldControl(field, tabGroup);
          }
          if (tab.children) buildTabControls(tab.children, tabGroup);
          parentGroup[tab.id] = this.fb.group(tabGroup);
        }
      }
    };

    buildTabControls(this.config.tabs || [], group);
    this.form = this.fb.group(group);
    this.warnAmbiguousRuleReferences();

    if (this.initialData) {
      this.patchForm(this.upgradeRecord(this.initialData));
    }

    const initialFlattened = this.flattenFormValues();
    this.formValues.set(initialFlattened);
    this.previousValues = { ...initialFlattened };
    this.sessionBaseline.set({ ...initialFlattened });
    this.unlockedFields.set(new Set<string>());
    this.syncHiddenFieldState(initialFlattened);

    if (this.preview) {
      // Show what an array field looks like rather than an empty slot, then freeze.
      for (const field of this.allFields()) {
        if (field.type !== 'array') continue;
        const array = this.getArrayControl(field.id);
        if (array && array.length === 0) array.push(this.buildArrayRow(field, undefined));
      }
      this.form.disable({ emitEvent: false });
    }

    // Rebuilding must not stack subscriptions on successive config/data changes.
    this.valueSub?.unsubscribe();
    const changes$ = this.changeDebounceMs > 0
      ? this.form.valueChanges.pipe(debounceTime(this.changeDebounceMs))
      : this.form.valueChanges;
    // Validity is not value: an async validator settling flips `pending` and then `invalid`
    // with no value change and no template event, so under OnPush the Save button would
    // never re-enable. submitBlocked reads form.pending and form.invalid, so this is what
    // keeps it honest.
    this.statusSub?.unsubscribe();
    this.statusSub = this.form.statusChanges.subscribe(() => this.cdr.markForCheck());

    this.valueSub = changes$.subscribe(() => {
      const flattened = this.flattenFormValues();
      this.formValues.set(flattened);
      this.runPatchOnTrue(flattened);
      this.syncHiddenFieldState(flattened);
      this.previousValues = { ...flattened };
      this.formChange.emit(this.extractRecord());
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
      const asyncValidators = this.validatorRegistry.resolveAsyncFromConfig(field.validators);
      group[field.id] = this.fb.control(
        { value: field.defaultValue ?? null, disabled: field.disabled ?? false },
        validators,
        asyncValidators,
      );
    }
  }

  /** One row of an `array` field: a FormGroup when the field declares columns, else a bare control. */
  /**
   * The `FormArray` behind an `array` field, for callers that manage rows themselves —
   * the record editor's inline row drawer.
   */
  getArrayControl(fieldId: string, tabId?: string): FormArray | null {
    const ctrl = this.getControl(fieldId, tabId);
    return ctrl instanceof FormArray ? ctrl : null;
  }

  /**
   * Build one detached row for an `array` field, with the field's own validators applied.
   * Exposed so a row can be edited outside the form and pushed on save.
   */
  createArrayRow(field: NestedFieldConfig, value?: unknown): AbstractControl {
    return this.buildArrayRow(field, value);
  }

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

  /**
   * Mark every control touched, then re-check the field components.
   *
   * They are OnPush and `touched` is flipped from outside their own template, so the second
   * half is what makes the error messages actually appear.
   */
  private markAllTouched(): void {
    this.form.markAllAsTouched();
    this.fieldHosts?.forEach(host => host.refresh());
  }

  /**
   * Bring a record up to the config's `version` before it reaches the form.
   *
   * Done here because this is the one place a record enters the renderer, so a consumer
   * cannot forget it. Migration is a no-op unless the consumer registered steps *and* the
   * record is behind — an unstamped record is deliberately left alone (see `migrateRecord`).
   *
   * A missing or broken step throws from core. That is not swallowed: rendering a
   * half-understood record would write it back in a shape matching neither schema.
   */
  private upgradeRecord(data: Record<string, any>): Record<string, any> {
    if (!this.migrations.length || !this.config) return data;

    const result = migrateRecord(data, this.config, this.migrations);
    if (result.applied.length && isDevMode()) {
      console.info(
        `[ngx-dynamic-entity] Migrated a "${this.config.entity}" record from config version ` +
          `${result.from} to ${result.to} (steps: ${result.applied.join(', ')}).`,
      );
    }
    return result.record;
  }

  private patchForm(data: Record<string, any>): void {
    if (!data || !this.form) return;
    const fieldsById = new Map(this.allFields().map(f => [f.id, f]));
    const patchedFieldIds = new Set<string>();

    const walkTabs = (tabs: NestedTabConfig[]) => {
      for (const tab of tabs) {
        const tabData = getTabData(tab.id, data, this.config);
        for (const field of tab.fields || []) {
          let val = tabData && typeof tabData === 'object' ? tabData[field.id] : undefined;
          if (field.refererField) {
            const refVal = getValueByPath(data, field.refererField);
            if (refVal !== undefined) val = refVal;
          }
          if (val === undefined) continue;

          const ctrl = this.getControl(field.id, tab.id);
          if (!ctrl) continue;

          if (ctrl instanceof FormArray && Array.isArray(val)) {
            ctrl.clear();
            for (const item of val) {
              ctrl.push(this.buildArrayRow(fieldsById.get(field.id), item));
            }
          } else {
            ctrl.patchValue(val, { emitEvent: false });
          }
          patchedFieldIds.add(field.id);
        }
        if (tab.children) walkTabs(tab.children);
      }
    };

    walkTabs(this.config.tabs || []);
    this.warnUnconsumedInitialData(data, fieldsById, patchedFieldIds);
  }

  /**
   * A record is nested by tab id (`{ tabId: { fieldId: value } }`) unless the tab sets
   * `flatData: true`. Handing a flat record to a nested tab finds nothing, so the fields
   * stay empty — with no error and no clue. That silent miss is the most expensive way to
   * lose an hour with this library, so name it in dev builds.
   *
   * Only top-level keys that match a known field id are reported: anything else is assumed
   * to be the consumer's own record metadata (ids, timestamps, `_configVersion`) and is not
   * our business.
   */
  private warnUnconsumedInitialData(
    data: Record<string, any>,
    fieldsById: Map<string, NestedFieldConfig>,
    patchedFieldIds: Set<string>,
  ): void {
    if (!isDevMode() || !this.config) return;

    const tabIds = new Set<string>();
    const collectTabIds = (tabs: NestedTabConfig[]) => {
      for (const tab of tabs) {
        tabIds.add(tab.id);
        if (tab.children) collectTabIds(tab.children);
      }
    };
    collectTabIds(this.config.tabs || []);

    const unconsumed = Object.keys(data).filter(
      key =>
        !tabIds.has(key) && // a tab id at the root is the nested container, not a stray field
        data[key] !== undefined &&
        fieldsById.has(key) &&
        !patchedFieldIds.has(key) &&
        !this.warnedUnconsumedKeys.has(key),
    );
    if (!unconsumed.length) return;

    for (const key of unconsumed) this.warnedUnconsumedKeys.add(key);

    const shown = unconsumed.slice(0, 5).join(', ');
    const more = unconsumed.length > 5 ? ` (+${unconsumed.length - 5} more)` : '';
    const plural = unconsumed.length === 1;
    console.warn(
      `[ngx-dynamic-entity] initialData has top-level ${plural ? 'key' : 'keys'} matching ` +
        `${plural ? 'a field that was' : 'fields that were'} not populated: ${shown}${more}. ` +
        `A record is nested by tab id ({ tabId: { fieldId: value } }) unless the tab sets ` +
        `flatData: true. Either nest the value under its tab id, or set flatData: true on ` +
        `the tab holding ${plural ? 'that field' : 'those fields'}.`,
    );
  }

  /** Warn once per key per form instance — patchForm re-runs on every initialData change. */
  private readonly warnedUnconsumedKeys = new Set<string>();

  /** Assemble full nested record from per-tab FormGroups, respecting flatData, refererField & arrays. */
  extractRecord(): Record<string, any> {
    if (!this.form || !this.config) return {};
    let record: Record<string, any> = {};

    const walkTabs = (tabs: NestedTabConfig[]) => {
      for (const tab of tabs) {
        const fieldValBag: Record<string, unknown> = {};
        for (const field of tab.fields || []) {
          const ctrl = this.getControl(field.id, tab.id);
          if (ctrl) {
            fieldValBag[field.id] = ctrl.value;
          }
        }

        setTabData(record, tab.id, fieldValBag, this.config);

        for (const field of tab.fields || []) {
          if (field.refererField) {
            const ctrl = this.getControl(field.id, tab.id);
            if (ctrl) {
              setValueByPath(record, field.refererField, ctrl.value);
            }
          }
        }

        if (tab.children) walkTabs(tab.children);
      }
    };

    walkTabs(this.config.tabs || []);
    record = normalizeArrayStructures(record, this.config);
    return record;
  }

  /**
   * Warns when a rule names a field id that two scopes define.
   *
   * Field ids are unique per scope, so `address` may exist on both Personal Details and Work
   * Details — but a rule carries a bare id and no scope, so it cannot say which one it means.
   * `flattenFormValues` keys by bare id, so one of the two silently wins and the rule reads
   * whichever landed there.
   *
   * `validateConfig({ rules })` catches this statically. The check here remains because
   * consumers that never call the validator still get a signal in development.
   */
  private warnAmbiguousRuleReferences(): void {
    if (!isDevMode() || !this.rules?.length || !this.config) return;

    const ambiguous = ambiguousFieldIds(this.config);
    if (ambiguous.size === 0) return;

    const referenced = new Set<string>();
    for (const rule of this.rules) {
      if (rule.fieldId) referenced.add(rule.fieldId);
      for (const condition of rule.conditions ?? []) {
        if (condition.compareToField) referenced.add(condition.compareToField);
      }
      for (const target of rule.targets ?? []) {
        if (target.type === 'field' && target.id) referenced.add(target.id);
      }
    }

    for (const raw of referenced) {
      const parsed = parseFieldRef(raw);
      if (parsed.kind === 'ref') continue;
      const id = parsed.value;
      const scopes = ambiguous.get(id);
      if (!scopes || DynamicFormComponent.warnedAmbiguousIds.has(id)) continue;
      DynamicFormComponent.warnedAmbiguousIds.add(id);
      console.warn(
        `[ngx-dynamic-entity] A rule references field "${id}", which is defined in ${scopes.join(' and ')}. ` +
          `A bare id cannot say which one is meant, so the rule will read whichever the form finds first. ` +
          `Name it by path instead, as [${scopes[0]}.${id}].`,
      );
    }
  }

  private static readonly warnedAmbiguousIds = new Set<string>();

  /**
   * The value map rules and `showWhen` are evaluated against.
   *
   * Every field appears under two keys: its bare id, and its `refererField` path wrapped in brackets.
   * The bare id is what every config written so far uses and is kept exactly as it was — but
   * ids are unique per scope, so when two scopes define one the last field walked wins and
   * the rule reads whichever that is. `[personal.address]` names one field and cannot be
   * ambiguous, which is why a rule that has to distinguish them uses the ref.
   *
   * Both live in one flat map on purpose: `evaluateFormRules` takes a `Record<string,
   * unknown>` and needs no knowledge of refs at all — the extra keys simply resolve.
   */
  /**
   * Whether a rule result names this field.
   *
   * A rule target is either a bare field id — how every config so far addresses a field — or
   * a bracketed path, which is the only way to name one of two fields that share an id.
   * Both have to match, or a rule written either way would fail to hide what it targeted.
   */
  private namesField(names: ReadonlySet<string>, field: NestedFieldConfig): boolean {
    if (names.has(field.id)) return true;
    const ref = field.refererField ?? this.pathFor(field);
    return ref ? names.has(toRefToken(ref)) : false;
  }

  /** The field's declared path, or the one its position implies when it carries none. */
  private pathFor(field: NestedFieldConfig): string | null {
    const entry = collectFieldScopes(this.config).find(e => e.field === field);
    return entry ? fieldRefFor(entry.scope, field.id) : null;
  }

  private flattenFormValues(): Record<string, any> {
    const out: Record<string, any> = {};
    for (const entry of collectFieldScopes(this.config)) {
      const field = entry.field;
      if (!field?.id) continue;
      const ctrl = this.getControl(field.id, entry.scope.split('.').pop());
      if (!ctrl) continue;
      out[field.id] = ctrl.value;
      out[toRefToken(refOf(field, entry.scope))] = ctrl.value;
    }
    return out;
  }

  private getTabGroup(tabId: string): FormGroup | null {
    const path = getTabPath(this.config?.tabs, tabId);
    if (!path || path.length === 0) return this.form;
    let curr: AbstractControl | null = this.form;
    for (const p of path) {
      if (!curr || !(curr instanceof FormGroup)) return null;
      curr = curr.get(p);
    }
    return curr instanceof FormGroup ? curr : null;
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
    // Readonly targets interpolate `control.value` under OnPush. `detectChanges` on the
    // hosted component flushes that write immediately — `markForCheck` waits for a later
    // tick that a Playwright selection never schedules.
    this.fieldHosts?.forEach(host => host.refresh());
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
        this.getControl(targetId)?.patchValue(value, { emitEvent: false });
      }
    }
  }

  /** Prefer a control declared on the configured target tab; fall back to a top-level control. */
  private resolveTargetControl(autoPatch: AutoPatchConfig, targetId: string): AbstractControl | null {
    const tab = findTab(this.tabs, autoPatch.targetTab);
    const inTargetTab = (tab?.fields ?? []).some(f => f.id === targetId);
    if (tab && !inTargetTab) return null;
    return this.getControl(targetId, autoPatch.targetTab);
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  /**
   * The fields the render filter operates on — a tab's own fields, at every tab depth.
   * Deliberately not `allFields()`: `group` and `array` children are shown or hidden with
   * their parent, and toggling a child's state independently would fight the parent's.
   */
  private tabFields(): NestedFieldConfig[] {
    const out: NestedFieldConfig[] = [];
    const walk = (tabs: NestedTabConfig[] | undefined) => {
      for (const tab of tabs ?? []) {
        out.push(...(tab.fields ?? []));
        walk(tab.children);
      }
    };
    walk(this.config?.tabs);
    return out;
  }

  /**
   * Keep a hidden field's control out of form validity.
   *
   * A field hidden by a rule or a `showWhen` condition is filtered out of the render, but
   * its validators stay attached — so a hidden *required* field holds `form.invalid` true
   * forever, permanently disabling Save with nothing on screen to explain why.
   *
   * Disabling is the fix rather than stripping validators: Angular excludes disabled
   * controls from validity, and the field's own validators survive intact for when it
   * comes back. Values are untouched — `flattenFormValues` and `extractRecord` both read
   * `control.value`, which a disabled control still carries, so rule evaluation and the
   * emitted record see exactly what they saw before. That also keeps this from feeding
   * back on itself: hiding a field cannot change the values the rules are evaluated over.
   *
   * The visibility predicate is the same one `fieldsForActiveTab` filters with, so what is
   * rendered and what counts toward validity cannot drift apart.
   */
  private syncHiddenFieldState(values: Record<string, any>): void {
    if (this.preview) return; // preview freezes the whole form on purpose

    const hiddenByRule = new Set<string>(this.ruleResult().hiddenFields);

    for (const field of this.tabFields()) {
      const ctrl = this.getControl(field.id);
      if (!ctrl) continue;

      const hidden = this.namesField(hiddenByRule, field) || !evaluateFieldVisibility(field, values);

      if (hidden) {
        if (ctrl.enabled) ctrl.disable({ emitEvent: false });
      } else if (ctrl.disabled && !field.disabled) {
        ctrl.enable({ emitEvent: false });
      }
    }
  }

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

  getControl(fieldId: string, currentTabId?: string): AbstractControl | null {
    if (!this.form) return null;

    // A bracketed path names exactly one control, and the form nests by tab exactly as the
    // path does — so `form.get('work.address')` walks straight to it. Anything that names a
    // field can therefore use a path: `showWhen` keys, `patchOnTrue` mappings and `autoPatch`
    // targets, not only rules.
    const parsed = parseFieldRef(fieldId);
    if (parsed.kind === 'ref') return this.form.get(parsed.value);

    if (currentTabId) {
      const tabGrp = this.getTabGroup(currentTabId);
      const ctrl = tabGrp?.get(fieldId);
      if (ctrl) return ctrl;
    }

    const rootCtrl = this.form.get(fieldId);
    if (rootCtrl) return rootCtrl;

    const findInGroup = (group: FormGroup): AbstractControl | null => {
      for (const key of Object.keys(group.controls)) {
        const c = group.controls[key];
        if (key === fieldId) return c;
        if (c instanceof FormGroup) {
          const found = findInGroup(c);
          if (found) return found;
        }
      }
      return null;
    };

    return findInGroup(this.form);
  }

  /**
   * Move focus into the newly shown panel.
   *
   * Activating a tab replaces everything below it while focus stays on the tab button, so a
   * screen-reader or keyboard user is given no indication that the content changed and must
   * tab back through the strip to reach it. Deferred a frame because the panel's contents
   * are rendered by the change detection this call is part of.
   */
  private focusActivePanel(): void {
    if (typeof requestAnimationFrame !== 'function') return;
    requestAnimationFrame(() => this.formPanel?.nativeElement?.focus?.());
  }

  /** Accessible name for the field panel — it is the tabpanel for the active tab. */
  get activeTabLabel(): string {
    const tab = this.activeSubTabConfig ?? this.activeTabConfig;
    return tab ? this.resolveTabLabel(tab) : '';
  }

  /**
   * Why a referenced field is flagged.
   *
   * `hasDrift` was written by the builder and read by nothing at runtime, so a field whose
   * source definition had changed since it was linked looked entirely normal to the person
   * filling the form in.
   */
  driftHint(field: NestedFieldConfig): string {
    const source = field.referencedEntityKey
      ? `"${field.referencedEntityKey}"`
      : 'its source entity';
    return `This field is linked to ${source} and its definition there has changed since it was linked.`;
  }

  resolveTabLabel(tab: NestedTabConfig): string {
    return resolveLabel(tab.label, this.language);
  }

  async submit(): Promise<void> {
    if (!this.canSubmit || this.submitBlocked) {
      this.markAllTouched();
      return;
    }

    const rawData = this.extractRecord();
    let processedData = rawData;

    this.isSaving.set(true);
    try {
      // beforeSave can now abort the save: returning false, or throwing, stops it. Previously
      // its return value simply replaced the payload and the submit proceeded regardless, so
      // a hook that wanted to veto — a server-side check, a confirmation — had no way to.
      const hookKey = `${this.config?.entity}:beforeSave`;
      if (this.hookRegistry.has(hookKey)) {
        const result = await this.hookRegistry.run(hookKey, processedData);
        if (result === false) {
          this.saveRejected.emit({ reason: 'beforeSave returned false' });
          return;
        }
        // Anything else is the payload to submit; `undefined` means "unchanged".
        if (result !== undefined && result !== true) processedData = result;
      }

      this.formSubmit.emit(processedData);
    } catch (err) {
      // A hook that throws aborts the save and reports why, rather than the error escaping
      // into an unhandled rejection with the form left looking as though it saved.
      this.saveRejected.emit({ reason: err instanceof Error ? err.message : String(err), error: err });
    } finally {
      this.isSaving.set(false);
    }
  }

  reset(): void {
    this.form.reset();
    if (this.initialData) this.patchForm(this.initialData);
    const values = this.flattenFormValues();
    this.formValues.set(values);
    this.previousValues = { ...values };
    this.unlockedFields.set(new Set<string>());
    this.formReset.emit();
  }
}
