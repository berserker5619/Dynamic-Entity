/**
 * Change history, for records and for form configs, over the demo's own seed configs and
 * records: a sentence is only worth testing against the data people will actually see.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { COMPLEX_FULL_TEST_RECORDS, INSURANCE_CLAIMS_RECORDS } from '../../demo-angular/src/app/mock/seed-records';
import type { EntityFormConfig, FormRule, NestedFieldConfig } from './form-model.types';
import {
  describeEntityChanges,
  describeFormChanges,
  diffEntityRecords,
  diffFormConfigs,
  entityAuditAdapter,
  entitySchema,
  type Change,
} from './history';
import { applyRowIds, type RecordMigration } from './migration';
import { ROW_ID_KEY } from './row-ids';

const CONFIGS = JSON.parse(readFileSync(join(__dirname, '..', '..', '..', 'test_data.json'), 'utf8')) as EntityFormConfig[];
const config = (entity: string): EntityFormConfig => structuredClone(CONFIGS.find(c => c.entity === entity)!);
const clone = <T>(value: T): T => structuredClone(value);

const CLAIMS = config('insuranceClaims');
const CFT = config('complexFullTest');

/** A claim as 3.2 saves it: rows carry ids. */
const savedClaim = () => applyRowIds(clone(INSURANCE_CLAIMS_RECORDS[0]), CLAIMS);
const savedCft = () => applyRowIds(clone(COMPLEX_FULL_TEST_RECORDS[0]), CFT);

const en = (changes: Change[], cfg: EntityFormConfig = CLAIMS) => describeEntityChanges(changes, { config: cfg }).map(s => s.text);
const de = (changes: Change[], cfg: EntityFormConfig = CLAIMS) =>
  describeEntityChanges(changes, { config: cfg, language: 'de' }).map(s => s.text);

