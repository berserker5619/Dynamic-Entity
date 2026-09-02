import { TestBed } from '@angular/core/testing';
import { AbstractControl, FormArray, FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import type { EntityFormConfig, NestedFieldConfig, RichFieldType } from '@dynamic-entity/core';
import { builtInFieldTypes } from '../providers/provide-field-types';
import { DynamicFormComponent } from '../form/dynamic-form.component';
import { provideBuiltInFieldTypes } from '../providers/provide-field-types';

/**
 * A field rendered twice produces two different sets of DOM ids.
 *
 * `field.id` is unique in a config and not in a document. An `array` renders its child fields
 * once per row, so a two-row Contacts array put two `#name` inputs on the page — and `<label
 * for>` resolves to the first match in document order, so the second row's label focused the
 * first row's input and announced the same association twice. Duplicate ids on focusable
 * elements are a WCAG failure in their own right.
 *
 * Two levels of check, because the unit-level one is easy to satisfy accidentally and the
 * form-level one is the shape a user actually meets.
 */
describe('DOM ids survive being rendered more than once', () => {
  const registry = builtInFieldTypes();
  const CONTAINERS = new Set(['group', 'array']);
  const types = Object.keys(registry).filter(t => !CONTAINERS.has(t));

  function controlFor(type: string): AbstractControl {
    if (type === 'array') return new FormArray<AbstractControl>([]);
    if (type === 'group') return new FormGroup({});
    return new FormControl('');
  }

  /** Ids emitted by one freshly mounted instance of a field type. */
  function idsFrom(type: string): string[] {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ imports: [registry[type], ReactiveFormsModule] });
    const fixture = TestBed.createComponent(registry[type]);
    fixture.componentRef.setInput('field', {
      id: 'probe',
      type: type as RichFieldType,
      label: { en: 'Probe' },
      options: [{ en: 'A' }, { en: 'B' }],
      fields: [],
    } as NestedFieldConfig);
    fixture.componentRef.setInput('control', controlFor(type));
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    return Array.from(host.querySelectorAll('[id]')).map(el => el.id);
  }

  for (const type of types) {
    it(`${type} gives a second instance different ids`, () => {
      const first = idsFrom(type);
      const second = idsFrom(type);

      // Types that emit no id at all are fine; they cannot collide.
      expect(first.length).toBe(second.length);
      expect(first.filter(id => second.includes(id))).toEqual([]);
    });
  }

  it('emits ids somewhere, so the sweep above is not vacuous', () => {
    const total = types.reduce((sum, type) => sum + idsFrom(type).length, 0);
    expect(total).toBeGreaterThan(15);
  });

  describe('inside an array, which is where it actually happened', () => {
    const CONFIG: EntityFormConfig = {
      entity: 'clients',
      version: 1,
      tabs: [
        {
          id: 'main',
          label: { en: 'Main' },
          fields: [
            {
              id: 'contacts',
              type: 'array',
              label: { en: 'Contacts' },
              // `children`, not `fields`: an array's row shape is its children.
              children: [
                { id: 'name', type: 'text', label: { en: 'Name' } },
                { id: 'method', type: 'radio', label: { en: 'Method' }, options: [{ en: 'Email' }, { en: 'Phone' }] },
              ],
            } as NestedFieldConfig,
          ],
        },
      ],
    } as EntityFormConfig;

    function mountRows() {
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({
        imports: [DynamicFormComponent, ReactiveFormsModule],
        providers: [provideBuiltInFieldTypes()],
      });
      const fixture = TestBed.createComponent(DynamicFormComponent);
      fixture.componentRef.setInput('config', CONFIG);
      fixture.componentRef.setInput('initialData', {
        main: {
          contacts: [
            { name: 'Ada', method: { en: 'Email' } },
            { name: 'Grace', method: { en: 'Phone' } },
          ],
        },
      });
      fixture.detectChanges();
      return fixture.nativeElement as HTMLElement;
    }

    it('renders both rows', () => {
      expect(mountRows().querySelectorAll('[data-field-type="text"]').length).toBe(2);
    });

    it('gives every element on the page a distinct id', () => {
      const ids = Array.from(mountRows().querySelectorAll('[id]')).map(el => el.id);
      const duplicated = ids.filter((id, i) => ids.indexOf(id) !== i);

      expect(duplicated).toEqual([]);
    });

    it('ties each row label to the control in its own row', () => {
      // The symptom the ids caused: `for` resolves to the first match in the document, so
      // the second row's label reached back into the first.
      const host = mountRows();
      const rows = Array.from(host.querySelectorAll('[data-field-type="text"]'));
      expect(rows.length).toBe(2);

      for (const row of rows) {
        const label = row.querySelector('label')!;
        // Matched by comparison rather than a `#id` selector: a field id may hold a dot, and
        // `CSS.escape` is not in this test environment.
        const wanted = label.getAttribute('for');
        const target = Array.from(host.querySelectorAll('[id]')).find(el => el.id === wanted) ?? null;
        expect(target).not.toBeNull();
        expect(row.contains(target)).toBe(true);
      }
    });

    it('keeps each row of radios addressable on its own', () => {
      const host = mountRows();
      const radios = Array.from(host.querySelectorAll('input[type="radio"]'));
      // Two options, two rows.
      expect(radios.length).toBe(4);
      expect(new Set(radios.map(r => r.id)).size).toBe(4);
    });
  });
});
