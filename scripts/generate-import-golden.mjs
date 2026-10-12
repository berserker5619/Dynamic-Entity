#!/usr/bin/env node
/**
 * generate-import-golden.mjs — what Dynamic Entity 2.5.0 imports, written down.
 *
 * Since 3.0 `applyMapping` is sheet-to-schema's engine over `entityFormConfigAdapter`. The
 * claim that nothing changed for a 2.x user needs something to be compared with that is not
 * the new code. This script runs the **published** `@dynamic-entity/core@2.5.0` over a set of
 * sheets, plans and configs, and writes both the inputs and what 2.5.0 made of them to
 * `packages/core/test-fixtures/import-golden-2.5.0.json`. `entity-form-config-adapter.spec.ts`
 * runs the same inputs through the current code and compares.
 *
 * The inputs are in the file too, so there is one definition of each case, here. The plans
 * are the ones 2.5.0's own `suggestMapping` wrote, or are written by hand in its shape: they
 * are stored 2.x plans, which is what must keep importing.
 *
 * To regenerate (only ever against 2.5.0; the file is a record, not a snapshot to refresh):
 *
 *     mkdir /tmp/de-2.5.0 && cd /tmp/de-2.5.0
 *     npm pack @dynamic-entity/core@2.5.0 && tar -xzf dynamic-entity-core-2.5.0.tgz
 *     node scripts/generate-import-golden.mjs --core /tmp/de-2.5.0/package
 *
 * A typed cell cannot be written in JSON, so a `Date` is `{ "$date": "<ISO>" }`, and an invalid
 * one `{ "$date": null }`.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';

const ROOT = process.cwd();
const at = process.argv.indexOf('--core');
if (at < 0 || !process.argv[at + 1]) {
  console.error('usage: node scripts/generate-import-golden.mjs --core <path to the unpacked @dynamic-entity/core@2.5.0>');
  process.exit(1);
}
const corePath = resolve(process.argv[at + 1]);
const core = createRequire(import.meta.url)(join(corePath, 'index.js'));
if (core.CORE_VERSION !== '2.5.0') {
  console.error(`That is @dynamic-entity/core ${core.CORE_VERSION}. The golden file is a record of 2.5.0 and of nothing else.`);
  process.exit(1);
}

const read = path => JSON.parse(readFileSync(join(ROOT, path), 'utf8'));
const SHIPPED = read('test_data.json');
/** The real `clientTier` list, resolved the way the demo server resolves it. */
const LOOKUPS = {
  clientTier: core.lookupValuesToOptions(core.normalizeLookupValues(read('packages/demo-angular/src/app/mock/client-tier-list.json'))),
};

// ── A typed cell, in JSON ─────────────────────────────────────────────────────
const encode = cell => (cell instanceof Date ? { $date: Number.isNaN(cell.getTime()) ? null : cell.toISOString() } : cell);
const encodeRows = rows => rows.map(row => row.map(encode));
/** As JSON holds it: what the spec reads back is what was written. */
const encodeResult = result => JSON.parse(JSON.stringify(result));
/** `raw` on an error may be a typed cell too. */
const withDates = result => ({
  ...result,
  errors: result.errors.map(error => ('raw' in error ? { ...error, raw: encode(error.raw) } : error)),
});

// ── A row for any config ──────────────────────────────────────────────────────
const PATTERN_CANDIDATES = ['ada@example.com', 'AB123456C', 'ABC-123', 'REF-0001', '123-45-6789', 'AST-00042', '12345', 'A1', 'Sample'];

/** A cell the field accepts, as text. */
function cellFor(column) {
  const field = column.field;
  const validators = field.validators ?? {};
  switch (field.type) {
    case 'dropdown':
    case 'radio':
    case 'multiSelect': {
      const fromList = field.listName ? LOOKUPS[field.listName]?.[0] : undefined;
      return column.enumValues?.[0] ?? (fromList ? String(fromList.en ?? '') : '');
    }
    case 'boolean':
    case 'checkbox':
      return 'true';
    case 'number':
    case 'currency':
      return String(Math.min(Math.max(42, validators.min ?? 42), validators.max ?? 42));
    case 'date':
      return '2024-03-07';
    case 'datetime':
      return '2024-03-07T09:30:00.000Z';
    case 'monthYear':
      return '2024-03';
    case 'time':
      return '09:30';
    case 'url':
      return 'https://example.com/profile';
    case 'phone':
      return '+1 555 555 0123';
    case 'color':
      return '#336699';
    case 'tags':
      return 'alpha;beta';
    case 'slider':
      return String(core.sliderBounds(field).min);
    case 'rating':
      return String(core.ratingScale(field));
    default: {
      if (validators.pattern) {
        const regex = new RegExp(validators.pattern);
        return PATTERN_CANDIDATES.find(candidate => regex.test(candidate)) ?? '';
      }
      if (validators.email) return 'ada@example.com';
      let text = `Sample ${field.id}`;
      if (typeof validators.minLength === 'number') text = text.padEnd(validators.minLength, 'x');
      if (typeof validators.maxLength === 'number') text = text.slice(0, validators.maxLength);
      return text;
    }
  }
}

