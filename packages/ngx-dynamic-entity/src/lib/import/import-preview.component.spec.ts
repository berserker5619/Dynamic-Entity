import { TestBed } from '@angular/core/testing';
import type { EntityFormConfig, MappingPlan, FormRule } from '@dynamic-entity/core';
import { ImportPreviewComponent } from './import-preview.component';

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

describe('ImportPreviewComponent', () => {
  it('shows each cell as the record will hold it, and names a cell that will fail', async () => {
    await TestBed.configureTestingModule({ imports: [ImportPreviewComponent] }).compileComponents();
    const fixture = TestBed.createComponent(ImportPreviewComponent);

    fixture.componentRef.setInput('config', CONFIG);
    fixture.componentRef.setInput('plan', {
      entity: 'employees',
      entries: [
        { ref: 'personal.firstName', column: 0 },
        { ref: 'personal.status', column: 1 },
      ],
    } as MappingPlan);
    fixture.componentRef.setInput('rows', [
      ['Alice', 'Aktiv'],
      ['Bob', 'Retired'],
    ]);
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent;
    // The German cell previews as the option it resolved to, in the form's language.
    expect(text).toContain('Active');
    expect(text).toContain('is not one of: Active, Inactive');
  });

  it('previews a constant the same way it previews a column', async () => {
    await TestBed.configureTestingModule({ imports: [ImportPreviewComponent] }).compileComponents();
    const fixture = TestBed.createComponent(ImportPreviewComponent);

    fixture.componentRef.setInput('config', CONFIG);
    fixture.componentRef.setInput('plan', {
      entity: 'employees',
      entries: [
        { ref: 'personal.firstName', column: 0 },
        { ref: 'personal.status', constant: STATUS[1] },
      ],
    } as MappingPlan);
    fixture.componentRef.setInput('rows', [['Alice']]);
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Inactive');
  });

  it('says which rows will be refused, not only which cells will not parse', async () => {
    // `coerceCell` alone catches a cell that will not parse and says nothing about a row the
    // import will reject — so a heading promising "as they will be saved" was showing rows
    // that would never be saved, looking exactly like the ones that would.
    await TestBed.configureTestingModule({ imports: [ImportPreviewComponent] }).compileComponents();
    const fixture = TestBed.createComponent(ImportPreviewComponent);

    fixture.componentRef.setInput('config', CONFIG);
    fixture.componentRef.setInput('plan', {
      entity: 'employees',
      entries: [
        { ref: 'personal.firstName', column: 0 },
        { ref: 'personal.status', column: 1 },
      ],
    } as MappingPlan);
    // Row 0 is fine. Row 1 leaves out a required field: every cell parses, and the row is
    // still refused.
    fixture.componentRef.setInput('rows', [
      ['Alice', 'Active'],
      ['', 'Active'],
    ]);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('[data-testid="import-preview-rejected-0"]')).toBeNull();
    expect(
      fixture.nativeElement.querySelector('[data-testid="import-preview-rejected-1"]').textContent,
    ).toContain('required');
  });

  it('honours a rule that relaxes a required field', async () => {
    // The parity case, at the preview: without `rules` the row below looks refused, and the
    // commit would then accept it — a preview disagreeing with the import it previews.
    const withRule: EntityFormConfig = {
      entity: 'employees',
      tabs: [
        {
          id: 'personal',
          label: { en: 'Personal' },
          fields: [
            { id: 'status', type: 'dropdown', label: { en: 'Status' }, options: STATUS },
            {
              id: 'reason',
              type: 'text',
              label: { en: 'Reason' },
              validators: { required: true },
            },
          ],
        },
      ],
    };
    const rules: FormRule[] = [
      {
        formConfigId: 'employees',
        fieldId: 'status',
        conditions: [{ operator: 'EQUAL', value: 'Active', compareType: 'value' }],
        action: { type: 'visibility', value: false },
        targets: [{ id: 'reason', type: 'field' }],
        enabled: true,
        priority: 1,
      },
    ];

    await TestBed.configureTestingModule({ imports: [ImportPreviewComponent] }).compileComponents();
    const fixture = TestBed.createComponent(ImportPreviewComponent);
    fixture.componentRef.setInput('config', withRule);
    fixture.componentRef.setInput('plan', {
      entity: 'employees',
      entries: [{ ref: 'personal.status', column: 0 }],
    } as MappingPlan);
    fixture.componentRef.setInput('rows', [['Active']]);

    fixture.componentRef.setInput('rules', []);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[data-testid="import-preview-rejected-0"]')).toBeTruthy();

    fixture.componentRef.setInput('rules', rules);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[data-testid="import-preview-rejected-0"]')).toBeNull();
  });

  it('ignores a plan entry the config no longer has a column for', async () => {
    await TestBed.configureTestingModule({ imports: [ImportPreviewComponent] }).compileComponents();
    const fixture = TestBed.createComponent(ImportPreviewComponent);

    fixture.componentRef.setInput('config', CONFIG);
    fixture.componentRef.setInput('plan', {
      entity: 'employees',
      entries: [{ ref: 'personal.goneAway', column: 0 }],
    } as MappingPlan);
    fixture.componentRef.setInput('rows', [['Alice']]);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelectorAll('th').length).toBe(0);
  });
});
