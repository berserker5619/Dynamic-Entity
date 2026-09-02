import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormControl, FormGroup } from '@angular/forms';
import type { EntityReferenceLoader, NestedFieldConfig } from '@dynamic-entity/core';
import { of } from 'rxjs';
import { ENTITY_REF_REGISTRY } from '../tokens/injection-tokens';
import { EntityRefSelectionService } from '../services/entity-ref-selection.service';
import { EntityRefFieldComponent } from './entity-ref-field.component';

const COUNTRIES = [
  { value: 'de', label: 'Germany', record: { id: 'de', vat: 'DE1' } },
  { value: 'fr', label: 'France', record: { id: 'fr', vat: 'FR1' } },
];

const CITIES = [
  { value: 'ber', label: 'Berlin', record: { country: 'de' } },
  { value: 'muc', label: 'Munich', record: { country: 'de' } },
  { value: 'par', label: 'Paris', record: { country: 'fr' } },
];

/**
 * Let the loader's promise chain settle. `fixture.whenStable()` does not cover it —
 * the loader resolves outside Angular's zone-tracked task queue.
 */
async function flush(fixture: ComponentFixture<EntityRefFieldComponent>): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, 0));
  fixture.detectChanges();
}

async function setup(
  field: NestedFieldConfig,
  loaders: Record<string, EntityReferenceLoader>,
  parent?: { id: string; value: unknown },
): Promise<ComponentFixture<EntityRefFieldComponent>> {
  await TestBed.configureTestingModule({
    imports: [EntityRefFieldComponent],
    providers: [{ provide: ENTITY_REF_REGISTRY, useValue: new Map(Object.entries(loaders)) }],
  }).compileComponents();

  const control = new FormControl('');
  const group = new FormGroup({
    [field.id]: control,
    ...(parent ? { [parent.id]: new FormControl(parent.value) } : {}),
  });
  void group;

  const fixture = TestBed.createComponent(EntityRefFieldComponent);
  fixture.componentRef.setInput('field', field);
  fixture.componentRef.setInput('control', control);
  fixture.detectChanges();
  await flush(fixture);
  return fixture;
}

describe('EntityRefFieldComponent', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('loads options from the registered loader', async () => {
    const fixture = await setup(
      { id: 'country', type: 'entity-ref', label: { en: 'Country' } },
      { country: () => Promise.resolve(COUNTRIES) },
    );

    expect(fixture.componentInstance.options().map(o => o.label)).toEqual(['Germany', 'France']);
    expect(fixture.nativeElement.querySelectorAll('option').length).toBe(3); // + placeholder
  });

  it('prefers linkedEntityKey over the field id', async () => {
    const fixture = await setup(
      {
        id: 'homeCountry',
        type: 'entity-ref',
        label: { en: 'Country' },
        entityReference: { enabled: true, linkedEntityKey: 'country' },
      },
      { country: () => COUNTRIES },
    );

    expect(fixture.componentInstance.options().length).toBe(2);
  });

  it('accepts an Observable loader', async () => {
    const fixture = await setup(
      { id: 'country', type: 'entity-ref', label: { en: 'Country' } },
      { country: () => of(COUNTRIES) },
    );

    expect(fixture.componentInstance.options().length).toBe(2);
  });

  it('renders no options and flags the parent when a cascade has no parent value', async () => {
    const fixture = await setup(
      {
        id: 'city',
        type: 'entity-ref',
        label: { en: 'City' },
        entityReference: { enabled: true, parentField: 'country', lookupFilter: 'country' },
      },
      { city: () => CITIES },
      { id: 'country', value: '' },
    );

    expect(fixture.componentInstance.options()).toEqual([]);
    expect(fixture.componentInstance.awaitingParent()).toBe(true);
  });

  it('filters options by the parent value via lookupFilter', async () => {
    const fixture = await setup(
      {
        id: 'city',
        type: 'entity-ref',
        label: { en: 'City' },
        entityReference: { enabled: true, parentField: 'country', lookupFilter: 'country' },
      },
      { city: () => CITIES },
      { id: 'country', value: 'de' },
    );

    expect(fixture.componentInstance.options().map(o => o.label)).toEqual(['Berlin', 'Munich']);
  });

  it('reloads and clears a stale selection when the parent changes', async () => {
    const fixture = await setup(
      {
        id: 'city',
        type: 'entity-ref',
        label: { en: 'City' },
        entityReference: { enabled: true, parentField: 'country', lookupFilter: 'country' },
      },
      { city: () => CITIES },
      { id: 'country', value: 'de' },
    );

    const component = fixture.componentInstance;
    component.control.setValue('ber');
    component.control.parent!.get('country')!.setValue('fr');
    await flush(fixture);

    expect(component.control.value).toBe('');
    expect(component.options().map(o => o.label)).toEqual(['Paris']);
  });

  it('publishes the selected record for autoPatch', async () => {
    const fixture = await setup(
      { id: 'country', type: 'entity-ref', label: { en: 'Country' } },
      { country: () => COUNTRIES },
    );

    const bus = TestBed.inject(EntityRefSelectionService);
    const seen: unknown[] = [];
    bus.selection$.subscribe(s => seen.push(s));

    fixture.componentInstance.control.setValue('de');

    expect(seen).toEqual([{ fieldId: 'country', option: expect.objectContaining({ value: 'de', label: 'Germany' }) }]);
  });

  it('renders empty options when no loader is registered', async () => {
    const fixture = await setup({ id: 'country', type: 'entity-ref', label: { en: 'Country' } }, {});
    expect(fixture.componentInstance.options()).toEqual([]);
  });
});

