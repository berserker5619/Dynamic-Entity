import { SimpleChange } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import type { EntityFormConfig } from '@dynamic-entity/core';
import { provideBuiltInFieldTypes } from '../providers/provide-field-types';
import { DynamicRecordFormComponent } from './dynamic-record-form.component';

/**
 * The inline row drawer on an `array` field.
 *
 * The record view edits an array row in a drawer rather than in the tab panel, and the whole
 * flow — open, save, cancel, delete — was uncovered. It is also the part of this component
 * most able to lose data: a row is committed into a `FormArray` that lives in the child form
 * while the rows on screen are read from `currentData`, so the two can disagree.
 */
describe('DynamicRecordFormComponent — array rows', () => {
  let fixture: ComponentFixture<DynamicRecordFormComponent>;
  let component: DynamicRecordFormComponent;

  const config: EntityFormConfig = {
    entity: 'claims',
    tabs: [
      {
        id: 'settlement',
        label: { en: 'Settlement' },
        fields: [
          {
            id: 'lineItems',
            type: 'array',
            label: { en: 'Line items' },
            children: [
              { id: 'description', type: 'text', label: { en: 'Description' } },
              { id: 'amount', type: 'number', label: { en: 'Amount' } },
            ],
          },
        ],
      },
    ],
  };

  const initial = () => ({
    settlement: {
      lineItems: [
        { description: 'Repair', amount: 100 },
        { description: 'Parts', amount: 50 },
      ],
    },
  });

  function build(data: Record<string, unknown> = initial()): void {
    fixture = TestBed.createComponent(DynamicRecordFormComponent);
    component = fixture.componentInstance;
    component.config = config;
    component.initialData = data;
    component.ngOnChanges({ config: new SimpleChange(undefined, config, true) });
    fixture.detectChanges();
  }

  /** The drawer refuses to open unless the tab is being edited. */
  function startEditing(): void {
    component.editSection();
    fixture.detectChanges();
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DynamicRecordFormComponent],
      providers: [provideBuiltInFieldTypes()],
    }).compileComponents();
  });

  afterEach(() => TestBed.resetTestingModule());

  it('lists the array fields on the active tab', () => {
    build();
    expect(component.arrayFieldsForActiveTab.map(f => f.id)).toEqual(['lineItems']);
  });

  it('reads rows from the record rather than from the child FormArray', () => {
    build();
    // Reading the child's control would render whatever it holds mid-initialisation.
    expect(component.rowsOf(config.tabs![0].fields![0])).toEqual([
      { description: 'Repair', amount: 100 },
      { description: 'Parts', amount: 50 },
    ]);
  });

  it('reports no rows for a record that has none', () => {
    build({ settlement: {} });
    expect(component.rowsOf(config.tabs![0].fields![0])).toEqual([]);
  });

  it('refuses to open the drawer while the section is read-only', () => {
    build();
    // Not editing yet: the row must not become editable just because it was clicked.
    expect(component.sectionReadOnly).toBe(true);
    component.openEditRow(config.tabs![0].fields![0], 0);
    expect(component.inlineRowField()).toBeNull();
  });

  it('opens a row for editing, seeded with that row', () => {
    build();
    startEditing();
    component.openEditRow(config.tabs![0].fields![0], 1);

    expect(component.inlineRowField()?.id).toBe('lineItems');
    expect(component.inlineRowIndex()).toBe(1);
    // Seeded from the row that was opened, not the first one.
    expect(component.inlineRowForm?.value).toEqual({ description: 'Parts', amount: 50 });
  });

  it('opens an empty drawer for a new row', () => {
    build();
    startEditing();
    component.openAddRow(config.tabs![0].fields![0]);

    expect(component.inlineRowIndex()).toBeNull();
    expect(component.inlineRowForm?.value).toEqual({ description: null, amount: null });
  });

  it('closes the drawer without touching the record on cancel', () => {
    build();
    startEditing();
    component.openEditRow(config.tabs![0].fields![0], 0);
    component.inlineRowForm?.patchValue({ description: 'Abandoned' });

    component.cancelRow();

    expect(component.inlineRowField()).toBeNull();
    expect(component.inlineRowForm).toBeNull();
    // The half-finished edit must not survive; Cancel means cancel.
    expect(component.rowsOf(config.tabs![0].fields![0])[0]).toEqual({
      description: 'Repair',
      amount: 100,
    });
  });

  it('commits an edited row back into the record', () => {
    build();
    startEditing();
    component.openEditRow(config.tabs![0].fields![0], 0);
    component.inlineRowForm?.patchValue({ description: 'Repair (revised)', amount: 120 });

    component.saveRow();
    fixture.detectChanges();

    const rows = component.rowsOf(config.tabs![0].fields![0]);
    expect(rows[0]).toEqual({ description: 'Repair (revised)', amount: 120 });
    // The sibling row is untouched — a save writes one row, not the array.
    expect(rows[1]).toEqual({ description: 'Parts', amount: 50 });
    expect(component.inlineRowField()).toBeNull();
  });

  it('appends a new row rather than replacing an existing one', () => {
    build();
    startEditing();
    component.openAddRow(config.tabs![0].fields![0]);
    component.inlineRowForm?.patchValue({ description: 'Labour', amount: 75 });

    component.saveRow();
    fixture.detectChanges();

    const rows = component.rowsOf(config.tabs![0].fields![0]);
    expect(rows).toHaveLength(3);
    expect(rows[2]).toEqual({ description: 'Labour', amount: 75 });
  });

  it('does nothing on save when no row is open', () => {
    build();
    startEditing();
    expect(() => component.saveRow()).not.toThrow();
    expect(component.rowsOf(config.tabs![0].fields![0])).toHaveLength(2);
  });

  it('deletes a row and leaves the rest in order', () => {
    build();
    startEditing();
    component.deleteRow(config.tabs![0].fields![0], 0);
    fixture.detectChanges();

    const rows = component.rowsOf(config.tabs![0].fields![0]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({ description: 'Parts', amount: 50 });
  });

  it('refuses to delete while the section is read-only', () => {
    build();
    component.deleteRow(config.tabs![0].fields![0], 0);
    expect(component.rowsOf(config.tabs![0].fields![0])).toHaveLength(2);
  });

  it('closes the drawer when the row being edited is deleted', () => {
    build();
    startEditing();
    component.openEditRow(config.tabs![0].fields![0], 1);
    component.deleteRow(config.tabs![0].fields![0], 1);

    // Leaving it open would edit whatever slid into that index.
    expect(component.inlineRowField()).toBeNull();
    expect(component.inlineRowIndex()).toBeNull();
  });
});
