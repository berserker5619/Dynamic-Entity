import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideBuiltInFieldTypes, provideFieldTypes } from '../providers/provide-field-types';
import { FIELD_TYPE_REGISTRY } from '../tokens/injection-tokens';
import { TextFieldComponent } from '../field-types/text-field.component';
import { NumberFieldComponent } from '../field-types/number-field.component';
import { FieldRegistryService } from './field-registry.service';

@Component({ template: '' })
class CustomFieldComponent {}

@Component({ template: '' })
class OverrideTextComponent {}

const ALL_BUILTIN_FIELD_TYPES = [
  'text',
  'textarea',
  'markdown',
  'number',
  'currency',
  'email',
  'password',
  'checkbox',
  'boolean',
  'date',
  'datetime',
  'time',
  'monthYear',
  'dropdown',
  'radio',
  'multiSelect',
  'entity-ref',
  'group',
  'array',
  'image',
  'file',
];

describe('FieldRegistryService', () => {
  afterEach(() => TestBed.resetTestingModule());

  describe('with no registration (the tree-shaking default)', () => {
    it('resolves nothing — built-ins are opt-in', () => {
      TestBed.configureTestingModule({});
      const service = TestBed.inject(FieldRegistryService);

      expect(service.resolve('text')).toBeNull();
      expect(service.has('text')).toBe(false);
      expect(service.registeredTypes()).toEqual([]);
    });
  });

  describe('with provideBuiltInFieldTypes()', () => {
    beforeEach(() => {
      TestBed.configureTestingModule({ providers: [provideBuiltInFieldTypes()] });
    });

    it('resolves every built-in field type', () => {
      const service = TestBed.inject(FieldRegistryService);
      for (const type of ALL_BUILTIN_FIELD_TYPES) {
        expect(service.resolve(type)).not.toBeNull();
        expect(service.has(type)).toBe(true);
      }
      expect(service.registeredTypes().length).toBe(ALL_BUILTIN_FIELD_TYPES.length);
    });

    it('maps text to TextFieldComponent', () => {
      expect(TestBed.inject(FieldRegistryService).resolve('text')).toBe(TextFieldComponent);
    });

    it('returns null for unknown field types', () => {
      expect(TestBed.inject(FieldRegistryService).resolve('unknown')).toBeNull();
    });
  });

  describe('with a partial provideFieldTypes()', () => {
    it('registers only the named types', () => {
      TestBed.configureTestingModule({
        providers: [provideFieldTypes({ text: TextFieldComponent })],
      });
      const service = TestBed.inject(FieldRegistryService);

      expect(service.resolve('text')).toBe(TextFieldComponent);
      expect(service.resolve('dropdown')).toBeNull();
    });

    it('composes multiple calls instead of clobbering', () => {
      TestBed.configureTestingModule({
        providers: [
          provideFieldTypes({ text: TextFieldComponent }),
          provideFieldTypes({ number: NumberFieldComponent }),
        ],
      });
      const service = TestBed.inject(FieldRegistryService);

      expect(service.resolve('text')).toBe(TextFieldComponent);
      expect(service.resolve('number')).toBe(NumberFieldComponent);
    });

    it('lets a later set win on a key collision', () => {
      TestBed.configureTestingModule({
        providers: [
          provideFieldTypes({ text: TextFieldComponent }),
          provideFieldTypes({ text: OverrideTextComponent }),
        ],
      });
      expect(TestBed.inject(FieldRegistryService).resolve('text')).toBe(OverrideTextComponent);
    });
  });

  describe('priority and runtime registration', () => {
    it('lets the consumer token override a registered built-in', () => {
      TestBed.configureTestingModule({
        providers: [
          provideBuiltInFieldTypes(),
          { provide: FIELD_TYPE_REGISTRY, useValue: new Map([['text', OverrideTextComponent]]) },
        ],
      });
      expect(TestBed.inject(FieldRegistryService).resolve('text')).toBe(OverrideTextComponent);
    });

    it('supports register() and registerAll() at runtime', () => {
      TestBed.configureTestingModule({});
      const service = TestBed.inject(FieldRegistryService);

      service.register('custom', CustomFieldComponent);
      service.registerAll({ another: CustomFieldComponent });

      expect(service.resolve('custom')).toBe(CustomFieldComponent);
      expect(service.resolve('another')).toBe(CustomFieldComponent);
      expect(service.registeredTypes()).toEqual(['another', 'custom']);
    });
  });
});
