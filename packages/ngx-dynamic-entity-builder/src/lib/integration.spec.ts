import { TestBed } from '@angular/core/testing';
import { SimpleChange } from '@angular/core';
import type { EntityFormConfig } from '@dynamic-entity/core';
import { validateConfig, collectFieldScopes } from '@dynamic-entity/core';
import { DynamicFormComponent, provideBuiltInFieldTypes } from 'ngx-dynamic-entity';
import { BuilderStore } from './builder-store.service';

/**
 * Builder → core → renderer, in one process.
 *
 * The three packages are tested in isolation by unit specs and together through a browser by
 * Playwright, and nothing sat in between. That gap matters because the contract between them
 * is a *data* contract: the builder authors a config, core decides what it means, and the
 * renderer turns it into controls and a record. A change to any one of those can satisfy its
 * own tests while breaking the handover.
 *
 * These run the real `BuilderStore`, the real validator and the real form — no stubs — and
 * assert the config survives every step in the shape core says it should.
 */
describe('integration — a config authored in the builder renders and submits', () => {
  let store: BuilderStore;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DynamicFormComponent],
      providers: [BuilderStore, provideBuiltInFieldTypes()],
    }).compileComponents();
    store = TestBed.inject(BuilderStore);
  });

  afterEach(() => TestBed.resetTestingModule());

  /** Drive the real form component over a config, exactly as the demo host does. */
  function render(config: EntityFormConfig) {
    const fixture = TestBed.createComponent(DynamicFormComponent);
    fixture.componentRef.setInput('config', config);
    fixture.componentInstance.ngOnChanges({ config: new SimpleChange(undefined, config, true) });
    fixture.detectChanges();
    return fixture;
  }

  it('authors a config the validator accepts', () => {
    store.setEntityName('clients');
    store.addField('text');
    store.addField('number');

    const config = store.exportConfig();
    // The builder must not be able to produce something core rejects — that is the dead end
    // the per-scope id bug created, and the reason this seam is worth a test of its own.
    expect(validateConfig(config).filter(i => i.level === 'error')).toEqual([]);
  });

  it('renders a control for every field the builder added', () => {
    store.setEntityName('clients');
    const a = store.addField('text');
    const b = store.addField('number');

    const fixture = render(store.exportConfig());
    const form = fixture.componentInstance.form;
    // The builder's ids are the control names; a mismatch here is invisible until a record
    // comes back missing values.
    expect(form.get(`${store.exportConfig().tabs![0].id}.${a}`)).toBeTruthy();
    expect(form.get(`${store.exportConfig().tabs![0].id}.${b}`)).toBeTruthy();
  });

  it('submits a record nested exactly where core says the scopes are', () => {
    store.setEntityName('people');
    // The store starts with no tabs at all, so both are created here rather than assumed.
    const first = store.addTab();
    const second = store.addTab();

    const a = store.addField('text', first);
    const b = store.addField('text', second);

    const config = store.exportConfig();
    const fixture = render(config);
    fixture.componentInstance.form.get(`${first}.${a}`)!.setValue('one');
    fixture.componentInstance.form.get(`${second}.${b}`)!.setValue('two');

    const record = fixture.componentInstance.extractRecord();

    // `collectFieldScopes` is core's answer to "where does this value live". The record the
    // renderer produces has to agree with it, or a rule reading by path finds nothing.
    const scopes = new Map(collectFieldScopes(config).map(e => [e.field.id, e.scope]));
    expect(scopes.get(a)).toBe(first);
    expect(scopes.get(b)).toBe(second);
    expect(record[first][a]).toBe('one');
    expect(record[second][b]).toBe('two');
  });

  it('keeps two fields that share an id apart, end to end', () => {
    // The case that broke the builder: valid to core and to the renderer, and the builder
    // used to refuse it. All three now agree.
    const config: EntityFormConfig = {
      entity: 'people',
      version: 1,
      tabs: [
        { id: 'personal', label: { en: 'Personal' }, fields: [{ id: 'address', type: 'text', label: { en: 'Home' } }] },
        { id: 'work', label: { en: 'Work' }, fields: [{ id: 'address', type: 'text', label: { en: 'Office' } }] },
      ],
    };

    expect(validateConfig(config).filter(i => i.level === 'error')).toEqual([]);

    store.load(config);
    expect(store.errors()).toEqual([]);

    const fixture = render(config);
    fixture.componentInstance.form.get('personal.address')!.setValue('Home St');
    fixture.componentInstance.form.get('work.address')!.setValue('Office Rd');

    const record = fixture.componentInstance.extractRecord();
    expect(record['personal'].address).toBe('Home St');
    expect(record['work'].address).toBe('Office Rd');
  });

  it('round-trips a config through the builder without changing what it means', () => {
    const original: EntityFormConfig = {
      entity: 'clients',
      version: 1,
      tabs: [
        {
          id: 'main',
          label: { en: 'Main' },
          flatData: true,
          fields: [
            { id: 'name', type: 'text', label: { en: 'Name' }, validators: { required: true } },
            { id: 'status', type: 'dropdown', label: { en: 'Status' }, options: [{ en: 'Active' }] },
          ],
        },
      ],
    };

    store.load(original);
    const exported = store.exportConfig();

    // Loading and exporting must not quietly move a field, drop a validator, or lose
    // `flatData` — which decides whether values sit at the record root.
    const before = collectFieldScopes(original).map(e => `${e.scope}::${e.field.id}`);
    const after = collectFieldScopes(exported).map(e => `${e.scope}::${e.field.id}`);
    expect(after).toEqual(before);
    expect(exported.tabs![0].flatData).toBe(true);
    expect(exported.tabs![0].fields![0].validators).toEqual({ required: true });
  });

  it('renders a flatData tab at the record root, as the scope says', () => {
    const config: EntityFormConfig = {
      entity: 'claims',
      version: 1,
      tabs: [
        {
          id: 'claimant',
          label: { en: 'Claimant' },
          flatData: true,
          fields: [{ id: 'claimRef', type: 'text', label: { en: 'Ref' } }],
        },
      ],
    };

    const fixture = render(config);
    fixture.componentInstance.form.get('claimRef')!.setValue('CLM-1');

    const record = fixture.componentInstance.extractRecord();
    // Not `record.claimant.claimRef` — flatData is what makes this the root.
    expect(record['claimRef']).toBe('CLM-1');
    expect(record['claimant']).toBeUndefined();
  });

  it('survives an undo without leaving the renderer holding a stale config', () => {
    store.setEntityName('clients');
    store.addField('text');
    store.addField('number');
    const both = store.exportConfig();

    store.undo();
    const undone = store.exportConfig();

    // Undo produces a config like any other: still valid, still renderable, one field lighter.
    expect(validateConfig(undone).filter(i => i.level === 'error')).toEqual([]);
    expect(collectFieldScopes(undone).length).toBe(collectFieldScopes(both).length - 1);
    expect(() => render(undone)).not.toThrow();
  });

  /**
   * The builder and core disagree about an empty entity, and this pins the disagreement
   * rather than papering over it.
   *
   * Undo all the way back and the config is the empty starting state. `validateConfig` calls
   * that an **error** — no tabs means nothing can render — while the builder reports only a
   * warning and leaves Save enabled. So the builder will save a config that
   * `dynamic-entity validate` then rejects in CI: the mirror image of the bug where it
   * refused a config core accepted.
   *
   * Which side should move is a product decision (may an entity be saved before it has any
   * tabs?), so this asserts today's behaviour and names the gap.
   */
  it('lets the builder save an empty entity that core rejects', () => {
    store.setEntityName('clients');
    store.addField('text');
    while (store.canUndo()) store.undo();

    const coreErrors = validateConfig(store.exportConfig()).filter(i => i.level === 'error');
    expect(coreErrors.map(e => e.message)).toContain('At least one tab is required.');

    // The builder does not agree, and this is the line to change if that is settled.
    expect(store.isValid()).toBe(true);
  });
});
