import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { SimpleChange } from '@angular/core';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import type { EntityFormConfig, FormRule } from '@dynamic-entity/core';
import { ConfigSourceService } from 'ngx-dynamic-entity';
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

  describe('sidebar collapse', () => {
    const byTestId = <T extends HTMLElement>(id: string): T | null =>
      host.querySelector(`[data-testid="${id}"]`);
    const leftCol = () => host.querySelector('.deb-col--left') as HTMLElement;
    const rightCol = () => host.querySelector('.deb-col--right') as HTMLElement;

    function click(el: HTMLElement | null): void {
      el!.click();
      fixture.detectChanges();
    }

    it('starts with both sidebars open and no rails showing', () => {
      expect(leftCol().hasAttribute('hidden')).toBe(false);
      expect(rightCol().hasAttribute('hidden')).toBe(false);
      expect(byTestId('expand-left-sidebar')).toBeNull();
      expect(byTestId('expand-right-sidebar')).toBeNull();
    });

    it('collapses the palette from the toolbar and restores it from the rail', () => {
      click(byTestId('toggle-left-sidebar'));
      expect(leftCol().hasAttribute('hidden')).toBe(true);
      // The inspector is untouched, so the two sides collapse independently.
      expect(rightCol().hasAttribute('hidden')).toBe(false);

      click(byTestId('expand-left-sidebar'));
      expect(leftCol().hasAttribute('hidden')).toBe(false);
      expect(byTestId('expand-left-sidebar')).toBeNull();
    });

    it('collapses the inspector from the toolbar and restores it from the rail', () => {
      click(byTestId('toggle-right-sidebar'));
      expect(rightCol().hasAttribute('hidden')).toBe(true);
      expect(leftCol().hasAttribute('hidden')).toBe(false);

      click(byTestId('expand-right-sidebar'));
      expect(rightCol().hasAttribute('hidden')).toBe(false);
      expect(byTestId('expand-right-sidebar')).toBeNull();
    });

    it('collapses from the button inside each card header', () => {
      click(byTestId('collapse-left-sidebar'));
      click(byTestId('collapse-right-sidebar'));

      expect(leftCol().hasAttribute('hidden')).toBe(true);
      expect(rightCol().hasAttribute('hidden')).toBe(true);
    });

    it('keeps the body a three-track grid so a collapsed side cannot reflow the rest', () => {
      click(byTestId('toggle-left-sidebar'));
      click(byTestId('toggle-right-sidebar'));

      const body = host.querySelector('.deb-body')!;
      expect(body.classList).toContain('deb-body--left-collapsed');
      expect(body.classList).toContain('deb-body--right-collapsed');

      // Both rails are present and both columns are out of flow: three grid items, three tracks.
      const items = Array.from(body.children).filter(
        el => !(el instanceof HTMLElement && el.hasAttribute('hidden')),
      );
      expect(items).toHaveLength(3);
    });

    /*
     * `[hidden]` takes its `display: none` from the user-agent sheet, which loses to any
     * author rule setting `display` on the same element — and `.deb-col` sets `display: flex`.
     * Without this override the sidebars stay fully visible when "collapsed", something no
     * DOM assertion above can see because jsdom does not model stylesheet origin.
     */
    it('overrides [hidden] in the stylesheet, which .deb-col would otherwise defeat', () => {
      // Read from source: the component's own sheet is not injected under jsdom.
      const css = readFileSync(join(__dirname, 'entity-builder.component.css'), 'utf8');
      expect(css).toMatch(/\.deb-col\[hidden\]\s*\{\s*display:\s*none/);
    });
  });

  describe('fields canvas and live preview collapse', () => {
    const byTestId = <T extends HTMLElement>(id: string): T | null =>
      host.querySelector(`[data-testid="${id}"]`);
    const fieldsSection = () => host.querySelector('[data-testid="builder-fields-section"]') as HTMLElement;
    const previewSection = () => host.querySelector('[data-testid="builder-preview-section"]') as HTMLElement;

    function click(el: HTMLElement | null): void {
      el!.click();
      fixture.detectChanges();
    }

    it('starts with fields and preview open and dock bars closed', () => {
      expect(fieldsSection().classList).not.toContain('deb-toggle-pane--collapsed');
      expect(previewSection().classList).not.toContain('deb-toggle-pane--collapsed');
      expect(host.querySelector('.deb-dock-pane--fields')!.classList).not.toContain('deb-dock-pane--open');
      expect(host.querySelector('.deb-dock-pane--preview')!.classList).not.toContain('deb-dock-pane--open');
    });

    it('collapses fields canvas from toolbar and restores it from the dock bar', () => {
      click(byTestId('toggle-fields'));
      expect(fieldsSection().classList).toContain('deb-toggle-pane--collapsed');
      expect(host.querySelector('.deb-dock-pane--fields')!.classList).toContain('deb-dock-pane--open');
      expect(previewSection().classList).not.toContain('deb-toggle-pane--collapsed');

      click(byTestId('expand-fields'));
      expect(fieldsSection().classList).not.toContain('deb-toggle-pane--collapsed');
      expect(host.querySelector('.deb-dock-pane--fields')!.classList).not.toContain('deb-dock-pane--open');
    });

    it('collapses preview from toolbar and restores it from the dock bar', () => {
      click(byTestId('toggle-preview'));
      expect(previewSection().classList).toContain('deb-toggle-pane--collapsed');
      expect(host.querySelector('.deb-dock-pane--preview')!.classList).toContain('deb-dock-pane--open');
      expect(fieldsSection().classList).not.toContain('deb-toggle-pane--collapsed');

      click(byTestId('expand-preview'));
      expect(previewSection().classList).not.toContain('deb-toggle-pane--collapsed');
      expect(host.querySelector('.deb-dock-pane--preview')!.classList).not.toContain('deb-dock-pane--open');
    });

    it('collapses fields and preview from the button inside each card header', () => {
      click(byTestId('collapse-fields'));
      expect(fieldsSection().classList).toContain('deb-toggle-pane--collapsed');

      click(byTestId('collapse-preview'));
      expect(previewSection().classList).toContain('deb-toggle-pane--collapsed');
    });
  });

  describe('undo / redo keyboard shortcuts', () => {
    function press(key: string, init: Partial<KeyboardEventInit> & { target?: Element } = {}): void {
      const { target, ...rest } = init;
      const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...rest });
      if (target) target.dispatchEvent(event);
      else document.dispatchEvent(event);
    }

    it('undoes on Ctrl+Z and redoes on Ctrl+Shift+Z', () => {
      const undo = jest.spyOn(store, 'undo');
      const redo = jest.spyOn(store, 'redo');

      press('z', { ctrlKey: true });
      expect(undo).toHaveBeenCalledTimes(1);
      expect(redo).not.toHaveBeenCalled();

      press('z', { ctrlKey: true, shiftKey: true });
      expect(redo).toHaveBeenCalledTimes(1);
    });

    it('accepts the Meta key, so the shortcut works on a Mac', () => {
      const undo = jest.spyOn(store, 'undo');
      press('z', { metaKey: true });
      expect(undo).toHaveBeenCalledTimes(1);
    });

    it('ignores Z without a modifier, and other keys with one', () => {
      const undo = jest.spyOn(store, 'undo');
      press('z');
      press('y', { ctrlKey: true });
      expect(undo).not.toHaveBeenCalled();
    });

    it('leaves the shortcut to a focused input or textarea', () => {
      const undo = jest.spyOn(store, 'undo');
      // An input has its own undo stack. Taking Ctrl+Z from it would discard a structural
      // edit when the author only wanted the last character back.
      for (const tag of ['input', 'textarea']) {
        const el = document.createElement(tag);
        document.body.appendChild(el);
        press('z', { ctrlKey: true, target: el });
        el.remove();
      }
      expect(undo).not.toHaveBeenCalled();
    });

    it('leaves the shortcut to a contenteditable element', () => {
      const undo = jest.spyOn(store, 'undo');
      const el = document.createElement('div');
      // jsdom does not derive isContentEditable from the attribute.
      Object.defineProperty(el, 'isContentEditable', { value: true });
      document.body.appendChild(el);
      press('z', { ctrlKey: true, target: el });
      el.remove();
      expect(undo).not.toHaveBeenCalled();
    });
  });

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

  describe('rules input and output', () => {
    const configOf = (entity: string): EntityFormConfig => ({
      entity,
      tabs: [
        {
          id: 'main',
          label: { en: 'Main' },
          fields: [{ id: 'status', type: 'text', label: { en: 'Status' } }],
        },
      ],
    });

    const ruleOf = (id: string): FormRule => ({
      id,
      formConfigId: 'clients',
      fieldId: '[main.status]',
      conditions: [{ operator: 'EQUAL', compareType: 'value', value: 'x' }],
      action: { type: 'visibility', value: false },
      targets: [{ id: '[main.status]', type: 'field' }],
      enabled: true,
      priority: 1,
    });

    function apply(config: EntityFormConfig | undefined, rules: FormRule[] | undefined, previous?: {
      config?: EntityFormConfig;
      rules?: FormRule[];
    }): void {
      component.config = config;
      component.rules = rules;
      component.ngOnChanges({
        config: new SimpleChange(previous?.config, config, previous === undefined),
        rules: new SimpleChange(previous?.rules, rules, previous === undefined),
      });
      fixture.detectChanges();
    }

    it('loads the rules that belong with the config', () => {
      // Without this input, opening a config for editing dropped every rule already
      // authored against it — and saving put that emptiness back.
      apply(configOf('clients'), [ruleOf('r1')]);
      expect(store.rules().map(r => r.id)).toEqual(['r1']);
    });

    it('clears them when a config arrives with none', () => {
      apply(configOf('clients'), [ruleOf('r1')]);
      apply(configOf('other'), undefined, { config: configOf('clients'), rules: [ruleOf('r1')] });
      expect(store.rules()).toEqual([]);
    });

    it('puts them back when the config changes but the rules array does not', () => {
      // `load` clears the store's rules, so a host that keeps one array and swaps the config
      // beside it would otherwise lose them without ever changing the input.
      const rules = [ruleOf('r1')];
      apply(configOf('clients'), rules);
      apply(configOf('second'), rules, { config: configOf('clients'), rules });
      expect(store.rules().map(r => r.id)).toEqual(['r1']);
    });

    it('takes new rules on their own, without a config change', () => {
      // A host whose rules changed while the config did not — loading a saved set, say.
      // This is a separate branch from the config swap, because that one re-seeds the pair
      // as a single snapshot and this one is an edit in its own right.
      apply(configOf('clients'), []);

      const next = [ruleOf('later')];
      component.rules = next;
      component.ngOnChanges({ rules: new SimpleChange([], next, false) });
      fixture.detectChanges();

      expect(store.rules().map(r => r.id)).toEqual(['later']);
      expect(store.canUndo()).toBe(true);
    });

    it('ignores a rules change whose value did not actually change', () => {
      const rules = [ruleOf('r1')];
      apply(configOf('clients'), rules);

      component.ngOnChanges({ rules: new SimpleChange(rules, rules, false) });
      fixture.detectChanges();

      // Angular reports a change on every pass for object inputs; the guard is what stops a
      // stable array putting an undo step on the stack each time.
      expect(store.canUndo()).toBe(false);
    });

    it('emits every change, so a rule can leave the component at all', () => {
      // `BuilderStore` is provided by the component, so its instance is private to this
      // injector, and `save` carries a config alone. Before this output a host could not
      // persist an authored rule, and so could never hand it back to the renderer.
      apply(configOf('clients'), []);

      const seen: FormRule[][] = [];
      component.rulesChange.subscribe(r => seen.push(r));

      store.addRule(ruleOf('authored'));
      fixture.detectChanges();

      expect(seen.at(-1)?.map(r => r.id)).toEqual(['authored']);
    });

    it('emits a rule the store repointed after a field rename', () => {
      apply(configOf('clients'), [ruleOf('r1')]);

      const seen: FormRule[][] = [];
      component.rulesChange.subscribe(r => seen.push(r));

      store.renameField('status', 'state');
      fixture.detectChanges();

      // The host's copy has to follow the rename, or it would write back a rule pointing at
      // a field that no longer exists.
      const last = seen.at(-1);
      expect(last?.[0].fieldId).toBe('[main.state]');
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

  describe('inputs and the JSON panel', () => {
    const api = () => fixture.componentInstance as unknown as {
      copyJson(): void;
      json: string;
    };

    // The active language is whatever the loaded config declared. If the host then narrows
    // `languages` to a set that excludes it, the builder would otherwise keep editing labels
    // in a language the host no longer offers.
    it('moves to the first offered language when the active one is withdrawn', () => {
      store.setActiveLanguage('fr');
      component.languages = ['en', 'de'];
      component.ngOnChanges({
        languages: new SimpleChange(undefined, component.languages, true),
      });

      expect(store.activeLanguage()).toBe('en');
    });

    it('keeps the active language when it is still offered', () => {
      store.setActiveLanguage('de');
      component.languages = ['en', 'de'];
      component.ngOnChanges({
        languages: new SimpleChange(undefined, component.languages, true),
      });

      expect(store.activeLanguage()).toBe('de');
    });

    it('copies the exported config to the clipboard', async () => {
      const writeText = jest.fn().mockResolvedValue(undefined);
      Object.defineProperty(globalThis.navigator, 'clipboard', {
        value: { writeText },
        configurable: true,
      });
      store.setEntityName('clients');
      store.addField('text');

      api().copyJson();

      expect(writeText).toHaveBeenCalledWith(api().json);
      expect(JSON.parse(api().json).entity).toBe('clients');
    });

    // jsdom has no clipboard, and neither does a non-secure browser context. The guard is
    // what keeps that from throwing out of a click handler.
    it('does nothing when the clipboard is unavailable', () => {
      Object.defineProperty(globalThis.navigator, 'clipboard', {
        value: undefined,
        configurable: true,
      });

      expect(() => api().copyJson()).not.toThrow();
    });
  });
});

/**
 * ConfigSourceService caches a config per entity and exposed clearCache from the start, but
 * nothing ever called it — so an edited config kept serving its old copy for the lifetime of
 * the page, most visibly to a referenced field resolving against the stale schema.
 */
describe('EntityBuilderComponent — config cache invalidation on save', () => {
  let clearCache: jest.Mock;

  async function setup(withConfigSource: boolean): Promise<EntityBuilderComponent> {
    clearCache = jest.fn();
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [EntityBuilderComponent],
      providers: [
        provideNoopAnimations(),
        ...(withConfigSource
          ? [{ provide: ConfigSourceService, useValue: { clearCache, getConfig: jest.fn() } }]
          : []),
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(EntityBuilderComponent);
    const component = fixture.componentInstance;
    component.config = {
      entity: 'clients',
      version: 1,
      tabs: [{ id: 'main', label: { en: 'Main' }, fields: [] }],
    };
    component.ngOnChanges({ config: new SimpleChange(undefined, component.config, true) });
    fixture.detectChanges();
    return component;
  }

  it('drops the cached config for the saved entity', async () => {
    const component = await setup(true);
    const saved: string[] = [];
    component.save.subscribe(c => saved.push(c.entity));

    (component as unknown as { doSave(): void }).doSave();

    expect(clearCache).toHaveBeenCalledWith('clients');
    expect(saved).toEqual(['clients']);
  });

  it('still saves when no CONFIG_SOURCE is registered', async () => {
    const component = await setup(false);
    const saved: string[] = [];
    component.save.subscribe(c => saved.push(c.entity));

    expect(() => (component as unknown as { doSave(): void }).doSave()).not.toThrow();
    expect(saved).toEqual(['clients']);
  });

  it('selects problem field when problem has fieldId', async () => {
    const component = await setup(false);
    const componentStore = (component as any).store as BuilderStore;
    const selectSpy = jest.spyOn(componentStore, 'selectField');

    (component as any).selectProblemField({ level: 'error', message: 'test', fieldId: 'field_1' });
    expect(selectSpy).toHaveBeenCalledWith('field_1');

    (component as any).selectProblemField({ level: 'error', message: 'test' });
    expect(selectSpy).toHaveBeenCalledTimes(1);
  });

  it('manages RBAC roles correctly', async () => {
    const component = await setup(false);
    expect((component as any).rolesFor('view')).toEqual([]);

    (component as any).setRoles('view', ['admin', 'manager']);
    expect((component as any).rolesFor('view')).toEqual(['admin', 'manager']);

    (component as any).setRolesFromText('edit', 'admin, manager, admin , IT_SUPPORT');
    expect((component as any).rolesFor('edit')).toEqual(['admin', 'manager', 'IT_SUPPORT']);
  });

  it('copies json string to clipboard when available', async () => {
    const component = await setup(false);
    expect((component as any).json).toContain('clients');

    const writeText = jest.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
      writable: true,
    });

    (component as any).copyJson();
    expect(writeText).toHaveBeenCalledWith((component as any).json);
  });

  it('controls rule graph modal and selects field from graph', async () => {
    const component = await setup(false);
    expect(component.ruleGraphOpen()).toBe(false);

    component.openRuleGraph();
    expect(component.ruleGraphOpen()).toBe(true);

    const componentStore = (component as any).store as BuilderStore;
    const selectSpy = jest.spyOn(componentStore, 'selectField');
    component.onSelectFieldFromGraph('testField');
    expect(selectSpy).toHaveBeenCalledWith('testField');
    expect(component.ruleGraphOpen()).toBe(false);

    component.openRuleGraph();
    component.closeRuleGraph();
    expect(component.ruleGraphOpen()).toBe(false);
  });
});
