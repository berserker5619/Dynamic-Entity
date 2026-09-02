import { TestBed } from '@angular/core/testing';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import type { NestedFieldConfig, RichFieldType } from '@dynamic-entity/core';
import { builtInFieldTypes } from '../providers/provide-field-types';
import { MASKED_PLACEHOLDER } from '../tokens/injection-tokens';

/**
 * `MASKED_PLACEHOLDER` must reach every field type that can be masked.
 *
 * The text was a literal repeated across twenty-one templates, so a host could not choose
 * between `XXXXXXXXX`, a row of bullets, or a localized word — and getting it wrong in one
 * component out of twenty would be invisible until someone masked that exact field type.
 *
 * The sweep walks the real registry, so a field type added later is covered the day it is
 * registered rather than the day someone remembers this file.
 */
describe('the masked placeholder reaches every maskable field type', () => {
  const CUSTOM = 'REDACTED-BY-HOST';
  const registry = builtInFieldTypes();

  /** Containers delegate to their children, which are masked individually. */
  const CONTAINERS = new Set(['group', 'array']);
  const types = Object.keys(registry).filter(t => !CONTAINERS.has(t));

  function render(type: string, provideToken: boolean) {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [registry[type], ReactiveFormsModule],
      providers: provideToken ? [{ provide: MASKED_PLACEHOLDER, useValue: CUSTOM }] : [],
    });
    const fixture = TestBed.createComponent(registry[type]);
    const field: NestedFieldConfig = {
      id: 'probe',
      type: type as RichFieldType,
      label: { en: 'Probe' },
      options: [{ en: 'A' }],
    };
    fixture.componentRef.setInput('field', field);
    fixture.componentRef.setInput('control', new FormControl('secret value'));
    fixture.componentRef.setInput('masked', true);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  it('sweeps a meaningful number of field types', () => {
    expect(types.length).toBeGreaterThan(12);
  });

  for (const type of types) {
    it(`${type} honours the configured placeholder and never leaks the value`, () => {
      const host = render(type, true);
      const masked = host.querySelector('[data-testid="field-probe-masked"]');
      expect(masked).toBeTruthy();
      expect(masked!.textContent).toContain(CUSTOM);

      // The point of masking: whatever the placeholder says, the value is not on screen.
      expect(host.textContent).not.toContain('secret value');
    });
  }

  it('keeps the historic default when nothing is provided', () => {
    // Changing what an unconfigured install prints would be a silent visual change on
    // upgrade for everyone already masking a field.
    const host = render('text', false);
    expect(host.querySelector('[data-testid="field-probe-masked"]')!.textContent).toContain(
      'XXXXXXXXX',
    );
  });
});
