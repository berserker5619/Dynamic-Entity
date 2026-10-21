import { SimpleChange } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormGroup, ReactiveFormsModule } from '@angular/forms';
import type { EntityFormConfig, FormRule } from '@dynamic-entity/core';
import { ROW_ID_KEY, applyRowIds, migrateRecord, rowIdMigration } from '@dynamic-entity/core';
import { ArrayFieldComponent } from '../field-types/array-field.component';
import { provideBuiltInFieldTypes } from '../providers/provide-field-types';
import { DynamicFormComponent } from './dynamic-form.component';
import { DynamicRecordFormComponent } from './dynamic-record-form.component';

/**
 * `$rowId` through the renderer: a row keeps its id from load to save, whatever happens to
 * the rows around it, and the id is never a value — not rendered, not validated, not seen by a
 * rule, not a change.
 */
const CONFIG: EntityFormConfig = {
  entity: 'claims',
  version: 2,
  tabs: [
    {
      id: 'settlement',
      label: { en: 'Settlement' },
      fields: [
        { id: 'total', type: 'number', label: { en: 'Total' } },
        {
          id: 'lineItems',
          type: 'array',
          label: { en: 'Line items' },
          criticalField: true,
          children: [
            { id: 'description', type: 'text', label: { en: 'Description' }, validators: { required: true } },
            { id: 'amount', type: 'number', label: { en: 'Amount' } },
          ],
        },
      ],
    },
  ],
} as EntityFormConfig;

/** A claim as 3.1 saved it: rows with no ids. */
const RECORD_31 = () => ({
  settlement: {
    total: 175,
    lineItems: [
      { description: 'Repair', amount: 100 },
      { description: 'Parts', amount: 50 },
      { description: 'Labour', amount: 25 },
    ],
  },
});

type Row = Record<string, unknown>;
const idsOf = (rows: Row[]) => rows.map(row => row[ROW_ID_KEY]);
const lineItems = () => CONFIG.tabs![0].fields![1];

describe('row identity in the record editor', () => {
  let fixture: ComponentFixture<DynamicRecordFormComponent>;
  let component: DynamicRecordFormComponent;

  function build(data: Record<string, unknown>): void {
    fixture = TestBed.createComponent(DynamicRecordFormComponent);
    component = fixture.componentInstance;
    component.config = CONFIG;
    component.initialData = data;
    component.ngOnChanges({ config: new SimpleChange(undefined, CONFIG, true) });
    fixture.detectChanges();
    component.editSection();
    fixture.detectChanges();
  }

  const saved = (): Row[] => component.dynamicFormComp!.extractRecord()['settlement'].lineItems;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DynamicRecordFormComponent],
      providers: [provideBuiltInFieldTypes()],
    }).compileComponents();
  });

  afterEach(() => TestBed.resetTestingModule());

  it('keeps every surviving row id through edit, add, remove and reorder, then save', () => {
    build(RECORD_31());
    expect(idsOf(saved())).toEqual(['legacy-1', 'legacy-2', 'legacy-3']);

    // Edit the second row in the drawer.
    component.openEditRow(lineItems(), 1);
    component.inlineRowForm!.patchValue({ description: 'Parts (revised)' });
    component.saveRow();

    // Add a row.
    component.openAddRow(lineItems());
    component.inlineRowForm!.patchValue({ description: 'Towing', amount: 40 });
    component.saveRow();
    const added = saved()[3][ROW_ID_KEY];
    expect(added).toEqual(expect.any(String));
    expect(added).not.toMatch(/^legacy-/);

    // Remove the first, then move the last to the front.
    component.deleteRow(lineItems(), 0);
    const array = component.dynamicFormComp!.getArrayControl('lineItems', 'settlement')!;
    const last = array.at(array.length - 1);
    array.removeAt(array.length - 1);
    array.insert(0, last);

    const rows = saved();
    expect(rows.map(row => [row[ROW_ID_KEY], row['description']])).toEqual([
      [added, 'Towing'],
      ['legacy-2', 'Parts (revised)'],
      ['legacy-3', 'Labour'],
    ]);
  });

  it('gives the same ids as the server migration, for one 3.1 record handled both ways', () => {
    // Copy one: loaded in the form, edited, saved.
    build(RECORD_31());
    component.openEditRow(lineItems(), 2);
    component.inlineRowForm!.patchValue({ amount: 30 });
    component.saveRow();
    const fromForm = idsOf(saved());

    // Copy two: migrated on a server, never opened.
    const fromServer = migrateRecord({ ...RECORD_31(), _configVersion: 1 }, CONFIG, [rowIdMigration(CONFIG)]).record;
    const viaApply = applyRowIds(RECORD_31(), CONFIG);

    expect(fromForm).toEqual(idsOf(fromServer['settlement'].lineItems));
    expect(fromForm).toEqual(idsOf(viaApply['settlement'].lineItems));
  });

  it('keeps ids a record already has, and does not reuse them for a new row', () => {
    build({ settlement: { lineItems: [{ [ROW_ID_KEY]: 'abc', description: 'Repair', amount: 1 }] } });
    component.openAddRow(lineItems());
    component.inlineRowForm!.patchValue({ description: 'Parts' });
    component.saveRow();

    const ids = idsOf(saved());
    expect(ids[0]).toBe('abc');
    expect(ids[1]).not.toBe('abc');
  });

  it('never renders the id', () => {
    build(RECORD_31());
    const element = fixture.nativeElement as HTMLElement;
    expect(element.textContent).not.toContain('legacy-');
    expect(element.textContent).not.toContain(ROW_ID_KEY);
  });
});

