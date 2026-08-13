import type { NestedFieldConfig, NestedTabConfig } from '@dynamic-entity/core';

export class BuilderFieldStore {
  /** Collect all fields across all tabs and sub-tabs recursively. */
  getAllFields(tabs: NestedTabConfig[] = []): NestedFieldConfig[] {
    const list: NestedFieldConfig[] = [];
    const visitFields = (fields: NestedFieldConfig[] = []) => {
      for (const f of fields) {
        list.push(f);
        if (f.children) visitFields(f.children);
      }
    };
    for (const tab of tabs) {
      if (tab.fields) visitFields(tab.fields);
      if (tab.children) {
        const subFields = this.getAllFields(tab.children);
        list.push(...subFields);
      }
    }
    return list;
  }

  /** Find a field by ID in tabs. */
  findFieldInTabs(tabs: NestedTabConfig[] = [], id: string): NestedFieldConfig | null {
    for (const t of tabs) {
      if (t.fields) {
        const found = this.findFieldInFields(t.fields, id);
        if (found) return found;
      }
      if (t.children) {
        const found = this.findFieldInTabs(t.children, id);
        if (found) return found;
      }
    }
    return null;
  }

  private findFieldInFields(fields: NestedFieldConfig[] = [], id: string): NestedFieldConfig | null {
    for (const f of fields) {
      if (f.id === id) return f;
      if (f.children) {
        const found = this.findFieldInFields(f.children, id);
        if (found) return found;
      }
    }
    return null;
  }

  /** Generate a unique field ID. */
  uniqueId(prefix: string, allFields: NestedFieldConfig[]): string {
    const existing = new Set(allFields.map(f => f.id));
    let n = 1;
    let candidate = `${prefix}_${n}`;
    while (existing.has(candidate)) {
      n++;
      candidate = `${prefix}_${n}`;
    }
    return candidate;
  }
}
