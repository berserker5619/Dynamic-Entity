import { Injectable, inject, isDevMode } from '@angular/core';
import { AbstractControl, FormArray, FormBuilder, FormGroup } from '@angular/forms';
import type { EntityFormConfig, NestedFieldConfig, NestedTabConfig } from '@dynamic-entity/core';
import {
  getTabData,
  getTabPath,
  getValueByPath,
  normalizeArrayStructures,
  parseFieldRef,
  setTabData,
  setValueByPath,
} from '@dynamic-entity/core';
import { ValidatorRegistryService } from '../services/validator-registry.service';

/**
 * FormStructureService — config ⇄ `FormGroup`, and nothing else.
 *
 * The one question this answers is *where a value lives*: which control a field owns, how
 * the tab tree nests into groups, how a record is read out of the tree and patched back in.
 * It was half of `DynamicFormComponent`, mixed in with tab state, focus management, rule
 * evaluation and RBAC — and the cost of that was not length but ownership: the bug Phase 2
 * fixed was two methods forty lines apart disagreeing about what "every field" meant.
 *
 * Deliberately stateless. Every method takes the form and the config it is operating on, so
 * there is no cached `this.form` to go stale against a rebuilt one, and every method is
 * testable without a component or a TestBed.
 *
 * Provided at the component, not the root: `FormBuilder` and the validator registry are the
 * only things injected, but keeping the service per form leaves room for that to change
 * without turning into shared mutable state.
 */
@Injectable()
export class FormStructureService {
  private readonly fb = inject(FormBuilder);
  private readonly validatorRegistry = inject(ValidatorRegistryService);

  /**
   * Build the control tree for a config.
   *
   * The tree mirrors the record's shape exactly: a tab opens a `FormGroup` under its id, a
   * `flatData` tab merges into its parent's, and a `group` field opens one for its children.
   * That correspondence is what lets a `[path]` ref resolve through `form.get()` and name
   * exactly one control — see `getControl`.
   */
  buildForm(config: EntityFormConfig): FormGroup {
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

    buildTabControls(config.tabs || [], group);
    return this.fb.group(group);
  }

