import { TestBed } from '@angular/core/testing';
import { SimpleChange } from '@angular/core';
import type { EntityFormConfig, FormRule } from '@dynamic-entity/core';
import { assignFieldRefs, toRefToken } from '@dynamic-entity/core';
import { provideBuiltInFieldTypes } from '../providers/provide-field-types';
import { DynamicFormComponent } from './dynamic-form.component';

/**
 * The point of refs: two fields may share an id, so a rule that has to mean one of them
 * cannot say so with a bare id. `[work.address]` names exactly one.
 */
const CONFIG = (): EntityFormConfig =>
  assignFieldRefs({
    entity: 'people',
    version: 1,
    tabs: [
      {
        id: 'personal',
        label: { en: 'Personal' },
        fields: [
          { id: 'address', type: 'text', label: { en: 'Address' } },
          { id: 'personalNote', type: 'text', label: { en: 'Personal note' } },
        ],
      },
      {
        id: 'work',
        label: { en: 'Work' },
        fields: [
          { id: 'address', type: 'text', label: { en: 'Address' } },
          { id: 'workNote', type: 'text', label: { en: 'Work note' } },
        ],
      },
    ],
  })!;

function build(rules?: FormRule[], data?: Record<string, unknown>): DynamicFormComponent {
  const config = CONFIG();
  const fixture = TestBed.createComponent(DynamicFormComponent);
  const c = fixture.componentInstance;
  c.config = config;
  c.rules = rules;
  c.initialData = data;
  c.ngOnChanges({ config: new SimpleChange(undefined, config, true) });
  fixture.detectChanges();
  return c;
}

describe('addressing a field by its path', () => {
  beforeEach(() => {
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    TestBed.configureTestingModule({
      imports: [DynamicFormComponent],
      providers: [provideBuiltInFieldTypes()],
    });
  });

  afterEach(() => jest.restoreAllMocks());

  it('exposes each field under both its bare id and its ref', () => {
    const c = build(undefined, {
      personal: { address: 'Home St 1' },
      work: { address: 'Office Rd 2' },
    });
    const values = c.formValues();

    // The bare id can only hold one of the two — this is exactly the ambiguity refs remove.
    expect(values[toRefToken('personal.address')]).toBe('Home St 1');
    expect(values[toRefToken('work.address')]).toBe('Office Rd 2');
    expect(['Home St 1', 'Office Rd 2']).toContain(values['address']);
  });

  const hideRule = (fieldRef: string, targetId: string): FormRule => ({
    formConfigId: 'people',
    fieldId: fieldRef,
    conditions: [{ operator: 'EQUAL', compareType: 'value', value: 'hide me' }],
    action: { type: 'visibility', value: false },
    targets: [{ id: targetId, type: 'field' }],
    enabled: true,
    priority: 1,
  });

  it('fires on the work address without the personal one triggering it', () => {
    const c = build([hideRule(toRefToken('work.address'), 'workNote')], {
      personal: { address: 'hide me' },
      work: { address: 'something else' },
    });

    // Only `personal.address` holds the trigger value, and the rule names `work.address`.
    expect(c.ruleResult().hiddenFields).toEqual([]);
  });

  it('fires when the referenced field is the one holding the value', () => {
    const c = build([hideRule(toRefToken('work.address'), 'workNote')], {
      personal: { address: 'something else' },
      work: { address: 'hide me' },
    });

    expect(c.ruleResult().hiddenFields).toContain('workNote');
  });

  it('hides a field targeted by ref rather than by bare id', () => {
    const c = build([hideRule(toRefToken('work.address'), toRefToken('work.address'))], {
      work: { address: 'hide me' },
    });

    c.setActiveTab('work');
    const visible = c.fieldsForActiveTab.map(f => f.id);
    expect(visible).not.toContain('address');
    expect(visible).toContain('workNote');

    // The personal tab has an `address` too, and targeting by ref must not have hidden it.
    c.setActiveTab('personal');
    expect(c.fieldsForActiveTab.map(f => f.id)).toContain('address');
  });

  it('still honours a rule written with a bare field id', () => {
    const c = build([hideRule('personalNote', 'personalNote')], {
      personal: { personalNote: 'hide me' },
    });

    expect(c.ruleResult().hiddenFields).toContain('personalNote');
  });
});
