import { ComponentFixture, TestBed } from '@angular/core/testing';
import type { EntityFormConfig, FormRule, ImportResult } from '@dynamic-entity/core';
import { IMPORT_TRANSPORT, LOOKUP_REGISTRY } from '../tokens/injection-tokens';
import { EntityImportComponent } from './entity-import.component';
import type { ImportTransport } from './import-contracts';

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

  it('resolves a listName field from LOOKUP_REGISTRY without the host passing lookups', async () => {
    // Core is framework-agnostic and cannot reach the registry, which is a reason for *core*
    // to be given the values — not a reason to ask the host for what this package is already
    // holding. Without this the column stores the raw text "Gold", which renders correctly
    // and then matches no rule: the exact failure the option-shape contract exists to stop.
    const listed: EntityFormConfig = {
      entity: 'clients',
      tabs: [
        {
          id: 'main',
          label: { en: 'Main' },
          fields: [{ id: 'tier', type: 'dropdown', label: { en: 'Tier' }, listName: 'tiers' }],
        },
      ],
    };

    await TestBed.configureTestingModule({
      imports: [EntityImportComponent],
      providers: [
        { provide: LOOKUP_REGISTRY, useValue: new Map([['tiers', [{ en: 'Gold' }, { en: 'Silver' }]]]) },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(EntityImportComponent);
    fixture.componentRef.setInput('config', listed);
    fixture.detectChanges();

    const results: ImportResult[] = [];
    fixture.componentInstance.importComplete.subscribe(result => results.push(result));

    await chooseFile(csvFile('t.csv', 'Tier\nGold'));
    fixture.nativeElement.querySelector('[data-testid="import-to-review"]').click();
    fixture.detectChanges();
    fixture.nativeElement.querySelector('[data-testid="import-commit"]').click();
    await fixture.whenStable();
    await settle();
    fixture.detectChanges();

    expect((results[0].records[0] as any).main.tier).toEqual({ en: 'Gold' });
  });

  it('lets the lookups input override one list without supplying them all', async () => {
    const listed: EntityFormConfig = {
      entity: 'clients',
      tabs: [
        {
          id: 'main',
          label: { en: 'Main' },
          fields: [{ id: 'tier', type: 'dropdown', label: { en: 'Tier' }, listName: 'tiers' }],
        },
      ],
    };

    await TestBed.configureTestingModule({
      imports: [EntityImportComponent],
      providers: [{ provide: LOOKUP_REGISTRY, useValue: new Map([['tiers', [{ en: 'Gold' }]]]) }],
    }).compileComponents();

    fixture = TestBed.createComponent(EntityImportComponent);
    fixture.componentRef.setInput('config', listed);
    fixture.componentRef.setInput('lookups', { tiers: [{ en: 'Platinum' }] });
    fixture.detectChanges();

    await chooseFile(csvFile('t.csv', 'Tier\nGold'));
    fixture.nativeElement.querySelector('[data-testid="import-to-review"]').click();
    fixture.detectChanges();

    // The override replaced the registry's list, so "Gold" is no longer an allowed value.
    expect(fixture.nativeElement.textContent).toContain('is not one of: Platinum');
  });

  it('keeps the previous file when a new one cannot be read', async () => {
    await mount();
    await chooseFile(csvFile('good.csv', 'First Name\nAlice'));
    expect(fixture.nativeElement.querySelector('[data-testid="import-mapper"]')).toBeTruthy();

    // The component must not end up holding a file whose headers describe a different one.
    fixture.componentInstance['restart']();
    fixture.detectChanges();
    await chooseFile(csvFile('bad.xlsx', 'PK'));

    expect(fixture.nativeElement.querySelector('[data-testid="import-file-chosen"]')).toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid="import-problem"]')).toBeTruthy();
  });

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
