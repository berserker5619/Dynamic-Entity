import { TestBed } from '@angular/core/testing';
import type { EntityFormConfig, MappingPlanV1, FormRule } from '@dynamic-entity/core';
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
    } as MappingPlanV1);
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
    } as MappingPlanV1);
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
    } as MappingPlanV1);
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
    } as MappingPlanV1);
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
    } as MappingPlanV1);
    fixture.componentRef.setInput('rows', [['Alice']]);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelectorAll('th').length).toBe(0);
  });
});

describe('ImportPreviewComponent — a date written in digits', () => {
  const DATED: EntityFormConfig = {
    entity: 'people',
    tabs: [{ id: 'main', label: { en: 'Main' }, flatData: true, fields: [{ id: 'born', type: 'date', label: { en: 'Born' } }] }],
  };
  const render = async (dateOrder?: 'DMY' | 'MDY' | 'YMD'): Promise<string> => {
    await TestBed.configureTestingModule({ imports: [ImportPreviewComponent] }).compileComponents();
    const fixture = TestBed.createComponent(ImportPreviewComponent);
    fixture.componentRef.setInput('config', DATED);
    fixture.componentRef.setInput('plan', { entity: 'people', entries: [{ ref: 'born', column: 0 }] } as MappingPlanV1);
    fixture.componentRef.setInput('rows', [['05/09/2026']]);
    if (dateOrder) fixture.componentRef.setInput('dateOrder', dateOrder);
    fixture.detectChanges();
    return fixture.nativeElement.textContent as string;
  };

  it('shows the cell as the commit will refuse it when no order is stated', async () => {
    expect(await render()).toContain('date order');
  });

  it('shows the day the commit will store when the order is stated', async () => {
    const text = await render('DMY');
    expect(text).not.toContain('date order');
    // 5 September, not 9 May: whatever the display format, the month it shows is September.
    const monthFirst = await (async () => {
      TestBed.resetTestingModule();
      return render('MDY');
    })();
    expect(text).not.toEqual(monthFirst);
  });
});

describe('ImportPreviewComponent — a plan v2 that states the order of one column', () => {
  const DATED: EntityFormConfig = {
    entity: 'people',
    tabs: [
      {
        id: 'main',
        label: { en: 'Main' },
        flatData: true,
        fields: [
          { id: 'born', type: 'date', label: { en: 'Born' } },
          { id: 'joined', type: 'date', label: { en: 'Joined' } },
        ],
      },
    ],
  };
  const cells = async (born?: 'DMY' | 'MDY', joined?: 'DMY' | 'MDY', run?: 'DMY' | 'MDY'): Promise<string[]> => {
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({ imports: [ImportPreviewComponent] }).compileComponents();
    const fixture = TestBed.createComponent(ImportPreviewComponent);
    fixture.componentRef.setInput('config', DATED);
    fixture.componentRef.setInput('plan', {
      planVersion: 2,
      target: 'people',
      entries: [
        { ref: 'born', column: 0, ...(born ? { dateOrder: born } : {}) },
        { ref: 'joined', column: 1, ...(joined ? { dateOrder: joined } : {}) },
      ],
    });
    fixture.componentRef.setInput('rows', [['05/09/2026', '05/09/2026']]);
    if (run) fixture.componentRef.setInput('dateOrder', run);
    fixture.detectChanges();
    return Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('tbody td')).map(cell => (cell.textContent ?? '').trim());
  };

  it('shows each column as its own entry reads it, and reports no row as rejected', async () => {
    const [dayFirst, monthFirst] = await cells('DMY', 'MDY');
    expect(dayFirst).not.toContain('date order');
    expect(monthFirst).not.toContain('date order');
    // One sheet value, read two ways: the two cells show different days.
    expect(dayFirst).not.toEqual(monthFirst);
    // And they are the days the run-level order shows for a whole sheet read that way.
    expect((await cells(undefined, undefined, 'DMY'))[0]).toEqual(dayFirst);
    expect((await cells(undefined, undefined, 'MDY'))[1]).toEqual(monthFirst);
  });

  it("reads a column that states none in the run's order, and an entry's order over the run's", async () => {
    const [stated, defaulted] = await cells('DMY', undefined, 'MDY');
    expect(stated).toEqual((await cells('DMY', 'DMY'))[0]);
    expect(defaulted).toEqual((await cells('MDY', 'MDY'))[1]);
  });

  it('still shows a column with no order from either as the commit will refuse it', async () => {
    const [stated, unstated] = await cells('DMY');
    expect(stated).not.toContain('date order');
    expect(unstated).toContain('date order');
  });
});