  /** One field's control: a nested group, an empty array, or a leaf carrying its validators. */
  buildFieldControl(field: NestedFieldConfig, group: Record<string, AbstractControl>): void {
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
  buildArrayRow(field: NestedFieldConfig | undefined, item: unknown): AbstractControl {
    if (!field?.children?.length) return this.fb.control(item);

    const rowGroup: Record<string, AbstractControl> = {};
    for (const child of field.children) {
      this.buildFieldControl(child, rowGroup);
    }
    const group = this.fb.group(rowGroup);
    if (item && typeof item === 'object') group.patchValue(item as Record<string, unknown>);
    return group;
  }

  /** The `FormGroup` a tab's fields live in, honouring `flatData`. */
  getTabGroup(form: FormGroup | null, config: EntityFormConfig | null | undefined, tabId: string): FormGroup | null {
    if (!form) return null;
    const path = getTabPath(config?.tabs, tabId);
    if (!path || path.length === 0) return form;

    let curr: AbstractControl | null = form;
    for (const p of path) {
      if (!curr || !(curr instanceof FormGroup)) return null;
      curr = curr.get(p);
    }
    return curr instanceof FormGroup ? curr : null;
  }

  /**
   * Find a control by reference: a bracketed path, or a bare field id.
   *
   * A bracketed path names exactly one control, because the tree nests exactly as the path
   * does — so `form.get('work.address.city')` walks straight to it. A bare id is what every
   * config written before paths existed uses: it is looked for on `currentTabId` first, then
   * at the root, then by a recursive search whose result is whichever the walk reaches first.
   * That last branch is the ambiguity refs exist to remove, and callers that can name a path
   * should.
   */
  getControl(
    form: FormGroup | null,
    config: EntityFormConfig | null | undefined,
    fieldId: string,
    currentTabId?: string,
  ): AbstractControl | null {
    if (!form) return null;

    const parsed = parseFieldRef(fieldId);
    if (parsed.kind === 'ref') return form.get(parsed.value);

    if (currentTabId) {
      const tabGrp = this.getTabGroup(form, config, currentTabId);
      const ctrl = tabGrp?.get(fieldId);
      if (ctrl) return ctrl;
    }

    const rootCtrl = form.get(fieldId);
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

    return findInGroup(form);
  }

  /** Assemble the full nested record from per-tab groups, respecting flatData, refererField & arrays. */
  extractRecord(form: FormGroup | null, config: EntityFormConfig | null | undefined): Record<string, any> {
    if (!form || !config) return {};
    let record: Record<string, any> = {};

    const walkTabs = (tabs: NestedTabConfig[]) => {
      for (const tab of tabs) {
        const fieldValBag: Record<string, unknown> = {};
        for (const field of tab.fields || []) {
          const ctrl = this.getControl(form, config, field.id, tab.id);
          if (ctrl) fieldValBag[field.id] = ctrl.value;
        }

        setTabData(record, tab.id, fieldValBag, config);

        for (const field of tab.fields || []) {
          if (field.refererField) {
            const ctrl = this.getControl(form, config, field.id, tab.id);
            if (ctrl) setValueByPath(record, field.refererField, ctrl.value);
          }
        }

        if (tab.children) walkTabs(tab.children);
      }
    };

    walkTabs(config.tabs || []);
    record = normalizeArrayStructures(record, config);
    return record;
  }

  /**
   * Write a record into the control tree.
   *
   * Returns the top-level keys that named a known field and were *not* consumed, so the
   * caller can say so — see `DynamicFormComponent.warnUnconsumedInitialData`. Reporting
   * rather than logging keeps the "warn once per form" bookkeeping with the form, and keeps
   * this service free of console output.
   */
  patchForm(
    form: FormGroup | null,
    config: EntityFormConfig | null | undefined,
    data: Record<string, any>,
    fieldsById: Map<string, NestedFieldConfig>,
  ): string[] {
    if (!data || !form || !config) return [];
    const patchedFieldIds = new Set<string>();

    const walkTabs = (tabs: NestedTabConfig[]) => {
      for (const tab of tabs) {
        const tabData = getTabData(tab.id, data, config);
        for (const field of tab.fields || []) {
          let val = tabData && typeof tabData === 'object' ? tabData[field.id] : undefined;
          if (field.refererField) {
            const refVal = getValueByPath(data, field.refererField);
            if (refVal !== undefined) val = refVal;
          }
          if (val === undefined) continue;

          const ctrl = this.getControl(form, config, field.id, tab.id);
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

    walkTabs(config.tabs || []);
    return this.unconsumedKeys(config, data, fieldsById, patchedFieldIds);
  }

  /**
   * Top-level keys that name a field but reached no control.
   *
   * A record is nested by tab id (`{ tabId: { fieldId: value } }`) unless the tab sets
   * `flatData: true`. Handing a flat record to a nested tab finds nothing, so the fields stay
   * empty — with no error and no clue.
   *
   * Only keys matching a known field id count: anything else is the consumer's own record
   * metadata (ids, timestamps, `_configVersion`) and is not our business.
   */
  private unconsumedKeys(
    config: EntityFormConfig,
    data: Record<string, any>,
    fieldsById: Map<string, NestedFieldConfig>,
    patchedFieldIds: Set<string>,
  ): string[] {
    if (!isDevMode()) return [];

    const tabIds = new Set<string>();
    const collectTabIds = (tabs: NestedTabConfig[]) => {
      for (const tab of tabs) {
        tabIds.add(tab.id);
        if (tab.children) collectTabIds(tab.children);
      }
    };
    collectTabIds(config.tabs || []);

    return Object.keys(data).filter(
      key =>
        // A tab id at the root is the nested container, not a stray field.
        !tabIds.has(key) &&
        data[key] !== undefined &&
        fieldsById.has(key) &&
        !patchedFieldIds.has(key),
    );
  }
}
