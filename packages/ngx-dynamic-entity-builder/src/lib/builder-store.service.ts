import { Injectable, computed, signal } from '@angular/core';
import type {
  DropdownOption,
  EntityFormConfig,
  EntityPermissions,
  NestedFieldConfig,
  NestedTabConfig,
  FieldValidators,
  RichFieldType,
} from '@dynamic-entity/core';
import {
  createFieldConfig,
  getFieldTypeMeta,
  humanizeId,
  type FlagValidator,
  type ParamValidator,
} from './field-catalog';

export interface BuilderProblem {
  level: 'error' | 'warning';
  message: string;
  fieldId?: string;
}

function clone<T>(value: T): T {
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value)) as T;
}

const ID_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

@Injectable()
export class BuilderStore {
  private readonly _config = signal<EntityFormConfig>(this.emptyConfig());
  private readonly _selectedFieldId = signal<string | null>(null);
  private readonly _activeLanguage = signal<string>('en');

  readonly config = this._config.asReadonly();
  readonly selectedFieldId = this._selectedFieldId.asReadonly();
  readonly activeLanguage = this._activeLanguage.asReadonly();

  readonly tabs = computed<NestedTabConfig[]>(() => this._config().tabs ?? []);

  readonly fields = computed<NestedFieldConfig[]>(() => {
    return (this._config().tabs ?? []).flatMap(t => t.fields ?? []);
  });

  readonly selectedField = computed<NestedFieldConfig | null>(() => {
    const id = this._selectedFieldId();
    if (!id) return null;
    return this.findFieldInTabs(this._config().tabs, id);
  });

  readonly problems = computed<BuilderProblem[]>(() => this.validate(this._config()));
  readonly errors = computed<BuilderProblem[]>(() =>
    this.problems().filter(p => p.level === 'error'),
  );
  readonly isValid = computed<boolean>(() => this.errors().length === 0);

  // ─── Initialisation ─────────────────────────────────────────────────────────

  load(config: EntityFormConfig): void {
    const next = clone(config);
    next.tabs = next.tabs ?? [];
    if (next.tabs.length === 0) {
      next.tabs = [{ id: 'default', label: { en: 'Default' }, fields: [] }];
    }
    this._config.set(next);
    const firstField = this.getAllFields(next.tabs)[0];
    this._selectedFieldId.set(firstField?.id ?? null);
    this._activeLanguage.set(next.defaultLanguage ?? 'en');
  }

  reset(entity = ''): void {
    this._config.set(this.emptyConfig(entity));
    this._selectedFieldId.set(null);
  }

  private emptyConfig(entity = ''): EntityFormConfig {
    return {
      entity,
      version: 1,
      defaultLanguage: 'en',
      tabs: [],
    };
  }

  // ─── Entity-level settings ──────────────────────────────────────────────────

  setEntityName(entity: string): void {
    this.mutate(draft => {
      draft.entity = entity.trim();
    });
  }

  setDefaultLanguage(language: string): void {
    this.mutate(draft => {
      draft.defaultLanguage = language;
    });
  }

  setMaskData(mask: boolean): void {
    this.mutate(draft => {
      draft.maskData = mask;
    });
  }

  setPermission(action: keyof EntityPermissions, roles: string[]): void {
    this.mutate(draft => {
      const permissions: EntityPermissions = { ...(draft.permissions ?? {}) };
      permissions[action] = roles;
      draft.permissions = permissions;
    });
  }

  setActiveLanguage(language: string): void {
    this._activeLanguage.set(language);
  }

  // ─── Helper Traversal ───────────────────────────────────────────────────────

  private getAllFields(tabs: NestedTabConfig[] = []): NestedFieldConfig[] {
    const list: NestedFieldConfig[] = [];
    for (const t of tabs) {
      if (t.fields) list.push(...t.fields);
      if (t.children) list.push(...this.getAllFields(t.children));
    }
    return list;
  }

  private findFieldInTabs(tabs: NestedTabConfig[] = [], id: string): NestedFieldConfig | null {
    for (const t of tabs) {
      if (t.fields) {
        const found = t.fields.find(f => f.id === id);
        if (found) return found;
      }
      if (t.children) {
        const found = this.findFieldInTabs(t.children, id);
        if (found) return found;
      }
    }
    return null;
  }

  // ─── Field CRUD ─────────────────────────────────────────────────────────────

  addField(type: RichFieldType, targetTabId?: string): string {
    const meta = getFieldTypeMeta(type);
    const prefix = meta?.idPrefix ?? 'field';
    const allFields = this.fields();
    const id = this.uniqueId(prefix, allFields);

    this.mutate(draft => {
      const field = createFieldConfig(type, id, draft.defaultLanguage ?? 'en');
      const targetTab = targetTabId
        ? draft.tabs.find(t => t.id === targetTabId)
        : draft.tabs[0];
      if (targetTab) {
        targetTab.fields = targetTab.fields ?? [];
        targetTab.fields.push(field);
      } else {
        draft.tabs.push({ id: 'main', label: { en: 'Main' }, fields: [field] });
      }
    });
    this._selectedFieldId.set(id);
    return id;
  }

