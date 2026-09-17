import { ComponentFixture, TestBed } from '@angular/core/testing';
import type { EntityFormConfig, FormRule, MappingPlan } from '@dynamic-entity/core';
import { IMPORT_TRANSPORT, SHEET_PARSER } from '../tokens/injection-tokens';
import { EntityImportComponent } from './entity-import.component';
import { ImportErrorsComponent } from './import-errors.component';
import { ImportMapperComponent } from './import-mapper.component';
import { ImportPreviewComponent } from './import-preview.component';
import { ImportTemplateComponent } from './import-template.component';
import { LocalImportTransport } from './local-import-transport';
import { defaultSheetParser } from './sheet-parser';
import type { ImportContext, ImportTransport } from './import-contracts';

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

/** Hides `terminationReason` while active — the rule-parity case, at the UI layer. */
const RULES: FormRule[] = [
  {
    formConfigId: 'employees',
    fieldId: 'status',
    conditions: [{ operator: 'EQUAL', value: 'Active', compareType: 'value' }],
    action: { type: 'visibility', value: false },
    targets: [{ id: 'notes', type: 'field' }],
    enabled: true,
    priority: 1,
  },
];

/** A `File` whose `text()` works under jsdom, which does not implement Blob.text. */
function csvFile(name: string, body: string): File {
  const file = new File([body], name, { type: 'text/csv' });
  Object.defineProperty(file, 'text', { value: () => Promise.resolve(body) });
  return file;
}

/** Reads a Blob under jsdom, which has FileReader but not Blob.text. */
function blobText(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(blob);
  });
}

/** Lets a promise chain that is several awaits deep finish before the next assertion. */
const settle = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 0));

const CONTEXT: ImportContext = { config: CONFIG, lang: 'en' };

describe('defaultSheetParser', () => {
  it('reads a CSV into headers and positional rows', async () => {
    const sheet = await defaultSheetParser(csvFile('people.csv', 'First Name,Status\nAlice,Active'));
    expect(sheet).toEqual({ headers: ['First Name', 'Status'], rows: [['Alice', 'Active']] });
  });

  it('refuses a workbook by name rather than reading a zip as text', async () => {
    // Attempting it yields a header row of mojibake and a mapping screen of nonsense, which
    // is far harder to diagnose than being told the format is not supported.
    await expect(defaultSheetParser(csvFile('people.xlsx', 'PK...'))).rejects.toThrow(
      /built-in parser handles CSV only/,
    );
  });
});

describe('LocalImportTransport', () => {
  let transport: LocalImportTransport;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    transport = TestBed.inject(LocalImportTransport);
  });

  it('previews headers, a sample and a suggested mapping', async () => {
    const preview = await transport.preview(
      csvFile('p.csv', 'First Name,Status\nAlice,Active\nBob,Inactive'),
      CONTEXT,
    );

    expect(preview.headers).toEqual(['First Name', 'Status']);
    expect(preview.rowCount).toBe(2);
    expect(preview.suggestion.entries).toContainEqual(
      expect.objectContaining({ ref: 'personal.firstName', column: 0 }),
    );
  });

  it('commits a file into records through the same engine a server would use', async () => {
    const plan: MappingPlan = {
      entity: 'employees',
      entries: [
        { ref: 'personal.firstName', column: 0 },
        { ref: 'personal.status', column: 1 },
      ],
    };
    const result = await transport.commit(csvFile('p.csv', 'a,b\nAlice,Aktiv'), plan, CONTEXT);

    expect(result.errors).toEqual([]);
    // Resolved to the option object, not the German text that was in the cell.
    expect((result.records[0] as any).personal.status).toEqual(STATUS[0]);
  });

  it('writes a CSV template of headers only', async () => {
    // Not headers plus a guidance row: CSV has one header row, so guidance inside the file
    // comes back as a record and fails row 2 of every re-import.
    const spec = {
      entity: 'employees',
      sheetName: 'Employees',
      columns: [
        { ref: 'a', scope: '(root)', field: {} as never, header: 'First Name', required: true },
      ],
      notes: ['Required'],
      unsupported: [],
    };
    const text = await blobText(await transport.template(spec, 'csv'));
    expect(text).toBe('First Name');
  });

  it('refuses xlsx rather than handing back CSV under an xlsx name', async () => {
    const spec = { entity: 'e', sheetName: 's', columns: [], notes: [], unsupported: [] };
    await expect(transport.template(spec, 'xlsx')).rejects.toThrow(/only write CSV/);
  });

  it('uses a registered sheet parser instead of the built-in one', async () => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        {
          provide: SHEET_PARSER,
          useValue: () => ({ headers: ['First Name'], rows: [['FromParser']] }),
        },
      ],
    });
    const preview = await TestBed.inject(LocalImportTransport).preview(
      csvFile('anything.xlsx', ''),
      CONTEXT,
    );
    expect(preview.sample).toEqual([['FromParser']]);
  });
});

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

