import {
  Component,
  Input,
  Output,
  EventEmitter,
  OnChanges,
  SimpleChanges,
  signal,
  inject,
} from '@angular/core';
import { AbstractControl, FormArray, FormBuilder, FormGroup, ReactiveFormsModule } from '@angular/forms';
import type { EntityFormConfig, NestedFieldConfig, NestedTabConfig } from '@dynamic-entity/core';
import { findTab, resolveLabel } from '@dynamic-entity/core';
import { DynamicFieldComponent } from './dynamic-field/dynamic-field.component';
import { ValidatorRegistryService } from '../services/validator-registry.service';
import { HookRegistryService } from '../services/hook-registry.service';
import { VersionService } from '../services/version.service';
import { RbacService } from '../services/rbac.service';

/**
 * DynamicFormComponent — the main form component.
 * Renders a reactive form from EntityFormConfig with tab support, nested fields,
 * migration banner, and RBAC-gated submission.
 */
@Component({
  selector: 'ngx-dynamic-form',
  standalone: true,
  imports: [ReactiveFormsModule, DynamicFieldComponent],
  templateUrl: './dynamic-form.component.html',
})
export class DynamicFormComponent implements OnChanges {
  // ─── Inputs ───────────────────────────────────────────────────────────────
  @Input() config!: EntityFormConfig;
  @Input() initialData?: Record<string, any>;
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
  protected readonly versionService = inject(VersionService);
  private readonly rbacService = inject(RbacService);

  // ─── Signals (local reactive state) ───────────────────────────────────────
  readonly activeTab = signal<string>('');
  readonly isSaving = signal(false);

  // ─── Form ─────────────────────────────────────────────────────────────────
  form!: FormGroup;

  // ─── Computed ─────────────────────────────────────────────────────────────
  get tabs(): NestedTabConfig[] {
    return this.config?.tabs || [];
  }

  get activeTabConfig(): NestedTabConfig | null {
    const tabId = this.activeTab();
    if (!tabId) return this.tabs[0] ?? null;
    return findTab(this.tabs, tabId);
  }

  get fieldsForActiveTab(): NestedFieldConfig[] {
    const active = this.activeTabConfig;
    if (active) return active.fields || [];
    // If no tabs defined, flatten all fields across tabs
    return (this.config?.tabs || []).flatMap(t => t.fields || []);
  }

  get permissions() {
    return this.rbacService.getPermissions(this.config, this.userRoles);
  }

  get needsMigration(): boolean {
    return this.versionService.needsMigration(this.initialData || {}, this.config);
  }

  get canSubmit(): boolean {
    return (
      this.permissions.canEdit &&
      !this.readonly &&
      !this.isSaving() &&
      !this.versionService.shouldBlockSubmit(this.initialData || {}, this.config)
    );
  }

  resolveTabLabel(tab: NestedTabConfig): string {
    return resolveLabel(tab.label, this.language);
  }

  // ─── Lifecycle ────────────────────────────────────────────────────────────

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['config'] && this.config) {
      this.buildForm();
    }
    if (changes['initialData'] && this.form && this.initialData) {
      this.patchForm(this.initialData);
    }
    if (changes['config'] && this.tabs.length) {
      this.activeTab.set(this.tabs[0]?.id || '');
    }
  }

  private getAllFields(tabs: NestedTabConfig[] = []): NestedFieldConfig[] {
    const result: NestedFieldConfig[] = [];
    for (const tab of tabs) {
      if (tab.fields) result.push(...tab.fields);
      if (tab.children) result.push(...this.getAllFields(tab.children));
    }
    return result;
  }

  private buildFieldControl(field: NestedFieldConfig): AbstractControl {
    const validators = this.validatorRegistry.resolveFromConfig(field.validators);
    if (field.type === 'group') {
      const controls: Record<string, AbstractControl> = {};
      for (const child of field.children ?? []) {
        controls[child.id] = this.buildFieldControl(child);
      }
      return this.fb.group(controls);
    }
    if (field.type === 'array') {
      return this.fb.array([]);
    }
    return this.fb.control(field.defaultValue ?? null, validators);
  }

  private buildForm(): void {
    const controls: Record<string, AbstractControl> = {};
    const allFields = this.getAllFields(this.config?.tabs);

    for (const field of allFields) {
      if (field.systemDefault) continue;
      controls[field.id] = this.buildFieldControl(field);
    }
    this.form = this.fb.group(controls);

    this.form.valueChanges.subscribe(value => this.formChange.emit(value));

    if (this.initialData) {
      this.patchForm(this.initialData);
    }

    if (this.tabs.length && !this.activeTab()) {
      this.activeTab.set(this.tabs[0].id);
    }
  }

  private patchForm(data: Record<string, any>): void {
    const allFields = this.getAllFields(this.config?.tabs);
    this.patchFormGroup(this.form, allFields, data);
  }

  private patchFormGroup(group: FormGroup, fields: NestedFieldConfig[], data: Record<string, any>): void {
    if (!data) return;
    fields.forEach(field => {
      const control = group.get(field.id);
      if (!control) return;

      if (field.type === 'group' && field.children) {
        this.patchFormGroup(control as FormGroup, field.children, data[field.id] ?? {});
      } else if (field.type === 'array' && field.children) {
        const arrayData = data[field.id];
        if (Array.isArray(arrayData)) {
          const fa = control as FormArray;
          fa.clear();
          arrayData.forEach(item => {
            const itemControls: Record<string, AbstractControl> = {};
            for (const child of field.children!) {
              itemControls[child.id] = this.buildFieldControl(child);
            }
            const itemGroup = this.fb.group(itemControls);
            this.patchFormGroup(itemGroup, field.children!, item);
            fa.push(itemGroup);
          });
        }
      } else {
        const val = data[field.id];
        if (val !== undefined) control.patchValue(val, { emitEvent: false });
      }
    });
  }

  // ─── Actions ──────────────────────────────────────────────────────────────

  setActiveTab(tabId: string): void {
    this.activeTab.set(tabId);
  }

  async submit(): Promise<void> {
    if (!this.canSubmit || this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    if (this.isSaving()) return;
    this.isSaving.set(true);

    try {
      let data = { ...this.form.value };

      data = await this.hookRegistry.run(`${this.config.entity}:beforeSave`, data, {
        config: this.config,
        userRoles: this.userRoles,
      });

      this.formSubmit.emit(data);
    } finally {
      this.isSaving.set(false);
    }
  }

  reset(): void {
    this.form.reset();
    if (this.initialData) this.patchForm(this.initialData);
    this.formReset.emit();
  }

  getControl(fieldId: string) {
    return this.form?.get(fieldId);
  }
}
