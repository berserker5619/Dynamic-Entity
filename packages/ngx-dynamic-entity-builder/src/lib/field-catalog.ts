/**
 * field-catalog.ts — re-exports shared field catalog from @dynamic-entity/core.
 * Single source of truth shared by both visual builder and renderer.
 */
export {
  FIELD_TYPE_CATALOG,
  getFieldTypeMeta,
  humanizeId,
  createFieldConfig,
  type FieldTypeMeta,
  type FlagValidator,
  type ParamValidator,
} from '@dynamic-entity/core';