describe('record history', () => {
  it('reports an edit in a tab, under the tab', () => {
    const before = savedCft();
    const after = clone(before);
    after.generalTab.fullName = 'Helena V. Quintero';
    after.generalTab.teamCount = 14;

    const changes = diffEntityRecords(before, after, CFT);
    expect(changes.map(c => [c.code, c.afterPath])).toEqual([
      ['FIELD_CHANGED', '/generalTab/fullName'],
      ['FIELD_CHANGED', '/generalTab/teamCount'],
    ]);
    expect(en(changes, CFT)[1]).toMatch(/: .+ changed from 12 to 14$/);
  });

  it('reports an edit in a group, through the group', () => {
    const before = savedCft();
    const after = clone(before);
    after.nestedStructuresTab.addressGroup.city = 'Amsterdam';

    const [change] = diffEntityRecords(before, after, CFT);
    expect(change).toMatchObject({ code: 'FIELD_CHANGED', afterPath: '/nestedStructuresTab/addressGroup/city', before: 'Rotterdam', after: 'Amsterdam' });
    expect(en([change], CFT)[0]).toMatch(/changed from "Rotterdam" to "Amsterdam"$/);
  });

  it('follows array rows by $rowId through an edit, a removal, an addition and a reorder', () => {
    const before = savedClaim();
    const after = clone(before);
    const rows = after.settlement.lineItems as Record<string, unknown>[];
    rows[2]['itemAmount'] = 25000; // edit the third
    rows.splice(0, 1); // remove the first
    rows.push({ [ROW_ID_KEY]: 'new-row', itemDescription: 'Loss adjuster fee', itemAmount: 1200, itemApproved: false });
    rows.reverse(); // and move them around

    const changes = diffEntityRecords(before, after, CLAIMS);
    const codes = changes.map(c => c.code);
    expect(codes).toEqual(expect.arrayContaining(['FIELD_CHANGED', 'ITEM_REMOVED', 'ITEM_ADDED', 'LIST_REORDERED']));

    const text = en(changes);
    // The edit lands on the row that was edited, named by its first text column, not on
    // whatever row now sits at its old index.
    expect(text).toContain('Settlement › Settlement Line Items › Business interruption, 11 days: Amount changed from 23,400 to 25,000');
    expect(text).toContain('Settlement: Row "Structural repair, packing bay" removed from Settlement Line Items');
    expect(text).toContain('Settlement: Row "Loss adjuster fee" added to Settlement Line Items');
    expect(changes.find(c => c.code === 'ITEM_REMOVED')!.item!.key).toBe('legacy-1');
  });

  it('reads a localized option in the reader language, coded and stored as a language map', () => {
    // `department` stores a code whose options carry en and de labels.
    const before = savedCft();
    const after = clone(before);
    after.generalTab.department = 'FIN';
    const coded = diffEntityRecords(before, after, CFT);
    expect(en(coded, CFT)[0]).toMatch(/Department changed from Engineering to Finance & Ops$/);
    expect(de(coded, CFT)[0]).toMatch(/Abteilung.* changed from Ingenieurwesen to Finanzen$|changed from Ingenieurwesen to Finanzen$/);

    // `tier` is a lookup: the record holds the whole localized option.
    const claim = savedClaim();
    const promoted = clone(claim);
    promoted['tier'] = { en: 'Platinum', de: 'Platin' };
    const stored = diffEntityRecords(claim, promoted, CLAIMS);
    expect(en(stored)[0]).toMatch(/changed from Gold to Platinum$/);
    expect(de(stored)[0]).toMatch(/changed from Gold to Platin$/);
  });

  it('does not count renaming a keyed option as an edit to a record that holds it', () => {
    const claim = savedClaim();
    claim.incident.incidentDetails.severity = { $key: 'high', en: 'High' };
    const renamed = clone(claim);
    renamed.incident.incidentDetails.severity = { $key: 'high', en: 'Severe' };
    expect(diffEntityRecords(claim, renamed, CLAIMS)).toEqual([]);
  });

  it('reports a masked field without its values', () => {
    const before = savedClaim();
    const after = clone(before);
    after.settlement.auditorPin = '4411';
    after['nationalId'] = 'QQ000000Z';

    const changes = diffEntityRecords(before, after, CLAIMS);
    for (const change of changes) {
      expect(change.redacted).toBe(true);
      expect(change).not.toHaveProperty('before');
      expect(change).not.toHaveProperty('after');
    }
    expect(en(changes)).toEqual(['National Insurance No. changed', 'Settlement: Auditor PIN set']);
    expect(JSON.stringify(changes)).not.toContain('4411');
    expect(JSON.stringify(changes)).not.toContain('QQ447199A');
  });

  it('matches a 3.1 record without row ids to the same record saved since', () => {
    // Before: exactly as 3.1 stored it. After: opened in the 3.2 form, one amount edited, saved.
    const stored31 = clone(INSURANCE_CLAIMS_RECORDS[0]) as Record<string, any>;
    expect(JSON.stringify(stored31)).not.toContain(ROW_ID_KEY);
    const saved = applyRowIds(clone(stored31), CLAIMS);
    saved.settlement.lineItems[1].itemAmount = 18000;

    const changes = diffEntityRecords(stored31, saved, CLAIMS);
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ code: 'FIELD_CHANGED', item: { key: 'legacy-2' }, before: 17650, after: 18000 });
  });

  it('never reads a field renamed by a migration as an edit', () => {
    // Version 1 of insuranceClaims called `claimRef` `claimNumber`.
    const rename: RecordMigration = {
      from: 1,
      to: 2,
      migrate: record => {
        const { claimNumber, ...rest } = record;
        return { ...rest, claimRef: claimNumber };
      },
    };
    const { claimRef, ...rest } = savedClaim();
    const v1 = { ...rest, claimNumber: claimRef, _configVersion: 1 };
    const v2: Record<string, any> = { ...savedClaim(), _configVersion: 2 };

    expect(diffEntityRecords(v1, v2, CLAIMS, { migrations: [rename] })).toEqual([]);

    v2['claimRef'] = 'CLM-2026-0431-A';
    const changes = diffEntityRecords(v1, v2, CLAIMS, { migrations: [rename] });
    expect(changes.map(c => [c.code, c.afterPath])).toEqual([['FIELD_CHANGED', '/claimRef']]);

    // Without the migration the rename is exactly the noise this exists to prevent.
    const noisy = diffEntityRecords(v1, v2, CLAIMS).map(c => c.code);
    expect(noisy).toEqual(expect.arrayContaining(['FIELD_SET', 'FIELD_CLEARED']));
  });

  it('migrates an unstamped record only when told which version it is', () => {
    const rename: RecordMigration = { from: 1, to: 2, migrate: r => ({ ...r, claimRef: r['claimNumber'], claimNumber: undefined }) };
    const unstamped = { claimNumber: 'X' };
    expect(diffEntityRecords(unstamped, { claimRef: 'X', _configVersion: 2 }, CLAIMS, { migrations: [rename], assumeVersion: 1 })).toEqual([]);
  });

  it('ignores system fields and records a create and a delete', () => {
    const before = { ...savedClaim(), _id: 'a', _configVersion: 2, _deletedAt: null, _updatedAt: '1' };
    const after = { ...clone(before), _id: 'b', _configVersion: 3, _deletedAt: '2026-10-22', _updatedAt: '2' };
    expect(diffEntityRecords(before, after, CLAIMS)).toEqual([]);

    expect(diffEntityRecords(null, before, CLAIMS)[0].code).toBe('RECORD_CREATED');
    expect(en(diffEntityRecords(before, null, CLAIMS))[0]).toMatch(/deleted$/);
  });

  it('reports a field moved by refererField once, where its tab puts it', () => {
    const moved: EntityFormConfig = {
      entity: 'contacts',
      tabs: [
        {
          id: 'main',
          label: { en: 'Main' },
          fields: [{ id: 'phone', type: 'text', label: { en: 'Phone' }, refererField: 'contact.phone' } as NestedFieldConfig],
        },
      ],
    };
    const before = { main: { phone: '1' }, contact: { phone: '1' } };
    const after = { main: { phone: '2' }, contact: { phone: '2' } };
    expect(en(diffEntityRecords(before, after, moved), moved)).toEqual(['Main: Phone changed from "1" to "2"']);
  });

  it('reads a flatData tab at the record root', () => {
    const before = savedClaim();
    const after = clone(before);
    after['claimantEmail'] = 'r.delgado@example.org';
    expect(diffEntityRecords(before, after, CLAIMS).map(c => c.afterPath)).toEqual(['/claimantEmail']);
  });

  it('defaults the language to the config’s defaultLanguage', () => {
    const before = savedClaim();
    const after = clone(before);
    after['claimRef'] = 'X';
    const changes = diffEntityRecords(before, after, CLAIMS);
    expect(describeEntityChanges(changes, { config: { ...CLAIMS, defaultLanguage: 'de' } })[0].text).toBe(de(changes)[0]);
    expect(describeEntityChanges(changes)[0].text).toBe(en(changes)[0]);
  });

  it('reuses a given adapter', () => {
    const adapter = entityAuditAdapter(CLAIMS);
    const before = savedClaim();
    const after = { ...clone(before), claimRef: 'Y' };
    expect(diffEntityRecords(before, after, CLAIMS, { adapter })).toEqual(diffEntityRecords(before, after, CLAIMS));
  });
});

