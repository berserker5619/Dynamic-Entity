import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  Injector,
  Input,
  Output,
  EventEmitter,
  OnChanges,
  OnDestroy,
  OnInit,
  SimpleChange,
  SimpleChanges,
  afterNextRender,
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
import type { AutoPatchConfig, EntityFormConfig, FormRule, NestedFieldConfig, NestedTabConfig } from '@dynamic-entity/core';
import type { FieldScopeEntry } from '@dynamic-entity/core';
import {
  ambiguousFieldIds,
  collectFieldScopes,
  fieldRefFor,
  parseFieldRef,
  refOf,
  toRefToken,
  valuesEqual,
  applyAutoPatch,
  applyPatchOnTrue,
  fieldsUnderTab,
  migrateRecord,
  findTab,
  normalizeConfigOptions,
  resolveLabel,
} from '@dynamic-entity/core';
import { DynamicFieldComponent } from './dynamic-field/dynamic-field.component';
import { FormStructureService } from './form-structure.service';
import { COMMON_MODULES_REGISTRY, RECORD_MIGRATIONS } from '../tokens/injection-tokens';
import { ValidatorRegistryService } from '../services/validator-registry.service';
import { HookRegistryService } from '../services/hook-registry.service';
import { RbacService } from '../services/rbac.service';
import { RulesEvaluationService } from '../services/rules-evaluation.service';
import { EntityRefSelectionService } from '../services/entity-ref-selection.service';
import { UiTextService } from '../services/ui-text.service';
import { ValidationMessagesService } from '../services/validation-messages.service';

/**
 * Grid width per field type, used only under `layout="auto"` and only where the field itself
 * names no `colSpan`.
 *
 * The rule behind the numbers is how much *content* the control holds, not how much room it
 * would happily fill: a date is eight characters and a currency amount is rarely more, so
 * giving either a full row buys nothing but scrolling. Anything that holds a paragraph, a
 * picture, or a form of its own keeps all twelve.
 *
 * A type missing from this table falls back to twelve, which is what an unrecognised custom
 * field type should get: the layout is conservative about controls it knows nothing about.
 */
const AUTO_COL_SPAN: Readonly<Record<string, number>> = {
  text: 6,
  email: 6,
  password: 6,
  number: 4,
  currency: 4,
  date: 4,
  datetime: 4,
  time: 4,
  monthYear: 4,
  dropdown: 6,
  radio: 6,
  multiSelect: 6,
  boolean: 4,
  checkbox: 4,
  'entity-ref': 6,
  // Left at the full width deliberately — textarea, markdown, image, file, group and array
  // each hold something a half-row would crop.
};

