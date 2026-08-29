import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { BuilderStore } from '../builder-store.service';
import { EntityReferenceConfigComponent } from './entity-reference-config.component';

describe('EntityReferenceConfigComponent', () => {
  let fixture: ComponentFixture<EntityReferenceConfigComponent>;
  let store: BuilderStore;
  let host: HTMLElement;

  /** Type into a `data-testid`-marked mat-input and let ngModel commit. */
  function type(testId: string, value: string): void {
    const input = host.querySelector(`[data-testid="${testId}"]`) as HTMLInputElement;
    input.value = value;
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  }

  function fieldId(): string {
    return store.selectedFieldId()!;
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [EntityReferenceConfigComponent],
      providers: [BuilderStore, provideNoopAnimations()],
    }).compileComponents();

    fixture = TestBed.createComponent(EntityReferenceConfigComponent);
    store = TestBed.inject(BuilderStore);
    host = fixture.nativeElement as HTMLElement;

    store.setEntityName('orders');
    store.addField('entity-ref'); // auto-selected
    fixture.detectChanges();
  });

  it('renders nothing when no field is selected', () => {
    store.selectField(null);
    fixture.detectChanges();
    expect(host.textContent?.trim()).toBe('');
  });

  it('writes the registry key onto entityReference', () => {
    type('entity-ref-key', 'countries');
    expect(store.selectedField()?.entityReference?.linkedEntityKey).toBe('countries');
  });

  it('splits comma-separated display fields and trims them', () => {
    type('entity-ref-display-fields', ' first , last ');
    expect(store.selectedField()?.entityReference?.displayFields).toEqual(['first', 'last']);
  });

  it('clears display fields when emptied', () => {
    type('entity-ref-display-fields', 'name');
    type('entity-ref-display-fields', '  ');
    expect(store.selectedField()?.entityReference?.displayFields).toBeUndefined();
  });

  describe('filters JSON', () => {
    it('parses a valid JSON object', () => {
      type('entity-ref-filters', '{"active":true}');
      expect(store.selectedField()?.entityReference?.filters).toEqual({ active: true });
    });

    it('reports invalid JSON and leaves the config untouched', () => {
      type('entity-ref-filters', '{not json');
      fixture.detectChanges();

      expect(store.selectedField()?.entityReference?.filters).toBeUndefined();
      expect(host.textContent).toContain('Invalid JSON');
    });

    it('rejects a JSON array — filters must be an object', () => {
      type('entity-ref-filters', '[1,2]');
      fixture.detectChanges();

      expect(store.selectedField()?.entityReference?.filters).toBeUndefined();
      expect(host.textContent).toContain('must be a JSON object');
    });

    it('clears filters and the error when emptied', () => {
      type('entity-ref-filters', '{bad');
      type('entity-ref-filters', '');
      fixture.detectChanges();

      expect(store.selectedField()?.entityReference?.filters).toBeUndefined();
      expect(host.textContent).not.toContain('Invalid JSON');
    });
  });

  describe('cascade', () => {
    it('offers every other field as a parent candidate, never itself', () => {
      const self = fieldId();
      store.addField('text');
      store.selectField(self);
      fixture.detectChanges();

      const options = Array.from(host.querySelectorAll('mat-option')).map(o => o.textContent ?? '');
      expect(options.some(o => o.includes(self))).toBe(false);
    });

    it('hides the lookup inputs until a parent is chosen', () => {
      expect(host.querySelector('[data-testid="entity-ref-lookup-filter"]')).toBeNull();

      store.updateEntityReference(fieldId(), { parentField: 'country' });
      fixture.detectChanges();

      expect(host.querySelector('[data-testid="entity-ref-lookup-filter"]')).not.toBeNull();
      expect(host.querySelector('[data-testid="entity-ref-lookup-path"]')).not.toBeNull();
    });

    it('writes the lookup filter path', () => {
      store.updateEntityReference(fieldId(), { parentField: 'country' });
      fixture.detectChanges();

      type('entity-ref-lookup-filter', 'country');
      expect(store.selectedField()?.entityReference?.lookupFilter).toBe('country');
    });
  });

  describe('autoPatch', () => {
    it('shows a hint and no mappings until one is added', () => {
      expect(host.textContent).toContain('No auto-patch configured');
    });

    it('adds a mapping row through the button', () => {
      (host.querySelector('[data-testid="add-auto-patch"]') as HTMLButtonElement).click();
      fixture.detectChanges();

      expect(store.selectedField()?.autoPatch?.mappings.length).toBe(1);
      expect(host.textContent).not.toContain('No auto-patch configured');
    });

    it('edits and removes a mapping', async () => {
      store.addAutoPatchMapping(fieldId());
      store.updateAutoPatchMapping(fieldId(), 0, { source: 'vat', target: 'taxId' });
      fixture.detectChanges();
      // [ngModel] writes to the view asynchronously.
      await fixture.whenStable();
      fixture.detectChanges();

      // Source stays free text — it is a path into the *linked* record, which this config
      // knows nothing about. The target is one of our fields, so it is a picker now.
      const inputs = Array.from(host.querySelectorAll('.deb-option-row input')) as HTMLInputElement[];
      expect(inputs.map(i => i.value)).toEqual(['vat']);
      expect(store.selectedField()?.autoPatch?.mappings[0].target).toBe('taxId');

      store.removeAutoPatchMapping(fieldId(), 0);
      fixture.detectChanges();
      expect(store.selectedField()?.autoPatch).toBeUndefined();
    });
  });

  /**
   * `parentCandidates` reads `store.fields()`, which used to stop at top-level tabs — so a
   * field on a sub-tab could never be offered as the parent of a cascade, with no indication
   * that it had been left out.
   */
  it('offers a field from a sub-tab as a cascade parent', () => {
    store.load({
      entity: 'claims',
      version: 1,
      tabs: [
        { id: 'top', label: { en: 'Top' }, fields: [{ id: 'child', type: 'dropdown', label: { en: 'Child' } }] },
        {
          id: 'incident',
          label: { en: 'Incident' },
          children: [
            {
              id: 'details',
              label: { en: 'Details' },
              fields: [{ id: 'nestedParent', type: 'dropdown', label: { en: 'Nested Parent' } }],
            },
          ],
        },
      ],
    });
    store.selectField('child');
    fixture.detectChanges();

    const candidates = (fixture.componentInstance as unknown as {
      parentCandidates(): { id: string }[];
    }).parentCandidates();

    expect(candidates.map(f => f.id)).toContain('nestedParent');
  });
});

