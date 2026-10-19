/**
 * Every sheet-to-schema fixture through DE's own router, against sheet-to-schema's router over the
 * binding DE's router builds (docs/3.1-spec.md, A). ngx's `sheet-to-schema-fixtures.spec.ts` holds
 * `LocalImportTransport` to the same router, so the browser and DE's server agree on every file.
 * The files and the config derived from each are `core/test-fixtures/sheet-to-schema-fixtures.ts`.
 */
import type { EntityFormConfig } from '@dynamic-entity/core';
import { caseOf, SHEET_TO_SCHEMA_FIXTURES } from '../../core/test-fixtures/sheet-to-schema-fixtures';
import { viaImporterRouter, viaRouter } from '../../core/test-fixtures/grouping-cases';
import { createImportRouter } from './express';

/** DE's router, serving `config` as an app would mount it. */
const viaDynamicEntity = (config: EntityFormConfig) =>
  viaRouter((app, onImport) => {
    app.use('/import', createImportRouter({ configs: { [config.entity]: config }, onImport: records => onImport(records) }));
  });

it('covers every fixture', () => {
  expect(SHEET_TO_SCHEMA_FIXTURES).toHaveLength(18);
});

it.each(SHEET_TO_SCHEMA_FIXTURES.map(fixture => [fixture.file, fixture] as const))("%s: DE's router imports what sheet-to-schema's router imports", async (_, fixture) => {
  const { case: c, file } = await caseOf(fixture);
  expect(await viaDynamicEntity(c.config)(c, file)).toEqual(await viaImporterRouter(c, file));
});
