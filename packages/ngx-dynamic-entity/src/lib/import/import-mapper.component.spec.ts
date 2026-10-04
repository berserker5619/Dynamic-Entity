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

describe('ImportMapperComponent with repeating fields and a stored plan', () => {
  const PHONES: EntityFormConfig = {
    entity: 'people',
    version: 1,
    tabs: [
      {
        id: 'main',
        label: { en: 'Main' },
        flatData: true,
        fields: [
          { id: 'name', type: 'text', label: { en: 'Name' } },
          { id: 'source', type: 'text', label: { en: 'Source' } },
          {
            id: 'phones',
            type: 'array',
            label: { en: 'Phone' },
            children: [{ id: 'number', type: 'text', label: { en: 'Number' } }],
          },
        ],
      },
    ],
  };

  let fixture: ComponentFixture<ImportMapperComponent>;
  let emitted: MappingPlan | null;

  const mount = (headers: string[], plan: MappingPlan | null): void => {
    fixture = TestBed.createComponent(ImportMapperComponent);
    fixture.componentRef.setInput('config', PHONES);
    fixture.componentRef.setInput('headers', headers);
    fixture.componentRef.setInput('plan', plan);
    fixture.detectChanges();
    emitted = null;
    fixture.componentInstance.planChange.subscribe(next => (emitted = next));
  };
  const el = (testId: string): HTMLElement | null =>
    fixture.nativeElement.querySelector(`[data-testid="${testId}"]`);
  const select = (ref: string, optionIndex: number): void => {
    const node = el(`import-select-${ref}`) as HTMLSelectElement;
    node.value = node.options[optionIndex].value;
    node.dispatchEvent(new Event('change'));
    fixture.detectChanges();
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [ImportMapperComponent] }).compileComponents();
  });

  it('offers a row for every slot the sheet names, not just three', () => {
    mount(['Name', ...[1, 2, 3, 4, 5, 6].map(n => `Phone ${n}`)], null);
    expect(el('import-map-phones.5.number')).toBeTruthy();
    expect(el('import-map-phones.6.number')).toBeNull();
  });

  it('round-trips a stored plan with a far slot and a fixed value, entry for entry', () => {
    const headers = ['Name', 'Phone 5'];
    const plan: MappingPlan = {
      entity: 'people',
      configVersion: 1,
      sourceHeaders: headers,
      entries: [
        { ref: 'phones.4.number', column: 1, header: 'Phone 5' },
        { ref: 'source', constant: 'import' },
        { ref: 'name', column: 0, header: 'Name', confidence: 'exact' },
      ],
    };
    mount(headers, plan);
    expect(el('import-map-phones.4.number')).toBeTruthy();

    // An unrelated change, so the plan is emitted: everything else must come back untouched.
    select('phones.0.number', 2); // null, constant-less row: null then headers → "Phone 5"
    expect(emitted!.entries.slice(0, 3)).toEqual(plan.entries);
    expect(emitted!.entries[3]).toMatchObject({ ref: 'phones.0.number', column: 1 });
  });

  it('shows a fixed value as the selection, and drops it only when the user picks otherwise', () => {
    mount(['Name'], { entity: 'people', entries: [{ ref: 'source', constant: 'import' }] });
    const node = el('import-select-source') as HTMLSelectElement;
    expect(node.options[node.selectedIndex].textContent).toContain('import');

    select('source', 0);
    expect(emitted!.entries).toEqual([]);
  });

  it('keeps an entry for a field the form no longer has until the user removes it', () => {
    mount(['Name'], {
      entity: 'people',
      entries: [
        { ref: 'retired', column: 0 },
        { ref: 'name', column: 0 },
      ],
    });
    expect(el('import-stale-retired')).toBeTruthy();

    select('source', 1);
    expect(emitted!.entries.map(entry => entry.ref)).toEqual(['retired', 'name', 'source']);

    el('import-remove-retired')!.click();
    fixture.detectChanges();
    expect(emitted!.entries.map(entry => entry.ref)).toEqual(['name', 'source']);
    expect(el('import-stale')).toBeNull();
  });

  it('adds one slot to an array on request, keeping the choices already made', () => {
    mount(['Name', 'Phone 1', 'Phone 4'], null);
    expect(el('import-map-phones.3.number')).toBeTruthy();
    expect(el('import-map-phones.4.number')).toBeNull();
    select('phones.0.number', 2);

    el('import-add-slot-phones')!.click();
    fixture.detectChanges();
    expect(el('import-map-phones.4.number')).toBeTruthy();

    select('phones.4.number', 3);
    expect(emitted!.entries).toEqual([
      expect.objectContaining({ ref: 'phones.0.number', column: 1 }),
      expect.objectContaining({ ref: 'phones.4.number', column: 2 }),
    ]);
  });
});