/**
 * The cascade parent was already a picker, but its values were bare ids — which name a field
 * only until a second scope reuses the id. It offers paths now.
 */
describe('ReferencedFieldConfigComponent — cascade parent options', () => {
  let fixture: ComponentFixture<EntityReferenceConfigComponent>;
  let store: BuilderStore;

  beforeEach(async () => {
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [EntityReferenceConfigComponent],
      providers: [BuilderStore, provideNoopAnimations()],
    }).compileComponents();

    store = TestBed.inject(BuilderStore);
    store.load({
      entity: 'people',
      version: 1,
      tabs: [
        { id: 'personal', label: {}, fields: [{ id: 'country', type: 'dropdown', label: { en: 'Country' } }] },
        {
          id: 'work',
          label: {},
          fields: [
            { id: 'country', type: 'dropdown', label: { en: 'Country' } },
            { id: 'city', type: 'entity-ref', label: { en: 'City' } },
          ],
        },
      ],
    });
    store.selectField('city');

    fixture = TestBed.createComponent(EntityReferenceConfigComponent);
    fixture.detectChanges();
  });

  const parentOptions = () =>
    (fixture.componentInstance as unknown as {
      parentOptions(): { value: string; path: string }[];
    }).parentOptions();

  it('offers each candidate by path, so two countries stay distinguishable', () => {
    expect(parentOptions().map(o => o.value)).toEqual(['[personal.country]', '[work.country]']);
  });

  it('does not offer the field as its own cascade parent', () => {
    expect(parentOptions().map(o => o.value)).not.toContain('[work.city]');
  });
});
