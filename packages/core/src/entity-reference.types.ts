/**
 * entity-reference.types.ts — contracts for consumer entity reference option loaders & cascades.
 */

export interface ReferenceOption {
  value: any;
  label: string;
  record?: Record<string, unknown>;
}

export interface ReferenceLoaderContext {
  parentValue?: unknown;
  filters?: Record<string, unknown>;
  lang?: string;
}

export type EntityReferenceLoader = (
  ctx: ReferenceLoaderContext,
) => Promise<ReferenceOption[]>;