describe('EntityRefFieldComponent — masking, labels and absent parents', () => {
  afterEach(() => TestBed.resetTestingModule());

  /**
   * A masked field renders XXXXXXXXX, so loading its options would be a pointless request
   * for data the user is not being shown.
   */
  it('does not load options when the field is masked', async () => {
    const loader = jest.fn(() => Promise.resolve(COUNTRIES));
    await TestBed.configureTestingModule({
      imports: [EntityRefFieldComponent],
      providers: [{ provide: ENTITY_REF_REGISTRY, useValue: new Map([['country', loader]]) }],
    }).compileComponents();

    const fixture = TestBed.createComponent(EntityRefFieldComponent);
    fixture.componentRef.setInput('field', { id: 'country', type: 'entity-ref', label: { en: 'Country' } });
    fixture.componentRef.setInput('control', new FormControl(''));
    fixture.componentRef.setInput('masked', true);
    fixture.detectChanges();
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(loader).not.toHaveBeenCalled();
    expect(fixture.componentInstance.options().length).toBe(0);
  });

  it('returns the raw value from getLabel when no option matches', async () => {
    const fixture = await setup(
      { id: 'country', type: 'entity-ref', label: { en: 'Country' } },
      { country: () => Promise.resolve(COUNTRIES) },
    );

    expect(fixture.componentInstance.getLabel('de')).toBe('Germany');
    expect(fixture.componentInstance.getLabel('zz')).toBe('zz');
  });

  it('renders an em dash from getLabel for an empty value', async () => {
    const fixture = await setup(
      { id: 'country', type: 'entity-ref', label: { en: 'Country' } },
      { country: () => Promise.resolve(COUNTRIES) },
    );

    expect(fixture.componentInstance.getLabel(null)).toBe('—');
  });

  /**
   * A config may name a parentField that is not in this form group — a partial form, or a
   * schema edited after the fact. Watching must simply not happen, rather than throw.
   */
  it('tolerates a parentField that is not present in the form group', async () => {
    const loader = jest.fn(() => Promise.resolve(CITIES));
    await TestBed.configureTestingModule({
      imports: [EntityRefFieldComponent],
      providers: [{ provide: ENTITY_REF_REGISTRY, useValue: new Map([['city', loader]]) }],
    }).compileComponents();

    const control = new FormControl('');
    new FormGroup({ city: control }); // no `country` sibling
    const fixture = TestBed.createComponent(EntityRefFieldComponent);
    fixture.componentInstance.field = {
      id: 'city',
      type: 'entity-ref',
      label: { en: 'City' },
      entityReference: { enabled: true, linkedEntityKey: 'city', parentField: 'country' },
    };
    fixture.componentRef.setInput('control', control);

    expect(() => fixture.detectChanges()).not.toThrow();
    await new Promise(resolve => setTimeout(resolve, 0));

    // A cascading child holds until its parent has a value, and an absent parent control
    // simply never supplies one — so it waits rather than loading the unfiltered list.
    expect(fixture.componentInstance.awaitingParent()).toBe(true);
    expect(fixture.componentInstance.options()).toEqual([]);
    expect(loader).not.toHaveBeenCalled();
  });

  it('emits the selected record on the selection bus', async () => {
    const fixture = await setup(
      { id: 'country', type: 'entity-ref', label: { en: 'Country' } },
      { country: () => Promise.resolve(COUNTRIES) },
    );
    const bus = TestBed.inject(EntityRefSelectionService);
    const seen: unknown[] = [];
    bus.selection$.subscribe(e => seen.push(e));

    fixture.componentInstance.control.setValue('fr');

    expect(seen).toEqual([{ fieldId: 'country', option: COUNTRIES[1] }]);
  });
});

