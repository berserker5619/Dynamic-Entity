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
import { assignFieldRefs, collectFieldScopes, fieldRefFor, parseFieldRef, toRefToken } from '@dynamic-entity/core';
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

/** One undoable state of the builder: the config and the rules that belong with it. */
interface BuilderSnapshot {
  readonly config: EntityFormConfig;
  readonly rules: FormRule[];
  /** Tab / field / rule counts, used to decide whether two edits may be coalesced. */
  readonly shape: string;
}

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
  /**
   * Fields whose `refererField` the config declared, rather than the builder stamping it.
   *
   * A declared path is a deliberate binding override and must survive a structural edit. A
   * stamped one is just the field's address, so it has to be rewritten when the field moves.
   * Without the distinction, restamping would destroy the override and not restamping would
   * leave a moved field pointing at where it used to be.
   */
  private readonly authoredRefs = new Set<string>();

  private readonly _isDirty = signal<boolean>(false);

  /**
   * Roles of the person using the builder — distinct from `availableRoles`, which is the
   * vocabulary a schema may reference. Needed so the SYSTEM_DEFAULT_CAN_EDIT predicate can
   * be asked a real question; it was previously called with a hardcoded empty array, which
   * made any role-checking predicate answer false for everyone.
   */
  private readonly _userRoles = signal<string[]>([]);

  // ─── Undo / redo ────────────────────────────────────────────────────────────
  //
  // History is a list of {config, rules} pairs, because the builder's state is two signals
  // and undoing one without the other would leave a rule pointing at a field that no longer
  // exists.
  //
  // Entries hold **references, not clones**. `mutate` builds a new config and `mutateField`
  // shares structure along the unchanged path, so every snapshot already refers to immutable
  // objects and unchanged subtrees are shared between entries. That also removes the usual
  // re-entrancy problem for free: undo puts the stored object back, so the recording effect
  // sees the exact reference already sitting at the cursor and skips it. No suppression flag
  // to get out of step.
  private readonly history: BuilderSnapshot[] = [];
  private readonly cursor = signal(-1);
  private readonly historyLength = signal(0);
  private lastEditAt = 0;

  /** Consecutive edits closer together than this fold into one undo step. */
  private static readonly COALESCE_MS = 400;

  readonly canUndo = computed(() => this.cursor() > 0);
  readonly canRedo = computed(() => this.cursor() < this.historyLength() - 1);

  /**
   * Fold the current state into history.
   *
   * Called explicitly by the write paths rather than from an `effect`. An effect would have
   * been fewer call sites, but it requires an injection context: `BuilderStore` had no
   * constructor, so `new BuilderStore()` was legal, and adding one broke every caller that
   * did it with NG0203. Explicit calls also make the timing deterministic — a test can
   * assert straight after an edit instead of flushing effects first.
   *
   * Calling it twice for one operation is harmless: the second call sees the same signal
   * references already at the cursor and returns.
   *
   * `setFieldLabel` is bound to a keystroke, so recording every emission would make undo
   * walk back one character at a time. Two consecutive edits merge when they land inside
   * `COALESCE_MS` *and* the structure is unchanged — a rename coalesces, while adding,
   * removing or moving anything always earns its own step however fast it is clicked.
   */
  private record(): void {
    const config = this._config();
    const rules = this._rules();
    const at = this.cursor();
    const top = at >= 0 ? this.history[at] : undefined;
    if (top && top.config === config && top.rules === rules) return;

    const now = Date.now();
    const snapshot: BuilderSnapshot = { config, rules, shape: this.shapeOf(config, rules) };

    if (
      top &&
      now - this.lastEditAt < BuilderStore.COALESCE_MS &&
      top.shape === snapshot.shape &&
      at === this.history.length - 1
    ) {
      this.history[at] = snapshot;
      this.lastEditAt = now;
      return;
    }

    // A new edit after an undo discards the redo branch, which is what every editor does.
    this.history.length = at + 1;
    this.history.push(snapshot);
    this.cursor.set(this.history.length - 1);
    this.historyLength.set(this.history.length);
    this.lastEditAt = now;
  }

  /** Counts that distinguish a structural edit from a value edit. */
  private shapeOf(config: EntityFormConfig, rules: FormRule[]): string {
    let fields = 0;
    let tabs = 0;
    const walkFields = (list: NestedFieldConfig[] | undefined): void => {
      for (const f of list ?? []) {
        fields += 1;
        walkFields(f.children);
      }
    };
    const walkTabs = (list: NestedTabConfig[] | undefined): void => {
      for (const t of list ?? []) {
        tabs += 1;
        walkFields(t.fields);
        walkTabs(t.children);
      }
    };
    walkTabs(config.tabs);
    return `${tabs}:${fields}:${rules.length}`;
  }

  /** Start history again from the state just loaded. Nothing before it is undoable. */
  private resetHistory(): void {
    this.history.length = 0;
    this.history.push({
      config: this._config(),
      rules: this._rules(),
      shape: this.shapeOf(this._config(), this._rules()),
    });
    this.cursor.set(0);
    this.historyLength.set(1);
    this.lastEditAt = 0;
  }

  undo(): void {
    if (!this.canUndo()) return;
    this.applyHistory(this.cursor() - 1);
  }

  redo(): void {
    if (!this.canRedo()) return;
    this.applyHistory(this.cursor() + 1);
  }

  private applyHistory(index: number): void {
    const snapshot = this.history[index];
    if (!snapshot) return;
    this.cursor.set(index);
    // Order matters only in that both land before the effect runs; it then sees references
    // identical to this entry and records nothing.
    this._config.set(snapshot.config);
    this._rules.set(snapshot.rules);
    this._isDirty.set(true);

    // The selected field may not exist in the state being restored.
    const selected = this._selectedFieldId();
    if (selected && !this.findFieldInTabs(snapshot.config.tabs, selected)) {
      this._selectedFieldId.set(null);
    }
  }

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
    // Remember the paths the config declared before filling in the rest, so a deliberate
    // binding override is never mistaken for one of ours and rewritten.
    this.authoredRefs.clear();
    for (const entry of collectFieldScopes(config)) {
      if (entry.field?.id && entry.field.refererField) this.authoredRefs.add(entry.field.id);
    }
    assignFieldRefs(config);
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
    this.resetHistory();
  }

  reset(entity = ''): void {
    this._config.set(this.emptyConfig(entity));
    this._selectedFieldId.set(null);
    this._rules.set([]);
    this.manualIds.clear();
    this._isDirty.set(false);
    this.resetHistory();
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

  /**
   * Resolve a field by key, where a key is either its `refererField` path or a bare id.
   *
   * Every resolution in this store funnels through here, which is why a bare id was enough
   * to edit the wrong field: with `personal.address` and `work.address` both present, the
   * first match won, so selecting or editing the second one silently addressed the first.
   *
   * The path is tried across the whole tree before any bare id is, so an exact key never
   * loses to a nearer-but-wrong match. Bare ids still resolve — every existing caller and
   * spec passes one, and for an unambiguous id it is the same field either way.
   */
  private findFieldInTabs(tabs: NestedTabConfig[] = [], key: string): NestedFieldConfig | null {
    return this.findFieldBy(tabs, f => f.refererField === key) ?? this.findFieldBy(tabs, f => f.id === key);
  }

  private findFieldBy(
    tabs: NestedTabConfig[] = [],
    match: (f: NestedFieldConfig) => boolean,
  ): NestedFieldConfig | null {
    for (const t of tabs) {
      const found = t.fields?.find(match);
      if (found) return found;
      if (t.children) {
        const nested = this.findFieldBy(t.children, match);
        if (nested) return nested;
      }
    }
    return null;
  }

  /**
   * The key a caller should hand back to address this exact field. Templates use it so a
   * click on the second of two same-named fields selects that one.
   */
  keyOf(field: { id: string; refererField?: string }): string {
    return field.refererField || field.id;
  }

  /**
   * Whether this exact field is the selected one.
   *
   * Not `selectedFieldId() === field.id`: selection may hold a bare id or a path depending
   * on who set it, and with two fields sharing an id a bare comparison lights up both rows
   * — or neither, once the click starts storing a path. Resolving both sides answers for
   * the field itself.
   */
  isSelected(field: NestedFieldConfig): boolean {
    const key = this._selectedFieldId();
    if (!key) return false;
    // Same key, same field — and this is the path a row click takes, so it is the common
    // case. It also covers a field handed in as an @Input that the store's own config has
    // no object for, which identity alone cannot.
    if (key === this.keyOf(field)) return true;
    // Otherwise the selection is in the other form (a bare id against a field that carries a
    // path, or vice versa), so let it resolve and compare the field it names.
    const resolved = this.findFieldInTabs(this._config().tabs, key);
    return !!resolved && resolved === field;
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

    this.applyRename(oldId, oldId, trimmed);
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
  /**
   * `key` addresses the field to rename; `oldId` is the bare id every *reference* to it
   * carries. They were one parameter, which worked only while an id was unique across the
   * config: resolving needs the path, while `showWhen`, `parentField`, `autoPatch` targets
   * and rules are all keyed by bare id and never match a path.
   */
  private applyRename(key: string, oldId: string, newId: string): void {
    // Selection is held as whatever the caller passed — `addField` stores a bare id while a
    // canvas click stores a path — so comparing the two strings said "not selected" for a
    // field that plainly was, and the inspector emptied itself mid-rename. Compare the
    // fields the two keys resolve to instead.
    const selectedKey = this._selectedFieldId();
    const tabsNow = this._config().tabs;
    const wasSelected =
      !!selectedKey &&
      this.findFieldInTabs(tabsNow, selectedKey) === this.findFieldInTabs(tabsNow, key);

    this.mutate(draft => {
      const field = this.findFieldInTabs(draft.tabs, key);
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

    // `mutate` restamps `refererField`, so the key's last segment moves with the id. Without
    // this the selection points at a path nothing resolves to any more, and the inspector
    // empties itself mid-keystroke as soon as a typed label derives a new id.
    this.record();

    if (wasSelected) {
      // Keep the shape the selection already had: a bare id stays bare, a path keeps its
      // scope and moves only its last segment.
      const cut = selectedKey!.lastIndexOf('.');
      this._selectedFieldId.set(cut === -1 ? newId : `${selectedKey!.slice(0, cut + 1)}${newId}`);
    }
  }

  removeField(key: string): void {
    let removedId: string | null = null;
    this.mutate(draft => {
      // Resolve inside the draft, then remove that one by identity. Filtering on
      // `f.id !== id` deleted every field sharing the id, so removing `work.address` took
      // `personal.address` with it.
      const target = this.findFieldInTabs(draft.tabs, key);
      if (!target) return;
      removedId = target.id;
      for (const tab of this.flattenTabs(draft.tabs)) {
        if (tab.fields) {
          tab.fields = tab.fields.filter(f => f !== target);
        }
      }
    });
    if (removedId === null) return;
    // `manualIds` is keyed by bare id and shared by every field carrying it, so it is only
    // safe to forget once no field uses that id any more.
    if (!this.getAllFields(this._config().tabs ?? []).some(f => f.id === removedId)) {
      this.manualIds.delete(removedId);
    }
    if (this._selectedFieldId() === key) this._selectedFieldId.set(null);
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

  moveField(key: string, direction: -1 | 1): void {
    this.mutate(draft => {
      // Resolve by key, then locate that object — `f.id === id` moved whichever same-named
      // field the walk reached first, which for two `address` fields was never the one the
      // arrow button belonged to.
      const wanted = this.findFieldInTabs(draft.tabs, key);
      if (!wanted) return;

      for (const tab of this.flattenTabs(draft.tabs)) {
        const fields = tab.fields ?? [];
        const from = fields.findIndex(f => f === wanted);
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

  /**
   * Moves a field to another tab, keeping its id.
   *
   * The builder could add, remove, duplicate and reorder a field but never relocate one, so
   * a field authored on the wrong tab had to be deleted and rebuilt — losing its validators,
   * options and any rule that pointed at it.
   *
   * The field's `refererField` changes, because it is an address and the field now has a new one.
   * `mutate` restamps it and repoints the rules that named it, so a move does not silently
   * strand them.
   */
  moveFieldToTab(id: string, targetTabId: string): boolean {
    const target = this.flattenTabs(this._config().tabs).find(t => t.id === targetTabId);
    if (!target) return false;

    let moved = false;
    this.mutate(draft => {
      const targetTab = this.flattenTabs(draft.tabs).find(t => t.id === targetTabId);
      if (!targetTab) return;

      // Resolve by key first so a path names one field, then locate that object. Matching
      // `f.id === id` moved whichever same-named field came first in the walk.
      const wanted = this.findFieldInTabs(draft.tabs, id);
      if (!wanted) return;

      for (const tab of this.flattenTabs(draft.tabs)) {
        const index = (tab.fields ?? []).findIndex(f => f === wanted);
        if (index === -1) continue;
        if (tab.id === targetTabId) return; // already there; nothing to do

        const [field] = tab.fields!.splice(index, 1);
        targetTab.fields = targetTab.fields ?? [];
        targetTab.fields.push(field);
        moved = true;
        return;
      }
    });
    return moved;
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
  setFieldLabel(key: string, language: string, value: string): void {
    // Bound to a keystroke event, so this uses the structural-sharing path.
    this.mutateField(key, field => ({ ...field, label: { ...field.label, [language]: value } }));

    if (language !== (this._config().defaultLanguage ?? 'en')) return;

    // The mutation is addressed by key, but everything below is about the *id*: `manualIds`
    // records bare ids, `availableId` compares bare ids, and a rename replaces one. Reading
    // the field's own id keeps the two straight — passing the path into `manualIds.has`
    // would never match, so a pinned id would silently start following the label again.
    const field = this.findFieldInTabs(this._config().tabs, key);
    if (!field) return;
    const currentId = field.id;
    if (this.manualIds.has(currentId)) return;

    const derived = labelToId(value);
    if (!derived || derived === currentId) return;

    this.applyRename(this.keyOf(field), currentId, this.availableId(derived, currentId));
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
  /**
   * Rules attached to the selected field, whichever way they name it.
   *
   * New rules are authored with the field's path — `[work.address]` — because a bare id
   * cannot distinguish two fields that share one. Rules written before paths existed name it
   * by id, and those must keep showing up here or editing an older config would look like it
   * had lost its rules.
   */
  readonly rulesForSelectedField = computed<FormRule[]>(() => {
    const id = this._selectedFieldId();
    if (!id) return [];
    const names = new Set<string>([id]);
    const ref = this.selectedField()?.refererField;
    if (ref) names.add(toRefToken(ref));
    return this._rules().filter(
      r => names.has(r.fieldId) || r.targets.some(t => names.has(t.id)),
    );
  });

  loadRules(rules: FormRule[]): void {
    this._rules.set(clone(rules));
    this.record();
  }

  addRule(rule: FormRule): string {
    const id = rule.id?.trim() || this.uniqueId('rule', new Set(this._rules().map(r => r.id ?? '')));
    this._rules.update(rules => [...rules, { ...clone(rule), id }]);
    this.record();
    return id;
  }

  updateRule(id: string, patch: Partial<FormRule>): void {
    this._rules.update(rules => rules.map(r => (r.id === id ? { ...r, ...clone(patch), id } : r)));
    this.record();
  }

  removeRule(id: string): void {
    this._rules.update(rules => rules.filter(r => r.id !== id));
    this.record();
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

  /**
   * The single choke point for a structural edit, and therefore the one place refs are kept
   * true.
   *
   * `refererField` is a field's address, so it changes whenever the structure around it does —
   * moving a field to another tab, or into a group, gives it a new one. Rules address fields
   * by ref, so a move that only restamped the field would leave every rule pointing at an
   * address nothing occupies. Both happen here, together, or the config is inconsistent
   * between them.
   */
  private mutate(fn: (draft: EntityFormConfig) => void): void {
    const before = this.refsById(this._config());
    const draft = clone(this._config());
    draft.tabs = draft.tabs ?? [];
    fn(draft);
    this.restampFieldPaths(draft);
    this.repointRulesForMovedFields(before, this.refsById(draft));
    this._config.set(draft);
    this._isDirty.set(true);
    this.record();
  }

  /**
   * Rewrites the address of every field the builder owns, leaving declared overrides alone.
   *
   * `assignFieldRefs` only fills in a missing path, which is right when a config arrives and
   * wrong after a move: the field already has a path, and it is now the wrong one.
   */
  private restampFieldPaths(config: EntityFormConfig): void {
    for (const entry of collectFieldScopes(config)) {
      const field = entry.field;
      if (!field?.id || this.authoredRefs.has(field.id)) continue;
      field.refererField = fieldRefFor(entry.scope, field.id);
    }
  }

  /** Field id → the refs it currently has. A duplicated id has more than one. */
  private refsById(config: EntityFormConfig): Map<string, string[]> {
    const map = new Map<string, string[]>();
    for (const entry of collectFieldScopes(config)) {
      if (!entry.field?.id) continue;
      const refs = map.get(entry.field.id) ?? [];
      refs.push(fieldRefFor(entry.scope, entry.field.id));
      map.set(entry.field.id, refs);
    }
    return map;
  }

  /**
   * Rewrites rules that pointed at a ref a move has just changed.
   *
   * A field is matched by its id: if exactly one ref for that id disappeared and exactly one
   * appeared, that is the move and the rules follow it. Anything less clear-cut — two fields
   * sharing an id where one moved — is left alone rather than guessed at, because rewriting
   * the wrong rule is worse than leaving one to be repointed by hand.
   */
  private repointRulesForMovedFields(
    before: Map<string, string[]>,
    after: Map<string, string[]>,
  ): void {
    const moves = new Map<string, string>();
    for (const [id, oldRefs] of before) {
      const newRefs = after.get(id) ?? [];
      const gone = oldRefs.filter(r => !newRefs.includes(r));
      const added = newRefs.filter(r => !oldRefs.includes(r));
      if (gone.length === 1 && added.length === 1) moves.set(gone[0], added[0]);
    }
    if (moves.size === 0) return;

    const repoint = (reference: string | undefined): string | undefined => {
      if (!reference) return reference;
      const parsed = parseFieldRef(reference);
      if (parsed.kind !== 'ref') return reference;
      const moved = moves.get(parsed.value);
      return moved ? toRefToken(moved) : reference;
    };

    this._rules.update(rules =>
      rules.map(rule => ({
        ...rule,
        fieldId: repoint(rule.fieldId) ?? rule.fieldId,
        conditions: rule.conditions.map(c =>
          c.compareToField ? { ...c, compareToField: repoint(c.compareToField) } : c,
        ),
        targets: rule.targets.map(t => ({ ...t, id: repoint(t.id) ?? t.id })),
      })),
    );
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
  private mutateField(key: string, update: (field: NestedFieldConfig) => NestedFieldConfig): void {
    let found = false;

    // Resolve once, then match on object identity. Matching on `field.id === id` inside the
    // walk updated *every* field carrying that id, so renaming `work.address` also rewrote
    // `personal.address` — both rows changed, and the second write was silent. Identity
    // cannot be ambiguous the way a bare id can.
    const target = this.findFieldInTabs(this._config().tabs, key);
    if (!target) return;

    const visitFields = (fields: NestedFieldConfig[] | undefined): NestedFieldConfig[] | undefined => {
      if (!fields) return fields;
      let changed = false;
      const next = fields.map(field => {
        if (field === target) {
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
    this.record();
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

    // Core calls a config with no tabs an error — nothing can render — and the builder used
    // to report only a warning and leave Save enabled. That let the builder save a config
    // `dynamic-entity validate` then rejected in CI: the mirror of the bug where it refused
    // one core accepted. The builder defers to core here, as it already does for the scope
    // rule, and the message is core's so the two read the same in both places.
    if (!config.tabs?.length) {
      problems.push({ level: 'error', message: 'At least one tab is required.' });
    }

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

    // Id uniqueness is a *per-scope* invariant, not a whole-config one — this counted into
    // one flat map keyed by bare id, so it rejected `personal.address` alongside
    // `work.address` and made every such config unopenable: Save is disabled while an error
    // stands, so unrelated edits could not be saved either. The runtime, the record shape
    // and `validateConfig` have all accepted per-scope ids since 1.4.0; this was the last
    // component still enforcing the old rule, and it enforced it against configs the rest
    // of the stack calls valid.
    //
    // The scope rule itself comes from core rather than being reimplemented here, so the
    // builder and the validator cannot drift apart on what "same scope" means.
    const scopeCounts = new Map<string, { id: string; count: number }>();
    for (const entry of collectFieldScopes(config)) {
      if (!entry.field.id) continue;
      const key = `${entry.scope}::${entry.field.id}`;
      const seen = scopeCounts.get(key);
      if (seen) seen.count += 1;
      else scopeCounts.set(key, { id: entry.field.id, count: 1 });
    }

    for (const [key, { id, count }] of scopeCounts) {
      if (count > 1) {
        // Still an error, and it must stay one: two fields in the same scope share a single
        // control and a single record key, so the second silently overwrites the first.
        const scope = key.slice(0, key.lastIndexOf('::'));
        problems.push({
          level: 'error',
          message: `Duplicate field id "${id}" (${count}×) in ${scope}. Two fields in one scope share a control and a record key.`,
          fieldId: id,
        });
      }
    }

    return problems;
  }
}
