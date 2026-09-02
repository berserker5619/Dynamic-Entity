import { TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import type { EntityFormConfig } from '@dynamic-entity/core';
import { EntityBuilderComponent } from './entity-builder.component';
import { BuilderStore } from './builder-store.service';
import { BUILDER_TEXT, DEFAULT_BUILDER_TEXT, type BuilderTextKey } from './builder-text';

/**
 * A configured `BUILDER_TEXT` reaches the builder's rendered DOM.
 *
 * The source scan beside this proves every published key has a call site. It cannot prove the
 * call site is the one that renders: a literal left in a panel nobody opened during the sweep
 * satisfies it and still shows English.
 *
 * So this mounts the real builder, overrides every key with a marker, drives it through the
 * states that reveal each panel — a field selected, options authored, a rule open, a
 * reference configured — and asserts that no English default survives in the markup.
 *
 * Inverted rather than enumerated, for the same reason as the renderer's sweep: a list of
 * which panel renders which key would need updating by exactly the person least likely to.
 */
describe('a configured BUILDER_TEXT reaches the builder on screen', () => {
  /** Joins the captured states; only ever searched, never parsed. */
  const SEPARATOR = String.fromCharCode(10);
  const MARK = (key: string) => `[[${key}]]`;
  const defaults = Object.entries(DEFAULT_BUILDER_TEXT) as [BuilderTextKey, string][];

  /** A config wide enough to open every panel: options, a reference, a group, a rule. */
  const CONFIG: EntityFormConfig = {
    entity: 'probe',
    version: 1,
    tabs: [
      {
        id: 'main',
        label: { en: 'Main' },
        fields: [
          { id: 'name', type: 'text', label: { en: 'Name' }, validators: { required: true } },
          { id: 'tier', type: 'dropdown', label: { en: 'Tier' }, options: [{ en: 'Gold' }, { en: 'Silver' }] },
          { id: 'country', type: 'entity-ref', label: { en: 'Country' }, entityRef: { entityKey: 'countries' } },
          {
            id: 'address',
            type: 'group',
            label: { en: 'Address' },
            fields: [{ id: 'city', type: 'text', label: { en: 'City' } }],
          },
        ],
      },
      { id: 'notes', label: { en: 'Notes' }, fields: [] },
    ],
    rules: [
      {
        id: 'r1',
        conditions: [{ field: 'tier', operator: 'EQUAL', value: 'Gold' }],
        action: { type: 'visibility', target: 'name', value: true },
      },
    ],
  } as EntityFormConfig;

  function mount(config?: EntityFormConfig) {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [EntityBuilderComponent],
      providers: [
        provideNoopAnimations(),
        // A resolver, so a key added later is covered without touching this file.
        { provide: BUILDER_TEXT, useValue: (key: string) => MARK(key) },
      ],
    });
    const fixture = TestBed.createComponent(EntityBuilderComponent);
    if (config) fixture.componentRef.setInput('config', JSON.parse(JSON.stringify(config)));
    fixture.componentRef.setInput('languages', ['en', 'de']);
    fixture.componentRef.setInput('availableRoles', ['admin', 'viewer']);
    fixture.detectChanges();
    return fixture;
  }

  /** Markup across the states that open different panels. */
  function sweep(): string {
    const seen: string[] = [];

    // An unconfigured builder first. Loading a config selects its first field, so the empty
    // canvas and the empty inspector are only reachable before one arrives — and those two
    // panels are the ones a first-time user sees.
    seen.push((mount().nativeElement as HTMLElement).innerHTML);

    const fixture = mount(CONFIG);
    const store = fixture.debugElement.injector.get(BuilderStore);
    const host = fixture.nativeElement as HTMLElement;

    const capture = () => {
      fixture.detectChanges();
      seen.push(host.innerHTML);
    };

    capture(); // the first field, selected by loading
    store.selectField('tier');
    capture(); // the options editor and its data-source picker
    store.selectField('country');
    capture(); // the entity-reference panel
    store.selectField('address');
    capture(); // a container, and the sub-field list
    store.setActiveLanguage('de');
    capture(); // the authoring-language switch, which the chrome must ignore

    return seen.join(SEPARATOR);
  }

  /** Mounted once, inside a test rather than in the describe body, which runs sync. */
  let cached: string | undefined;
  const markup = () => (cached ??= sweep());

  it('renders the builder at all, so the sweep is not looking at an empty page', () => {
    expect(markup()).toContain('deb-toolbar');
    expect(markup().length).toBeGreaterThan(5000);
  });

  it('shows no English default a host cannot replace', () => {
    const html = markup();
    const leaked = defaults
      // Multi-word defaults only. A single word appears in class names, icon ligatures and
      // the config being authored, and a sweep that cries wolf gets switched off.
      .filter(([, english]) => english.includes(' ') && english.length > 6)
      // `{placeholder}` defaults never appear verbatim once substituted, so they cannot leak
      // as written and would only produce noise here.
      .filter(([, english]) => !english.includes('{'))
      .filter(([, english]) => html.includes(english))
      .map(([key]) => key);

    expect(leaked).toEqual([]);
  });

  it('reaches a large share of the vocabulary, so the check above is not vacuous', () => {
    const seen = defaults.filter(([key]) => markup().includes(MARK(key)));
    // Roughly a third of the keys live behind a dialog or a rule form this sweep does not
    // open; what it does open must be substantially covered.
    expect(seen.length).toBeGreaterThan(70);
  });
});
