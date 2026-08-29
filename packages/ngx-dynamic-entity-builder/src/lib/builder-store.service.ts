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
import { findTab, labelToId, normalizeConfigOptions, computeFieldDrift, createFieldSnapshot } from '@dynamic-entity/core';
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

/** One tab's own fields, for a canvas that has to reorder within the right tab. */
export interface BuilderFieldGroup {
  tabId: string;
  label: NestedTabConfig['label'];
  fields: NestedFieldConfig[];
}

const clone = deepClone;

const ID_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * The regex the builder used to write into `pattern` to mean "email".
 *
 * Retained only to recognise configs authored before `FieldValidators.email` existed, so
 * they still show Email as ticked and do not leave a stray pattern behind when it is
 * un-ticked. Nothing writes it any more.
 */
const LEGACY_EMAIL_PATTERN = '^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}$';

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

  private readonly _isDirty = signal<boolean>(false);

  /**
   * Roles of the person using the builder — distinct from `availableRoles`, which is the
   * vocabulary a schema may reference. Needed so the SYSTEM_DEFAULT_CAN_EDIT predicate can
   * be asked a real question; it was previously called with a hardcoded empty array, which
   * made any role-checking predicate answer false for everyone.
   */
  private readonly _userRoles = signal<string[]>([]);

  readonly config = this._config.asReadonly();
  readonly selectedFieldId = this._selectedFieldId.asReadonly();
  readonly activeLanguage = this._activeLanguage.asReadonly();
  readonly rules = this._rules.asReadonly();
  readonly isDirty = this._isDirty.asReadonly();
  readonly userRoles = this._userRoles.asReadonly();

  readonly tabs = computed<NestedTabConfig[]>(() => this._config().tabs ?? []);

  /**
   * Every field the config declares, sub-tabs included.
   *
   * This used to stop at top-level tabs, which quietly broke three things at once: nine of
   * `insuranceClaims`'s twenty-eight fields never appeared on the canvas, the entity-reference
   * picker could not offer a nested field as a source, and the drift check looked a nested
   * field up here, got nothing, and returned without checking. The store's structural
   * operations already walked the whole tree — only this view did not.
   *
   * It deliberately does not descend into a field's own `children`: `group` and `array`
   * children are rendered by the row that owns them, not as rows of their own.
   */
  readonly fields = computed<NestedFieldConfig[]>(() =>
    this.getAllFields(this._config().tabs ?? []),
  );

  /**
   * The same fields, kept in their owning tab.
   *
   * Drag-and-drop reorders by index, so the canvas needs to know which tab an index belongs
   * to — `reorderField` has always taken a `tabId` for exactly this, and the canvas simply
   * never passed one. Without the grouping a drag on any config with more than one tab
   * reordered `tabs[0]` regardless of what was actually dragged.
   */
  readonly fieldGroups = computed<BuilderFieldGroup[]>(() =>
    this.flattenTabs(this._config().tabs ?? [])
      .filter(tab => (tab.fields ?? []).length > 0)
      .map(tab => ({ tabId: tab.id, label: tab.label, fields: tab.fields ?? [] })),
  );

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
    // Check if any fields carry both inline options and listName before normalizing options
    const fieldsWithBoth = this.getAllFields(config.tabs ?? []).filter(
      f => Array.isArray(f.options) && f.options.length > 0 && typeof f.listName === 'string' && f.listName.trim() !== '',
    );
    for (const f of fieldsWithBoth) {
      console.warn(
        `[BuilderStore] Field "${f.id}" carries both inline options and listName "${f.listName}". ` +
          `Inline options win; listName was dropped.`,
      );
    }

    // The other boundary where a config enters the library (the renderer's ngOnChanges is
    // the first). Authoring must start from the canonical option shape, or the builder
    // would round-trip a legacy config straight back out unchanged.
    const next = clone(normalizeConfigOptions(config));
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
    this._isDirty.set(false);
  }

  reset(entity = ''): void {
    this._config.set(this.emptyConfig(entity));
    this._selectedFieldId.set(null);
    this._rules.set([]);
    this.manualIds.clear();
    this._isDirty.set(false);
  }

  resetDirty(): void {
    this._isDirty.set(false);
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

  /** Roles of the person using the builder, for SYSTEM_DEFAULT_CAN_EDIT. */
  setUserRoles(roles: string[]): void {
    this._userRoles.set(roles ?? []);
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

  /**
   * Every tab in the tree, flattened.
   *
   * The structural operations below used to iterate `draft.tabs` directly, which is only
   * the top level. A field on a sub-tab could be selected and edited but never removed,
   * duplicated, moved or reordered — the builder could author nested configs it was then
   * unable to restructure, which is the worst possible state for an authoring tool.
   */
  private flattenTabs(tabs: NestedTabConfig[] = []): NestedTabConfig[] {
    const list: NestedTabConfig[] = [];
    for (const t of tabs) {
      list.push(t);
      if (t.children) list.push(...this.flattenTabs(t.children));
    }
    return list;
  }

  /**
   * Every field id in the config, including `group`/`array` children.
   *
   * Id uniqueness is a whole-config invariant, not a per-tab one: rules, `showWhen`
   * conditions and `autoPatch` mappings all address fields by bare id, so two fields
   * sharing an id anywhere in the tree interfere with each other. Uniqueness checks must
   * therefore see deeper than `fields()`, which stops at a tab's own fields.
   */
  private allFieldIds(tabs: NestedTabConfig[] = []): Set<string> {
    const ids = new Set<string>();
    const walkFields = (fields: NestedFieldConfig[] | undefined) => {
      for (const f of fields ?? []) {
        ids.add(f.id);
        if (f.children?.length) walkFields(f.children);
      }
    };
    for (const tab of this.flattenTabs(tabs)) walkFields(tab.fields);
    return ids;
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
    const id = this.uniqueId(prefix, this.allFieldIds(this._config().tabs));

    this.mutate(draft => {
      const field = createFieldConfig(type, id, draft.defaultLanguage ?? 'en');
      const targetTab = targetTabId
        ? this.flattenTabs(draft.tabs).find(t => t.id === targetTabId)
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
    if (this.allFieldIds(this._config().tabs).has(trimmed)) return;
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
      for (const tab of this.flattenTabs(draft.tabs)) {
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
    const newId = this.uniqueId(prefix, this.allFieldIds(this._config().tabs));

    this.mutate(draft => {
      for (const tab of this.flattenTabs(draft.tabs)) {
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
      for (const tab of this.flattenTabs(draft.tabs)) {
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
        ? this.flattenTabs(draft.tabs).find(t => t.id === tabId)
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
    // Bound to a keystroke event, so this uses the structural-sharing path.
    this.mutateField(id, field => ({ ...field, label: { ...field.label, [language]: value } }));

    if (language !== (this._config().defaultLanguage ?? 'en')) return;
    if (this.manualIds.has(id)) return;

    const derived = labelToId(value);
    if (!derived || derived === id) return;

    this.applyRename(id, this.availableId(derived, id));
  }

  /** `derived`, or `derived_2`, `derived_3`… if another field already holds it. */
  private availableId(derived: string, currentId: string): string {
    const taken = new Set([...this.allFieldIds(this._config().tabs)].filter(fid => fid !== currentId));
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
        // Writes its own flag, not `pattern`. Sharing `pattern` meant a field could not have
        // both an email check and a custom regex, setting a custom pattern made the Email box
        // appear ticked, and un-ticking Email deleted whatever pattern the author had written.
        if (on) field.validators.email = true;
        else delete field.validators.email;
        // Clear the legacy encoding either way, so a config touched here stops carrying both.
        if (field.validators.pattern === LEGACY_EMAIL_PATTERN) delete field.validators.pattern;
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
    if (validator === 'email') {
      // This used to report *any* pattern as email, so writing a custom regex silently
      // ticked the box. The legacy encoding is still recognised so a config authored by the
      // old builder keeps showing Email as ticked.
      return !!field.validators?.email || field.validators?.pattern === LEGACY_EMAIL_PATTERN;
    }
    return false;
  }

  // ─── Options (dropdown / multiSelect / radio) ────────────────────────────────

  /**
   * Where a choice field's options come from.
   *
   * `entity` is absent on purpose: in this model an entity reference is a field *type*
   * (`entity-ref`), not a data source a dropdown can switch to, so offering it here would mean
   * mutating the field's type — and rebuilding its control — from a source picker. The
   * exclusion that matters within a choice field is inline `options` vs `listName`.
   */
  fieldDataSource(field: NestedFieldConfig | undefined): 'none' | 'manual' | 'lookup' {
    if (!field) return 'none';
    // Presence, not emptiness: a source the author has picked but not filled in yet — no
    // options authored, no list name typed — must still read as that source, or the editor
    // for it disappears the moment they select it.
    if (Array.isArray(field.options)) return 'manual';
    if (typeof field.listName === 'string') return 'lookup';
    return 'none';
  }

  /**
   * Switch a choice field's data source, clearing the one it is leaving.
   *
   * The reference makes these mutually exclusive (doc §4.4) and it has to stay that way here:
   * `optionsFor` resolves inline options first, so a field left holding both would silently
   * ignore its list.
   */
  setFieldDataSource(fieldId: string, source: 'none' | 'manual' | 'lookup'): void {
    this.mutate(draft => {
      const field = this.findFieldInTabs(draft.tabs, fieldId);
      if (!field) return;
      if (source === 'manual') {
        delete field.listName;
        field.options = field.options?.length ? field.options : [];
      } else if (source === 'lookup') {
        delete field.options;
        field.listName = field.listName ?? '';
      } else {
        delete field.options;
        delete field.listName;
      }
    });
  }

  /** Set the named list a choice field reads its options from. */
  setListName(fieldId: string, listName: string): void {
    this.mutate(draft => {
      const field = this.findFieldInTabs(draft.tabs, fieldId);
      if (!field) return;
      const trimmed = listName.trim();
      if (trimmed) {
        field.listName = trimmed;
        // Belt and braces: inline options would win over the list at render time.
        delete field.options;
      } else {
        field.listName = '';
      }
    });
  }

  /** Link a field to a field defined in another entity configuration (Phase 8). */
  linkReferencedField(fieldId: string, sourceEntityKey: string, sourceField: NestedFieldConfig): void {
    this.mutate(draft => {
      const field = this.findFieldInTabs(draft.tabs, fieldId);
      if (!field) return;
      field.isReferenced = true;
      field.referencedEntityKey = sourceEntityKey;
      field.referencedFieldId = sourceField.id;
      field.referencedSnapshot = createFieldSnapshot(sourceField);
      field.hasDrift = false;
      // Copy label, type, validators, options from source
      if (sourceField.label) field.label = clone(sourceField.label);
      if (sourceField.type) field.type = sourceField.type;
      if (sourceField.validators) field.validators = clone(sourceField.validators);
      if (sourceField.options) field.options = clone(sourceField.options);
    });
  }

  /** Unlink a referenced field back to an independent field. */
  unlinkReferencedField(fieldId: string): void {
    this.mutate(draft => {
      const field = this.findFieldInTabs(draft.tabs, fieldId);
      if (!field) return;
      delete field.isReferenced;
      delete field.referencedEntityKey;
      delete field.referencedFieldId;
      delete field.referencedSnapshot;
      delete field.hasDrift;
    });
  }

  /** Sync a drifted referenced field with the updated source field definition. */
  syncReferencedField(fieldId: string, currentSourceField: NestedFieldConfig): void {
    this.mutate(draft => {
      const field = this.findFieldInTabs(draft.tabs, fieldId);
      if (!field || !field.isReferenced) return;
      field.referencedSnapshot = createFieldSnapshot(currentSourceField);
      field.hasDrift = false;
      if (currentSourceField.label) field.label = clone(currentSourceField.label);
      if (currentSourceField.type) field.type = currentSourceField.type;
      if (currentSourceField.validators) field.validators = clone(currentSourceField.validators);
      if (currentSourceField.options) field.options = clone(currentSourceField.options);
    });
  }

  /** Scan all referenced fields in the config and update their hasDrift state against current source configs. */
  checkDrift(sourceConfigs: Record<string, EntityFormConfig>): void {
    this.mutate(draft => {
      const scanFields = (fields: NestedFieldConfig[]) => {
        for (const f of fields) {
          if (f.isReferenced && f.referencedEntityKey && f.referencedFieldId) {
            const sourceConfig = sourceConfigs[f.referencedEntityKey];
            const sourceField = sourceConfig
              ? this.findFieldInTabs(sourceConfig.tabs ?? [], f.referencedFieldId)
              : undefined;
            f.hasDrift = computeFieldDrift(f, sourceField ?? undefined);
          }
          if (f.children?.length) scanFields(f.children);
        }
      };

      for (const tab of draft.tabs ?? []) {
        if (tab.fields?.length) scanFields(tab.fields);
      }
    });
  }

  addOption(fieldId: string): void {
    this.mutate(draft => {
      const field = this.findFieldInTabs(draft.tabs, fieldId);
      if (!field) return;
      const options = field.options ?? [];
      const n = options.length + 1;
      const lang = draft.defaultLanguage ?? 'en';
      options.push({ [lang]: `Option ${n}` });
      field.options = options;
      // Authoring an inline option makes this a manual field — see `setFieldDataSource`.
      delete field.listName;
    });
  }

  /** Merge language keys into an option. `setOptionLabel` is the usual single-language path. */
  updateOption(fieldId: string, index: number, patch: DropdownOption): void {
    this.mutate(draft => {
      const field = this.findFieldInTabs(draft.tabs, fieldId);
      const option = field?.options?.[index];
      if (!option) return;
      field.options![index] = { ...option, ...patch };
    });
  }

  /**
   * Set an option's text for one language.
   *
   * An option is a language-keyed object and the displayed text **is** the stored value,
   * so this is the only way to edit one — there is no separate value to set.
   */
  setOptionLabel(fieldId: string, index: number, language: string, value: string): void {
    // Also keystroke-bound.
    this.mutateField(fieldId, field => {
      const option = field.options?.[index];
      if (!option) return field;
      const options = field.options!.map((o, i) => (i === index ? { ...o, [language]: value } : o));
      return { ...field, options };
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
    const id = rule.id?.trim() || this.uniqueId('rule', new Set(this._rules().map(r => r.id ?? '')));
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
    // Must be unique across the whole tree, not just the top level: a tab id is the record
    // storage path, so a new top-level tab colliding with an existing sub-tab would make two
    // tabs write to the same key and break findTab/getTabPath.
    const id = this.uniqueId('tab', new Set(this.allTabIds()));
    this.mutate(draft => {
      const tabs = draft.tabs ?? (draft.tabs = []);
      const lang = draft.defaultLanguage ?? 'en';
      tabs.push({ id, label: { [lang]: humanizeId(id) }, fields: [] });
    });
    return id;
  }

  /** Every tab id in the tree, at any depth. Tab ids must be globally unique — they are paths. */
  private allTabIds(): string[] {
    const ids: string[] = [];
    const collect = (tabs: NestedTabConfig[] | undefined) => {
      for (const t of tabs ?? []) {
        ids.push(t.id);
        collect(t.children);
      }
    };
    collect(this._config().tabs);
    return ids;
  }

  addSubTab(parentId: string): string {
    const id = this.uniqueId('tab', new Set(this.allTabIds()));
    this.mutate(draft => {
      const parent = findTab(draft.tabs, parentId);
      if (parent) {
        parent.children = parent.children ?? [];
        const lang = draft.defaultLanguage ?? 'en';
        parent.children.push({ id, label: { [lang]: humanizeId(id) }, fields: [] });
      }
    });
    return id;
  }

  setPrimaryTab(tabId: string): void {
    this.mutate(draft => {
      const markPrimary = (tabs: NestedTabConfig[]) => {
        for (const t of tabs) {
          t.isPrimaryTab = t.id === tabId;
          if (t.children) markPrimary(t.children);
        }
      };
      markPrimary(draft.tabs ?? []);
    });
  }

  updateTab(id: string, patch: Partial<NestedTabConfig>): void {
    this.mutate(draft => {
      const tab = findTab(draft.tabs, id);
      if (tab) Object.assign(tab, patch);
    });
  }

  setTabLabel(id: string, language: string, value: string): void {
    this.mutate(draft => {
      const tab = findTab(draft.tabs, id);
      if (tab) tab.label = { ...tab.label, [language]: value };
    });
  }

  removeTab(id: string): void {
    this.mutate(draft => {
      const removeRecursive = (tabs: NestedTabConfig[]): NestedTabConfig[] => {
        return tabs
          .filter(t => t.id !== id)
          .map(t => ({
            ...t,
            children: t.children ? removeRecursive(t.children) : undefined,
          }));
      };
      draft.tabs = removeRecursive(draft.tabs ?? []);
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
    this._isDirty.set(true);
  }

  /**
   * Replace one field, copying only the objects on the path to it.
   *
   * `mutate` deep-clones the entire config, which is right for a structural edit but wrong
   * for the two setters bound to keystroke events: typing a label allocated a full copy of
   * the config per character. Here every tab and field outside the target's chain is reused
   * by reference, so the cost is proportional to nesting depth rather than config size —
   * while the parts that did change are still fresh objects, so change detection and the
   * signal both see a new identity.
   *
   * Returns without touching anything when the field is not found.
   */
  private mutateField(id: string, update: (field: NestedFieldConfig) => NestedFieldConfig): void {
    let found = false;

    const visitFields = (fields: NestedFieldConfig[] | undefined): NestedFieldConfig[] | undefined => {
      if (!fields) return fields;
      let changed = false;
      const next = fields.map(field => {
        if (field.id === id) {
          found = true;
          changed = true;
          return update(field);
        }
        const children = visitFields(field.children);
        if (children !== field.children) {
          changed = true;
          return { ...field, children };
        }
        return field;
      });
      return changed ? next : fields;
    };

    const visitTabs = (tabs: NestedTabConfig[] | undefined): NestedTabConfig[] | undefined => {
      if (!tabs) return tabs;
      let changed = false;
      const next = tabs.map(tab => {
        const fields = visitFields(tab.fields);
        const children = visitTabs(tab.children);
        if (fields !== tab.fields || children !== tab.children) {
          changed = true;
          return { ...tab, fields, children };
        }
        return tab;
      });
      return changed ? next : tabs;
    };

    const current = this._config();
    const tabs = visitTabs(current.tabs);
    // `found` implies current.tabs existed and was walked, so tabs is defined here — the
    // fallback below is for the type checker, not a reachable state.
    if (!found || tabs === current.tabs) return;

    this._config.set({ ...current, tabs: tabs ?? [] });
    this._isDirty.set(true);
  }

  private uniqueId(prefix: string, taken: Set<string>): string {
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

    for (const field of allFields) {
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
      // A field on the lookup source has no inline options by design — its options arrive from
      // the registry at runtime. Warn only about the missing list name.
      if (meta?.hasOptions && typeof field.listName === 'string') {
        if (!field.listName.trim()) {
          problems.push({
            level: 'warning',
            message: `Field "${field.id}" reads options from a named list but has no list name.`,
            fieldId: field.id,
          });
        }
      } else if (meta?.hasOptions && (!field.options || field.options.length === 0)) {
        problems.push({
          level: 'warning',
          message: `Field "${field.id}" is a ${field.type} but has no options.`,
          fieldId: field.id,
        });
      }
    }

    // Id uniqueness is a whole-config invariant, and it is counted over the entire field
    // tree rather than `allFields`, which stops at a tab's own fields. Two ids colliding
    // inside a group or array went unreported even though rules, showWhen conditions and
    // autoPatch mappings all address fields by bare id and would resolve to whichever one
    // the lookup happened to reach first.
    const idCounts = new Map<string, number>();
    const countIds = (fields: NestedFieldConfig[] | undefined) => {
      for (const f of fields ?? []) {
        idCounts.set(f.id, (idCounts.get(f.id) ?? 0) + 1);
        if (f.children?.length) countIds(f.children);
      }
    };
    for (const tab of this.flattenTabs(config.tabs)) countIds(tab.fields);

    for (const [id, count] of idCounts) {
      if (count > 1) {
        problems.push({ level: 'error', message: `Duplicate field id "${id}" (${count}×).`, fieldId: id });
      }
    }

    return problems;
  }
}