describe('ImportErrorsComponent', () => {
  it('groups problems by the row number the spreadsheet shows', async () => {
    await TestBed.configureTestingModule({ imports: [ImportErrorsComponent] }).compileComponents();
    const fixture = TestBed.createComponent(ImportErrorsComponent);

    fixture.componentRef.setInput('errors', [
      { row: 4, ref: 'personal.status', message: 'bad status' },
      { row: 2, ref: 'personal.firstName', message: 'required' },
      { row: 4, ref: 'personal.firstName', message: 'required' },
    ]);
    fixture.detectChanges();

    const rows = fixture.nativeElement.querySelectorAll('[data-testid^="import-error-row-"]');
    expect(rows.length).toBe(3);
    // Row 2 before row 4, and row 4's two problems share one row heading.
    expect(rows[0].getAttribute('data-testid')).toBe('import-error-row-2');
    expect(fixture.nativeElement.querySelector('th[rowspan="2"]')).toBeTruthy();
  });

  it('renders nothing when there is nothing wrong', async () => {
    await TestBed.configureTestingModule({ imports: [ImportErrorsComponent] }).compileComponents();
    const fixture = TestBed.createComponent(ImportErrorsComponent);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[data-testid="import-errors"]')).toBeNull();
  });
});

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

describe('EntityImportComponent', () => {
  let fixture: ComponentFixture<EntityImportComponent>;

  const mount = async (providers: unknown[] = []): Promise<void> => {
    await TestBed.configureTestingModule({
      imports: [EntityImportComponent],
      providers: providers as never[],
    }).compileComponents();
    fixture = TestBed.createComponent(EntityImportComponent);
    fixture.componentRef.setInput('config', CONFIG);
    fixture.componentRef.setInput('rules', RULES);
    fixture.detectChanges();
  };

  /** Drives the file input the way the browser would. */
  const chooseFile = async (file: File): Promise<void> => {
    const input: HTMLInputElement = fixture.nativeElement.querySelector('[data-testid="import-file"]');
    Object.defineProperty(input, 'files', { value: [file] });
    input.dispatchEvent(new Event('change'));
    await fixture.whenStable();
    await settle();
    fixture.detectChanges();
  };

  it('starts on the upload step with a template offer', async () => {
    await mount();
    expect(fixture.nativeElement.querySelector('[data-testid="import-template"]')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('[data-testid="import-mapper"]')).toBeNull();
  });

  it('walks a file through map, review and done', async () => {
    await mount();
    await chooseFile(csvFile('p.csv', 'First Name,Status\nAlice,Active\nBob,Inactive'));

    expect(fixture.nativeElement.querySelector('[data-testid="import-mapper"]')).toBeTruthy();

    fixture.nativeElement.querySelector('[data-testid="import-to-review"]').click();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[data-testid="import-preview"]')).toBeTruthy();

    fixture.nativeElement.querySelector('[data-testid="import-commit"]').click();
    await fixture.whenStable();
    await settle();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('[data-testid="import-succeeded"]').textContent).toContain(
      '2',
    );
  });

  it('emits the result for the host to save', async () => {
    await mount();
    const seen: unknown[] = [];
    fixture.componentInstance.importComplete.subscribe(result => seen.push(result));

    await chooseFile(csvFile('p.csv', 'First Name\nAlice'));
    fixture.nativeElement.querySelector('[data-testid="import-to-review"]').click();
    fixture.detectChanges();
    fixture.nativeElement.querySelector('[data-testid="import-commit"]').click();
    await fixture.whenStable();
    await settle();
    fixture.detectChanges();

    expect(seen).toHaveLength(1);
  });

  it('reports a file the parser refuses, where the user is looking', async () => {
    await mount();
    await chooseFile(csvFile('book.xlsx', 'PK'));

    const problem = fixture.nativeElement.querySelector('[data-testid="import-problem"]');
    expect(problem.textContent).toContain('CSV only');
    // And stays on the upload step rather than advancing into an empty mapper.
    expect(fixture.nativeElement.querySelector('[data-testid="import-mapper"]')).toBeNull();
  });

  it('counts failed rows, not failed cells', async () => {
    await mount();
    // Row 3 is blank in a required column; row 4 fails twice over.
    await chooseFile(
      csvFile('p.csv', 'First Name,Status\nAlice,Active\n,Active\n,Retired'),
    );
    fixture.nativeElement.querySelector('[data-testid="import-to-review"]').click();
    fixture.detectChanges();
    fixture.nativeElement.querySelector('[data-testid="import-commit"]').click();
    await fixture.whenStable();
    await settle();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('[data-testid="import-failed"]').textContent).toContain(
      '2',
    );
  });

  it('drives a registered transport instead of the local one', async () => {
    const calls: string[] = [];
    const fake: ImportTransport = {
      preview: async () => {
        calls.push('preview');
        return {
          headers: ['First Name'],
          sample: [['Alice']],
          rowCount: 1,
          suggestion: {
            entity: 'employees',
            entries: [{ ref: 'personal.firstName', column: 0 }],
          },
        };
      },
      commit: async () => {
        calls.push('commit');
        return { records: [{}], errors: [], skipped: 0, planProblems: [] };
      },
      template: async () => new Blob(),
    };

    await mount([{ provide: IMPORT_TRANSPORT, useValue: fake }]);
    await chooseFile(csvFile('p.csv', 'ignored'));
    fixture.nativeElement.querySelector('[data-testid="import-to-review"]').click();
    fixture.detectChanges();
    fixture.nativeElement.querySelector('[data-testid="import-commit"]').click();
    await fixture.whenStable();
    await settle();
    fixture.detectChanges();

    expect(calls).toEqual(['preview', 'commit']);
  });

  it('refuses a plan the config cannot satisfy instead of reporting an empty success', async () => {
    const broken: ImportTransport = {
      preview: async () => ({
        headers: ['x'],
        sample: [['1']],
        rowCount: 1,
        suggestion: { entity: 'employees', entries: [{ ref: 'personal.gone', column: 0 }] },
      }),
      commit: async () => ({
        records: [],
        errors: [],
        skipped: 0,
        planProblems: [{ level: 'error', path: 'entries[0].ref', message: 'References unknown field.' }],
      }),
      template: async () => new Blob(),
    };

    await mount([{ provide: IMPORT_TRANSPORT, useValue: broken }]);
    await chooseFile(csvFile('p.csv', 'x'));
    fixture.nativeElement.querySelector('[data-testid="import-to-review"]').click();
    fixture.detectChanges();
    fixture.nativeElement.querySelector('[data-testid="import-commit"]').click();
    await fixture.whenStable();
    await settle();
    fixture.detectChanges();

    // "Imported 0 records" would describe this as a clean run of an empty file.
    expect(fixture.nativeElement.querySelector('[data-testid="import-succeeded"]')).toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid="import-problem"]').textContent).toContain(
      'References unknown field.',
    );
  });

  it('downloads a template and hands the same blob to the host', async () => {
    await mount();
    const produced: Blob[] = [];
    fixture.componentInstance.templateReady.subscribe(blob => produced.push(blob));

    // jsdom has no download machinery; the anchor click is a no-op we only need not to throw.
    const createObjectURL = jest.fn(() => 'blob:demo');
    const revokeObjectURL = jest.fn();
    Object.assign(URL, { createObjectURL, revokeObjectURL });

    fixture.nativeElement.querySelector('[data-testid="import-template-download"]').click();
    await settle();
    fixture.detectChanges();

    expect(produced).toHaveLength(1);
    expect(await blobText(produced[0])).toContain('First Name');
    expect(createObjectURL).toHaveBeenCalled();
  });

  it('reports a template format the transport cannot write', async () => {
    await mount();
    fixture.componentRef.setInput('templateFormat', 'xlsx');
    fixture.detectChanges();

    fixture.nativeElement.querySelector('[data-testid="import-template-download"]').click();
    await settle();
    fixture.detectChanges();

    // Not a silent fallback to CSV under an .xlsx name, which opens with a warning in Excel
    // and imports wrongly elsewhere.
    expect(fixture.nativeElement.querySelector('[data-testid="import-problem"]').textContent).toContain(
      'only write CSV',
    );
  });

  it('asks for a file when the picker comes back empty', async () => {
    await mount();
    const input: HTMLInputElement = fixture.nativeElement.querySelector('[data-testid="import-file"]');
    Object.defineProperty(input, 'files', { value: [] });
    input.dispatchEvent(new Event('change'));
    await settle();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('[data-testid="import-problem"]')).toBeTruthy();
  });

  it('surfaces a transport that throws mid-import', async () => {
    const angry: ImportTransport = {
      preview: async () => ({
        headers: ['First Name'],
        sample: [['Alice']],
        rowCount: 1,
        suggestion: { entity: 'employees', entries: [{ ref: 'personal.firstName', column: 0 }] },
      }),
      commit: async () => {
        throw new Error('the server said no');
      },
      template: async () => new Blob(),
    };

    await mount([{ provide: IMPORT_TRANSPORT, useValue: angry }]);
    await chooseFile(csvFile('p.csv', 'x'));
    fixture.nativeElement.querySelector('[data-testid="import-to-review"]').click();
    fixture.detectChanges();
    fixture.nativeElement.querySelector('[data-testid="import-commit"]').click();
    await fixture.whenStable();
    await settle();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('[data-testid="import-problem"]').textContent).toContain(
      'the server said no',
    );
  });

  it('reports blank rows as skipped rather than as failures', async () => {
    await mount();
    await chooseFile(csvFile('p.csv', 'First Name\nAlice\n\nBob'));
    fixture.nativeElement.querySelector('[data-testid="import-to-review"]').click();
    fixture.detectChanges();
    fixture.nativeElement.querySelector('[data-testid="import-commit"]').click();
    await fixture.whenStable();
    await settle();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('[data-testid="import-skipped"]').textContent).toContain(
      '1',
    );
    expect(fixture.nativeElement.querySelector('[data-testid="import-failed"]')).toBeNull();
  });

  it('accepts a transport whose result predates planProblems', async () => {
    // The field was added after the contract existed, and a hand-written transport is a
    // plain object rather than something the compiler keeps in step at runtime.
    const older = {
      preview: async () => ({
        headers: ['First Name'],
        sample: [['Alice']],
        rowCount: 1,
        suggestion: { entity: 'employees', entries: [{ ref: 'personal.firstName', column: 0 }] },
      }),
      commit: async () => ({ records: [{}], errors: [], skipped: 0 }),
      template: async () => new Blob(),
    };

    await mount([{ provide: IMPORT_TRANSPORT, useValue: older }]);
    await chooseFile(csvFile('p.csv', 'x'));
    fixture.nativeElement.querySelector('[data-testid="import-to-review"]').click();
    fixture.detectChanges();
    fixture.nativeElement.querySelector('[data-testid="import-commit"]').click();
    await fixture.whenStable();
    await settle();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('[data-testid="import-succeeded"]')).toBeTruthy();
  });

  it('reports a transport that rejects with something that is not an Error', async () => {
    const rude: ImportTransport = {
      preview: async () => {
        // eslint-disable-next-line no-throw-literal
        throw 'no thank you';
      },
      commit: async () => ({ records: [], errors: [], skipped: 0, planProblems: [] }),
      template: async () => new Blob(),
    };

    await mount([{ provide: IMPORT_TRANSPORT, useValue: rude }]);
    await chooseFile(csvFile('p.csv', 'x'));

    expect(fixture.nativeElement.querySelector('[data-testid="import-problem"]').textContent).toContain(
      'no thank you',
    );
  });

  it('refuses to commit with no file, which the UI should never allow', async () => {
    // The commit button only exists on the review step, which cannot be reached without a
    // file — so this guard is reached by calling it, not by clicking. It is tested rather
    // than deleted because what it prevents is a null dereference inside a `finally`, and the
    // cost of keeping it is one line.
    await mount();
    const component = fixture.componentInstance as unknown as { commit(): Promise<void> };
    await component.commit();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('[data-testid="import-problem"]').textContent).toContain(
      'Choose a file',
    );
  });

  it('goes back from review to fix a mapping', async () => {
    await mount();
    await chooseFile(csvFile('p.csv', 'First Name\nAlice'));
    fixture.nativeElement.querySelector('[data-testid="import-to-review"]').click();
    fixture.detectChanges();
    fixture.nativeElement.querySelector('[data-testid="import-back"]').click();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('[data-testid="import-mapper"]')).toBeTruthy();
  });

  it('starts over cleanly', async () => {
    await mount();
    await chooseFile(csvFile('p.csv', 'First Name\nAlice'));
    fixture.nativeElement.querySelector('[data-testid="import-to-review"]').click();
    fixture.detectChanges();
    fixture.nativeElement.querySelector('[data-testid="import-commit"]').click();
    await fixture.whenStable();
    await settle();
    fixture.detectChanges();

    fixture.nativeElement.querySelector('[data-testid="import-restart"]').click();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('[data-testid="import-template"]')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('[data-testid="import-file-chosen"]')).toBeNull();
  });
});
