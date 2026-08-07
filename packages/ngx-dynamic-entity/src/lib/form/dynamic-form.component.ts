import {
  Component,
  Input,
  Output,
  EventEmitter,
  OnChanges,
  SimpleChanges,
  signal,
  computed,
  inject,
  HostListener,
} from '@angular/core';
import { AbstractControl, FormArray, FormBuilder, FormGroup, ReactiveFormsModule } from '@angular/forms';
import type { EntityFormConfig, FormRule, NestedFieldConfig, NestedTabConfig } from '@dynamic-entity/core';
import { evaluateFieldVisibility, findTab, resolveLabel } from '@dynamic-entity/core';
import { DynamicFieldComponent } from './dynamic-field/dynamic-field.component';
import { ValidatorRegistryService } from '../services/validator-registry.service';
import { HookRegistryService } from '../services/hook-registry.service';
import { RbacService } from '../services/rbac.service';
import { RulesEvaluationService } from '../services/rules-evaluation.service';

/**
 * DynamicFormComponent — the main form component.
 * Renders a reactive form from EntityFormConfig with tab support, responsive 12-col grid,
 * rules evaluation, keyboard shortcuts (Ctrl+S, Esc), and RBAC-gated submission.
 */
@Component({
  selector: 'ngx-dynamic-form',
  standalone: true,
  imports: [ReactiveFormsModule, DynamicFieldComponent],
  templateUrl: './dynamic-form.component.html',
  styles: [
    `
      .ngx-form__panel {
        display: grid;
        grid-template-columns: repeat(12, minmax(0, 1fr));
        gap: 16px 20px;
        align-items: start;
      }
      @media (max-width: 768px) {
        .ngx-form__panel {
          grid-template-columns: 1fr;
        }
        ngx-dynamic-field {
          grid-column: span 12 !important;
        }
      }
    `,
  ],
})
export class DynamicFormComponent implements OnChanges {
  // ─── Inputs ───────────────────────────────────────────────────────────────
  @Input() config!: EntityFormConfig;
  @Input() rules?: FormRule[];
  @Input() initialData?: Record<string, any>;
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

  protected readonly Object = Object;

  // ─── Signals (local reactive state) ───────────────────────────────────────
  readonly activeTab = signal<string>('');
  readonly isSaving = signal(false);
  readonly formValues = signal<Record<string, any>>({});

  // ─── Form ─────────────────────────────────────────────────────────────────
  form!: FormGroup;

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
    this.rulesEvaluation.evaluate(this.rules, this.formValues(), this.originalData),
  );

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

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['config'] || changes['initialData']) {
      this.buildForm();
      if (this.visibleTabs.length > 0 && !this.activeTab()) {
        this.activeTab.set(this.visibleTabs[0].id);
      }
    }
  }

  setActiveTab(tabId: string): void {
    this.activeTab.set(tabId);
  }

  getFieldSpan(field: NestedFieldConfig): string {
    const span = field.colSpan ?? 12;
    return `span ${Math.min(12, Math.max(1, span))}`;
  }

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

    this.formValues.set(this.form.value || {});
    this.form.valueChanges.subscribe(val => {
      this.formValues.set(val || {});
      this.formChange.emit(val);
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
      group[field.id] = this.fb.control({ value: null, disabled: field.disabled ?? false }, validators);
    }
  }

  private patchForm(data: Record<string, any>): void {
    for (const [key, val] of Object.entries(data)) {
      const ctrl = this.form.get(key);
      if (!ctrl) continue;
      if (ctrl instanceof FormArray && Array.isArray(val)) {
        ctrl.clear();
        for (const item of val) {
          ctrl.push(this.fb.control(item));
        }
      } else {
        ctrl.patchValue(val, { emitEvent: false });
      }
    }
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
    this.formValues.set(this.form.value || {});
    this.formReset.emit();
  }
}
