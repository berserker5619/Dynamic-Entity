import { TestBed } from '@angular/core/testing';
import { FormArray, FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import type { NestedFieldConfig, RichFieldType } from '@dynamic-entity/core';
import { builtInFieldTypes } from '../providers/provide-field-types';

/**
 * `field.hint` must reach every field type, and must reach the screen reader too.
 *
 * Help text that renders on eighteen types out of twenty is worse than none: an author writes
 * it once, sees it work, and has no way of knowing which of their fields quietly dropped it.
 * The same argument as `validation-messages-reach-every-field.spec.ts`, which exists because
 * exactly that happened to `validationMessages`.
 *
 * The second half — `aria-describedby` — is the half that cannot be seen. Sixteen of the
 * nineteen leaf components named nothing at all before this, so their *error* messages were on
 * screen and unannounced; the hint would have inherited the same gap. This walks the real
 * registry, so a field type added later is covered the day it is registered.
 */
describe('author help text reaches every field type', () => {
  const HINT = 'Use the number printed on your card.';

  /** A container renders its children, and describes the set rather than any one control. */
  const CONTAINERS = new Set<RichFieldType | string>(['group', 'array']);

  const registry = builtInFieldTypes();
  const allTypes = Object.keys(registry);
  const leafTypes = allTypes.filter(t => !CONTAINERS.has(t));

  function render(type: string, field: Partial<NestedFieldConfig> = {}) {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ imports: [registry[type], ReactiveFormsModule] });

    const fixture = TestBed.createComponent(registry[type]);
    fixture.componentRef.setInput('field', {
      id: 'probe',
      type: type as RichFieldType,
      label: { en: 'Probe' },
      options: [{ en: 'A' }],
      ...field,
    } satisfies NestedFieldConfig);
    // An `array` iterates its control; everything else reads a value off it.
    fixture.componentRef.setInput('control', type === 'array' ? new FormArray([]) : new FormControl(''));
    fixture.componentRef.setInput('language', 'en');
    fixture.detectChanges();
    return fixture;
  }

  it('covers more than a dozen field types, so the sweep is meaningful', () => {
    // Guards against the loops below silently shrinking to nothing.
    expect(leafTypes.length).toBeGreaterThan(12);
  });

  for (const type of allTypes) {
    it(`${type} renders the hint`, () => {
      const fixture = render(type, { hint: { en: HINT } });
      expect((fixture.nativeElement as HTMLElement).textContent).toContain(HINT);
    });
  }

  for (const type of allTypes) {
    it(`${type} renders no hint element when the field has none`, () => {
      const fixture = render(type);
      expect((fixture.nativeElement as HTMLElement).querySelector('.ngx-field__hint')).toBeNull();
    });
  }

  /**
   * The hint is only useful to a screen reader if the control points at it, and the pointer
   * has to resolve — `aria-describedby` naming an id that is not in the document is worse
   * than saying nothing, because nothing is announced and nothing looks wrong.
   */
  for (const type of leafTypes) {
    it(`${type} points its control at the hint, and the id resolves`, () => {
      const fixture = render(type, { hint: { en: HINT } });
      const host = fixture.nativeElement as HTMLElement;

      const described = host.querySelector('[aria-describedby]');
      expect(described).not.toBeNull();

      const ids = described!.getAttribute('aria-describedby')!.split(/\s+/).filter(Boolean);
      expect(ids.length).toBeGreaterThan(0);
      for (const id of ids) {
        expect(host.querySelector(`[id="${id}"]`)).not.toBeNull();
      }
      // The hint's own id is among them, not merely some other description.
      const hintId = host.querySelector('.ngx-field__hint')!.getAttribute('id');
      expect(ids).toContain(hintId);
    });
  }

  /** With both on screen the hint is announced first: it describes the field, not the attempt. */
  for (const type of leafTypes) {
    it(`${type} announces the hint before the error`, () => {
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({ imports: [registry[type], ReactiveFormsModule] });

      const fixture = TestBed.createComponent(registry[type]);
      const control = new FormControl('', { validators: [Validators.required] });
      control.markAsTouched();
      fixture.componentRef.setInput('field', {
        id: 'probe',
        type: type as RichFieldType,
        label: { en: 'Probe' },
        options: [{ en: 'A' }],
        hint: { en: HINT },
      } satisfies NestedFieldConfig);
      fixture.componentRef.setInput('control', control);
      fixture.componentRef.setInput('language', 'en');
      fixture.detectChanges();

      const host = fixture.nativeElement as HTMLElement;
      const ids = host.querySelector('[aria-describedby]')!.getAttribute('aria-describedby')!.split(/\s+/);
      const hintId = host.querySelector('.ngx-field__hint')!.getAttribute('id');
      const errorEl = host.querySelector('.ngx-field__error');

      expect(ids[0]).toBe(hintId);
      // Not every type raises a message for an empty value, so the error half is conditional.
      if (errorEl?.getAttribute('id')) {
        expect(ids).toContain(errorEl.getAttribute('id'));
      }
    });
  }

  /** `LocalizedText`, like every other authored string — the hint follows `language`. */
  it('resolves the hint in the form language', () => {
    const fixture = render('text', { hint: { en: HINT, de: 'Die Nummer auf Ihrer Karte.' } });
    fixture.componentRef.setInput('language', 'de');
    fixture.detectChanges();

    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Die Nummer auf Ihrer Karte.');
    expect((fixture.nativeElement as HTMLElement).textContent).not.toContain(HINT);
  });
});