describe('the schema a config reads as', () => {
  const props = (schema: Record<string, any>, ...path: string[]) => path.reduce((s, key) => s.properties[key], schema);

  it('types values so they read as dates, numbers and Yes / No', () => {
    const schema = entitySchema(CFT);
    expect(props(schema, 'datesAndFilesTab', 'joinDate')).toMatchObject({ type: 'string', format: 'date' });
    expect(props(schema, 'generalTab', 'annualBudget')).toMatchObject({ type: 'number' });
    expect(props(schema, 'generalTab', 'accountActive')).toMatchObject({ type: 'boolean' });
    expect(props(schema, 'generalTab', 'optInNewsletter')).toMatchObject({ type: 'boolean' });
    expect((entitySchema(CLAIMS) as any).properties.incident.properties.incidentDetails.properties.reportedAt).toMatchObject({ format: 'date-time' });
  });

  it('keys a file by its url and names it by its file name; keeps an entity-ref as its id', () => {
    const schema = entitySchema(CFT);
    expect(props(schema, 'datesAndFilesTab', 'complianceDoc')).toMatchObject({ 'x-atomic': true, 'x-key': 'url', 'x-label': '{name}' });
    expect(props(schema, 'datesAndFilesTab', 'avatarImage')).toMatchObject({ 'x-atomic': true, 'x-key': 'url' });
    expect(props(schema, 'datesAndFilesTab', 'orgRef')).toMatchObject({ type: 'string' });

    const before = { datesAndFilesTab: { complianceDoc: { url: 'https://f/1', name: 'policy-v1.pdf' } } };
    const after = { datesAndFilesTab: { complianceDoc: { url: 'https://f/2', name: 'policy-v2.pdf' } } };
    expect(en(diffEntityRecords(before, after, CFT), CFT)[0]).toMatch(/changed from policy-v1\.pdf to policy-v2\.pdf$/);
  });

  it('treats tags and an array without children as plain values, and a whole masked config as sensitive', () => {
    const cfg: EntityFormConfig = {
      entity: 'e',
      maskData: true,
      tabs: [
        {
          id: 't',
          label: { en: 'T' },
          fields: [
            { id: 'tags', type: 'tags', label: { en: 'Tags' } },
            { id: 'list', type: 'array', label: { en: 'List' } },
            { id: 'rows', type: 'array', label: { en: 'Rows' }, children: [{ id: 'n', type: 'number', label: { en: 'N' } }] },
            { id: 'pick', type: 'multiSelect', label: { en: 'Pick' }, options: [{ en: 'A' }] },
            { id: 'free', type: 'text', label: 'Free' as never },
          ] as NestedFieldConfig[],
        },
      ],
    };
    const schema = entitySchema(cfg);
    expect(props(schema, 't', 'tags')).toMatchObject({ type: 'array', items: { type: 'string' }, 'x-sensitive': true });
    expect(props(schema, 't', 'list')).toMatchObject({ type: 'array', items: {} });
    // A row with no text column is named by its id.
    expect(props(schema, 't', 'rows')).not.toHaveProperty('x-label');
    expect(props(schema, 't', 'pick').items).toMatchObject({ 'x-atomic': true, 'x-key': '$key', 'x-label': '@lang' });
    expect(props(schema, 't', 'free')).toMatchObject({ title: 'Free', 'x-title': { en: 'Free' } });
    expect((entitySchema({ entity: 'bare', tabs: [{ id: 'x', label: undefined as never, fields: [] }] }) as any).properties.x).toMatchObject({ title: 'x' });
  });

  it('reads coded multi-select values by their labels', () => {
    const before = savedCft();
    const after = clone(before);
    after.generalTab.roles = ['ROLE_LEAD', 'ROLE_AUDITOR'];
    expect(en(diffEntityRecords(before, after, CFT), CFT)).toEqual(
      expect.arrayContaining([expect.stringMatching(/DevOps Architect removed from /), expect.stringMatching(/Security Auditor added to /)]),
    );
  });

  it('takes the fallback language from options', () => {
    expect((entitySchema(CLAIMS, { language: 'de' }) as any).properties.policy.title).toBe('Police');
  });
});

