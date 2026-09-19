/**
 * all-configs.spec.ts — the whole import feature, over every config the repository ships.
 *
 * **What this exists to catch.** Every other import test in this repository picks a config and
 * proves something about that config. `sheet.fixtures.ts` carries five columns and five field
 * types; the browser E2E drives `clients`, which has three. The repository actually ships
 * seven configs in `test_data.json` spanning sixteen field types, two rules, pattern
 * validators, bounded numbers, `file` and `image` columns a sheet cannot carry, and a
 * `listName` that only resolves against a lookup list. A field type that breaks on
 * `insuranceClaims` and nowhere else currently breaks in production and in no test.
 *
 * So nothing here is authored per config. The columns come from `buildTemplateSpec`, the row
 * comes from `config-rows.fixtures.ts`, and a config added to `test_data.json` tomorrow is
 * covered by these tests without anyone editing them.
 *
 * **The parity claim.** Each config's one synthesised row goes three ways — `applyMapping`
 * directly (the in-browser path), the same row as CSV through `runImport`, and the same row as
 * a *typed* workbook through `runImport` — and the three records must be identical. One
 * engine, three transports, asserted across every field type the repo uses rather than the
 * five somebody wrote down.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  applyMapping,
  buildTemplateSpec,
  deriveImportColumns,
  lookupValuesToOptions,
  normalizeLookupValues,
  suggestMapping,
  type EntityFormConfig,
  type FormRule,
  type ImportLookups,
  type MappingPlan,
} from '@dynamic-entity/core';
import { synthesiseCsv, synthesiseRow, synthesiseTypedRow } from './config-rows.fixtures';
import { listNamesOf } from './express';
import { runImport } from './run-import';
import { chunked } from './sheet.fixtures';
import { workbookOf } from './workbook.fixtures';

const ROOT = join(__dirname, '..', '..', '..');

/**
 * Read rather than imported, because this package's tsconfig has no `resolveJsonModule` and
 * turning it on for a fixture would change how the shipped source is compiled.
 */
const CONFIGS = JSON.parse(readFileSync(join(ROOT, 'test_data.json'), 'utf8')) as EntityFormConfig[];

/**
 * The real `clientTier` list, resolved exactly the way `import-server.mjs` resolves it.
 *
 * Not a list invented here. `insuranceClaims.clientTier` is the only `listName` in the
 * repository, the demo server loads this file, and a made-up list would let the synthesiser
 * and the coercion agree with each other while both disagreed with what ships.
 */
const LOOKUPS: ImportLookups = {
  clientTier: lookupValuesToOptions(
    normalizeLookupValues(
      JSON.parse(
        readFileSync(
          join(ROOT, 'packages', 'demo-angular', 'src', 'app', 'mock', 'client-tier-list.json'),
          'utf8',
        ),
      ),
    ),
  ),
};

/** `rules` rides on the JSON beside the config; `EntityFormConfig` does not declare it. */
function rulesOf(config: EntityFormConfig): readonly FormRule[] {
  const raw = (config as unknown as Record<string, unknown>)['rules'];
  return Array.isArray(raw) ? (raw as FormRule[]) : [];
}

/** Everything a config's row needs, derived once so the three paths share it exactly. */
function setUp(config: EntityFormConfig): {
  headers: string[];
  plan: MappingPlan;
  row: string[];
  typedRow: unknown[];
  columns: ReturnType<typeof deriveImportColumns>['columns'];
} {
  const spec = buildTemplateSpec(config, { lang: 'en' });
  const headers = spec.columns.map(column => column.header);
  const { columns } = deriveImportColumns(config, { lang: 'en' });
  const options = { lang: 'en', lookups: LOOKUPS, entity: config.entity };

  return {
    headers,
    columns,
    plan: suggestMapping(headers, columns, config.entity),
    row: synthesiseRow(spec.columns, options),
    typedRow: synthesiseTypedRow(spec.columns, options),
  };
}

/** Run a whole file through the server and keep the records, which `runImport` does not return. */
async function importAll(
  bytes: string | Uint8Array,
  plan: MappingPlan,
  config: EntityFormConfig,
): Promise<{ records: Record<string, unknown>[]; result: Awaited<ReturnType<typeof runImport>> }> {
  const records: Record<string, unknown>[] = [];
  const result = await runImport({
    stream: chunked(bytes, 8192),
    plan,
    config,
    rules: rulesOf(config),
    lookups: LOOKUPS,
    lang: 'en',
    onBatch: batch => {
      records.push(...batch);
    },
  });
  return { records, result };
}

