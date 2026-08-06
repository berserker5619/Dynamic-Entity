import { Injectable, computed, signal } from '@angular/core';
import type {
  DropdownOption,
  EntityConfig,
  EntityPermissions,
  FieldConfig,
  TabConfig,
} from '@dynamic-entity/core';
import {
  createFieldConfig,
  getFieldTypeMeta,
  humanizeId,
  type FlagValidator,
  type ParamValidator,
} from './field-catalog';

/** A validation issue surfaced to the UI. Errors block a clean export; warnings do not. */
export interface BuilderProblem {
  level: 'error' | 'warning';
  message: string;
  fieldId?: string;
}

/** Deep clone helper — structuredClone where available, JSON fallback for older runtimes. */
function clone<T>(value: T): T {
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value)) as T;
}

const ID_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * BuilderStore — signal-backed working state for one EntityConfig being authored.
 *
 * Provided at the EntityBuilderComponent level (NOT root) so every builder instance
 * gets an isolated store. All mutations go through the private `mutate()` helper which
 * clones the current config, applies the change to the draft, and re-sets the signal —
 * keeping every emitted config immutable and change-detection friendly.
 */
@Injectable()
export class BuilderStore {
  private readonly _config = signal<EntityConfig>(this.emptyConfig());
  private readonly _selectedFieldId = signal<string | null>(null);
  private readonly _activeLanguage = signal<string>('en');

  /** The current working config (read-only signal). */
  readonly config = this._config.asReadonly();
  readonly selectedFieldId = this._selectedFieldId.asReadonly();
  readonly activeLanguage = this._activeLanguage.asReadonly();

  readonly fields = computed<FieldConfig[]>(() => this._config().fields);
  readonly tabs = computed<TabConfig[]>(() =>
    [...(this._config().tabs ?? [])].sort((a, b) => a.order - b.order),
  );
  readonly selectedField = computed<FieldConfig | null>(() => {
    const id = this._selectedFieldId();
    if (!id) return null;
    return this._config().fields.find(f => f.id === id) ?? null;
  });

  readonly problems = computed<BuilderProblem[]>(() => this.validate(this._config()));
  readonly errors = computed<BuilderProblem[]>(() =>
    this.problems().filter(p => p.level === 'error'),
  );
  readonly isValid = computed<boolean>(() => this.errors().length === 0);

  // ─── Initialisation ─────────────────────────────────────────────────────────

  /** Load an existing config for editing. A deep clone is taken — the input is never mutated. */
  load(config: EntityConfig): void {
    const next = clone(config);
    next.fields = next.fields ?? [];
    next.tabs = next.tabs ?? [];
    this._config.set(next);
    this._selectedFieldId.set(next.fields[0]?.id ?? null);
    this._activeLanguage.set(next.defaultLanguage ?? 'en');
  }

  /** Reset to a blank config for the given entity name. */
  reset(entity = ''): void {
    this._config.set(this.emptyConfig(entity));
    this._selectedFieldId.set(null);
  }