  updateField(id: string, patch: Partial<NestedFieldConfig>): void {
    this.mutate(draft => {
      const field = this.findFieldInTabs(draft.tabs, id);
      if (field) Object.assign(field, patch);
    });
  }

  renameField(oldId: string, newId: string): void {
    const trimmed = newId.trim();
    if (!trimmed || trimmed === oldId) return;
    if (this.fields().some(f => f.id === trimmed)) return;

    this.mutate(draft => {
      const field = this.findFieldInTabs(draft.tabs, oldId);
      if (!field) return;
      field.id = trimmed;
    });
    if (this._selectedFieldId() === oldId) this._selectedFieldId.set(trimmed);
  }

  removeField(id: string): void {
    this.mutate(draft => {
      for (const tab of draft.tabs) {
        if (tab.fields) {
          tab.fields = tab.fields.filter(f => f.id !== id);
        }
      }
    });
    if (this._selectedFieldId() === id) this._selectedFieldId.set(null);
  }

  duplicateField(id: string): string | null {
    const source = this.selectedField() ?? this.findFieldInTabs(this._config().tabs, id);
    if (!source) return null;
    const meta = getFieldTypeMeta(source.type);
    const prefix = meta?.idPrefix ?? 'field';
    const newId = this.uniqueId(prefix, this.fields());

    this.mutate(draft => {
      for (const tab of draft.tabs) {
        const index = (tab.fields ?? []).findIndex(f => f.id === id);
        if (index !== -1) {
          const copy = clone(source);
          copy.id = newId;
          tab.fields!.splice(index + 1, 0, copy);
          break;
        }
      }
    });
    this._selectedFieldId.set(newId);
    return newId;
  }

  moveField(id: string, direction: -1 | 1): void {
    this.mutate(draft => {
      for (const tab of draft.tabs) {
        const fields = tab.fields ?? [];
        const from = fields.findIndex(f => f.id === id);
        if (from !== -1) {
          const to = from + direction;
          if (to < 0 || to >= fields.length) return;
          const [item] = fields.splice(from, 1);
          fields.splice(to, 0, item);
          return;
        }
      }
    });
  }

  /** Safe reorder for drag & drop within active tab or flat list */
  reorderField(fromIndex: number, toIndex: number, tabId?: string): void {
    this.mutate(draft => {
      const targetTab = tabId
        ? draft.tabs.find(t => t.id === tabId)
        : draft.tabs[0];
      const fields = targetTab?.fields ?? [];
      if (
        fromIndex < 0 ||
        toIndex < 0 ||
        fromIndex >= fields.length ||
        toIndex >= fields.length
      ) {
        return;
      }
      const [item] = fields.splice(fromIndex, 1);
      fields.splice(toIndex, 0, item);
    });
  }

  selectField(id: string | null): void {
    this._selectedFieldId.set(id);
  }

  // ─── Localised text ─────────────────────────────────────────────────────────

  setFieldLabel(id: string, language: string, value: string): void {
    this.mutate(draft => {
      const field = this.findFieldInTabs(draft.tabs, id);
      if (field) field.label = { ...field.label, [language]: value };
    });
  }

  setFieldPlaceholder(id: string, language: string, value: string): void {
    this.mutate(draft => {
      const field = this.findFieldInTabs(draft.tabs, id);
      if (!field) return;
      field.placeholder = { ...(field.placeholder ?? {}), [language]: value };
    });
  }

  // ─── Validators ─────────────────────────────────────────────────────────────

  toggleFlagValidator(id: string, validator: FlagValidator, on: boolean): void {
    this.mutate(draft => {
      const field = this.findFieldInTabs(draft.tabs, id);
      if (!field) return;
      field.validators = field.validators ?? {};
      if (validator === 'required') {
        if (on) field.validators.required = true;
        else delete field.validators.required;
      } else if (validator === 'email') {
        if (on) field.validators.pattern = '^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}$';
        else delete field.validators.pattern;
      }
    });
  }

  setParamValidator(id: string, validator: ParamValidator, value: number | null): void {
    this.mutate(draft => {
      const field = this.findFieldInTabs(draft.tabs, id);
      if (!field) return;
      field.validators = field.validators ?? {};
      if (value === null || value === undefined || Number.isNaN(value)) {
        delete field.validators[validator];
      } else {
        field.validators[validator] = value;
      }
    });
  }

  getParamValidator(field: NestedFieldConfig, validator: ParamValidator): number | null {
    const val = field.validators?.[validator];
    return typeof val === 'number' ? val : null;
  }

  hasFlagValidator(field: NestedFieldConfig, validator: FlagValidator): boolean {
    if (validator === 'required') return !!field.validators?.required;
    if (validator === 'email') return !!field.validators?.pattern;
    return false;
  }

  // ─── Options (dropdown / multiSelect / radio) ────────────────────────────────

  addOption(fieldId: string): void {
    this.mutate(draft => {
      const field = this.findFieldInTabs(draft.tabs, fieldId);
      if (!field) return;
      const options = field.options ? [...field.options] : [];
      const n = options.length + 1;
      const lang = draft.defaultLanguage ?? 'en';
      options.push({ value: `option_${n}`, label: { [lang]: `Option ${n}` } });
      field.options = options;
    });
  }

