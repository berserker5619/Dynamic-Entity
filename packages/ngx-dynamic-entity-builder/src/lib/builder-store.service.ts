import { Injectable, computed, signal } from '@angular/core';
import type {
  AutoPatchMapping,
  DropdownOption,
  EntityFormConfig,
  EntityPermissions,
  EntityReferenceConfig,
  FormRule,
  NestedFieldConfig,
  NestedTabConfig,
  PatchOnTrueMapping,
  RichFieldType,
} from '@dynamic-entity/core';
import { labelToId } from '@dynamic-entity/core';
import {
  createFieldConfig,
  getFieldTypeMeta,
  humanizeId,
  type FlagValidator,
  type ParamValidator,
} from './field-catalog';
import { deepClone } from './clone';

export interface BuilderProblem {
  level: 'error' | 'warning';
  message: string;
  fieldId?: string;
}

const clone = deepClone;

const ID_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

@Injectable()
export class BuilderStore {
  private readonly _config = signal<EntityFormConfig>(this.emptyConfig());
  private readonly _selectedFieldId = signal<string | null>(null);
  private readonly _activeLanguage = signal<string>('en');
  /** Rules live beside the config: they are persisted per form, not inside `EntityFormConfig`. */
  private readonly _rules = signal<FormRule[]>([]);
  /**
   * Field ids the author owns — set by an explicit rename, or by loading a saved config
   * whose ids are already live data keys. Ids outside this set are still derived from the
   * field's label. Builder-session state, deliberately not part of the exported config.
   */
  private readonly manualIds = new Set<string>();

  readonly config = this._config.asReadonly();
  readonly selectedFieldId = this._selectedFieldId.asReadonly();
  readonly activeLanguage = this._activeLanguage.asReadonly();
  readonly rules = this._rules.asReadonly();

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