describe('row identity in the form', () => {
  function mount(data: Record<string, unknown>, extra: { rules?: FormRule[]; originalData?: Record<string, unknown> } = {}) {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [DynamicFormComponent, ReactiveFormsModule],
      providers: [provideBuiltInFieldTypes()],
    });
    const fixture = TestBed.createComponent(DynamicFormComponent);
    fixture.componentRef.setInput('config', CONFIG);
    fixture.componentRef.setInput('initialData', data);
    if (extra.rules) fixture.componentRef.setInput('rules', extra.rules);
    if (extra.originalData) fixture.componentRef.setInput('originalData', extra.originalData);
    fixture.detectChanges();
    return fixture;
  }

  it('keeps the id out of the values rules see', () => {
    const fixture = mount(RECORD_31());
    const values = fixture.componentInstance.formValues();
    expect(values['lineItems']).toEqual(RECORD_31().settlement.lineItems);
    expect(JSON.stringify(values)).not.toContain(ROW_ID_KEY);
  });

  it('does not count the id as a change to a critical array field', () => {
    const fixture = mount(RECORD_31(), { originalData: { lineItems: RECORD_31().settlement.lineItems } });
    expect(fixture.componentInstance.changedCriticalFields()).toEqual([]);
  });

  it('carries the id as an unvalidated control on each row', () => {
    const fixture = mount(RECORD_31());
    const row = fixture.componentInstance.getArrayControl('lineItems', 'settlement')!.at(0) as FormGroup;
    const id = row.get(ROW_ID_KEY)!;
    expect(id.value).toBe('legacy-1');
    id.setValue(null);
    expect(id.valid).toBe(true);
  });

  it('gives a row added inline a fresh id', () => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ imports: [ArrayFieldComponent], providers: [provideBuiltInFieldTypes()] });
    const fixture = TestBed.createComponent(ArrayFieldComponent);
    const host = TestBed.createComponent(DynamicFormComponent);
    host.componentRef.setInput('config', CONFIG);
    host.detectChanges();
    fixture.componentInstance.field = lineItems();
    fixture.componentInstance.control = host.componentInstance.getArrayControl('lineItems', 'settlement')!;
    fixture.detectChanges();

    fixture.componentInstance.addItem();
    fixture.componentInstance.addItem();
    const [first, second] = fixture.componentInstance.formArray.value as Row[];
    expect(first[ROW_ID_KEY]).toEqual(expect.any(String));
    expect(first[ROW_ID_KEY]).not.toBe(second[ROW_ID_KEY]);
  });
});