/** A field the form will not save, with what is wrong and where to find it. */
export interface InvalidField {
  field: NestedFieldConfig;
  /** The same message the field renders under itself. */
  message: string;
  tabId: string;
  subTabId?: string;
}

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
  // Scoped per form instance: entity-ref selections must not leak between concurrent forms,
  // and the structure service is deliberately per form rather than shared.
  providers: [EntityRefSelectionService, FormStructureService],
  templateUrl: './dynamic-form.component.html',
  /*
   * The grid is structural, so it lives here rather than in the optional stylesheet.
   *
   * `getFieldSpan` writes `grid-column` inline on every slot, and a consumer who never
   * imports `ngx-dynamic-entity/styles.css` still has to get a laid-out form rather than a
   * column of unpositioned divs. That makes this the authoritative copy, and the reason the
   * stylesheet deliberately does not restate it: a component stylesheet is injected after a
   * global one and carries an attribute selector, so a duplicate there would lose every tie
   * and sit in the file looking authoritative while doing nothing.
   *
   * Every value that a design might want to move is read from the same tokens the stylesheet
   * sets, with a fallback for the consumer who imports nothing.
   */
  styles: [
    `
      .ngx-form__panel {
        display: grid;
        grid-template-columns: repeat(12, minmax(0, 1fr));
        gap: var(--ngx-gap, 18px);
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
        border-radius: var(--ngx-radius-sm, 6px);
        cursor: pointer;
        font-size: 14px;
        line-height: 1;
        padding: 4px 6px;
      }
      .ngx-form__lock:hover {
        border-color: var(--ngx-color-border, #d1d5db);
        background: var(--ngx-color-surface-alt, #f9fafb);
      }
      /* Matches the stylesheet's own breakpoint — a 12-column grid is unreadable below it. */
      @media (max-width: 640px) {
        .ngx-form__panel {
          grid-template-columns: minmax(0, 1fr);
        }
        .ngx-form__field-slot {
          grid-column: 1 / -1 !important;
        }
      }
    `,
  ],
})
export class DynamicFormComponent implements OnInit, OnChanges, OnDestroy {
  /** Library chrome, overridable via UI_TEXT. */
  protected readonly ui = inject(UiTextService);
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
  /**
   * How a field with no `colSpan` of its own is sized in the 12-column grid.
   *
   * `stack` — the historic behaviour — gives every such field the full twelve, so a form of
   * eight short text fields renders as an eight-row ladder with two thirds of its width
   * empty. `auto` sizes them by field type instead: a date or a number is half a row, a
   * textarea or a nested group still takes all twelve.
   *
   * An explicit `colSpan` always wins in both modes, so turning `auto` on cannot override a
   * layout somebody authored. The default stays `stack` because changing how existing configs
   * render is not this input's business — opting in is.
   */
  @Input() layout: 'stack' | 'auto' = 'stack';

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
  /** config ⇄ FormGroup: where a value lives. See `FormStructureService`. */
  private readonly structure = inject(FormStructureService);
  /** Resolves what is wrong with a field, for the error summary — see `resolveForField`. */
  private readonly messages = inject(ValidationMessagesService);
  private readonly entityRefSelection = inject(EntityRefSelectionService);
  private readonly commonModulesRegistry = inject(COMMON_MODULES_REGISTRY, { optional: true });
  private readonly migrations = inject(RECORD_MIGRATIONS, { optional: true }) ?? [];
  /** Scopes the field-slot lookup a jump does, so the library never touches global `document`. */
  private readonly host = inject(ElementRef) as ElementRef<HTMLElement>;
  /** Ties `afterNextRender` to this component, so destroying it cancels a pending jump. */
  private readonly injector = inject(Injector);

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
      // No `form.valid` check: the shortcut is the Save button, and pressing Save on an
      // invalid form is what produces the error summary. Guarding here instead meant Ctrl+S
      // on an incomplete form did nothing at all — and unlike the button, a shortcut cannot
      // even look disabled.
      // `void`, not an `await`: a `@HostListener` cannot be async without changing what
      // Angular does with its return value, and `submit()` reports its own failures through
      // `saveRejected`. Nothing here would have anywhere to put a rejection.
      if (!this.readonly && this.canSubmit) void this.submit();
    }
  }

  // ─── Computed ─────────────────────────────────────────────────────────────
  readonly ruleResult = computed(() =>
    this.rulesEvaluation.evaluate(this.rules, this.formValues(), this.baseline(), {
      // The engine reports rather than logs, because it also runs on a server. This is the
      // client's answer: say it once per distinct problem, in dev only. A rule the author
      // half-finished used to throw out of change detection; now it is skipped, and a
      // silently skipped rule is exactly as hard to diagnose as a thrown one.
      onProblem: message => this.warnOnce(message),
    }),
  );

  /** Warned-about rule problems, per component instance — see `warnedAmbiguousIds`. */
  private readonly warnedProblems = new Set<string>();

  private warnOnce(message: string): void {
    if (!isDevMode() || this.warnedProblems.has(message)) return;
    this.warnedProblems.add(message);
    console.warn(`[ngx-dynamic-entity] ${message}`);
  }

  /**
   * Critical fields whose value differs from the session baseline.
   * These drive the deferred `VALUE_CHANGED` banner — a critical edit is announced once,
   * against the value the record had when the session started, not per keystroke.
   */
  readonly changedCriticalFields = computed<NestedFieldConfig[]>(() => {
    const baseline = this.baseline();
    if (!baseline || Object.keys(baseline).length === 0) return [];
    const values = this.formValues();
    return this.allFields().filter(f => f.criticalField && !this.sameValue(values[f.id], baseline[f.id]));
  });

  get tabs(): NestedTabConfig[] {
    return this.config?.tabs || [];
  }

  get visibleTabs(): NestedTabConfig[] {
    return this.tabs.filter(tab => this.isTabVisible(tab));
  }

  private isTabVisible(tab: NestedTabConfig): boolean {
    return this.rulesEvaluation.isTabVisible(this.ruleResult(), tab);
  }

  get activeTabConfig(): NestedTabConfig | null {
    const tabId = this.activeTab();
    if (!tabId) return this.visibleTabs[0] ?? null;
    return findTab(this.tabs, tabId);
  }

  get visibleSubTabs(): NestedTabConfig[] {
    const active = this.activeTabConfig;
    if (!active?.children || active.children.length === 0) return [];
    return active.children.filter(tab => this.isTabVisible(tab));
  }

  get activeSubTabConfig(): NestedTabConfig | null {
    const subTabs = this.visibleSubTabs;
    if (!subTabs.length) return null;
    const subId = this.activeSubTab();
    return subTabs.find(s => s.id === subId) ?? subTabs[0];
  }

  /**
   * The component to mount for the active tab, or `null` if there is nothing to mount.
   *
   * A registry entry may name its component with a **selector string** — `COMMON_MODULES`
   * is a catalogue of names for the builder's picker, and the token's own example showed
   * one. `ngComponentOutlet` mounts a component *type*, so a string reached it and Angular
   * threw an assertion the moment somebody opened that tab. Following the documented shape
   * broke the feature, which is worse than the feature not existing.
   *
   * A string now resolves to nothing renderable and says why, once per module.
   */
  get activeTabModuleComponent(): any | null {
    const active = this.activeSubTabConfig ?? this.activeTabConfig;
    if (!active?.moduleName || !this.commonModulesRegistry) return null;
    const entry = this.commonModulesRegistry.find(m => m.id === active.moduleName || m.component === active.moduleName);
    if (!entry) return null;
    if (typeof entry.component === 'string') {
      this.warnSelectorModule(entry.id, entry.component);
      return null;
    }
    return entry.component;
  }

  /** Warned once per module id, because a getter runs on every change-detection pass. */
  private readonly warnedSelectorModules = new Set<string>();

  private warnSelectorModule(id: string, selector: string): void {
    if (this.warnedSelectorModules.has(id)) return;
    this.warnedSelectorModules.add(id);
    console.warn(
      `[ngx-dynamic-entity] The common module '${id}' is registered with the selector ` +
        `'${selector}' rather than a component class, so there is nothing to mount for its ` +
        `tab. Register the component itself: ` +
        `{ id: '${id}', label: {...}, component: MyComponent }.`,
    );
  }

  get fieldsForActiveTab(): NestedFieldConfig[] {
    const active = this.activeSubTabConfig ?? this.activeTabConfig;
    if (active?.moduleName) return [];
    const rawFields = active ? active.fields || [] : (this.config?.tabs || []).flatMap(t => t.fields || []);
    const currentValues = this.formValues();

    return rawFields.filter(field => this.isFieldVisible(field, currentValues));
  }

  /**
   * Whether a field renders. Precedence lives in `RulesEvaluationService`, which is also
   * what `syncHiddenFieldState` asks — so what is on screen and what counts toward validity
   * cannot drift apart.
   */
  private isFieldVisible(field: NestedFieldConfig, values: Record<string, unknown>): boolean {
    return this.rulesEvaluation.isFieldVisible(this.ruleResult(), field, this.namesOf(field), values);
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

  /**
   * Whether a submit would be refused. The guard `submit()` checks — not the button's state.
   *
   * See `submitDisabled` for why those are no longer the same question.
   */
  get submitBlocked(): boolean {
    return this.form.invalid || this.form.pending || this.hasRuleErrors;
  }

  /**
   * Whether the Save button is unavailable.
   *
   * This used to be `submitBlocked`, so an invalid form greyed Save out — and a greyed button
   * is the worst possible answer to "why can't I save?". It cannot be clicked, so there is no
   * moment at which the form gets to say which field is at fault or which tab it is on; the
   * user is left comparing a disabled button against a form that looks, to them, filled in.
   * On a tabbed form the offending field is usually not even on screen.
   *
   * Save now stays available while the form is merely invalid. Clicking it still saves
   * nothing — `submit()` checks `submitBlocked` and refuses — but the refusal is where the
   * error summary, the tab badges and the jump to the first bad field come from, so pressing
   * Save produces an explanation instead of silence.
   *
   * What is still disabled is what a *retry cannot fix*: a save already in flight, and an
   * async validator whose answer has not come back. Those are moments where the right answer
   * is genuinely "wait", and a button that accepts a click would be lying.
   */
  get submitDisabled(): boolean {
    return this.isSaving() || this.loading || this.form.pending;
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
    const span = field.colSpan ?? (this.layout === 'auto' ? (AUTO_COL_SPAN[field.type] ?? 12) : 12);
    return `span ${Math.min(12, Math.max(1, span))}`;
  }

  // ─── Validation recovery ──────────────────────────────────────────────────

  /**
   * Set by a submit that validation refused, cleared by one that went through.
   *
   * Gates the error summary rather than `form.invalid` doing it: a form opened on an empty
   * required field is invalid from the first render, and leading with a block of red before
   * the user has typed anything is an accusation, not help. The summary is the answer to
   * "why did Save do nothing", so it appears when Save does nothing.
   */
  readonly submitAttempted = signal(false);

  /**
   * Every rendered field whose control is currently invalid, with the tab it lives on.
   *
   * Read by the tab badges, the error summary and the jump, so all three agree on what
   * counts. Hidden fields are excluded because `syncHiddenFieldState` disables them and a
   * disabled control is not part of validity — pointing the user at one would send them to a
   * field that is not on screen, or worse, switch tabs to show them nothing.
   *
   * Cached per change-detection pass. The walk calls `getControl` once per field and that
   * falls back to a recursive search of the whole form; the template reads this three times
   * for the summary and once per tab for the badges, so recomputing it each time turns one
   * traversal into a dozen on every keystroke. `form.statusChanges` is the only thing that
   * can alter the answer, and it already runs `markForCheck` — dropping the cache there keeps
   * it honest without a second subscription.
   */
  invalidFields(): InvalidField[] {
    if (this.invalidFieldsCache) return this.invalidFieldsCache;

    const out: InvalidField[] = [];

    /*
     * Descends into `group` children rather than stopping at the container.
     *
     * A `FormGroup` is invalid whenever any descendant is, so reporting the container said
     * "Contacts is invalid" and left the user to open it and hunt. The offending leaf is
     * both the useful answer and the one `jumpToField` can actually move focus to.
     *
     * An `array` is reported as itself: its rows are built and destroyed at runtime, so
     * there is no configured child to name and nothing stable to jump to.
     */
    const collectField = (field: NestedFieldConfig, tab: NestedTabConfig, parentId?: string) => {
      const control = this.getControl(field.id, tab.id);
      if (!control || control.disabled || control.valid || control.pending) return;

      if (field.type === 'group' && field.children?.length) {
        for (const child of field.children) collectField(child, tab, parentId);
        return;
      }

      // The same message the field renders under itself — see `resolveForField`. Saying
      // only *which* field is wrong leaves the user to go and look at each one; saying what
      // is wrong with it is usually enough to fix it without leaving the summary.
      const message = this.messages.resolveForField(control.errors, this.language, field.type);
      out.push(
        parentId
          ? { field, message, tabId: parentId, subTabId: tab.id }
          : { field, message, tabId: tab.id },
      );
    };

    const collect = (tab: NestedTabConfig, parentId?: string) => {
      for (const field of tab.fields ?? []) collectField(field, tab, parentId);
      for (const child of tab.children ?? []) collect(child, parentId ?? tab.id);
    };
    for (const tab of this.visibleTabs) collect(tab);

    return (this.invalidFieldsCache = out);
  }

  private invalidFieldsCache?: InvalidField[];

  /** How many invalid fields sit on a tab — its own and its sub-tabs'. */
  tabErrorCount(tab: NestedTabConfig): number {
    if (!this.submitAttempted()) return 0;
    return this.invalidFields().filter(entry => entry.tabId === tab.id).length;
  }

  /** The same count for a sub-tab, which is addressed by its own id rather than its parent's. */
  subTabErrorCount(subTab: NestedTabConfig): number {
    if (!this.submitAttempted()) return 0;
    return this.invalidFields().filter(entry => entry.subTabId === subTab.id).length;
  }

  /**
   * Switch to the tab holding `fieldId`, scroll it into view, and move focus onto it.
   *
   * `afterNextRender` rather than a timer: the panel the field lives in is rendered by the
   * change detection this call is part of, so the element does not exist yet — and a timeout
   * is both a guess at how long that takes and something that keeps running after the
   * component is destroyed. The query is scoped to this component's own element, so the
   * library never reaches for the global `document`.
   */
  jumpToField(fieldId: string): void {
    const location = this.invalidFields().find(entry => entry.field.id === fieldId) ?? this.locateField(fieldId);
    if (!location) return;

    // The panel must not take focus back — this jump is going to focus the field itself.
    this.setActiveTab(location.tabId, { focusPanel: false });
    // `setActiveTab` resets to a tab's first child, so the sub-tab is selected after it.
    if (location.subTabId) this.setActiveSubTab(location.subTabId, { focusPanel: false });

    afterNextRender(
      () => {
        // The id comes from config, so it never goes into a selector string: no escaping to
        // get wrong, and no need for `CSS.escape`, which jsdom does not provide.
        const wanted = `field-container-${fieldId}`;
        const el = Array.from(this.host.nativeElement.querySelectorAll<HTMLElement>('[id^="field-container-"]')).find(
          slot => slot.id === wanted,
        );
        if (!el) return;
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        // The slot carries tabindex="-1", so this actually moves focus rather than only
        // scrolling and leaving focus behind on the link that was clicked.
        el.focus();
      },
      { injector: this.injector },
    );
  }

  /**
   * Which tab (and sub-tab) holds a field.
   *
   * Descends into `group`/`array` children: this compared top-level fields only, so "jump to
   * the first invalid field" found nothing for a nested one and silently did nothing. Only
   * sub-tabs one level deep are named, because that is what the tab strip can select —
   * anything deeper resolves to the ancestor it renders under.
   */
  private locateField(fieldId: string): { tabId: string; subTabId?: string } | null {
    const holds = (fields: NestedFieldConfig[] | undefined): boolean =>
      (fields ?? []).some(f => f?.id === fieldId || holds(f?.children));

    const search = (tabs: NestedTabConfig[] | undefined, tabId?: string, subTabId?: string):
      | { tabId: string; subTabId?: string }
      | null => {
      for (const tab of tabs ?? []) {
        if (!tab?.id) continue;
        const at = tabId ?? tab.id;
        const sub = tabId ? (subTabId ?? tab.id) : undefined;
        if (holds(tab.fields)) return sub ? { tabId: at, subTabId: sub } : { tabId: at };
        const found = search(tab.children, at, sub);
        if (found) return found;
      }
      return null;
    };

    return search(this.tabs);
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

  /**
   * A field's label in the form's language, falling back to its id.
   *
   * The fallback matters wherever the label stands alone rather than beside its control: an
   * error-summary chip or a critical-change banner naming a field with no label for this
   * language would otherwise be blank, and a blank chip is worse than a raw id.
   */
  resolveFieldLabel(field: NestedFieldConfig): string {
    return resolveLabel(field.label, this.language) || field.id;
  }

  /**
   * The changed critical fields as one comma-separated string.
   *
   * Joined here rather than looped in the template because the banner is a sentence with the
   * list inside it, and a sentence has to reach `UI_TEXT` whole — a translation moves the
   * list somewhere else in the clause.
   */
  changedCriticalFieldLabels(): string {
    return this.changedCriticalFields()
      .map(field => this.resolveFieldLabel(field))
      .join(', ');
  }

  // ─── Form construction ────────────────────────────────────────────────────

  private buildForm(): void {
    if (!this.config) return;
    this.form = this.structure.buildForm(this.config);
    // A rebuild replaces every control, and the scope index is keyed by config identity.
    this.scopeCache = undefined;
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
    const changes$ =
      this.changeDebounceMs > 0 ? this.form.valueChanges.pipe(debounceTime(this.changeDebounceMs)) : this.form.valueChanges;
    // Validity is not value: an async validator settling flips `pending` and then `invalid`
    // with no value change and no template event, so under OnPush the Save button would
    // never re-enable. submitBlocked reads form.pending and form.invalid, so this is what
    // keeps it honest.
    this.statusSub?.unsubscribe();
    // A rebuild replaces every control, so anything cached against the old ones is stale.
    this.invalidFieldsCache = undefined;
    this.statusSub = this.form.statusChanges.subscribe(() => {
      // The only thing that can change which fields are invalid — see `invalidFields`.
      this.invalidFieldsCache = undefined;
      this.cdr.markForCheck();
    });

    this.valueSub = changes$.subscribe(() => {
      const flattened = this.flattenFormValues();
      this.formValues.set(flattened);
      this.runPatchOnTrue(flattened);
      this.syncHiddenFieldState(flattened);
      this.previousValues = { ...flattened };
      this.formChange.emit(this.extractRecord());
    });
  }

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
    return this.structure.buildArrayRow(field, item);
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
    if (!data || !this.form || !this.config) return;
    const fieldsById = new Map(this.allFields().map(f => [f.id, f]));
    const unconsumed = this.structure.patchForm(this.form, this.config, data, fieldsById);
    this.warnUnconsumedInitialData(unconsumed);
  }

  /**
   * A record is nested by tab id (`{ tabId: { fieldId: value } }`) unless the tab sets
   * `flatData: true`. Handing a flat record to a nested tab finds nothing, so the fields
   * stay empty — with no error and no clue. That silent miss is the most expensive way to
   * lose an hour with this library, so name it in dev builds.
   *
   * Which keys were missed is `FormStructureService`'s answer; warning once per key per form
   * is this component's, because it is the thing that lives as long as the form does.
   */
  private warnUnconsumedInitialData(keys: readonly string[]): void {
    const fresh = keys.filter(key => !this.warnedUnconsumedKeys.has(key));
    if (!fresh.length) return;

    for (const key of fresh) this.warnedUnconsumedKeys.add(key);

    const shown = fresh.slice(0, 5).join(', ');
    const more = fresh.length > 5 ? ` (+${fresh.length - 5} more)` : '';
    const plural = fresh.length === 1;
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
    return this.structure.extractRecord(this.form, this.config);
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
      if (!scopes || this.warnedAmbiguousIds.has(id)) continue;
      this.warnedAmbiguousIds.add(id);
      console.warn(
        `[ngx-dynamic-entity] A rule references field "${id}", which is defined in ${scopes.join(' and ')}. ` +
          `A bare id cannot say which one is meant, so the rule will read whichever the form finds first. ` +
          `Name it by path instead, as [${scopes[0]}.${id}].`,
      );
    }
  }

  /**
   * Ids already warned about, per component instance.
   *
   * This was `private static`, so it was module-global mutable state that nothing ever
   * cleared: under SSR every render of every form in the process accumulated into one set
   * that lived as long as the server did, and the first request to render a config
   * suppressed the warning for every request after it. Per instance, the warning is once per
   * form — which is what "warn once" was meant to mean.
   */
  private readonly warnedAmbiguousIds = new Set<string>();

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
   * Every name a rule may address this field by.
   *
   * A rule target is either a bare field id — how every config so far addresses a field — or
   * a bracketed path, which is the only way to name one of two fields that share an id. Both
   * have to match, or a rule written either way would fail to hide what it targeted.
   *
   * The path comes last, and `syncHiddenFieldState` relies on that: it uses the last entry
   * as the field's address when deciding whether a hidden container already covers it.
   */
  private namesOf(field: NestedFieldConfig): readonly string[] {
    const path = field.refererField ?? this.pathFor(field);
    return path ? [field.id, toRefToken(path)] : [field.id];
  }

  /**
   * The field's dotted address, unbracketed.
   *
   * The positional path rather than an authored `refererField`: this is compared as a prefix
   * to decide whether a hidden container already covers a field, and containment is a fact
   * about where the field *is*. A `refererField` is a binding override — it says where the
   * value goes, not which group renders it.
   */
  private addressOf(field: NestedFieldConfig): string {
    return this.pathFor(field) ?? field.id;
  }

  /** The field's declared path, or the one its position implies when it carries none. */
  private pathFor(field: NestedFieldConfig): string | null {
    const entry = this.scopeEntryFor(field);
    return entry ? fieldRefFor(entry.scope, field.id) : null;
  }

  /**
   * Every field in the config with the scope its value is stored under, cached per config.
   *
   * `collectFieldScopes` walks the whole tree. It was called once per field from `pathFor`,
   * which `namesField` calls, which the render filter calls for every field on the active
   * tab — a quadratic walk on every change-detection pass. Keyed by config identity, so a
   * new config invalidates it without an explicit lifecycle hook to forget.
   */
  private fieldScopes(): FieldScopeEntry[] {
    if (this.scopeCache?.config !== this.config) {
      const entries = collectFieldScopes(this.config);
      this.scopeCache = {
        config: this.config,
        entries,
        byField: new Map(entries.map(entry => [entry.field, entry])),
      };
    }
    return this.scopeCache.entries;
  }

  private scopeEntryFor(field: NestedFieldConfig): FieldScopeEntry | undefined {
    this.fieldScopes();
    return this.scopeCache?.byField.get(field);
  }

  private scopeCache?: {
    config: EntityFormConfig | null | undefined;
    entries: FieldScopeEntry[];
    byField: Map<NestedFieldConfig, FieldScopeEntry>;
  };

  /**
   * The control a scope entry addresses, named by path rather than by bare id.
   *
   * `getControl(field.id)` with no tab falls through to a first-match recursive search of the
   * whole form, so with `address` on two tabs, hiding one disabled the other. The control
   * tree mirrors the scope path exactly — `buildTabControls` nests by tab id and
   * `buildFieldControl` nests a `group` under its own id — so a `[path]` ref resolves through
   * `form.get()` on `getControl`'s first branch and names exactly one control.
   *
   * A field inside an `array` has no static path: its controls live in `FormArray` rows built
   * per row. `form.get()` returns null for those and they are left alone, which is correct —
   * a row's controls are created and destroyed with the row.
   */
  private controlForEntry(entry: FieldScopeEntry): AbstractControl | null {
    return this.getControl(toRefToken(fieldRefFor(entry.scope, entry.field.id)));
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

  /**
   * Prefer a control declared on the configured target tab; fall back to a top-level control.
   *
   * "Declared on the tab" now means anywhere under it, sub-tabs and `group` children
   * included. It meant the tab's own top-level fields only, so an `autoPatch` mapping onto a
   * field inside a group resolved to `null` and copied nothing, silently.
   */
  private resolveTargetControl(autoPatch: AutoPatchConfig, targetId: string): AbstractControl | null {
    const tab = findTab(this.tabs, autoPatch.targetTab);
    if (!tab) return this.getControl(targetId, autoPatch.targetTab);

    const entry = fieldsUnderTab(this.config, autoPatch.targetTab).find(e => {
      if (!e.field?.id) return false;
      const parsed = parseFieldRef(targetId);
      return parsed.kind === 'ref'
        ? fieldRefFor(e.scope, e.field.id) === parsed.value
        : e.field.id === parsed.value;
    });
    if (!entry) return null;
    return this.controlForEntry(entry);
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  /**
   * Keep a hidden field's control out of form validity — see
   * `RulesEvaluationService.syncHiddenFieldState`, which owns the rule and the reasoning.
   *
   * This supplies the three things it cannot know: which fields exist and in what order
   * (`collectFieldScopes`, parent-first), what each one is called, and which control each
   * one addresses.
   */
  private syncHiddenFieldState(values: Record<string, any>): void {
    if (this.preview) return; // preview freezes the whole form on purpose

    this.rulesEvaluation.syncHiddenFieldState(this.fieldScopes(), {
      result: this.ruleResult(),
      values,
      namesOf: field => this.namesOf(field),
      addressOf: field => this.addressOf(field),
      controlFor: entry => this.controlForEntry(entry),
    });
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

  /**
   * Whether a critical field still holds what it held when the session started.
   *
   * The same question `VALUE_CHANGED` asks, so it is answered by the same comparator rather
   * than by a third one. The local version compared objects through `JSON.stringify`, which
   * is key-order sensitive — two serialisers writing the same option in a different key
   * order made the field read as edited — and had its own idea of which values count as
   * empty. `valuesEqual` is order-independent and treats `null` and `undefined` as the same
   * absence; the empty-string case is kept here, because a cleared text input is not an edit.
   */
  private sameValue(a: unknown, b: unknown): boolean {
    const aEmpty = a === null || a === undefined || a === '';
    const bEmpty = b === null || b === undefined || b === '';
    if (aEmpty && bEmpty) return true;
    return valuesEqual(a, b);
  }

  /**
   * Find a control by a bracketed path or a bare field id.
   *
   * Public API, so it stays on the component and delegates — see `FormStructureService`,
   * which owns the resolution rule and is where the behaviour is documented.
   */
  getControl(fieldId: string, currentTabId?: string): AbstractControl | null {
    return this.structure.getControl(this.form, this.config, fieldId, currentTabId);
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
    requestAnimationFrame(() =>
      // `preventScroll` because this focus exists to tell a screen reader the panel changed,
      // not to move the page. The default scrolls the panel into view, which on a short
      // viewport jumps the layout — enough that a Save button below it moves out from under
      // a tap. The panel sits directly beneath the tab strip and is already on screen.
      this.formPanel?.nativeElement?.focus?.({ preventScroll: true }),
    );
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
    const source = field.referencedEntityKey ? `"${field.referencedEntityKey}"` : 'its source entity';
    return `This field is linked to ${source} and its definition there has changed since it was linked.`;
  }

  resolveTabLabel(tab: NestedTabConfig): string {
    return resolveLabel(tab.label, this.language);
  }

  async submit(): Promise<void> {
    if (!this.canSubmit || this.submitBlocked) {
      /*
       * A refused save used to mark every control touched and stop there.
       *
       * On a tabbed form that is indistinguishable from a broken button: the errors appear on
       * whichever tabs hold them, the user is looking at a different one, and nothing on
       * screen changes. Three things fix it, and all three are needed — the summary says how
       * many and which, the tab badges say where, and this jump takes the user to the first.
       */
      this.markAllTouched();
      this.submitAttempted.set(true);
      const first = this.invalidFields()[0];
      if (first) this.jumpToField(first.field.id);
      return;
    }

    // Whatever the last attempt complained about is settled, so the summary goes away.
    this.submitAttempted.set(false);

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
    // Nothing has been attempted against the restored values, so the old complaint is stale.
    this.submitAttempted.set(false);
    this.formReset.emit();
  }
}
