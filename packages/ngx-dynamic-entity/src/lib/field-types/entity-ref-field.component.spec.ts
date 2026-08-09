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
  fixture.componentInstance.field = field;
  fixture.componentInstance.control = control;
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
    fixture.componentInstance.onSelectionChange();

    expect(seen).toEqual([
      { fieldId: 'country', option: expect.objectContaining({ value: 'de', label: 'Germany' }) },
    ]);
  });

  it('renders empty options when no loader is registered', async () => {
    const fixture = await setup({ id: 'country', type: 'entity-ref', label: { en: 'Country' } }, {});
    expect(fixture.componentInstance.options()).toEqual([]);
  });
});