// ─── Form history ────────────────────────────────────────────────────────────

const texts = (changes: Change[], cfg?: EntityFormConfig) => describeFormChanges(changes, { config: cfg }).map(s => s.text);
const tab = (cfg: EntityFormConfig, id: string) => cfg.tabs.find(t => t.id === id)!;
const field = (cfg: EntityFormConfig, tabId: string, id: string) => tab(cfg, tabId).fields!.find(f => f.id === id)!;

describe('form history', () => {
  it('reports nothing for an unchanged config, including one that differs only in key order', () => {
    const reverseKeys = (v: unknown): unknown =>
      Array.isArray(v)
        ? v.map(reverseKeys)
        : v && typeof v === 'object'
          ? Object.fromEntries(Object.keys(v).reverse().map(k => [k, reverseKeys((v as Record<string, unknown>)[k])]))
          : v;
    const reordered = reverseKeys(CFT) as EntityFormConfig;
    expect(diffFormConfigs(CFT, clone(CFT))).toEqual([]);
    expect(diffFormConfigs(CFT, reordered)).toEqual([]);
  });

  it('reports a field added and a field removed, in the tab they belong to', () => {
    const next = clone(CFT);
    tab(next, 'generalTab').fields!.push({ id: 'phone', type: 'phone', label: { en: 'Phone' } });
    tab(next, 'generalTab').fields = tab(next, 'generalTab').fields!.filter(f => f.id !== 'bioNotes');
    const generalLabel = tab(CFT, 'generalTab').label['en'];
    expect(texts(diffFormConfigs(CFT, next))).toEqual(
      expect.arrayContaining([`Field "Phone" added to ${generalLabel}`, expect.stringMatching(new RegExp(`^Field ".+" removed from ${escape(generalLabel)}$`))]),
    );
  });

  it('reports a relabelled field, in every language', () => {
    const next = clone(CFT);
    field(next, 'generalTab', 'fullName').label = { en: 'Name', de: 'Name' };
    const changes = diffFormConfigs(CFT, next);
    expect(changes).toHaveLength(1);
    // An item is named as it is after the edit.
    expect(texts(changes)[0]).toMatch(/› Name: Label changed from Full Name to Name$/);
  });

  it('reads "Label changed from Phone to Mobile" for the field it is', () => {
    const before: EntityFormConfig = { entity: 'c', tabs: [{ id: 'contact', label: { en: 'Contact' }, fields: [{ id: 'phone', type: 'phone', label: { en: 'Phone' } }] }] };
    const after = clone(before);
    after.tabs[0].fields![0].label = { en: 'Mobile' };
    expect(texts(diffFormConfigs(before, after))).toEqual(['Contact › Mobile: Label changed from Phone to Mobile']);

    const added = clone(before);
    added.tabs[0].fields!.push({ id: 'email', type: 'email', label: { en: 'Email' } });
    expect(texts(diffFormConfigs(before, added))).toEqual(['Field "Email" added to Contact']);
  });

  it('names the sub-tab an edit is in', () => {
    const next = clone(CLAIMS);
    const details = tab(next, 'incident').children!.find(t => t.id === 'incidentDetails')!;
    details.fields!.push({ id: 'weather', type: 'text', label: { en: 'Weather' } });
    const detailsLabel = tab(CLAIMS, 'incident').children!.find(t => t.id === 'incidentDetails')!.label['en'];
    expect(texts(diffFormConfigs(CLAIMS, next))).toEqual([`Field "Weather" added to ${detailsLabel}`]);
  });

  it('reports re-ordered fields', () => {
    const next = clone(CFT);
    tab(next, 'generalTab').fields!.reverse();
    const changes = diffFormConfigs(CFT, next);
    expect(changes.map(c => c.code)).toEqual(['LIST_REORDERED']);
    expect(texts(changes)[0]).toBe(`Fields reordered in ${tab(CFT, 'generalTab').label['en']}`);
  });

  it('reads a field moved between tabs as removed from one and added to the other', () => {
    const next = clone(CFT);
    const moved = field(next, 'generalTab', 'bioNotes');
    tab(next, 'generalTab').fields = tab(next, 'generalTab').fields!.filter(f => f !== moved);
    tab(next, 'datesAndFilesTab').fields!.push(moved);
    expect(diffFormConfigs(CFT, next).map(c => c.code).sort()).toEqual(['ITEM_ADDED', 'ITEM_REMOVED']);
  });

  it('reports options added, removed and relabelled, keyed by $key, then value, then label', () => {
    const status = (options: unknown[]): EntityFormConfig => ({
      entity: 's',
      defaultLanguage: 'en',
      tabs: [{ id: 'main', label: { en: 'Main' }, fields: [{ id: 'status', type: 'dropdown', label: { en: 'Status' }, options: options as never }] }],
    });
    // Keyed: a relabel is a label change.
    const keyed = diffFormConfigs(status([{ $key: 'a', en: 'Active' }]), status([{ $key: 'a', en: 'Enabled' }]));
    expect(texts(keyed)).toEqual(['Main › Status › Enabled: Label changed from Active to Enabled']);
    // Unkeyed: matched by label, so the one that went is removed and the new one added.
    const unkeyed = diffFormConfigs(status([{ en: 'Active' }, { en: 'Inactive' }]), status([{ en: 'Active' }, { en: 'Archived' }]));
    expect(texts(unkeyed)).toEqual(['Option "Inactive" removed from Status', 'Option "Archived" added to Status']);
    // Coded: matched by the stored value, whatever the label says.
    const coded = diffFormConfigs(status([{ value: 'A', label: { en: 'Active' } }]), status([{ value: 'A', label: { en: 'Live' } }]));
    expect(coded.map(c => c.code)).toEqual(['FIELD_CHANGED']);
    // Two options with one label do not stop the diff.
    expect(() => diffFormConfigs(status([{ en: 'Open' }, { en: 'Open' }]), status(['Open']))).not.toThrow();
  });

  it('reports validators, visibility and showWhen as changes to the field', () => {
    const next = clone(CFT);
    const f = field(next, 'generalTab', 'fullName');
    f.validators = { ...f.validators, required: !f.validators?.required, maxLength: 80, custom: ['noDigits'] };
    f.visibility = false;
    f.showWhen = { accountActive: true };
    const text = texts(diffFormConfigs(CFT, next)).join('\n');
    expect(text).toMatch(/Required changed from (Yes|No) to (Yes|No)|Required set to Yes/);
    expect(text).toMatch(/Maximum length changed from 100 to 80/);
    expect(text).toMatch(/Custom validators set to noDigits/);
    expect(text).toMatch(/Visible (changed from Yes to No|set to No)/);
    expect(text).toMatch(/Show when set to \{"accountActive":true\}/);
  });

  it('reports rules added, removed and edited, keyed by id', () => {
    const rule = (id: string, fieldId: string): FormRule =>
      ({ id, formConfigId: 'c', fieldId, conditions: [], action: { type: 'visibility', value: true }, targets: [], enabled: true }) as unknown as FormRule;
    const changes = diffFormConfigs(CFT, CFT, {
      oldRules: [rule('r1', 'a'), rule('r2', 'a')],
      newRules: [rule('r1', 'b'), rule('r3', 'a')],
    });
    expect(texts(changes)).toEqual(['r1: Trigger field changed from a to b', 'Rule "r2" removed', 'Rule "r3" added']);
  });

  it('compares the rules as one value when any rule has no id', () => {
    const noId = { formConfigId: 'c', fieldId: 'a', conditions: [], action: { type: 'info', value: 'x' }, targets: [], enabled: true } as unknown as FormRule;
    const changes = diffFormConfigs(CFT, CFT, { oldRules: [noId], newRules: [{ ...noId, enabled: false }] });
    expect(texts(changes)).toEqual(['Rules changed']);
    expect(diffFormConfigs(CFT, CFT, { oldRules: [noId], newRules: [noId] })).toEqual([]);
  });

  it('reports a tab added and a form created, deleted and renamed', () => {
    const next = clone(CFT);
    next.tabs.push({ id: 'extra', label: { en: 'Extra' }, fields: [] });
    next.name = { en: 'Complex test' };
    next.defaultLanguage = undefined;
    const text = texts(diffFormConfigs(CFT, next), next);
    expect(text).toContain('Tab "Extra" added');
    expect(text).toContain('Name changed from Complex Edge Case Test Suite to Complex test');
    expect(texts(diffFormConfigs(null, CFT))).toEqual(['Form created']);
    expect(texts(diffFormConfigs(CFT, null))).toEqual(['Form deleted']);
  });

  it('words clearing a value, and lets a caller override any sentence', () => {
    const next = clone(CFT);
    const f = field(next, 'generalTab', 'fullName');
    f.validators = undefined;
    const changes = diffFormConfigs(CFT, next);
    expect(texts(changes).every(t => / cleared \(was /.test(t))).toBe(true);
    expect(describeFormChanges(changes, { messages: { FIELD_CLEARED: 'x' } })[0].text).toMatch(/x$/);
    expect(describeFormChanges(changes, { language: 'de' })).toHaveLength(changes.length);
  });

  it('words a redacted rules list being set and cleared', () => {
    const noId = { formConfigId: 'c', fieldId: 'a', conditions: [], action: { type: 'info', value: 'x' }, targets: [], enabled: true } as unknown as FormRule;
    expect(texts(diffFormConfigs(CFT, CFT, { oldRules: [], newRules: [noId] }))).toEqual(['Rules changed']);
    expect(texts(diffFormConfigs(CFT, CFT, { newRules: [noId] }))).toEqual(['Rules set']);
    expect(texts(diffFormConfigs(CFT, CFT, { oldRules: [noId] }))).toEqual(['Rules cleared']);
  });
});

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