describe.each(CONFIGS.map(config => [config.entity, config] as const))(
  'every field type %s uses',
  (entity, config) => {
    /**
     * A template whose own headers do not map is a template that fails on first use.
     *
     * `exact` and not merely "mapped": a `guess` is the suggester falling back to a field's
     * label or id, which means the *header* did not match — and a generated template's headers
     * are the one input that should never need guessing at.
     */
    it('generates a template whose every column maps back exactly', () => {
      const { headers, plan } = setUp(config);

      expect(headers.length).toBeGreaterThan(0);
      expect(plan.entries).toHaveLength(headers.length);
      expect(plan.entries.filter(entry => entry.confidence !== 'exact')).toEqual([]);
      // And onto distinct fields, so two headings never land on one ref.
      expect(new Set(plan.entries.map(entry => entry.ref)).size).toBe(headers.length);
    });

    it('imports a synthesised row in the browser, with no errors at all', () => {
      const { plan, row } = setUp(config);
      const result = applyMapping([row], plan, config, {
        lang: 'en',
        lookups: LOOKUPS,
        rules: rulesOf(config),
      });

      // The errors first: `toHaveLength(1)` on an empty `records` reports "0 !== 1" and tells
      // nobody which field of which config went wrong.
      expect(result.errors).toEqual([]);
      expect(result.planProblems).toEqual([]);
      expect(result.records).toHaveLength(1);
      expect(result.skipped).toBe(0);
    });

    it('produces the same record from a CSV on a server', async () => {
      const { plan, row, columns } = setUp(config);
      const spec = buildTemplateSpec(config, { lang: 'en' });
      const csv = synthesiseCsv(spec.columns, 1, {
        lang: 'en',
        lookups: LOOKUPS,
        entity: config.entity,
      });
      expect(columns.length).toBe(spec.columns.length);

      const local = applyMapping([row], plan, config, {
        lang: 'en',
        lookups: LOOKUPS,
        rules: rulesOf(config),
      });
      const { records, result } = await importAll(csv, plan, config);

      expect(result.errors).toEqual([]);
      expect(result.imported).toBe(1);
      expect(result.format).toBe('csv');
      expect(records).toEqual(local.records);
    });

    /**
     * The leg the CSV one cannot stand in for.
     *
     * A workbook does not hold text in a date cell — it holds a `Date` — so this is the only
     * path that reaches `coerceTypedCell`, the function that exists because `String(date)`
     * renders local time and moves the day for everyone west of Greenwich. The typed row and
     * the text row must still produce the same record, which is what is asserted.
     */
    it('produces the same record from a typed workbook', async () => {
      const { headers, plan, row, typedRow } = setUp(config);
      const book = await workbookOf(headers, [typedRow]);

      const local = applyMapping([row], plan, config, {
        lang: 'en',
        lookups: LOOKUPS,
        rules: rulesOf(config),
      });
      const { records, result } = await importAll(book, plan, config);

      expect(result.errors).toEqual([]);
      expect(result.imported).toBe(1);
      expect(result.format).toBe('xlsx');
      expect(records).toEqual(local.records);
    });

    /**
     * A field a sheet cannot carry is *reported*, never quietly dropped.
     *
     * An `image` column missing from a generated template looks identical to one nobody
     * thought to include, and the user finds out when the import they believed was complete
     * turns out not to be.
     */
    it('reports what a sheet cannot carry, with a reason', () => {
      const spec = buildTemplateSpec(config, { lang: 'en' });
      const mapped = new Set(spec.columns.map(column => column.ref));

      for (const gap of spec.unsupported) {
        expect(typeof gap.reason).toBe('string');
        expect(gap.reason.length).toBeGreaterThan(0);
        // Reported *instead of* generated, not as well as.
        expect(mapped.has(gap.ref)).toBe(false);
      }
    });
  },
);

/**
 * The `file` and `image` fields two configs carry, named rather than counted.
 *
 * The generic assertion above passes vacuously for a config with no unsupported fields, which
 * is five of the seven. This is what stops the whole unsupported path being proven by nothing.
 */
describe('the fields a spreadsheet genuinely cannot carry', () => {
  it.each([
    ['complexFullTest', ['datesAndFilesTab.avatarImage', 'datesAndFilesTab.complianceDoc']],
    [
      'insuranceClaims',
      ['incident.incidentAttachments.claimantPhoto', 'incident.incidentAttachments.lossReport'],
    ],
  ])('%s reports its attachment fields', (entity, refs) => {
    const config = CONFIGS.find(candidate => candidate.entity === entity)!;
    const spec = buildTemplateSpec(config, { lang: 'en' });

    expect(spec.unsupported.map(gap => gap.ref).sort()).toEqual([...refs].sort());
    for (const gap of spec.unsupported) {
      expect(gap.reason).toMatch(/spreadsheet cell cannot carry/);
    }
  });
});

/**
 * The lookups a server must be handed, checked against the list this file supplies.
 *
 * `createImportRouter` refuses to start when a config names a list it was not given — the
 * guard that exists because an unsupplied list means the raw cell text is stored, which
 * renders correctly and matches nothing. A config added with a *second* `listName` would
 * otherwise make every matrix test above quietly stop exercising the option path.
 */
describe('lookups', () => {
  it('supplies every list any config names', () => {
    const wanted = new Set(CONFIGS.flatMap(config => listNamesOf(config)));
    expect([...wanted].filter(name => !LOOKUPS[name])).toEqual([]);
    // And the one that exists is exercised, rather than the set merely being empty.
    expect(wanted.has('clientTier')).toBe(true);
  });
});

/**
 * The synthesiser is a test dependency, so its failure mode is asserted rather than trusted.
 *
 * A synthesiser that answered a required pattern field with a blank would turn every failure
 * above into a pass — `applyMapping` would report one error on one field and the config matrix
 * would look like it was exercising something. That is the whole reason it throws.
 */
describe('the synthesiser refuses to blank a field it cannot satisfy', () => {
  it('throws, naming the config and the ref', () => {
    const config = CONFIGS.find(candidate => candidate.entity === 'complexFullTest')!;
    const spec = buildTemplateSpec(config, { lang: 'en' });
    const impossible = spec.columns.map(column =>
      column.ref === 'generalTab.emailAddress'
        ? { ...column, field: { ...column.field, validators: { pattern: '^\\u0000$' } } }
        : column,
    );

    expect(() => synthesiseRow(impossible, { entity: config.entity })).toThrow(
      /generalTab\.emailAddress.*complexFullTest/s,
    );
  });
});
