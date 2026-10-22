/**
 * `@dynamic-entity/core/history` — change history for records and for form configs, through
 * `audit-trail-text`.
 *
 * Its own entry rather than part of the root barrel because `audit-trail-text` is ESM-only.
 * The root entry's CommonJS build must keep loading on every Node version an app runs on, and
 * would not if it required an ES module. Importing this subpath from CommonJS needs Node 20.19
 * or later, or 22.12 or later, or a dynamic `import()`.
 */
export {
  describeEntityChanges,
  diffEntityRecords,
  entityAuditAdapter,
  entitySchema,
} from './history-records';
export type { DescribeEntityChangesOptions, DiffEntityRecordsOptions, EntityAuditAdapterOptions } from './history-records';
export { describeFormChanges, diffFormConfigs, formChangeMessages } from './history-forms';
export type { FormMessageKey } from './history-forms';
export type { DescribeFormChangesOptions, DiffFormConfigsOptions, FormRules } from './history-forms';
export type { Change, Sentence, SentencePart } from 'audit-trail-text';
