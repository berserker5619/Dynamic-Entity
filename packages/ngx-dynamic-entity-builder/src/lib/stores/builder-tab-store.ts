import type { EntityFormConfig, NestedTabConfig } from '@dynamic-entity/core';
import { deepClone as clone } from '../clone';

export class BuilderTabStore {
  /** Find a tab or sub-tab by ID recursively. */
  findTab(tabs: NestedTabConfig[] = [], id: string): NestedTabConfig | null {
    for (const tab of tabs) {
      if (tab.id === id) return tab;
      if (tab.children) {
        const found = this.findTab(tab.children, id);
        if (found) return found;
      }
    }
    return null;
  }

  /** Find the parent tab containing a given child tab ID. */
  findParentTab(tabs: NestedTabConfig[] = [], childId: string): NestedTabConfig | null {
    for (const tab of tabs) {
      if (tab.children?.some(c => c.id === childId)) return tab;
      if (tab.children) {
        const found = this.findParentTab(tab.children, childId);
        if (found) return found;
      }
    }
    return null;
  }

  /** Collect all tab IDs recursively. */
  allTabIds(tabs: NestedTabConfig[] = []): string[] {
    const ids: string[] = [];
    for (const tab of tabs) {
      ids.push(tab.id);
      if (tab.children) ids.push(...this.allTabIds(tab.children));
    }
    return ids;
  }

  /** Generate a unique tab ID given a base name. */
  uniqueTabId(base: string, existingTabs: NestedTabConfig[]): string {
    const existing = new Set(this.allTabIds(existingTabs));
    let candidate = base;
    let n = 1;
    while (existing.has(candidate)) {
      n++;
      candidate = `${base}_${n}`;
    }
    return candidate;
  }

  /** Add a top-level or nested sub-tab. */
  addTab(config: EntityFormConfig, labelText: string, parentTabId?: string): { nextConfig: EntityFormConfig; newTabId: string } {
    const next = clone(config);
    next.tabs = next.tabs ?? [];
    const baseId = labelText.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'tab';
    const tabId = this.uniqueTabId(baseId, next.tabs);
    const newTab: NestedTabConfig = { id: tabId, label: { en: labelText.trim() || 'New Tab' }, fields: [] };

    if (parentTabId) {
      const parent = this.findTab(next.tabs, parentTabId);
      if (parent) {
        parent.children = parent.children ?? [];
        parent.children.push(newTab);
      } else {
        next.tabs.push(newTab);
      }
    } else {
      next.tabs.push(newTab);
    }

    return { nextConfig: next, newTabId: tabId };
  }

  /** Remove a tab by ID. */
  removeTab(config: EntityFormConfig, tabId: string): EntityFormConfig {
    const next = clone(config);
    if (!next.tabs) return next;

    const removeRecursive = (list: NestedTabConfig[]): NestedTabConfig[] => {
      return list.filter(t => t.id !== tabId).map(t => {
        if (t.children) t.children = removeRecursive(t.children);
        return t;
      });
    };

    next.tabs = removeRecursive(next.tabs);
    return next;
  }

  /** Set primary tab flag. */
  setPrimaryTab(config: EntityFormConfig, tabId: string): EntityFormConfig {
    const next = clone(config);
    const setRecursive = (list: NestedTabConfig[] = []) => {
      for (const t of list) {
        t.isPrimaryTab = t.id === tabId;
        if (t.children) setRecursive(t.children);
      }
    };
    setRecursive(next.tabs);
    return next;
  }
}
