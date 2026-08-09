import { Component, Type } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { FIELD_TYPE_CATALOG } from '@dynamic-entity/core';
import {
  ENTITY_REF_REGISTRY,
  FIELD_TYPE_REGISTRY,
  HOOK_REGISTRY,
  MASKED_ROLES,
  VALIDATOR_REGISTRY,
} from '../tokens/injection-tokens';
import { FieldRegistryService } from '../services/field-registry.service';
import { builtInFieldTypes, provideBuiltInFieldTypes } from './provide-field-types';
import { provideNgxDynamicEntity } from './provide-ngx-dynamic-entity';

@Component({ template: '' })
class CustomFieldComponent {}

describe('provideNgxDynamicEntity', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('provides empty registries when called with no options', () => {
    TestBed.configureTestingModule({ providers: [provideNgxDynamicEntity()] });

    expect(TestBed.inject(MASKED_ROLES)).toEqual([]);
    expect(TestBed.inject(FIELD_TYPE_REGISTRY).size).toBe(0);
    expect(TestBed.inject(ENTITY_REF_REGISTRY).size).toBe(0);
    expect(TestBed.inject(VALIDATOR_REGISTRY).size).toBe(0);
    expect(TestBed.inject(HOOK_REGISTRY).size).toBe(0);
  });

  it('turns each option record into a Map keyed the same way', () => {
    const loader = () => [];
    TestBed.configureTestingModule({
      providers: [
        provideNgxDynamicEntity({
          maskedRoles: ['IT_SUPPORT'],
          fieldTypes: { custom: CustomFieldComponent },
          entityRefs: { countries: loader },
          validators: { even: () => null },
          hooks: { 'clients:beforeSave': (d: unknown) => d },
        }),
      ],
    });

    expect(TestBed.inject(MASKED_ROLES)).toEqual(['IT_SUPPORT']);
    expect(TestBed.inject(FIELD_TYPE_REGISTRY).get('custom')).toBe(CustomFieldComponent);
    expect(TestBed.inject(ENTITY_REF_REGISTRY).get('countries')).toBe(loader);
    expect(TestBed.inject(VALIDATOR_REGISTRY).has('even')).toBe(true);
    expect(TestBed.inject(HOOK_REGISTRY).has('clients:beforeSave')).toBe(true);
  });

  it('lets a fieldTypes override beat a registered built-in', () => {
    TestBed.configureTestingModule({
      providers: [
        provideBuiltInFieldTypes(),
        provideNgxDynamicEntity({ fieldTypes: { text: CustomFieldComponent } }),
      ],
    });

    expect(TestBed.inject(FieldRegistryService).resolve('text')).toBe(CustomFieldComponent);
  });
});

/**
 * The catalog in core is the single source of truth for field types. If the renderer's
 * built-in set and that catalog ever diverge, the builder can author a field the renderer
 * cannot draw (or vice versa) — the exact drift the shared catalog exists to prevent.
 */
describe('built-in field types ↔ core catalog parity', () => {
  const builtIns: Record<string, Type<unknown>> = builtInFieldTypes();

  it('registers a component for every catalog type', () => {
    const missing = FIELD_TYPE_CATALOG.map(m => m.type).filter(type => !(type in builtIns));
    expect(missing).toEqual([]);
  });

  it('registers no key the catalog does not declare', () => {
    const catalogTypes = new Set<string>(FIELD_TYPE_CATALOG.map(m => m.type));
    const extra = Object.keys(builtIns).filter(key => !catalogTypes.has(key));
    expect(extra).toEqual([]);
  });

  it('exposes exactly the catalog keys through the registry', () => {
    TestBed.configureTestingModule({ providers: [provideBuiltInFieldTypes()] });
    const registered = TestBed.inject(FieldRegistryService).registeredTypes();

    expect(registered).toEqual([...FIELD_TYPE_CATALOG.map(m => m.type)].sort());
  });
});
