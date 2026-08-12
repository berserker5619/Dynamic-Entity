import { ComponentFixture, TestBed } from '@angular/core/testing';
import { SimpleChange } from '@angular/core';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import type { EntityFormConfig } from '@dynamic-entity/core';
import { EntityBuilderComponent } from './entity-builder.component';
import { BuilderStore } from './builder-store.service';

describe('EntityBuilderComponent', () => {
  let fixture: ComponentFixture<EntityBuilderComponent>;
  let component: EntityBuilderComponent;
  let store: BuilderStore;
  let host: HTMLElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [EntityBuilderComponent],
      providers: [provideNoopAnimations()],
    }).compileComponents();

    fixture = TestBed.createComponent(EntityBuilderComponent);
    component = fixture.componentInstance;
    store = fixture.debugElement.injector.get(BuilderStore);
    host = fixture.nativeElement as HTMLElement;
    fixture.detectChanges();
  });

  const paletteButtons = (): HTMLButtonElement[] =>
    Array.from(host.querySelector('ngx-field-palette')!.querySelectorAll('button'));
  const fieldRows = (): HTMLElement[] => Array.from(host.querySelectorAll('.deb-field-row'));
  const buttonByText = (text: string): HTMLButtonElement =>
    Array.from(host.querySelectorAll('button')).find(b =>
      (b.textContent || '').includes(text),
    ) as HTMLButtonElement;
  const rowButtonByIcon = (row: HTMLElement, icon: string): HTMLButtonElement =>
    Array.from(row.querySelectorAll('button')).find(
      b => b.querySelector('mat-icon')?.textContent?.trim() === icon,
    ) as HTMLButtonElement;

  it('creates and starts with no field rows', () => {
    expect(component).toBeTruthy();
    expect(fieldRows().length).toBe(0);
  });

  it('adds a field row when a palette type is clicked', () => {
    paletteButtons()[0].click(); // "Text"
    fixture.detectChanges();

    expect(fieldRows().length).toBe(1);
    expect(store.fields()[0].type).toBe('text');
    expect(fieldRows()[0].classList).toContain('deb-field-row--active');
  });

  it('removes a field when its delete button is clicked', () => {
    store.setEntityName('clients');
    store.addField('text');
    fixture.detectChanges();
    expect(fieldRows().length).toBe(1);

    rowButtonByIcon(fieldRows()[0], 'delete').click();
    fixture.detectChanges();

    expect(fieldRows().length).toBe(0);
    expect(store.fields().length).toBe(0);
  });

  it('reorders fields on drop', () => {
    const a = store.addField('text');
    const b = store.addField('number');
    expect(store.fields().map(f => f.id)).toEqual([a, b]);

    (component as unknown as { onDrop(e: unknown): void }).onDrop({
      previousIndex: 0,
      currentIndex: 1,
    });
    fixture.detectChanges();

    expect(store.fields().map(f => f.id)).toEqual([b, a]);
  });

  it('gates the Save button on validity and emits a clean config on save', () => {
    const saved: EntityFormConfig[] = [];
    component.save.subscribe(c => saved.push(c));

    expect(buttonByText('Save').disabled).toBe(true);

    store.setEntityName('clients');
    store.addField('text');
    fixture.detectChanges();

    const saveBtn = buttonByText('Save');
    expect(saveBtn.disabled).toBe(false);

    saveBtn.click();
    expect(saved.length).toBe(1);
    expect(saved[0].entity).toBe('clients');
    expect(saved[0].tabs[0].fields!.length).toBe(1);
  });

  it('emits configChange as the working config changes', () => {
    const emissions: EntityFormConfig[] = [];
    component.configChange.subscribe(c => emissions.push(c));

    store.setEntityName('clients');
    fixture.detectChanges();
    store.addField('text');
    fixture.detectChanges();

    expect(emissions.length).toBeGreaterThan(0);
    expect(emissions[emissions.length - 1].entity).toBe('clients');
  });

  it('loads an @Input config into the canvas', () => {
    const cfg: EntityFormConfig = {
      entity: 'people',
      version: 2,
      tabs: [
        {
          id: 'main',
          label: { en: 'Main' },
          fields: [
            { id: 'firstName', type: 'text', label: { en: 'First name' } },
            { id: 'age', type: 'number', label: { en: 'Age' } },
          ],
        },
      ],
    };
    component.config = cfg;
    component.ngOnChanges({
      config: new SimpleChange(undefined, cfg, true),
    });
    fixture.detectChanges();

    expect(fieldRows().length).toBe(2);
    expect(store.config().version).toBe(2);

    store.addField('text');
    expect(cfg.tabs[0].fields!.length).toBe(2);
  });

  it('accepts custom common modules from input', () => {
    const modules = [{ id: 'custom', label: { en: 'Custom' }, component: 'app-custom' }];

    component.commonModules = modules;
    component.ngOnChanges({
      commonModules: new SimpleChange(undefined, modules, true),
    });
    fixture.detectChanges();

    expect(component.commonModules).toEqual(modules);
  });

  describe('config input', () => {
    const configOf = (entity: string): EntityFormConfig => ({
      entity,
      tabs: [{ id: 'main', label: { en: 'Main' }, fields: [] }],
    });

    function setConfig(next: EntityFormConfig | undefined, previous?: EntityFormConfig): void {
      component.config = next;
      component.ngOnChanges({
        config: new SimpleChange(previous, next, previous === undefined),
      });
      fixture.detectChanges();
    }

    it('reloads the store when a different config arrives', () => {
      setConfig(configOf('first'));
      expect(store.config().entity).toBe('first');

      setConfig(configOf('second'), configOf('first'));
      expect(store.config().entity).toBe('second');
    });

    it('resets to a blank config when the first value is empty', () => {
      store.setEntityName('leftover');

      // `null`, not `undefined`: Angular reports the first change as
      // `undefined → currentValue`, so an undefined input is not a change at all and the
      // component correctly leaves the store alone.
      component.config = null as never;
      component.ngOnChanges({ config: new SimpleChange(undefined, null, true) });
      fixture.detectChanges();

      expect(store.config().entity).toBe('');
    });

    it('ignores a change whose value did not actually change', () => {
      const cfg = configOf('stable');
      setConfig(cfg);
      store.setEntityName('edited-by-the-user');

      // Angular reports a change on every CD pass for object inputs; the guard is what stops
      // the user's in-progress edits being thrown away by an unchanged reference.
      component.ngOnChanges({ config: new SimpleChange(cfg, cfg, false) });

      expect(store.config().entity).toBe('edited-by-the-user');
    });
  });

  describe('languages input', () => {
    it('moves the active language into the offered set', () => {
      store.setActiveLanguage('fr');

      component.languages = ['en', 'de'];
      component.ngOnChanges({ languages: new SimpleChange(undefined, ['en', 'de'], true) });

      expect(store.activeLanguage()).toBe('en');
    });

    it('leaves the active language alone when it is still offered', () => {
      store.setActiveLanguage('de');

      component.languages = ['en', 'de'];
      component.ngOnChanges({ languages: new SimpleChange(undefined, ['en', 'de'], true) });

      expect(store.activeLanguage()).toBe('de');
    });

    it('ignores an empty language list', () => {
      store.setActiveLanguage('de');

      component.languages = [];
      component.ngOnChanges({ languages: new SimpleChange(['en'], [], false) });

      expect(store.activeLanguage()).toBe('de');
    });
  });

  describe('permission roles', () => {
    it('parses a comma-separated list, trimming and de-duplicating', () => {
      component['setRolesFromText']('edit', ' admin , manager ,admin,, ');

      expect(store.config().permissions?.edit).toEqual(['admin', 'manager']);
    });

    it('clears the roles when the text is emptied', () => {
      component['setRolesFromText']('edit', 'admin');
      component['setRolesFromText']('edit', '   ');

      expect(store.config().permissions?.edit).toEqual([]);
    });

    it('returns the same empty array every call when no roles are set', () => {
      // A fresh [] here would give the bound mat-select a new reference on every change
      // detection pass, which loops.
      expect(component['rolesFor']('delete')).toBe(component['rolesFor']('delete'));
    });

    it('returns the stored array once roles exist', () => {
      component['setRoles']('view', ['admin']);
      expect(component['rolesFor']('view')).toEqual(['admin']);
    });
  });
});
