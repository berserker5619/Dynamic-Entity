import { TestBed } from '@angular/core/testing';
import { SimpleChange } from '@angular/core';
import type { EntityFormConfig, FormRule } from '@dynamic-entity/core';
import { provideBuiltInFieldTypes } from '../providers/provide-field-types';
import { DynamicFormComponent } from './dynamic-form.component';

/**
 * `validateConfig` catches an ambiguous `showWhen` or cascade parent because both live in the
 * config. Rules do not — they arrive as a separate `@Input`, so the form component is the only
 * place that sees the config and the rules together.
 */
const TWO_ADDRESSES: EntityFormConfig = {
  entity: 'people',
  version: 1,
  tabs: [
    { id: 'personal', label: { en: 'Personal' }, fields: [{ id: 'address', type: 'text', label: { en: 'Address' } }] },
    {
      id: 'work',
      label: { en: 'Work' },
      fields: [
        { id: 'address', type: 'text', label: { en: 'Address' } },
        { id: 'note', type: 'text', label: { en: 'Note' } },
      ],
    },
  ],
};

const rule = (over: Partial<FormRule> = {}): FormRule => ({
  formConfigId: 'people',
  fieldId: 'address',
  conditions: [{ operator: 'EQUAL', compareType: 'value', value: 'x' }],
  action: { type: 'visibility', value: false },
  targets: [{ id: 'note', type: 'field' }],
  enabled: true,
  priority: 1,
  ...over,
});

describe('a rule that names an ambiguous field id', () => {
  let warn: jest.SpyInstance;

  function build(config: EntityFormConfig, rules?: FormRule[]): void {
    const fixture = TestBed.createComponent(DynamicFormComponent);
    const c = fixture.componentInstance;
    c.config = config;
    c.rules = rules;
    c.ngOnChanges({ config: new SimpleChange(undefined, config, true) });
    fixture.detectChanges();
  }

  beforeEach(() => {
    // The warning is emitted once per id per process, so each test needs a clean slate.
    (DynamicFormComponent as unknown as { warnedAmbiguousIds: Set<string> }).warnedAmbiguousIds.clear();
    warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    TestBed.configureTestingModule({
      imports: [DynamicFormComponent],
      providers: [provideBuiltInFieldTypes()],
    });
  });

  afterEach(() => warn.mockRestore());

  it('warns, naming the field and both scopes', () => {
    build(TWO_ADDRESSES, [rule()]);

    const message = warn.mock.calls.map(c => String(c[0])).find(m => m.includes('address'));
    expect(message).toContain('defined in personal and work');
    expect(message).toContain('whichever one the form finds first');
  });

  it('warns for an ambiguous id named only by a condition', () => {
    build(TWO_ADDRESSES, [
      rule({ fieldId: 'note', conditions: [{ operator: 'EQUAL', compareType: 'field', compareToField: 'address' }] }),
    ]);

    expect(warn.mock.calls.some(c => String(c[0]).includes('references field "address"'))).toBe(true);
  });

  it('warns for an ambiguous id named only by a target', () => {
    build(TWO_ADDRESSES, [rule({ fieldId: 'note', targets: [{ id: 'address', type: 'field' }] })]);

    expect(warn.mock.calls.some(c => String(c[0]).includes('references field "address"'))).toBe(true);
  });

  it('says nothing when the rule names an id only one scope defines', () => {
    build(TWO_ADDRESSES, [rule({ fieldId: 'note', targets: [{ id: 'note', type: 'field' }] })]);

    expect(warn.mock.calls.some(c => String(c[0]).includes('references field'))).toBe(false);
  });

  it('says nothing when there are no rules at all', () => {
    build(TWO_ADDRESSES);

    expect(warn.mock.calls.some(c => String(c[0]).includes('references field'))).toBe(false);
  });

  it('says nothing when no id is duplicated', () => {
    build(
      {
        entity: 'people',
        version: 1,
        tabs: [{ id: 'only', label: { en: 'Only' }, fields: [{ id: 'address', type: 'text', label: { en: 'A' } }] }],
      },
      [rule()],
    );

    expect(warn.mock.calls.some(c => String(c[0]).includes('references field'))).toBe(false);
  });
});
