import type { EntityFormConfig, FormRule, NestedFieldConfig } from '@dynamic-entity/core';
import {
  collectFieldScopes,
  parseFieldRef,
  refOf,
  resolveLabel,
  toRefToken,
} from '@dynamic-entity/core';

export type DependencyType = 'rule' | 'showWhen' | 'cascade' | 'patchOnTrue' | 'autoPatch';

export interface RuleDependencyEdge {
  id: string;
  sourceKey: string;
  sourceLabel: string;
  targetKey: string;
  targetLabel: string;
  type: DependencyType;
  actionSummary: string;
  description: string;
  sourceValid: boolean;
  targetValid: boolean;
}

export interface RuleDependencyGraphData {
  edges: RuleDependencyEdge[];
  totalRules: number;
  totalShowWhen: number;
  totalCascades: number;
  totalPatches: number;
}

interface FieldMeta {
  key: string;
  id: string;
  label: string;
  field: NestedFieldConfig;
}

/**
 * Computes all dependency edges (rules, showWhen, cascades, patchOnTrue, autoPatch)
 * across an EntityFormConfig and its rules.
 */
export function computeRuleDependencies(
  config: EntityFormConfig | null | undefined,
  rules: readonly FormRule[] = [],
  language = 'en',
): RuleDependencyGraphData {
  const edges: RuleDependencyEdge[] = [];
  let edgeIdSeq = 0;

  const scopes = collectFieldScopes(config);
  const byKey = new Map<string, FieldMeta>();
  const byId = new Map<string, FieldMeta>();
  const byToken = new Map<string, FieldMeta>();

  for (const entry of scopes) {
    const key = refOf(entry.field, entry.scope);
    const token = toRefToken(key);
    const label = resolveLabel(entry.field.label, language) || entry.field.id;
    const meta: FieldMeta = { key, id: entry.field.id, label, field: entry.field };

    byKey.set(key, meta);
    byId.set(entry.field.id, meta);
    byToken.set(token, meta);
  }

  function resolveRef(refStr: string): { key: string; label: string; valid: boolean } {
    if (!refStr) return { key: '', label: '—', valid: false };
    const parsed = parseFieldRef(refStr);
    const val = parsed.value;
    const meta =
      byKey.get(refStr) ??
      byKey.get(val) ??
      byId.get(val) ??
      byToken.get(refStr) ??
      byToken.get(toRefToken(val));

    if (meta) {
      return { key: meta.key, label: meta.label, valid: true };
    }
    return { key: val || refStr, label: val || refStr, valid: false };
  }

  let totalRules = 0;
  let totalShowWhen = 0;
  let totalCascades = 0;
  let totalPatches = 0;

  // 1. Form Rules
  for (const rule of rules) {
    if (!rule.fieldId) continue;
    totalRules++;
    const source = resolveRef(rule.fieldId);
    const targets = rule.targets ?? [];

    const actionType: string = rule.action?.type ?? 'action';
    let actionSummary = actionType;
    if (actionType === 'visibility') {
      actionSummary = rule.action?.value === false || rule.action?.value === 'false' ? 'hide' : 'show';
    } else if (actionType === 'validation' || actionType === 'validationMessage') {
      actionSummary = 'validate';
    } else if (actionType === 'info' || actionType === 'infoBanner') {
      actionSummary = 'info';
    }

    const conditionsText =
      rule.conditions && rule.conditions.length > 0
        ? rule.conditions.map(c => `${c.operator ?? 'EQUAL'} ${c.value ?? ''}`.trim()).join(' & ')
        : 'always';

    for (const target of targets) {
      const targetResolved = resolveRef(target.id);
      edges.push({
        id: `rule-${++edgeIdSeq}`,
        sourceKey: source.key,
        sourceLabel: source.label,
        targetKey: targetResolved.key,
        targetLabel: targetResolved.label,
        type: 'rule',
        actionSummary,
        description: `${actionSummary.toUpperCase()} when ${conditionsText}`,
        sourceValid: source.valid,
        targetValid: targetResolved.valid,
      });
    }
  }

  // 2. Field-level features: showWhen, cascade, patchOnTrue, autoPatch
  for (const entry of scopes) {
    const field = entry.field;
    const fieldKey = refOf(field, entry.scope);
    const fieldResolved = resolveRef(fieldKey);

    // showWhen
    if (field.showWhen && typeof field.showWhen === 'object') {
      for (const [watchedRef, expectedVal] of Object.entries(field.showWhen)) {
        totalShowWhen++;
        const source = resolveRef(watchedRef);
        const valStr = typeof expectedVal === 'object' ? JSON.stringify(expectedVal) : String(expectedVal);
        edges.push({
          id: `showWhen-${++edgeIdSeq}`,
          sourceKey: source.key,
          sourceLabel: source.label,
          targetKey: fieldResolved.key,
          targetLabel: fieldResolved.label,
          type: 'showWhen',
          actionSummary: `= ${valStr}`,
          description: `Visible when ${source.label} = ${valStr}`,
          sourceValid: source.valid,
          targetValid: fieldResolved.valid,
        });
      }
    }

    // cascade parentField
    if (field.entityReference?.parentField) {
      totalCascades++;
      const source = resolveRef(field.entityReference.parentField);
      edges.push({
        id: `cascade-${++edgeIdSeq}`,
        sourceKey: source.key,
        sourceLabel: source.label,
        targetKey: fieldResolved.key,
        targetLabel: fieldResolved.label,
        type: 'cascade',
        actionSummary: 'filters options',
        description: `Reloads options when ${source.label} changes`,
        sourceValid: source.valid,
        targetValid: fieldResolved.valid,
      });
    }

    // patchOnTrue
    if (Array.isArray(field.patchOnTrue)) {
      for (const mapping of field.patchOnTrue) {
        if (!mapping.to) continue;
        totalPatches++;
        const toResolved = resolveRef(mapping.to);
        const fromResolved = resolveRef(mapping.from);
        edges.push({
          id: `patch-${++edgeIdSeq}`,
          sourceKey: fieldResolved.key,
          sourceLabel: fieldResolved.label,
          targetKey: toResolved.key,
          targetLabel: toResolved.label,
          type: 'patchOnTrue',
          actionSummary: `copy ${fromResolved.label} → ${toResolved.label}`,
          description: `When true, copies ${fromResolved.label} to ${toResolved.label}`,
          sourceValid: fieldResolved.valid,
          targetValid: toResolved.valid,
        });
      }
    }

    // autoPatch
    if (field.autoPatch && Array.isArray(field.autoPatch.mappings)) {
      for (const mapping of field.autoPatch.mappings) {
        if (!mapping.target) continue;
        totalPatches++;
        const targetResolved = resolveRef(mapping.target);
        edges.push({
          id: `autopatch-${++edgeIdSeq}`,
          sourceKey: fieldResolved.key,
          sourceLabel: fieldResolved.label,
          targetKey: targetResolved.key,
          targetLabel: targetResolved.label,
          type: 'autoPatch',
          actionSummary: `patch → ${targetResolved.label}`,
          description: `Selection copies ${mapping.source} to ${targetResolved.label}`,
          sourceValid: fieldResolved.valid,
          targetValid: targetResolved.valid,
        });
      }
    }
  }

  return {
    edges,
    totalRules,
    totalShowWhen,
    totalCascades,
    totalPatches,
  };
}
