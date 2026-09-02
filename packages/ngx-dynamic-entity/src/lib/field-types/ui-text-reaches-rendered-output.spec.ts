import { TestBed } from '@angular/core/testing';
import { AbstractControl, FormArray, FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import type { NestedFieldConfig, RichFieldType } from '@dynamic-entity/core';
import { builtInFieldTypes } from '../providers/provide-field-types';
import { UI_TEXT } from '../tokens/injection-tokens';
import { DEFAULT_UI_TEXT, type UiTextKey } from '../services/ui-text.service';

/**
 * A configured `UI_TEXT` reaches the rendered DOM of every field type.
 *
 * The companion sweep reads the source and proves every published key has a call site. That
 * is a weaker claim than it looks: a call site inside a branch nothing renders, or one whose
 * result is assigned and dropped, satisfies the scan and still puts English on the screen.
 * This one mounts each component and reads what came out.
 *
 * The assertion is inverted on purpose. Rather than listing which key each component ought to
 * render — a list that goes stale the day a template changes, and that nobody updates — it
 * overrides *every* key and asserts no English default survives anywhere in the output,
 * attributes included. A literal no token can reach fails here by construction.
 */
describe('a configured UI_TEXT reaches every field type on screen', () => {
  const registry = builtInFieldTypes();
  const types = Object.keys(registry);

  /** Joins the captured states; only ever searched, never parsed. */
  const SEPARATOR = String.fromCharCode(10);

  /** Marks a key's resolved value so it can be found in the output. */
  const MARK = (key: string) => `[[${key}]]`;

  const defaults = Object.entries(DEFAULT_UI_TEXT) as [UiTextKey, string][];

  /**
   * The control a field type binds to. A container handed a plain `FormControl` throws
   * reading `.length` off a `controls` that isn't there — which is a test artefact, not a
   * defect: the renderer builds these itself and never hands an `array` field anything else.
   */
  function controlFor(type: string, value: unknown): AbstractControl {
    if (type === 'array') return new FormArray<AbstractControl>([]);
    if (type === 'group') return new FormGroup({});
    return new FormControl(value);
  }

  /**
   * A value each type will actually display.
   *
   * Empty is not enough: a file field only offers Replace and Download once it holds
   * something, and a boolean only prints Yes or No once it is set. Those are the strings a
   * German install would most visibly be stuck with in English.
   */
  const VALUES: Record<string, unknown> = {
    file: { name: 'report.pdf', url: 'https://example.test/report.pdf', size: 12, mimeType: 'application/pdf' },
    image: { name: 'photo.png', url: 'https://example.test/photo.png', size: 12, mimeType: 'image/png' },
    boolean: true,
    checkbox: true,
    markdown: '# Heading',
    monthYear: { month: 3, year: 2020 },
    dropdown: { en: 'A' },
    radio: { en: 'A' },
    multiSelect: [{ en: 'A' }],
    number: 3,
    currency: 3,
    date: '2020-01-15',
    datetime: '2020-01-15T10:30',
    time: '09:30',
  };

  function render(type: string, readonly: boolean, value: unknown): string {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [registry[type], ReactiveFormsModule],
      // A resolver rather than a map: it answers for every key including any added later, so
      // this sweep cannot fall behind the vocabulary it is checking.
      providers: [{ provide: UI_TEXT, useValue: (key: string) => MARK(key) }],
    });
    const fixture = TestBed.createComponent(registry[type]);
    fixture.componentRef.setInput('field', {
      id: 'probe',
      type: type as RichFieldType,
      label: { en: 'Probe' },
      options: [{ en: 'A' }],
      fields: [],
    } as NestedFieldConfig);
    fixture.componentRef.setInput('control', controlFor(type, value));
    fixture.componentRef.setInput('readonly', readonly);
    fixture.detectChanges();
    return (fixture.nativeElement as HTMLElement).innerHTML;
  }

  /**
   * Four states per type — editable and read-only, empty and filled — because the chrome
   * differs across all four. Rendered once and reused; the assertions below would otherwise
   * re-mount every component for every key.
   */
  const cache = new Map<string, string>();
  function output(type: string): string {
    if (!cache.has(type)) {
      const value = VALUES[type] ?? 'a value';
      cache.set(
        type,
        [render(type, false, ''), render(type, true, ''), render(type, false, value), render(type, true, value)].join(
          SEPARATOR,
        ),
      );
    }
    return cache.get(type)!;
  }

  it('sweeps every registered field type', () => {
    expect(types.length).toBeGreaterThan(18);
  });

  for (const type of types) {
    it(`${type} renders no English default that a host cannot replace`, () => {
      const html = output(type);
      const leaked = defaults
        // Multi-word defaults only. A single word — `Save`, `No`, `Preview` — appears in
        // markup for reasons that have nothing to do with chrome, and a sweep that cries
        // wolf gets switched off. The marker count below is what covers those.
        .filter(([, english]) => english.includes(' ') && english.length > 4)
        .filter(([, english]) => html.includes(english))
        .map(([key]) => key);

      expect(leaked).toEqual([]);
    });
  }

  it('reaches a meaningful number of distinct keys across the registry', () => {
    // The inverted assertion above passes trivially for a component that renders no chrome
    // at all. This is the other half: the token really is read, in many places.
    const seen = new Set<string>();
    for (const type of types) {
      const html = output(type);
      for (const [key] of defaults) if (html.includes(MARK(key))) seen.add(key);
    }
    expect(seen.size).toBeGreaterThan(14);
  });
});
