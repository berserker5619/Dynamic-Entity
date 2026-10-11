/**
 * entity-form-config-adapter.ts — an `EntityFormConfig` as the importer's schema adapter
 * (docs/import-phase1-spec.md, §7).
 *
 * The only code that knows both sides: the generic import engine, and Dynamic Entity's config.
 * Everything it does is something `import-engine.ts` and `import-columns.ts` already do; the
 * adapter hands each piece to the engine through the contract instead of re-implementing it,
 * so a record imported through the generic engine is the one 2.x's `applyMapping` builds.
 *
 * - `targets` are `deriveImportColumns`' columns, whose refs come from `collectFieldRefs`.
 * - `coerce` is `coerceCell`. Every target's kind is `custom`: only this adapter reads a cell.
 * - `upgradeRefs` is `legacyRefAliases`, with 2.3's `PLAN_LEGACY_REF` warning.
 * - `finalize` is `recordShaper` (compaction, array structure, tab placement), then the stamp.
 * - `validate` is `validateImportedRecord`: the validators and the rules, as the form runs them.
 *
 * Arrays are not positional: a `null` slot does not survive the form (spec, Decision 5).
 *
 * Not exported from the package yet. The importer (`sheet-to-schema`) is still a private
 * workspace, so nothing published may reach it; this file is wired in by Phase 2.
 */
import type {
  CoerceOutcome as ImporterCoerceOutcome,
  ImportTarget,
  MappingPlan as ImporterPlan,
  PlanProblem,
  RecordProblem as ImporterRecordProblem,
  SchemaAdapter,
  TargetArray,
  TargetSet,
} from 'sheet-to-schema';

import { CORE_VERSION } from './constants';
import { collectFieldRefs } from './field-scopes';
import { resolveLabel } from './form-logic';
import type { EntityFormConfig, FormRule, NestedFieldConfig } from './form-model.types';
import {
  MAX_ARRAY_BOUND,
  arrayBoundOf,
  collectLeafTargets,
  deriveImportColumns,
  legacyRefAliases,
} from './import-columns';
import { coerceCell, recordShaper, validateImportedRecordCoded, type ImportLookups } from './import-engine';
import { stampRecord } from './migration';

export interface EntityFormConfigAdapterOptions {
  /** Rules that apply to this entity. Without them, rule-driven validation is not checked. */
  rules?: readonly FormRule[];
  /** Named lists the config's `listName` fields resolve against, already loaded. */
  lookups?: ImportLookups;
  /**
   * Offer `readonly` fields as targets. Default `true`, which is what applying a plan needs:
   * a stored plan may map one. A template or a suggestion passes `false`, as 2.x's wizard does.
   */
  includeReadonly?: boolean;
  /** Offer `systemDefault` fields as targets. Default `true`, for the same reason. */
  includeSystemDefault?: boolean;
}

/** What one import run tells the adapter. */
export interface EntityImportContext {
  /** Language for error message text only; matching compares every language (see `CoerceOptions`). */
  lang?: string;
  /** The decimal mark text numbers use. Default `.`. */
  decimal?: '.' | ',';
  /** Stamp each record with the config's version. Default `true`. */
  stamp?: boolean;
}

/** Field types whose cell names an option, so a cell that fails to read named an unknown one. */
const OPTION_TYPES = new Set<string>(['dropdown', 'radio', 'multiSelect']);