/**
 * Selection is published from `valueChanges`, which fires after the formControl directive
 * has written the new value. Driving the DOM `change` event is how a real select (and
 * Playwright) update the control — these specs cover that path, not a direct `setValue`.
 */
describe('EntityRefFieldComponent — selection published from a real change event', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('publishes the option matching the newly chosen value', async () => {
    const fixture = await setup(
      { id: 'country', type: 'entity-ref', label: { en: 'Country' } },
      { country: () => Promise.resolve(COUNTRIES) },
    );

    const bus = TestBed.inject(EntityRefSelectionService);
    const seen: any[] = [];
    bus.selection$.subscribe(e => seen.push(e));

    const select: HTMLSelectElement = fixture.nativeElement.querySelector('select');
    select.value = 'fr';
    select.dispatchEvent(new Event('change'));
    fixture.detectChanges();

    expect(seen).toHaveLength(1);
    expect(seen[0].fieldId).toBe('country');
    expect(seen[0].option?.value).toBe('fr');
    // The record is what autoPatch copies from, so an empty one is a silent no-op downstream.
    expect(seen[0].option?.record).toBeDefined();
  });

  it('reads the control when called with no value of its own', async () => {
    // `onSelectionChange()` is also called imperatively — from `valueChanges`, which carries
    // no argument. The argument-less path has to fall back to the control, and did so
    // untested: a regression there would break autoPatch only for programmatic changes,
    // which is the half no click reproduces.
    const fixture = await setup(
      { id: 'country', type: 'entity-ref', label: { en: 'Country' } },
      { country: () => Promise.resolve(COUNTRIES) },
    );

    const bus = TestBed.inject(EntityRefSelectionService);
    const seen: any[] = [];
    bus.selection$.subscribe(e => seen.push(e));

    fixture.componentInstance.control.setValue('fr');
    fixture.componentInstance.onSelectionChange();
    fixture.detectChanges();

    expect(seen.at(-1).option?.value).toBe('fr');
  });

  it('publishes null for a control value no option matches', async () => {
    const fixture = await setup(
      { id: 'country', type: 'entity-ref', label: { en: 'Country' } },
      { country: () => Promise.resolve(COUNTRIES) },
    );

    const bus = TestBed.inject(EntityRefSelectionService);
    const seen: any[] = [];
    bus.selection$.subscribe(e => seen.push(e));

    // A record can hold a value whose option has since been removed from the source.
    fixture.componentInstance.control.setValue('atlantis');
    fixture.componentInstance.onSelectionChange();
    fixture.detectChanges();

    expect(seen.at(-1).option).toBeNull();
  });

  it('publishes null when the selection is cleared', async () => {
    const fixture = await setup(
      { id: 'country', type: 'entity-ref', label: { en: 'Country' } },
      { country: () => Promise.resolve(COUNTRIES) },
    );

    const bus = TestBed.inject(EntityRefSelectionService);
    const seen: any[] = [];
    bus.selection$.subscribe(e => seen.push(e));

    const select: HTMLSelectElement = fixture.nativeElement.querySelector('select');
    select.value = '';
    select.dispatchEvent(new Event('change'));
    fixture.detectChanges();

    expect(seen[0].option).toBeNull();
  });
});
