/**
 * grouping-transport.ts — the demo's grouped plans (?plan=grouped), for the import wizard.
 *
 * DE 3.1 imports plans that group several rows into one record, and the wizard has no screen for
 * building one yet (docs/3.1-spec.md: Phase 4, "grouped plans come from code"). This is that code
 * for the demo. It wraps the transport the demo would use anyway and turns each suggestion into a
 * grouped plan, so a reader, and e2e/import-messages.spec.ts, can see what grouping does in the
 * browser and on a server, and what the wizard says when it cannot.
 *
 * The rule, stated once: rows are grouped by the column the suggestion maps to its first field
 * outside an array, and each numbered-column array (`items.0.sku`, `items.1.sku`, …) becomes a
 * collected one, read from the columns of its first slot (`items.sku`), one item per row.
 */
import type { AnyMappingPlan, MappingEntry, MappingPlan } from '@dynamic-entity/core';
import type { ImportTransport } from 'ngx-dynamic-entity';

const SLOT = /^(.+?)\.(\d+)\.(.+)$/;

/** The suggestion as a grouped plan, or the suggestion when there is nothing to group by. */
export function groupedPlanOf(suggestion: AnyMappingPlan): AnyMappingPlan {
  const plan = suggestion as MappingPlan;
  const entries = plan.entries ?? [];
  const collect = new Set<string>();
  const regrouped: MappingEntry[] = [];
  for (const entry of entries) {
    const slot = SLOT.exec(entry.ref);
    if (!slot) {
      regrouped.push(entry);
      continue;
    }
    // The first slot's columns carry each row's item; the other slots' columns are not read.
    if (slot[2] !== '0') continue;
    collect.add(slot[1]);
    regrouped.push({ ...entry, ref: `${slot[1]}.${slot[3]}` });
  }
  const key = entries.find(entry => !SLOT.test(entry.ref) && entry.column !== undefined)?.column;
  if (key === undefined || !collect.size) return suggestion;
  return { ...plan, planVersion: 2, entries: regrouped, group: { key: [key], collect: [...collect] } };
}

/** `base`, with every suggestion grouped. */
export function groupingTransport(base: ImportTransport): ImportTransport {
  return {
    accept: base.accept,
    preview: async (file, context) => {
      const preview = await base.preview(file, context);
      return { ...preview, suggestion: groupedPlanOf(preview.suggestion) };
    },
    commit: (file, plan, context) => base.commit(file, plan, context),
    template: (spec, format, context, fields) => base.template(spec, format, context, fields),
  };
}
