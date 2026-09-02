import { TestBed } from '@angular/core/testing';
import { AbstractControl, FormArray, FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import type { NestedFieldConfig, RichFieldType } from '@dynamic-entity/core';
import { builtInFieldTypes } from '../providers/provide-field-types';

/**
 * Every control a field type renders has an accessible name.
 *
 * A `<label>` that sits beside a control without pointing at it looks right and announces as
 * nothing: a screen reader reaches an unlabelled combo box, and clicking the label does not
 * focus the field. Most components got this right; the ones that did not were invisible
 * because the accessibility scan ran over a config made of text and dropdowns, and the
 * offenders were `multiSelect`, `currency`, `email`, `password` and `monthYear`.
 *
 * A per-component sweep rather than an axe run over one demo config: axe can only judge what
 * the page it was pointed at happened to contain, and no demo config contains everything.
 */
describe('every rendered control has an accessible name', () => {
  const registry = builtInFieldTypes();

  /** Containers render their children's controls, not one of their own. */
  const CONTAINERS = new Set(['group', 'array']);
  const types = Object.keys(registry).filter(t => !CONTAINERS.has(t));

  function controlFor(type: string): AbstractControl {
    if (type === 'array') return new FormArray<AbstractControl>([]);
    if (type === 'group') return new FormGroup({});
    return new FormControl('');
  }

  function render(type: string): HTMLElement {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ imports: [registry[type], ReactiveFormsModule] });
    const fixture = TestBed.createComponent(registry[type]);
    fixture.componentRef.setInput('field', {
      id: 'probe',
      type: type as RichFieldType,
      label: { en: 'Probe Label' },
      options: [{ en: 'A' }],
      fields: [],
    } as NestedFieldConfig);
    fixture.componentRef.setInput('control', controlFor(type));
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  /**
   * The ways an accessible name can legitimately arrive.
   *
   * `title` and `placeholder` are deliberately **not** among them. Both produce a name in
   * some browsers and none in others, and neither is visible to a sighted user as a label
   * once the field holds a value.
   */
  function accessibleName(host: HTMLElement, control: Element): string {
    const id = control.getAttribute('id');
    if (id && host.querySelector(`label[for="${id}"]`)) return 'label[for]';
    if (control.closest('label')) return 'wrapping label';
    if (control.getAttribute('aria-label')) return 'aria-label';

    const labelledBy = control.getAttribute('aria-labelledby');
    if (labelledBy && labelledBy.split(/\s+/).some(ref => host.querySelector(`#${CSS.escape(ref)}`))) {
      return 'aria-labelledby';
    }

    // A radio group names itself with a fieldset legend rather than per-input labels.
    const fieldset = control.closest('fieldset');
    if (fieldset?.querySelector('legend')?.textContent?.trim()) return 'legend';

    return '';
  }

  const CONTROLS = 'input:not([type="hidden"]), select, textarea';

  it('sweeps a meaningful number of field types', () => {
    expect(types.length).toBeGreaterThan(12);
  });

  for (const type of types) {
    it(`${type} names every control it renders`, () => {
      const host = render(type);
      const controls = Array.from(host.querySelectorAll(CONTROLS));

      const unnamed = controls
        .filter(control => !accessibleName(host, control))
        .map(control => `${control.tagName.toLowerCase()}${control.id ? `#${control.id}` : ''}`);

      expect(unnamed).toEqual([]);
    });
  }

  it('finds controls at all, so a green sweep is not an empty one', () => {
    const total = types.reduce((sum, type) => sum + render(type).querySelectorAll(CONTROLS).length, 0);
    expect(total).toBeGreaterThan(15);
  });
});
