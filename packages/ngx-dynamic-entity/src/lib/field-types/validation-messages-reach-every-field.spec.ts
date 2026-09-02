import { TestBed } from '@angular/core/testing';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import type { NestedFieldConfig, RichFieldType } from '@dynamic-entity/core';
import { builtInFieldTypes } from '../providers/provide-field-types';
import { VALIDATION_MESSAGES } from '../tokens/injection-tokens';

/**
 * `provideNgxDynamicEntity({ validationMessages })` must reach every field type.
 *
 * It reached three of fifteen. The other twelve rendered a fixed "This field has an error",
 * so a consumer who configured a message saw it on text, number and dropdown and the generic
 * string everywhere else — a documented feature working on a fifth of the surface, which is
 * worse than one that plainly does not exist.
 *
 * This walks the real registry rather than a hand-written list, so a field type added later
 * is covered the day it is registered instead of the day someone remembers this file.
 */
describe('configured validation messages reach every field type', () => {
  const CUSTOM = 'Configured by the host';

  /** Container types render their children rather than an error of their own. */
  const CONTAINERS = new Set<RichFieldType | string>(['group', 'array']);

  const registry = builtInFieldTypes();
  const types = Object.keys(registry).filter(t => !CONTAINERS.has(t));

  it('covers more than a dozen field types, so the sweep is meaningful', () => {
    // Guards against the loop below silently shrinking to nothing.
    expect(types.length).toBeGreaterThan(12);
  });

  for (const type of types) {
    it(`${type} renders the configured message`, () => {
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({
        imports: [registry[type], ReactiveFormsModule],
        providers: [
          {
            provide: VALIDATION_MESSAGES,
            // Both keys: a `dropdown` deliberately resolves `required` through
            // `requiredSelection`, because "Please select an option" reads better than
            // "This field is required" on a select. The invariant under test is that the
            // host's configuration reaches the field — not which key the field prefers.
            useValue: { required: CUSTOM, requiredSelection: CUSTOM },
          },
        ],
      });

      const fixture = TestBed.createComponent(registry[type]);
      const field: NestedFieldConfig = {
        id: 'probe',
        type: type as RichFieldType,
        label: { en: 'Probe' },
        options: [{ en: 'A' }],
      };
      const control = new FormControl('', { validators: [Validators.required] });
      control.markAsTouched();

      fixture.componentRef.setInput('field', field);
      fixture.componentRef.setInput('control', control);
      fixture.detectChanges();

      const error = (fixture.nativeElement as HTMLElement).querySelector(
        '[data-testid="field-probe-error"]',
      );
      expect(error).toBeTruthy();
      expect(error!.textContent).toContain(CUSTOM);
    });
  }
});
