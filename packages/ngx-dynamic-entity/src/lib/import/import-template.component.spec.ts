import { ComponentFixture, TestBed } from '@angular/core/testing';
import type { EntityFormConfig } from '@dynamic-entity/core';
import { ImportTemplateComponent } from './import-template.component';

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

describe('ImportTemplateComponent', () => {
  let fixture: ComponentFixture<ImportTemplateComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [ImportTemplateComponent] }).compileComponents();
    fixture = TestBed.createComponent(ImportTemplateComponent);
    fixture.componentRef.setInput('config', CONFIG);
    fixture.detectChanges();
  });

  it('says how many fields a spreadsheet cannot carry rather than hiding them', () => {
    const note = fixture.nativeElement.querySelector('[data-testid="import-template-unsupported"]');
    expect(note.textContent).toContain('1');
  });

  it('emits the selected refs, with row numbers stripped', () => {
    let emitted: string[] = [];
    fixture.componentInstance.download.subscribe(refs => (emitted = refs));

    fixture.nativeElement.querySelector('[data-testid="import-template-none"]').click();
    fixture.detectChanges();
    fixture.nativeElement
      .querySelector('[data-testid="import-template-field-personal.firstName"]')
      .click();
    fixture.detectChanges();
    fixture.nativeElement.querySelector('[data-testid="import-template-download"]').click();

    expect(emitted).toEqual(['personal.firstName']);
  });

  it('cannot download an empty template', () => {
    fixture.nativeElement.querySelector('[data-testid="import-template-none"]').click();
    fixture.detectChanges();
    expect(
      fixture.nativeElement.querySelector('[data-testid="import-template-download"]').disabled,
    ).toBe(true);
  });

  it('offers a repeating field once, not once per row number', async () => {
    // "Contacts / Name" is one decision. Asking it three times as "Name 1", "Name 2",
    // "Name 3" is the same decision wearing different numbers.
    const withArray: EntityFormConfig = {
      entity: 'e',
      tabs: [
        {
          id: 'work',
          label: { en: 'Work' },
          fields: [
            {
              id: 'contacts',
              type: 'array',
              label: { en: 'Contacts' },
              children: [{ id: 'name', type: 'text', label: { en: 'Name' } }],
            },
          ],
        },
      ],
    };

    fixture.componentRef.setInput('config', withArray);
    fixture.detectChanges();

    const boxes = fixture.nativeElement.querySelectorAll('[data-testid^="import-template-field-"]');
    expect(boxes.length).toBe(1);
    expect(fixture.nativeElement.textContent).toContain('Work / Contacts / Name');
    expect(fixture.nativeElement.textContent).not.toContain('Name 1');
  });

  it('says nothing about unsupported fields when there are none', () => {
    const plain: EntityFormConfig = {
      entity: 'e',
      tabs: [
        { id: 't', label: { en: 'T' }, fields: [{ id: 'a', type: 'text', label: { en: 'A' } }] },
      ],
    };
    fixture.componentRef.setInput('config', plain);
    fixture.detectChanges();
    expect(
      fixture.nativeElement.querySelector('[data-testid="import-template-unsupported"]'),
    ).toBeNull();
  });
});
