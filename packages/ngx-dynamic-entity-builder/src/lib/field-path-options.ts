import type { EntityFormConfig } from '@dynamic-entity/core';
import { collectFieldScopes, refOf, resolveLabel, toRefToken } from '@dynamic-entity/core';

/** One choosable field: the reference stored, the label shown, and the path behind it. */
export interface FieldPathOption {
  value: string;
  label: string;
  path: string;
}

/**
 * Every field in the config, offered by path.
 *
 * Four places in the builder name a field — `showWhen` keys, `patchOnTrue` mappings,
 * `autoPatch` targets and rule triggers/targets — and each was a free-text box. Typing an id
 * is the one way left to author an ambiguous reference: ids are unique per scope, so
 * `address` names nothing in particular once two tabs have one. Choosing from this list
 * always yields a path.
 *
 * `collectFieldScopes` rather than the tab-level view, so a field nested inside a `group` is
 * offered too, and every entry carries the scope `refOf` needs.
 */
export function fieldPathOptions(
  config: EntityFormConfig | null | undefined,
  language: string,
): FieldPathOption[] {
  return collectFieldScopes(config).map(entry => {
    const path = refOf(entry.field, entry.scope);
    return {
      value: toRefToken(path),
      label: resolveLabel(entry.field.label, language) || entry.field.id,
      path,
    };
  });
}

/**
 * The options plus whatever is already selected.
 *
 * A reference written before paths existed is a bare id, and one written against a field
 * since deleted is a path nothing answers to. Neither appears in the list, and a `mat-select`
 * silently drops a value it has no option for — so opening such a config and saving it would
 * quietly erase the reference. They are kept, and shown as they are.
 */
export function withExistingOptions(
  options: readonly FieldPathOption[],
  current: readonly (string | undefined)[],
): FieldPathOption[] {
  const known = new Set(options.map(o => o.value));
  const extra = current
    .filter((value): value is string => !!value && !known.has(value))
    .map(value => ({ value, label: value, path: 'not in this config' }));
  return [...options, ...extra];
}
