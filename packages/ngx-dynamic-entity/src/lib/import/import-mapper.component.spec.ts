import { ComponentFixture, TestBed } from '@angular/core/testing';
import type { EntityFormConfig, MappingPlan } from '@dynamic-entity/core';
import { ImportMapperComponent } from './import-mapper.component';

const STATUS = [
  { en: 'Active', de: 'Aktiv' },
  { en: 'Inactive', de: 'Inaktiv' },
];

const CONFIG: EntityFormConfig = {
  entity: 'employees',
  version: 2,
  tabs: [
    {
      id: 'personal',
      label: { en: 'Personal' },
      fields: [
        { id: 'firstName', type: 'text', label: { en: 'First Name' }, validators: { required: true } },
        { id: 'status', type: 'dropdown', label: { en: 'Status' }, options: STATUS },
        { id: 'photo', type: 'image', label: { en: 'Photo' } },
      ],
    },
  ],
};

describe('ImportMapperComponent', () => {
  let fixture: ComponentFixture<ImportMapperComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [ImportMapperComponent] }).compileComponents();
    fixture = TestBed.createComponent(ImportMapperComponent);
    fixture.componentRef.setInput('config', CONFIG);
    fixture.componentRef.setInput('headers', ['Notes', 'First Name', 'Notes']);
    fixture.componentRef.setInput('plan', {
      entity: 'employees',
      entries: [{ ref: 'personal.firstName', column: 1, confidence: 'guess' }],
    } as MappingPlan);
    fixture.detectChanges();
  });

  it('lists a row per importable field and leaves out the ones a sheet cannot carry', () => {
    const rows = fixture.nativeElement.querySelectorAll('[data-testid^="import-map-"]');
    const refs = [...rows].map((r: Element) => r.getAttribute('data-testid'));
    expect(refs).toEqual(['import-map-personal.firstName', 'import-map-personal.status']);
  });

  it('badges a guessed match so the user knows it was inferred', () => {
    expect(
      fixture.nativeElement.querySelector('[data-testid="import-guess-personal.firstName"]'),
    ).toBeTruthy();
  });

  it('says what a spreadsheet cannot carry, for a user who skipped the template', () => {
    // The template picker says it too, but a user who already had a sheet never saw that
    // screen — this is otherwise the only place they would find out an attachment column
    // was never going to arrive.
    expect(
      fixture.nativeElement.querySelector('[data-testid="import-mapper-unsupported"]').textContent,
    ).toContain('1');
  });

  it('warns while a required field has no column', () => {
    expect(fixture.nativeElement.querySelector('[data-testid="import-required-unmapped"]')).toBeNull();

    fixture.componentRef.setInput('plan', { entity: 'employees', entries: [] } as MappingPlan);
    fixture.detectChanges();
    expect(
      fixture.nativeElement.querySelector('[data-testid="import-required-unmapped"]'),
    ).toBeTruthy();
  });

  it('emits a plan addressing the column by index, not by header text', () => {
    // The sheet has "Notes" at 0 and at 2. Only an index can say which was chosen.
    let emitted: MappingPlan | null = null;
    fixture.componentInstance.planChange.subscribe(plan => (emitted = plan));

    const select: HTMLSelectElement = fixture.nativeElement.querySelector(
      '[data-testid="import-select-personal.status"]',
    );
    select.value = select.options[3].value; // null, then headers 0..2
    select.dispatchEvent(new Event('change'));
    fixture.detectChanges();

    expect(emitted!.entries).toContainEqual(
      expect.objectContaining({ ref: 'personal.status', column: 2, header: 'Notes' }),
    );
  });
});