  private emptyConfig(entity = ''): EntityConfig {
    return { entity, version: 1, fields: [], tabs: [], defaultLanguage: 'en' };
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

  /** Set the role list for one RBAC action. Empty array = no restriction. */
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

  // ─── Field CRUD ─────────────────────────────────────────────────────────────

  /** Add a new field of the given type, select it, and return its generated id. */
  addField(type: FieldConfig['type']): string {
    const meta = getFieldTypeMeta(type);
    const prefix = meta?.idPrefix ?? 'field';
    const id = this.uniqueId(prefix, this._config().fields);
    const activeTab = this.tabs()[0]?.id;

    this.mutate(draft => {
      const field = createFieldConfig(type as any, id, draft.defaultLanguage ?? 'en');
      if (activeTab) field.tab = activeTab;
      draft.fields.push(field);
    });
    this._selectedFieldId.set(id);
    return id;
  }

  /** Shallow-merge a patch into a field by id. */
  updateField(id: string, patch: Partial<FieldConfig>): void {
    this.mutate(draft => {
      const field = draft.fields.find(f => f.id === id);
      if (field) Object.assign(field, patch);
    });
  }

  /** Rename a field id, keeping it unique and updating any dependsOn references. */
  renameField(oldId: string, newId: string): void {
    const trimmed = newId.trim();
    if (!trimmed || trimmed === oldId) return;
    // Refuse a collision — validation will also flag it, but never overwrite silently.
    if (this._config().fields.some(f => f.id === trimmed)) return;

    this.mutate(draft => {
      const field = draft.fields.find(f => f.id === oldId);
      if (!field) return;
      field.id = trimmed;
      for (const f of draft.fields) {
        if (f.dependsOn?.field === oldId) f.dependsOn = { ...f.dependsOn, field: trimmed };
      }
    });
    if (this._selectedFieldId() === oldId) this._selectedFieldId.set(trimmed);
  }

  removeField(id: string): void {
    this.mutate(draft => {
      draft.fields = draft.fields.filter(f => f.id !== id);
    });
    if (this._selectedFieldId() === id) this._selectedFieldId.set(null);
  }

  /** Duplicate a field with a fresh unique id, inserted right after the original. */
  duplicateField(id: string): string | null {
    const source = this._config().fields.find(f => f.id === id);
    if (!source) return null;
    const meta = getFieldTypeMeta(source.type);
    const prefix = meta?.idPrefix ?? 'field';
    const newId = this.uniqueId(prefix, this._config().fields);

    this.mutate(draft => {
      const index = draft.fields.findIndex(f => f.id === id);
      const copy = clone(source);
      copy.id = newId;
      draft.fields.splice(index + 1, 0, copy);
    });
    this._selectedFieldId.set(newId);
    return newId;
  }

  /** Move a field one slot up (-1) or down (+1) in order. */
  moveField(id: string, direction: -1 | 1): void {
    this.mutate(draft => {
      const from = draft.fields.findIndex(f => f.id === id);
      if (from === -1) return;
      const to = from + direction;
      if (to < 0 || to >= draft.fields.length) return;
      const [item] = draft.fields.splice(from, 1);
      draft.fields.splice(to, 0, item);
    });
  }

  /** Reorder by absolute indices — used by drag-and-drop. */
  reorderField(fromIndex: number, toIndex: number): void {
    this.mutate(draft => {
      if (
        fromIndex < 0 ||
        toIndex < 0 ||
        fromIndex >= draft.fields.length ||
        toIndex >= draft.fields.length
      ) {
        return;
      }
      const [item] = draft.fields.splice(fromIndex, 1);
      draft.fields.splice(toIndex, 0, item);
    });
  }

  selectField(id: string | null): void {
    this._selectedFieldId.set(id);
  }

  // ─── Localised text ─────────────────────────────────────────────────────────

  setFieldLabel(id: string, language: string, value: string): void {
    this.mutate(draft => {
      const field = draft.fields.find(f => f.id === id);
      if (field) field.label = { ...field.label, [language]: value };
    });
  }

  setFieldPlaceholder(id: string, language: string, value: string): void {
    this.mutate(draft => {
      const field = draft.fields.find(f => f.id === id);
      if (!field) return;
      field.placeholder = { ...(field.placeholder ?? {}), [language]: value };
    });
  }

  // ─── Validators ─────────────────────────────────────────────────────────────

  /** Toggle a no-param validator ('required' | 'email'). */
  toggleFlagValidator(id: string, validator: FlagValidator, on: boolean): void {
    this.mutate(draft => {
      const field = draft.fields.find(f => f.id === id);
      if (!field) return;
      const list = new Set(field.validators ?? []);
      if (on) list.add(validator);
      else list.delete(validator);
      field.validators = [...list];
    });
  }

  /**
   * Set (or clear) a parameterised validator like `min:5`, `maxLength:255`.
   * Pass null/undefined/NaN to remove it.
   */
  setParamValidator(id: string, validator: ParamValidator, value: number | null): void {
    this.mutate(draft => {
      const field = draft.fields.find(f => f.id === id);
      if (!field) return;
      const kept = (field.validators ?? []).filter(v => v.split(':')[0] !== validator);
      if (value !== null && value !== undefined && !Number.isNaN(value)) {
        kept.push(`${validator}:${value}`);
      }
      field.validators = kept;
    });
  }

  /** Read back the numeric parameter of a param validator, or null if unset. */
  getParamValidator(field: FieldConfig, validator: ParamValidator): number | null {
    const entry = (field.validators ?? []).find(v => v.split(':')[0] === validator);
    if (!entry) return null;
    const n = Number(entry.split(':')[1]);
    return Number.isNaN(n) ? null : n;
  }

  hasFlagValidator(field: FieldConfig, validator: FlagValidator): boolean {
    return (field.validators ?? []).includes(validator);
  }

  // ─── Options (dropdown / multiSelect) ───────────────────────────────────────

  addOption(fieldId: string): void {
    this.mutate(draft => {
      const field = draft.fields.find(f => f.id === fieldId);
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
      const field = draft.fields.find(f => f.id === fieldId);
      if (!field?.options?.[index]) return;
      field.options = field.options.map((o, i) => (i === index ? { ...o, ...patch } : o));
    });
  }

  setOptionLabel(fieldId: string, index: number, language: string, value: string): void {
    this.mutate(draft => {
      const field = draft.fields.find(f => f.id === fieldId);
      const option = field?.options?.[index];
      if (!option) return;
      option.label = { ...option.label, [language]: value };
    });
  }

  removeOption(fieldId: string, index: number): void {
    this.mutate(draft => {
      const field = draft.fields.find(f => f.id === fieldId);
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
      const order = tabs.reduce((max, t) => Math.max(max, t.order), -1) + 1;
      tabs.push({ id, label: { [lang]: humanizeId(id) }, order });
    });
    return id;
  }

  updateTab(id: string, patch: Partial<TabConfig>): void {
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

  /** Remove a tab and unassign any fields that pointed at it. */
  removeTab(id: string): void {
    this.mutate(draft => {
      draft.tabs = (draft.tabs ?? []).filter(t => t.id !== id);
      for (const f of draft.fields) {
        if (f.tab === id) delete f.tab;
      }
    });
  }

  moveTab(id: string, direction: -1 | 1): void {
    this.mutate(draft => {
      const ordered = [...(draft.tabs ?? [])].sort((a, b) => a.order - b.order);
      const from = ordered.findIndex(t => t.id === id);
      if (from === -1) return;
      const to = from + direction;
      if (to < 0 || to >= ordered.length) return;
      const [item] = ordered.splice(from, 1);
      ordered.splice(to, 0, item);
      ordered.forEach((t, i) => (t.order = i));
      draft.tabs = ordered;
    });
  }

  assignFieldToTab(fieldId: string, tabId: string | null): void {
    this.mutate(draft => {
      const field = draft.fields.find(f => f.id === fieldId);
      if (!field) return;
      if (tabId) field.tab = tabId;
      else delete field.tab;
    });
  }

  // ─── Export ─────────────────────────────────────────────────────────────────

  /** Return a clean, deep-cloned copy of the config suitable for saving. */
  exportConfig(): EntityConfig {
    return clone(this._config());
  }

  // ─── Internals ──────────────────────────────────────────────────────────────

  private mutate(fn: (draft: EntityConfig) => void): void {
    const draft = clone(this._config());
    draft.fields = draft.fields ?? [];
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

  private validate(config: EntityConfig): BuilderProblem[] {
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

    const fields = config.fields ?? [];
    if (fields.length === 0) {
      problems.push({ level: 'warning', message: 'This entity has no fields yet.' });
    }

    const seen = new Map<string, number>();
    for (const field of fields) {
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
      if (meta?.isEntityRef && !field.component && !field.id) {
        problems.push({
          level: 'warning',
          message: `Entity-ref field "${field.id}" has no registry key set.`,
          fieldId: field.id,
        });
      }
      if (field.tab && !(config.tabs ?? []).some(t => t.id === field.tab)) {
        problems.push({
          level: 'error',
          message: `Field "${field.id}" references unknown tab "${field.tab}".`,
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