/** The typed cell an xlsx would carry for the field, where it has one. */
function typedCellFor(column) {
  switch (column.field.type) {
    case 'boolean':
    case 'checkbox':
      return true;
    case 'number':
    case 'currency':
    case 'slider':
    case 'rating':
      return Number(cellFor(column));
    case 'date':
    case 'monthYear':
      return new Date(Date.UTC(2024, 2, 7));
    case 'datetime':
      return new Date(Date.UTC(2024, 2, 7, 9, 30));
    case 'time':
      return new Date(Date.UTC(1899, 11, 30, 9, 30));
    default:
      return cellFor(column);
  }
}

const cases = [];
/** Record one case: its inputs, and what 2.5.0 does with them. */
function add(name, { config, shipped, rows, plan, options = {} }) {
  const cfg = shipped ? SHIPPED.find(c => c.entity === shipped) : config;
  const result = core.applyMapping(rows, plan, cfg, options);
  cases.push({
    name,
    // A shipped config is named, not copied: `test_data.json` is in the repository.
    ...(shipped ? { shipped } : { config }),
    rows: encodeRows(rows),
    plan,
    options,
    expected: encodeResult(withDates(result)),
  });
}

// ── Every shipped config ──────────────────────────────────────────────────────
const suggestions = [];
for (const config of SHIPPED) {
  const spec = core.buildTemplateSpec(config, { lang: 'en' });
  const headers = spec.columns.map(column => column.header);
  const { columns } = core.deriveImportColumns(config, { lang: 'en' });
  // 2.5.0's own suggestion, which is a stored 2.x plan: `entity`, no `planVersion`.
  const plan = { ...core.suggestMapping(headers, columns, config.entity), configVersion: config.version };
  const rules = Array.isArray(config.rules) ? config.rules : [];
  const options = { lang: 'en', lookups: LOOKUPS, rules };
  const text = spec.columns.map(cellFor);
  const typed = spec.columns.map(typedCellFor);
  const garbage = spec.columns.map(() => '???');
  const blank = spec.columns.map(() => '');

  suggestions.push({
    shipped: config.entity,
    headers,
    arrayBound: core.arrayBoundFor(headers, config, undefined, 'en'),
    entries: core
      .suggestMapping(headers, core.deriveImportColumns(config, { lang: 'en', maxArrayRows: core.arrayBoundFor(headers, config, undefined, 'en') }).columns, config.entity)
      .entries.map(({ ref, column, confidence }) => ({ ref, column, confidence })),
  });
  add(`${config.entity}: a valid row, as text and as typed cells`, { shipped: config.entity, rows: [text, typed], plan, options });
  add(`${config.entity}: rows nothing can read, and blank rows`, { shipped: config.entity, rows: [garbage, blank, [], garbage], plan, options });
}

// ── Cases written by hand ─────────────────────────────────────────────────────
const text = (id, label, extra = {}) => ({ id, type: 'text', label: { en: label }, ...extra });
const phones = (extra = {}) => ({ id: 'phones', type: 'array', label: { en: 'Phone' }, children: [text('number', 'Number'), text('kind', 'Kind')], ...extra });
const configWith = (...fields) => ({
  entity: 'people',
  version: 4,
  tabs: [{ id: 'main', label: { en: 'Main' }, flatData: true, fields: [text('name', 'Name'), ...fields] }],
});
const planFor = (refs, extra = {}) => ({ entity: 'people', entries: refs.map((ref, column) => ({ ref, column })), ...extra });
const rule = (value, action, target) => ({
  formConfigId: 'people',
  fieldId: 'name',
  conditions: [{ operator: 'EQUAL', value, compareType: 'value' }],
  action,
  targets: [{ id: target, type: 'field' }],
  enabled: true,
  priority: 0,
});

