import { TestBed } from '@angular/core/testing';
import { SimpleChange } from '@angular/core';
import type { EntityFormConfig, FormRule } from '@dynamic-entity/core';
import { assignFieldRefs, toRefToken } from '@dynamic-entity/core';
import { provideBuiltInFieldTypes } from '../providers/provide-field-types';
import { DynamicFormComponent } from './dynamic-form.component';

/**
 * Hiding and showing a field that is not a tab's direct child.
 *
 * `syncHiddenFieldState` walked a tab's own fields only, so a *required* field inside a
 * `group` stayed enabled after a rule hid it and held `form.invalid` true forever — with
 * nothing on screen to explain why Save did nothing. It also resolved controls by bare id
 * with no tab, so with one id on two tabs, hiding either disabled whichever the search
 * happened to reach first.
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
          { id: 'status', type: 'text', label: { en: 'Status' } },
          {
            id: 'address',
            type: 'group',
            label: { en: 'Address' },
            children: [
              {
                id: 'city',
                type: 'text',
                label: { en: 'City' },
                validators: { required: true },
              },
            ],
          },
          {
            id: 'secret',
            type: 'text',
            label: { en: 'Secret' },
            visibility: false,
          },
          {
            id: 'conditional',
            type: 'text',
            label: { en: 'Conditional' },
            showWhen: { status: 'open' },
          },
        ],
      },
      {
        id: 'work',
        label: { en: 'Work' },
        fields: [
          {
            id: 'address',
            type: 'group',
            label: { en: 'Address' },
            children: [{ id: 'city', type: 'text', label: { en: 'City' } }],
          },
        ],
      },
    ],
  })!;

const rule = (over: Partial<FormRule>): FormRule => ({
  formConfigId: 'people',
  fieldId: 'status',
  conditions: [{ operator: 'EQUAL', compareType: 'value', value: 'trigger' }],
  action: { type: 'visibility', value: false },
  targets: [],
  enabled: true,
  priority: 1,
  ...over,
});

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

describe('a rule that hides a nested field', () => {
  beforeEach(() => {
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    TestBed.configureTestingModule({
      imports: [DynamicFormComponent],
      providers: [provideBuiltInFieldTypes()],
    });
  });

  afterEach(() => jest.restoreAllMocks());

  const hideNestedCity = rule({
    targets: [{ id: toRefToken('personal.address.city'), type: 'field' }],
  });

  it('leaves the form invalid while the required nested field is shown', () => {
    const c = build([hideNestedCity], { personal: { status: 'nothing' } });
    expect(c.form.invalid).toBe(true);
  });

  it('makes the form valid once the rule hides it', () => {
    // The bug this fixes: Save stayed disabled with no field on screen to fill in.
    const c = build([hideNestedCity], { personal: { status: 'trigger' } });
    expect(c.getControl(toRefToken('personal.address.city'))?.disabled).toBe(true);
    expect(c.form.invalid).toBe(false);
  });

  it('re-enables it when the rule stops firing', () => {
    const c = build([hideNestedCity], { personal: { status: 'trigger' } });
    expect(c.form.invalid).toBe(false);

    c.getControl(toRefToken('personal.status'))?.setValue('nothing');
    expect(c.getControl(toRefToken('personal.address.city'))?.disabled).toBe(false);
    expect(c.form.invalid).toBe(true);
  });

  it('does not touch the same id on another tab', () => {
    const c = build([hideNestedCity], { personal: { status: 'trigger' } });
    expect(c.getControl(toRefToken('personal.address.city'))?.disabled).toBe(true);
    expect(c.getControl(toRefToken('work.address.city'))?.disabled).toBe(false);
  });

  it('does not fight a hidden container over its children', () => {
    const hideGroup = rule({ targets: [{ id: toRefToken('personal.address'), type: 'field' }] });
    const c = build([hideGroup], { personal: { status: 'trigger' } });

    expect(c.getControl(toRefToken('personal.address'))?.disabled).toBe(true);
    // Disabling a group cascades; re-enabling a child would walk back up and re-enable the
    // group, which is why the walk stops at a hidden container.
    expect(c.getControl(toRefToken('personal.address.city'))?.disabled).toBe(true);
    expect(c.form.invalid).toBe(false);
  });
});

describe('a rule that shows', () => {
  beforeEach(() => {
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    TestBed.configureTestingModule({
      imports: [DynamicFormComponent],
      providers: [provideBuiltInFieldTypes()],
    });
  });

  afterEach(() => jest.restoreAllMocks());

  const show = (targetId: string) =>
    rule({ action: { type: 'visibility', value: true }, targets: [{ id: targetId, type: 'field' }] });

  const renderedIds = (c: DynamicFormComponent) => c.fieldsForActiveTab.map(f => f.id);

  it('overrides visibility: false', () => {
    // `{ type: 'visibility', value: true }` was read and discarded — a documented no-op.
    expect(renderedIds(build([show('secret')], { personal: { status: 'nothing' } }))).not.toContain('secret');
    expect(renderedIds(build([show('secret')], { personal: { status: 'trigger' } }))).toContain('secret');
  });

  it('overrides a showWhen that does not hold', () => {
    const c = build([show('conditional')], { personal: { status: 'trigger' } });
    expect(renderedIds(c)).toContain('conditional');
  });

  it('re-enables a control the static config had disabled', () => {
    const c = build([show('secret')], { personal: { status: 'trigger' } });
    expect(c.getControl(toRefToken('personal.secret'))?.disabled).toBe(false);
  });

  it('loses to an explicit hide, whichever order the rules are in', () => {
    const hide = rule({ targets: [{ id: 'secret', type: 'field' }] });
    const showFirst = build([show('secret'), hide], { personal: { status: 'trigger' } });
    const hideFirst = build([hide, show('secret')], { personal: { status: 'trigger' } });

    expect(renderedIds(showFirst)).not.toContain('secret');
    expect(renderedIds(hideFirst)).not.toContain('secret');
  });
});

describe('a rule that shows a tab', () => {
  beforeEach(() => {
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    TestBed.configureTestingModule({
      imports: [DynamicFormComponent],
      providers: [provideBuiltInFieldTypes()],
    });
  });

  afterEach(() => jest.restoreAllMocks());

  it('overrides a tab the config hides, and still loses to a hide rule', () => {
    const config = CONFIG();
    config.tabs[1].visibility = false;

    const make = (rules: FormRule[]) => {
      const fixture = TestBed.createComponent(DynamicFormComponent);
      const c = fixture.componentInstance;
      c.config = config;
      c.rules = rules;
      c.initialData = { personal: { status: 'trigger' } };
      c.ngOnChanges({ config: new SimpleChange(undefined, config, true) });
      fixture.detectChanges();
      return c.visibleTabs.map(t => t.id);
    };

    const showTab = rule({
      action: { type: 'visibility', value: true },
      targets: [{ id: 'work', type: 'tab' }],
    });
    const hideTab = rule({ targets: [{ id: 'work', type: 'tab' }] });

    expect(make([])).not.toContain('work');
    expect(make([showTab])).toContain('work');
    expect(make([showTab, hideTab])).not.toContain('work');
  });
});

describe('what the renderer says about a rule it cannot apply', () => {
  let warn: jest.SpyInstance;

  beforeEach(() => {
    warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    TestBed.configureTestingModule({
      imports: [DynamicFormComponent],
      providers: [provideBuiltInFieldTypes()],
    });
  });

  afterEach(() => jest.restoreAllMocks());

  it('warns once, rather than throwing out of change detection', () => {
    // The engine reports and carries on; this is the half that makes a skipped rule visible
    // instead of merely non-fatal.
    const broken = { ...rule({ id: 'half-written' }), conditions: undefined as never };
    const c = build([broken, rule({ id: 'ok', targets: [{ id: 'secret', type: 'field' }] })], {
      personal: { status: 'trigger' },
    });

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain('half-written');

    // The other rule still applied.
    expect(c.fieldsForActiveTab.map(f => f.id)).not.toContain('secret');

    // Re-evaluating does not say it again.
    c.getControl(toRefToken('personal.status'))?.setValue('trigger again');
    expect(warn).toHaveBeenCalledTimes(1);
  });
});

describe('the error summary names the field, not the group holding it', () => {
  beforeEach(() => {
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    TestBed.configureTestingModule({
      imports: [DynamicFormComponent],
      providers: [provideBuiltInFieldTypes()],
    });
  });

  afterEach(() => jest.restoreAllMocks());

  it('descends into a group and reports the offending child', () => {
    // A FormGroup is invalid whenever any descendant is, so reporting the container said
    // "Address is invalid" and left the user to open it and hunt.
    const c = build(undefined, { personal: { status: 'nothing' } });
    const invalid = c.invalidFields().map(entry => entry.field.id);

    expect(invalid).toContain('city');
    expect(invalid).not.toContain('address');
  });
});