/** Wrap a config as a `SchemaAdapter`, for the generic import engine. */
export function entityFormConfigAdapter(
  config: EntityFormConfig,
  options: EntityFormConfigAdapterOptions = {},
): SchemaAdapter<NestedFieldConfig, EntityImportContext> {
  const derive = {
    includeReadonly: options.includeReadonly ?? true,
    includeSystemDefault: options.includeSystemDefault ?? true,
  };
  const entries = collectFieldRefs(config);
  const arrayEntries = entries.filter(entry => entry.field?.type === 'array' && entry.field.id);
  // An array inside an array is not a list a sheet can carry; its children are `unsupported`.
  const topArrays = arrayEntries.filter(
    entry => !arrayEntries.some(other => entry.ref.startsWith(`${other.ref}.`)),
  );
  const leafTargets = collectLeafTargets(config);
  const shape = recordShaper(config);

  return {
    id: config.entity,
    ...(typeof config.version === 'number' ? { version: config.version } : {}),
    adapterVersion: CORE_VERSION,

    targets({ slots, lang }): TargetSet<NestedFieldConfig> {
      // `deriveImportColumns` unrolls every array to one count, so it is asked for the most
      // any array needs and each array's columns are cut back to its own.
      const most = Math.min(Math.max(1, ...topArrays.map(entry => slots[entry.ref] ?? 0)), MAX_ARRAY_BOUND);
      const { columns, unsupported } = deriveImportColumns(config, { ...derive, lang, maxArrayRows: most });

      const targets: ImportTarget<NestedFieldConfig>[] = [];
      for (const column of columns) {
        const label = resolveLabel(column.field.label, lang) || '';
        const base = {
          header: column.header,
          matchKeys: label ? [label, column.field.id] : [column.field.id],
          required: column.required,
          value: { kind: 'custom' } as const,
          ...(column.format ? { format: column.format } : {}),
          meta: column.field,
        };
        if (column.arrayRef === undefined || column.arrayIndex === undefined) {
          targets.push({ ...base, ref: column.ref, shapeRef: column.ref });
          continue;
        }
        if (column.arrayIndex >= (slots[column.arrayRef] ?? 0)) continue;
        // The slot sits at the array's own boundary: `work.contacts.1.email`.
        const tail = column.ref.slice(column.arrayRef.length + 1 + String(column.arrayIndex).length);
        targets.push({
          ...base,
          ref: column.ref,
          shapeRef: `${column.arrayRef}${tail}`,
          arrayRef: column.arrayRef,
          ...(column.arrayLabel ? { arrayLabel: column.arrayLabel } : {}),
          arrayIndex: column.arrayIndex,
        });
      }

      const arrays: TargetArray[] = topArrays.map(entry => ({
        ref: entry.ref,
        label: resolveLabel(entry.field.label, lang) || entry.field.id,
        itemKind: 'object',
        required: entry.field.validators?.required === true,
        positional: false,
      }));

      return { targets, arrays, unsupported: unsupported.map(({ ref, reason }) => ({ ref, reason })) };
    },

    upgradeRefs(plan: ImporterPlan): { plan: ImporterPlan; problems: PlanProblem[] } {
      const bound = Math.max(arrayBoundOf({ entity: config.entity, entries: plan.entries }), 1);
      const aliases = legacyRefAliases(config, bound);
      if (!aliases.size) return { plan, problems: [] };

      const known = new Set(
        deriveImportColumns(config, { ...derive, maxArrayRows: bound }).columns.map(column => column.ref),
      );
      const problems: PlanProblem[] = [];
      const upgraded = plan.entries.map((entry, i) => {
        const now = aliases.get(entry.ref);
        if (now === undefined || !known.has(now)) return entry;
        problems.push({
          level: 'warning',
          code: 'PLAN_LEGACY_REF',
          path: `entries[${i}].ref`,
          message: `"${entry.ref}" is the 2.2 address of "${now}"; it is read as "${now}" until 4.0. Save the plan again to update it.`,
        });
        return { ...entry, ref: now };
      });
      return { plan: { ...plan, entries: upgraded }, problems };
    },

    coerce(target, raw, ctx): ImporterCoerceOutcome {
      const outcome = coerceCell(target.meta, raw, { lang: ctx.lang, lookups: options.lookups, decimal: ctx.decimal });
      if (!('error' in outcome)) return outcome;
      // An option field fails only by naming no option, unless the cell was a broken date.
      const unknownOption = OPTION_TYPES.has(target.meta.type) && !(raw instanceof Date);
      return { error: outcome.error, code: unknownOption ? 'CELL_UNKNOWN_OPTION' : 'CELL_FORMAT' };
    },

    finalize(record, ctx): Record<string, unknown> {
      const shaped = shape(record);
      return ctx.stamp === false ? shaped : (stampRecord(shaped, config) as Record<string, unknown>);
    },

    validate(record, ctx): ImporterRecordProblem[] {
      return validateImportedRecordCoded(record, config, {
        lang: ctx.lang,
        rules: options.rules,
        targets: leafTargets,
      });
    },
  };
}