    // Ids in a saved config are live data keys — records are already stored under them.
    // Editing a label must never rewrite one, so freeze every id the config arrived with.
    this.manualIds.clear();
    for (const field of this.getAllFields(next.tabs)) this.manualIds.add(field.id);
  }

  reset(entity = ''): void {
    this._config.set(this.emptyConfig(entity));
    this._selectedFieldId.set(null);
    this._rules.set([]);
    this.manualIds.clear();
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

  /**
   * Rename a field explicitly, pinning the id so it is no longer derived from the label.
   *
   * Not reachable from the inspector — the id input is read-only by design. This exists for
   * programmatic callers that must match an id to an existing data key.
   */
  renameField(oldId: string, newId: string): void {
    const trimmed = newId.trim();
    if (!trimmed || trimmed === oldId) return;
    if (this.fields().some(f => f.id === trimmed)) return;
    if (!this.findFieldInTabs(this._config().tabs, oldId)) return;

    this.applyRename(oldId, trimmed);
    this.manualIds.delete(oldId);
    this.manualIds.add(trimmed);
  }

  /** Whether this field's id is pinned (loaded from storage or explicitly renamed). */
  hasManualId(id: string): boolean {
    return this.manualIds.has(id);
  }

  /**
   * Move a field to a new id and repoint every id-based reference in the config at it.
   *
   * Ids are the wiring between fields — rules, cascades, patches and `showWhen` all address
   * fields by id — so a rename that only touches `field.id` silently breaks that wiring.
   * That was survivable while renaming was a rare manual act; label-derived ids make it
   * routine, so the references move with it.
   */
  private applyRename(oldId: string, newId: string): void {
    this.mutate(draft => {
      const field = this.findFieldInTabs(draft.tabs, oldId);
      if (!field) return;
      field.id = newId;

      const walkFields = (fields: NestedFieldConfig[] | undefined) => {
        for (const f of fields ?? []) {
          if (f.showWhen && oldId in f.showWhen) {
            const next: Record<string, unknown> = {};
            // Rebuild in place so condition order survives the rename.
            for (const [key, value] of Object.entries(f.showWhen)) {
              next[key === oldId ? newId : key] = value;
            }
            f.showWhen = next;
          }
          if (f.entityReference?.parentField === oldId) {
            f.entityReference = { ...f.entityReference, parentField: newId };
          }
          if (f.autoPatch) {
            // `source` names a field on the *linked* record, not this config — leave it.
            f.autoPatch = {
              ...f.autoPatch,
              mappings: f.autoPatch.mappings.map(m =>
                m.target === oldId ? { ...m, target: newId } : m,
              ),
            };
          }
          if (f.patchOnTrue) {
            f.patchOnTrue = f.patchOnTrue.map(m => ({
              from: m.from === oldId ? newId : m.from,
              to: m.to === oldId ? newId : m.to,
            }));
          }
          if (f.children?.length) walkFields(f.children);
        }
      };
      const walkTabs = (tabs: NestedTabConfig[] | undefined) => {
        for (const tab of tabs ?? []) {
          walkFields(tab.fields);
          walkTabs(tab.children);
        }
      };
      walkTabs(draft.tabs);
    });

    this._rules.update(rules =>
      rules.map(rule => ({
        ...rule,
        fieldId: rule.fieldId === oldId ? newId : rule.fieldId,
        targets: rule.targets.map(t =>
          t.type === 'field' && t.id === oldId ? { ...t, id: newId } : t,
        ),
      })),
    );

    if (this._selectedFieldId() === oldId) this._selectedFieldId.set(newId);
  }

  removeField(id: string): void {
    this.mutate(draft => {
      for (const tab of draft.tabs) {
        if (tab.fields) {
          tab.fields = tab.fields.filter(f => f.id !== id);
        }
      }
    });
    this.manualIds.delete(id);
    if (this._selectedFieldId() === id) this._selectedFieldId.set(null);
  }

  duplicateField(id: string): string | null {
    // Look the source up by id — not by current selection. The insert below searches by id
    // too, so falling back to the selected field could report a new id while inserting
    // nothing, or duplicate a field the caller never named.
    const source = this.findFieldInTabs(this._config().tabs, id);
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

  /**
   * Set a field's label, and derive the field's id from it: type "Employee Count", get
   * `employeeCount`. The inspector renders the id read-only, so this is the only way a
   * new field's id is set.
   *
   * Two things stop derivation: a config loaded from storage (its ids are live data keys
   * that records are already stored under — see `load`), and an explicit `renameField`
   * call, which remains available to programmatic callers.
   *
   * Only the config's default language drives the id; translating a label must not rename
   * anything.
   */
  setFieldLabel(id: string, language: string, value: string): void {
    this.mutate(draft => {
      const field = this.findFieldInTabs(draft.tabs, id);
      if (field) field.label = { ...field.label, [language]: value };
    });

    if (language !== (this._config().defaultLanguage ?? 'en')) return;
    if (this.manualIds.has(id)) return;

    const derived = labelToId(value);
    if (!derived || derived === id) return;

    this.applyRename(id, this.availableId(derived, id));
  }

  /** `derived`, or `derived_2`, `derived_3`… if another field already holds it. */
  private availableId(derived: string, currentId: string): string {
    const taken = new Set(this.fields().map(f => f.id).filter(fid => fid !== currentId));
    if (!taken.has(derived)) return derived;

    let n = 2;
    while (taken.has(`${derived}_${n}`)) n += 1;
    return `${derived}_${n}`;
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
      const options = field.options ?? [];
      const n = options.length + 1;
      const lang = draft.defaultLanguage ?? 'en';
      options.push({ [lang]: `Option ${n}` });
      field.options = options;
    });
  }

  updateOption(fieldId: string, index: number, patch: any): void {
    if (patch && 'value' in patch) {
      this.setOptionValue(fieldId, index, patch.value);
    }
  }

  setOptionValue(fieldId: string, index: number, value: any): void {
    this.mutate(draft => {
      const field = this.findFieldInTabs(draft.tabs, fieldId);
      if (!field?.options?.[index]) return;
      const existing = field.options[index];
      if (typeof existing === 'object' && 'value' in existing) {
        (existing as { value: any }).value = value;
      } else if (typeof existing === 'object') {
        const lang = draft.defaultLanguage ?? 'en';
        field.options[index] = { value, label: existing as Record<string, string> };
      } else {
        field.options[index] = value;
      }
    });
  }

  setOptionLabel(fieldId: string, index: number, language: string, value: string): void {
    this.mutate(draft => {
      const field = this.findFieldInTabs(draft.tabs, fieldId);
      const option = field?.options?.[index];
      if (!option) return;
      if (typeof option === 'object' && 'label' in option && option.label) {
        (option as { label: Record<string, string> }).label = {
          ...(option as { label: Record<string, string> }).label,
          [language]: value,
        };
      } else if (typeof option === 'object') {
        field.options![index] = { ...(option as Record<string, string>), [language]: value };
      } else {
        field.options![index] = { [language]: value };
      }
    });
  }

  removeOption(fieldId: string, index: number): void {
    this.mutate(draft => {
      const field = this.findFieldInTabs(draft.tabs, fieldId);
      if (!field?.options) return;
      field.options = field.options.filter((_, i) => i !== index);
    });
  }

  // ─── Entity reference / cascade ─────────────────────────────────────────────

  /** Merge a patch into a field's `entityReference` block, keeping it enabled. */
  updateEntityReference(fieldId: string, patch: Partial<EntityReferenceConfig>): void {
    this.mutate(draft => {
      const field = this.findFieldInTabs(draft.tabs, fieldId);
      if (!field) return;
      const next: EntityReferenceConfig = {
        ...(field.entityReference ?? { enabled: true }),
        ...patch,
        enabled: true,
      };
      // Drop keys explicitly cleared to `undefined` so exported configs stay clean.
      for (const key of Object.keys(patch) as (keyof EntityReferenceConfig)[]) {
        if (patch[key] === undefined) delete next[key];
      }
      field.entityReference = next;
    });
  }

  // ─── autoPatch ──────────────────────────────────────────────────────────────

  addAutoPatchMapping(fieldId: string): void {
    this.mutate(draft => {
      const field = this.findFieldInTabs(draft.tabs, fieldId);
      if (!field) return;
      const targetTab = field.autoPatch?.targetTab ?? draft.tabs[0]?.id ?? '';
      const mappings = [...(field.autoPatch?.mappings ?? []), { source: '', target: '' }];
      field.autoPatch = { targetTab, mappings };
    });
  }

  setAutoPatchTargetTab(fieldId: string, targetTab: string): void {
    this.mutate(draft => {
      const field = this.findFieldInTabs(draft.tabs, fieldId);
      if (!field?.autoPatch) return;
      field.autoPatch = { ...field.autoPatch, targetTab };
    });
  }

  updateAutoPatchMapping(fieldId: string, index: number, patch: Partial<AutoPatchMapping>): void {
    this.mutate(draft => {
      const field = this.findFieldInTabs(draft.tabs, fieldId);
      if (!field?.autoPatch?.mappings?.[index]) return;
      field.autoPatch = {
        ...field.autoPatch,
        mappings: field.autoPatch.mappings.map((m, i) => (i === index ? { ...m, ...patch } : m)),
      };
    });
  }

  /** Removing the last mapping drops `autoPatch` entirely — no empty config in the export. */
  removeAutoPatchMapping(fieldId: string, index: number): void {
    this.mutate(draft => {
      const field = this.findFieldInTabs(draft.tabs, fieldId);
      if (!field?.autoPatch) return;
      const mappings = field.autoPatch.mappings.filter((_, i) => i !== index);
      if (mappings.length === 0) delete field.autoPatch;
      else field.autoPatch = { ...field.autoPatch, mappings };
    });
  }

  // ─── patchOnTrue ────────────────────────────────────────────────────────────

  addPatchOnTrueMapping(fieldId: string): void {
    this.mutate(draft => {
      const field = this.findFieldInTabs(draft.tabs, fieldId);
      if (!field) return;
      field.patchOnTrue = [...(field.patchOnTrue ?? []), { from: '', to: '' }];
    });
  }

  updatePatchOnTrueMapping(fieldId: string, index: number, patch: Partial<PatchOnTrueMapping>): void {
    this.mutate(draft => {
      const field = this.findFieldInTabs(draft.tabs, fieldId);
      if (!field?.patchOnTrue?.[index]) return;
      field.patchOnTrue = field.patchOnTrue.map((m, i) => (i === index ? { ...m, ...patch } : m));
    });
  }

  removePatchOnTrueMapping(fieldId: string, index: number): void {
    this.mutate(draft => {
      const field = this.findFieldInTabs(draft.tabs, fieldId);
      if (!field?.patchOnTrue) return;
      const mappings = field.patchOnTrue.filter((_, i) => i !== index);
      if (mappings.length === 0) delete field.patchOnTrue;
      else field.patchOnTrue = mappings;
    });
  }

  // ─── showWhen (static conditional visibility) ───────────────────────────────

  /** Replace a field's `showWhen` map; an empty map removes the condition. */
  setShowWhen(fieldId: string, showWhen: Record<string, unknown> | undefined): void {
    this.mutate(draft => {
      const field = this.findFieldInTabs(draft.tabs, fieldId);
      if (!field) return;
      if (!showWhen || Object.keys(showWhen).length === 0) delete field.showWhen;
      else field.showWhen = showWhen;
    });
  }

  // ─── Rules ──────────────────────────────────────────────────────────────────

  /** Rules for the field currently selected in the inspector. */
  readonly rulesForSelectedField = computed<FormRule[]>(() => {
    const id = this._selectedFieldId();
    if (!id) return [];
    return this._rules().filter(r => r.fieldId === id || r.targets.some(t => t.id === id));
  });

  loadRules(rules: FormRule[]): void {
    this._rules.set(clone(rules));
  }

  addRule(rule: FormRule): string {
    const id = rule.id?.trim() || this.uniqueId('rule', this._rules().map(r => ({ id: r.id ?? '' })));
    this._rules.update(rules => [...rules, { ...clone(rule), id }]);
    return id;
  }

  updateRule(id: string, patch: Partial<FormRule>): void {
    this._rules.update(rules => rules.map(r => (r.id === id ? { ...r, ...clone(patch), id } : r)));
  }

  removeRule(id: string): void {
    this._rules.update(rules => rules.filter(r => r.id !== id));
  }

  toggleRule(id: string, enabled: boolean): void {
    this.updateRule(id, { enabled });
  }

  /** Move a rule in priority order. Priorities are renumbered 1..n so they stay contiguous. */
  moveRule(id: string, direction: -1 | 1): void {
    this._rules.update(rules => {
      const next = [...rules];
      const from = next.findIndex(r => r.id === id);
      if (from === -1) return rules;
      const to = from + direction;
      if (to < 0 || to >= next.length) return rules;
      const [item] = next.splice(from, 1);
      next.splice(to, 0, item);
      return next.map((r, i) => ({ ...r, priority: i + 1 }));
    });
  }

  exportRules(): FormRule[] {
    return clone(this._rules());
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
      const hasLabel = Object.values(labels).some(v => typeof v === 'string' && v.trim());
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
