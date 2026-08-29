import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import type { FormRule } from '@dynamic-entity/core';
import { BuilderStore } from '../builder-store.service';
import { RuleFormComponent } from './rule-form.component';

describe('RuleFormComponent', () => {
  let fixture: ComponentFixture<RuleFormComponent>;
  let component: RuleFormComponent;
  let host: HTMLElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [RuleFormComponent],
      providers: [BuilderStore, provideNoopAnimations()],
    }).compileComponents();

    fixture = TestBed.createComponent(RuleFormComponent);
    component = fixture.componentInstance;
    host = fixture.nativeElement as HTMLElement;
    fixture.detectChanges();
  });

  it('defaults to a new visibility rule with one condition', () => {
    expect(component.rule.conditions.length).toBe(1);
    expect(component.rule.action.type).toBe('visibility');
    expect(component.rule.enabled).toBe(true);
  });

  it('titles itself New for a draft and Edit for a saved rule', () => {
    expect(host.textContent).toContain('New Form Rule');

    component.rule = { ...component.rule, id: 'rule_1' };
    fixture.detectChanges();
    expect(host.textContent).toContain('Edit Rule');
  });

  it('offers every supported operator', () => {
    expect(component.operators).toContain('EQUAL');
    expect(component.operators).toContain('VALUE_CHANGED');
    expect(component.operators).toContain('HAS_ITEMS');
    expect(new Set(component.operators).size).toBe(component.operators.length);
  });

  it('adds and removes conditions', () => {
    component.addCondition();
    expect(component.rule.conditions.length).toBe(2);

    component.removeCondition(0);
    expect(component.rule.conditions.length).toBe(1);
  });

  it('adds conditions defaulting to a value comparison', () => {
    component.addCondition();
    expect(component.rule.conditions[1]).toEqual({ operator: 'EQUAL', compareType: 'value', value: '' });
  });

  it('emits the edited rule on save', () => {
    const saved: FormRule[] = [];
    component.save.subscribe(r => saved.push(r));
    component.rule.fieldId = 'status';

    (host.querySelector('button[mat-raised-button]') as HTMLButtonElement).click();

    expect(saved.length).toBe(1);
    expect(saved[0].fieldId).toBe('status');
  });

  it('emits cancel without saving', () => {
    let cancelled = 0;
    const saved: FormRule[] = [];
    component.cancel.subscribe(() => cancelled++);
    component.save.subscribe(r => saved.push(r));

    (host.querySelector('button[mat-button]') as HTMLButtonElement).click();

    expect(cancelled).toBe(1);
    expect(saved).toEqual([]);
  });

  it('edits an injected rule in place rather than a copy', () => {
    const incoming: FormRule = {
      id: 'rule_9',
      formConfigId: 'clients',
      fieldId: 'status',
      conditions: [{ operator: 'CONTAINS', compareType: 'value', value: 'arch' }],
      action: { type: 'info', value: 'Note' },
      targets: [{ id: 'notes', type: 'field' }],
      enabled: true,
      priority: 2,
    };
    component.rule = incoming;
    fixture.detectChanges();

    const saved: FormRule[] = [];
    component.save.subscribe(r => saved.push(r));
    (host.querySelector('button[mat-raised-button]') as HTMLButtonElement).click();

    expect(saved[0]).toBe(incoming);
    expect(saved[0].id).toBe('rule_9');
  });
});

/**
 * Both pickers were free text: the trigger was typed by hand and the targets could not be
 * edited at all, so a rule only ever acted on the field it triggered from.
 */
describe('RuleFormComponent — choosing fields', () => {
  let fixture: ComponentFixture<RuleFormComponent>;
  let component: RuleFormComponent;
  let store: BuilderStore;

  const api = () => component as unknown as {
    fieldOptions(): { value: string; label: string; path: string }[];
    targetOptions(): { value: string; label: string; path: string }[];
    triggerOptions(): { value: string; label: string; path: string }[];
    targetValues(): string[];
    setTargets(ids: string[]): void;
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [RuleFormComponent],
      providers: [BuilderStore, provideNoopAnimations()],
    }).compileComponents();

    store = TestBed.inject(BuilderStore);
    store.load({
      entity: 'people',
      version: 1,
      tabs: [
        { id: 'personal', label: {}, fields: [{ id: 'address', type: 'text', label: { en: 'Address' } }] },
        { id: 'work', label: {}, fields: [{ id: 'address', type: 'text', label: { en: 'Address' } }] },
      ],
    });

    fixture = TestBed.createComponent(RuleFormComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('offers every field by path, so two with one id stay distinguishable', () => {
    expect(api().fieldOptions().map(o => o.value)).toEqual(['[personal.address]', '[work.address]']);
    expect(api().fieldOptions().map(o => o.label)).toEqual(['Address', 'Address']);
    expect(api().fieldOptions().map(o => o.path)).toEqual(['personal.address', 'work.address']);
  });

  it('reads the field targets and writes them back', () => {
    api().setTargets(['[work.address]']);

    expect(component.rule.targets).toEqual([{ id: '[work.address]', type: 'field' }]);
    expect(api().targetValues()).toEqual(['[work.address]']);
  });

  // The picker never offered tab targets, so it cannot know about one and must not drop it.
  it('leaves a tab target alone when the field targets change', () => {
    component.rule.targets = [{ id: 'work', type: 'tab' }];

    api().setTargets(['[personal.address]']);

    expect(component.rule.targets).toEqual([
      { id: 'work', type: 'tab' },
      { id: '[personal.address]', type: 'field' },
    ]);
  });

  /**
   * A mat-select silently drops a value it has no option for, so a rule naming a bare id or a
   * deleted field would have its reference erased just by being opened and saved.
   */
  it('keeps a reference the config no longer contains', () => {
    component.rule.fieldId = 'legacyBareId';
    component.rule.targets = [{ id: '[gone.field]', type: 'field' }];
    fixture.detectChanges();

    expect(api().triggerOptions().map(o => o.value)).toContain('legacyBareId');
    expect(api().targetOptions().map(o => o.value)).toContain('[gone.field]');
    expect(api().targetOptions().find(o => o.value === '[gone.field]')?.path).toBe('not in this config');
  });

  // Fields inside a group are addressable too, and the tab-level view does not reach them.
  it('offers a field nested inside a group, and falls back to the id for an unlabelled one', () => {
    store.load({
      entity: 'people',
      version: 1,
      tabs: [
        {
          id: 'work',
          label: {},
          fields: [
            {
              id: 'addresses',
              type: 'group',
              label: { en: 'Addresses' },
              children: [{ id: 'city', type: 'text', label: {} }],
            },
          ],
        },
      ],
    });
    fixture.detectChanges();

    const city = api().fieldOptions().find(o => o.path === 'work.addresses.city');
    expect(city?.value).toBe('[work.addresses.city]');
    expect(city?.label).toBe('city');
  });

  it('does not invent an option for an empty trigger', () => {
    component.rule.fieldId = '';
    fixture.detectChanges();

    expect(api().triggerOptions().map(o => o.value)).toEqual(['[personal.address]', '[work.address]']);
  });
});