add('a 2.2 ref of a moved array is read as slot 0, with a warning', {
  config: configWith(phones({ refererField: 'contact.phones' })),
  rows: [['Ada', '111']],
  plan: planFor(['name', 'phones.number']),
  options: { stamp: false },
});
add('a moved group is written at its override and at its position', {
  config: configWith({ id: 'addr', type: 'group', label: { en: 'Address' }, refererField: 'customer.address', children: [text('city', 'City')] }),
  rows: [['Ada', 'Paris']],
  plan: planFor(['name', 'addr.city']),
  options: { stamp: false },
});
add('an old ref mapped alongside its new one is refused', {
  config: configWith(phones({ refererField: 'contact.phones' })),
  rows: [['111', '222']],
  plan: planFor(['phones.number', 'contact.phones.0.number']),
});
add('a ref the config does not have is refused', { config: configWith(), rows: [['x']], plan: planFor(['nope']) });
add('a plan for another entity and another config version imports, with warnings', {
  config: configWith(),
  rows: [['Ada']],
  plan: { ...planFor(['name']), entity: 'pets', configVersion: 3 },
});
add('a sparse array is compacted, and the record is stamped', {
  config: configWith(phones()),
  rows: [['Ada', '', '', '222', 'cell']],
  plan: planFor(['name', 'phones.0.number', 'phones.0.kind', 'phones.1.number', 'phones.1.kind']),
});
add('a rule hides a required field, and a rule raises an error', {
  config: configWith(text('reason', 'Reason', { validators: { required: true } }), text('note', 'Note')),
  rows: [['skip', '', ''], ['Ada', '', ''], ['bad', 'r', 'n']],
  plan: planFor(['name', 'reason', 'note']),
  options: {
    stamp: false,
    rules: [rule('skip', { type: 'visibility', value: false }, 'reason'), rule('bad', { type: 'validation', value: 'Not allowed' }, 'note')],
  },
});
add('each kind of cell and record failure', {
  config: configWith(
    { id: 'age', type: 'number', label: { en: 'Age' }, validators: { min: 18 } },
    { id: 'tier', type: 'dropdown', label: { en: 'Tier' }, options: [{ en: 'Gold' }, { en: 'Silver' }] },
    text('email', 'Email', { validators: { email: true } }),
    { id: 'born', type: 'date', label: { en: 'Born' } },
    { id: 'kinds', type: 'multiSelect', label: { en: 'Kinds' }, listName: 'kinds' },
  ),
  rows: [
    ['Ada', '30', 'Gold', 'ada@example.com', '2024-03-07', 'A; B'],
    ['Bo', 'x', 'Bronze', 'nope', 'never', 'C'],
    ['Cy', '7', new Date(Number.NaN), '', '', ''],
  ],
  plan: planFor(['name', 'age', 'tier', 'email', 'born', 'kinds']),
  options: { stamp: false, lookups: { kinds: [{ en: 'A' }, { en: 'B' }] } },
});
const priced = configWith({ id: 'price', type: 'currency', label: { en: 'Price', de: 'Preis' }, validators: { required: true } });
add('a decimal comma, when the run says so', { config: priced, rows: [['Ada', '1,5']], plan: planFor(['name', 'price']), options: { decimal: ',', stamp: false } });
add("error text in the run's language", { config: priced, rows: [['Ada', '']], plan: planFor(['name', 'price']), options: { lang: 'de' } });
add('a typed constant as it is, and a text one through the field', {
  config: configWith({ id: 'active', type: 'boolean', label: { en: 'Active' } }, { id: 'tier', type: 'dropdown', label: { en: 'Tier' }, options: [{ en: 'Gold' }] }),
  rows: [['Ada'], ['']],
  plan: { entity: 'people', entries: [{ ref: 'name', column: 0 }, { ref: 'active', constant: 'yes' }, { ref: 'tier', constant: { en: 'Gold' } }] },
  options: { stamp: false },
});
add("the form's email rule takes an address with no dot in its domain", {
  config: configWith(text('email', 'Email', { validators: { email: true } })),
  rows: [['Rahul', 'rahul.k@example'], ['Ada', 'ada@']],
  plan: planFor(['name', 'email']),
  options: { stamp: false },
});
const born = configWith({ id: 'born', type: 'date', label: { en: 'Born' } });
for (const dateOrder of ['DMY', 'MDY', undefined]) {
  add(`a slash date with ${dateOrder ? `the run's order ${dateOrder}` : 'no order stated'}`, {
    config: born,
    rows: [['Ada', '05/09/2026']],
    plan: planFor(['name', 'born']),
    options: { stamp: false, ...(dateOrder ? { dateOrder } : {}) },
  });
}
add('a required field whose cell cannot be read, and one nobody filled in', {
  config: configWith({ id: 'age', type: 'number', label: { en: 'Age' }, validators: { required: true } }, text('city', 'City', { validators: { required: true } })),
  rows: [['Ada', 'old', '']],
  plan: planFor(['name', 'age', 'city']),
  options: { stamp: false },
});
add('a plan that names no entity is read against the config it is given', {
  config: configWith(),
  rows: [['Ada']],
  plan: { entries: [{ ref: 'name', column: 0 }] },
  options: { stamp: false },
});

const out = {
  generatedBy: 'scripts/generate-import-golden.mjs',
  from: `@dynamic-entity/core@${core.CORE_VERSION}, the published package`,
  note: 'A record of what 2.5.0 imports. Do not edit, and do not regenerate against any other version.',
  suggestions,
  cases,
};
const target = join(ROOT, 'packages', 'core', 'test-fixtures', 'import-golden-2.5.0.json');
writeFileSync(target, JSON.stringify(out, null, 1) + '\n');
console.log(`Wrote ${cases.length} cases and ${suggestions.length} suggestions from @dynamic-entity/core@${core.CORE_VERSION} to ${target}.`);