  updateOption(fieldId: string, index: number, patch: Partial<DropdownOption>): void {
    this.mutate(draft => {
      const field = this.findFieldInTabs(draft.tabs, fieldId);
      if (!field?.options?.[index]) return;
      field.options = field.options.map((o, i) => (i === index ? { ...o, ...patch } : o));
    });
  }

  setOptionLabel(fieldId: string, index: number, language: string, value: string): void {
    this.mutate(draft => {
      const field = this.findFieldInTabs(draft.tabs, fieldId);
      const option = field?.options?.[index];
      if (!option) return;
      option.label = { ...option.label, [language]: value };
    });
  }

  removeOption(fieldId: string, index: number): void {
    this.mutate(draft => {
      const field = this.findFieldInTabs(draft.tabs, fieldId);
      if (!field?.options) return;
      field.options = field.options.filter((_, i) => i !== index);
    });
  }

  // ─── Tabs ───────────────────────────────────────────────────────────────────

  addTab(): string {
    const id = this.uniqueId('tab', (this._config().tabs ?? []).map(t => ({ id: t.id })));
    this.mutate(draft => {
      const tabs = draft.tabs ?? (draft.tabs = []);
      const lang = draft.defaultLanguage ?? 'en';
      tabs.push({ id, label: { [lang]: humanizeId(id) }, fields: [] });
    });
    return id;
  }

  updateTab(id: string, patch: Partial<NestedTabConfig>): void {
    this.mutate(draft => {
      const tab = (draft.tabs ?? []).find(t => t.id === id);
      if (tab) Object.assign(tab, patch);
    });
  }

  setTabLabel(id: string, language: string, value: string): void {
    this.mutate(draft => {
      const tab = (draft.tabs ?? []).find(t => t.id === id);
      if (tab) tab.label = { ...tab.label, [language]: value };
    });
  }

  removeTab(id: string): void {
    this.mutate(draft => {
      draft.tabs = (draft.tabs ?? []).filter(t => t.id !== id);
    });
  }

  moveTab(id: string, direction: -1 | 1): void {
    this.mutate(draft => {
      const tabs = draft.tabs ?? [];
      const from = tabs.findIndex(t => t.id === id);
      if (from === -1) return;
      const to = from + direction;
      if (to < 0 || to >= tabs.length) return;
      const [item] = tabs.splice(from, 1);
      tabs.splice(to, 0, item);
    });
  }

  // ─── Export ─────────────────────────────────────────────────────────────────

  exportConfig(): EntityFormConfig {
    return clone(this._config());
  }

  // ─── Internals ──────────────────────────────────────────────────────────────

  private mutate(fn: (draft: EntityFormConfig) => void): void {
    const draft = clone(this._config());
    draft.tabs = draft.tabs ?? [];
    fn(draft);
    this._config.set(draft);
  }

  private uniqueId(prefix: string, existing: { id: string }[]): string {
    const taken = new Set(existing.map(e => e.id));
    let n = 1;
    let candidate = `${prefix}_${n}`;
    while (taken.has(candidate)) {
      n += 1;
      candidate = `${prefix}_${n}`;
    }
    return candidate;
  }

  private validate(config: EntityFormConfig): BuilderProblem[] {
    const problems: BuilderProblem[] = [];

    if (!config.entity || !config.entity.trim()) {
      problems.push({ level: 'error', message: 'Entity name is required.' });
    } else if (!ID_PATTERN.test(config.entity)) {
      problems.push({
        level: 'error',
        message:
          'Entity name must start with a letter or underscore and contain only letters, digits, and underscores.',
      });
    }

    const allFields = this.getAllFields(config.tabs);
    if (allFields.length === 0) {
      problems.push({ level: 'warning', message: 'This entity has no fields yet.' });
    }

    const seen = new Map<string, number>();
    for (const field of allFields) {
      seen.set(field.id, (seen.get(field.id) ?? 0) + 1);

      if (!field.id || !ID_PATTERN.test(field.id)) {
        problems.push({
          level: 'error',
          message: `Field id "${field.id}" is not a valid identifier.`,
          fieldId: field.id,
        });
      }

      const labels = field.label ?? {};
      const hasLabel = Object.values(labels).some(v => v && v.trim());
      if (!hasLabel) {
        problems.push({
          level: 'warning',
          message: `Field "${field.id}" has no label.`,
          fieldId: field.id,
        });
      }

      const meta = getFieldTypeMeta(field.type);
      if (meta?.hasOptions && (!field.options || field.options.length === 0)) {
        problems.push({
          level: 'warning',
          message: `Field "${field.id}" is a ${field.type} but has no options.`,
          fieldId: field.id,
        });
      }
    }

    for (const [id, count] of seen) {
      if (count > 1) {
        problems.push({ level: 'error', message: `Duplicate field id "${id}" (${count}×).`, fieldId: id });
      }
    }

    return problems;
  }
}
