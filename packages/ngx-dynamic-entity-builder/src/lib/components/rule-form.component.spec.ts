import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import type { FormRule } from '@dynamic-entity/core';
import { RuleFormComponent } from './rule-form.component';

describe('RuleFormComponent', () => {
  let fixture: ComponentFixture<RuleFormComponent>;
  let component: RuleFormComponent;
  let host: HTMLElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [RuleFormComponent],
      providers: [provideNoopAnimations()],
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
