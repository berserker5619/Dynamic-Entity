import { TestBed } from '@angular/core/testing';
import { FormArray, FormGroup, ReactiveFormsModule } from '@angular/forms';
import type { EntityFormConfig, NestedFieldConfig } from '@dynamic-entity/core';
import { ROW_ID_KEY } from '@dynamic-entity/core';
import { provideBuiltInFieldTypes } from '../providers/provide-field-types';
import { DynamicFormComponent } from './dynamic-form.component';
import { FormStructureService } from './form-structure.service';

/**
 * Arrays below the tab level (#38).
 *
 * Only a tab-level array used to get its rows on load: anything deeper went through
 * `patchValue`, which fills only the `FormArray` controls that already exist — none, in a
 * freshly built form. So the rows of an array inside a group, or inside another array's row,
 * were not shown and were dropped by the next save.
 */
const text = (id: string): NestedFieldConfig => ({ id, type: 'text', label: { en: id } }) as NestedFieldConfig;

const CONFIG: EntityFormConfig = {
  entity: 'orders',
  tabs: [
    {
      id: 'main',
      label: { en: 'Main' },
      fields: [
        text('ref'),
        // tab → group → array
        {
          id: 'shipping',
          type: 'group',
          label: { en: 'Shipping' },
          children: [text('carrier'), { id: 'parcels', type: 'array', label: { en: 'Parcels' }, children: [text('label')] }],
        },
        // tab → array → row → array
        {
          id: 'lines',
          type: 'array',
          label: { en: 'Lines' },
          children: [text('sku'), { id: 'serials', type: 'array', label: { en: 'Serials' }, children: [text('serial')] }],
        },
      ],
    },
  ],
} as EntityFormConfig;

/** As 3.1 saved it: nested rows, no ids. */
const RECORD = () => ({
  main: {
    ref: 'A-1',
    shipping: { carrier: 'DHL', parcels: [{ label: 'box 1' }, { label: 'box 2' }] },
    lines: [
      { sku: 'X', serials: [{ serial: 's1' }, { serial: 's2' }] },
      { sku: 'Y', serials: [] },
    ],
  },
});

type Row = Record<string, unknown>;
const fieldsById = (config: EntityFormConfig) => {
  const map = new Map<string, NestedFieldConfig>();
  const walk = (fields: NestedFieldConfig[] | undefined) => {
    for (const f of fields ?? []) {
      map.set(f.id, f);
      walk(f.children);
    }
  };
  for (const tab of config.tabs) walk(tab.fields);
  return map;
};

describe('nested arrays in FormStructureService', () => {
  let service: FormStructureService;
  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [FormStructureService] });
    service = TestBed.inject(FormStructureService);
  });
  afterEach(() => TestBed.resetTestingModule());

  const load = () => {
    const form = service.buildForm(CONFIG);
    service.patchForm(form, CONFIG, RECORD(), fieldsById(CONFIG));
    return form;
  };

  it('loads the rows of an array inside a group', () => {
    const parcels = load().get('main.shipping.parcels') as FormArray;
    expect(parcels.length).toBe(2);
    expect(parcels.at(1).get('label')!.value).toBe('box 2');
    expect(parcels.at(1).get(ROW_ID_KEY)!.value).toBe('legacy-2');
  });

  it('loads the rows of an array inside an array row', () => {
    const lines = load().get('main.lines') as FormArray;
    const serials = lines.at(0).get('serials') as FormArray;
    expect(serials.length).toBe(2);
    expect(serials.at(0).get('serial')!.value).toBe('s1');
    expect(serials.at(0).get(ROW_ID_KEY)!.value).toBe('legacy-1');
    expect((lines.at(1).get('serials') as FormArray).length).toBe(0);
  });

  it('saves every nested row back, values and ids', () => {
    const saved = service.extractRecord(load(), CONFIG)['main'];
    expect(saved.ref).toBe('A-1');
    expect(saved.shipping).toEqual({
      carrier: 'DHL',
      parcels: [
        { [ROW_ID_KEY]: 'legacy-1', label: 'box 1' },
        { [ROW_ID_KEY]: 'legacy-2', label: 'box 2' },
      ],
    });
    expect(saved.lines).toEqual([
      {
        [ROW_ID_KEY]: 'legacy-1',
        sku: 'X',
        serials: [
          { [ROW_ID_KEY]: 'legacy-1', serial: 's1' },
          { [ROW_ID_KEY]: 'legacy-2', serial: 's2' },
        ],
      },
      { [ROW_ID_KEY]: 'legacy-2', sku: 'Y', serials: [] },
    ]);
  });

  it('builds a detached row with its nested rows, as the drawer does', () => {
    const row = service.buildArrayRow(fieldsById(CONFIG).get('lines'), RECORD().main.lines[0]) as FormGroup;
    expect((row.get('serials') as FormArray).length).toBe(2);
    expect(row.value.serials.map((r: Row) => r['serial'])).toEqual(['s1', 's2']);
  });

  it('still ignores keys with no field, as patchValue did', () => {
    const row = service.buildArrayRow(fieldsById(CONFIG).get('lines'), { sku: 'Z', stray: 1 }) as FormGroup;
    expect(row.value).toEqual({ [ROW_ID_KEY]: expect.any(String), sku: 'Z', serials: [] });
  });
});

describe('nested arrays in the form', () => {
  it('keeps every nested row and its id through load, edit and save', () => {
    TestBed.configureTestingModule({
      imports: [DynamicFormComponent, ReactiveFormsModule],
      providers: [provideBuiltInFieldTypes()],
    });
    const fixture = TestBed.createComponent(DynamicFormComponent);
    fixture.componentRef.setInput('config', CONFIG);
    fixture.componentRef.setInput('initialData', RECORD());
    fixture.detectChanges();

    const form = fixture.componentInstance.form;
    form.get('main.shipping.parcels.0.label')!.setValue('box 1 (opened)');
    (form.get('main.lines.0.serials') as FormArray).removeAt(0);

    const saved = fixture.componentInstance.extractRecord()['main'];
    expect(saved.shipping.parcels).toEqual([
      { [ROW_ID_KEY]: 'legacy-1', label: 'box 1 (opened)' },
      { [ROW_ID_KEY]: 'legacy-2', label: 'box 2' },
    ]);
    // The surviving serial keeps its own id; it does not become row 1.
    expect(saved.lines[0].serials).toEqual([{ [ROW_ID_KEY]: 'legacy-2', serial: 's2' }]);
    TestBed.resetTestingModule();
  });
});
