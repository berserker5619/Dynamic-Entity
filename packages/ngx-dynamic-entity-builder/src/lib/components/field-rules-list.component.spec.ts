import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import type { FormRule } from '@dynamic-entity/core';
import { BuilderStore } from '../builder-store.service';
import { FieldRulesListComponent } from './field-rules-list.component';

const rule = (fieldId: string, over: Partial<FormRule> = {}): FormRule => ({
  formConfigId: 'clients',
  fieldId,
  conditions: [{ operator: 'EQUAL', compareType: 'value', value: 'archived' }],
  action: { type: 'visibility', value: false },
  targets: [{ id: fieldId, type: 'field' }],
  enabled: true,
  priority: 1,
  ...over,
});

describe('FieldRulesListComponent', () => {
  let fixture: ComponentFixture<FieldRulesListComponent>;
  let store: BuilderStore;
  let host: HTMLElement;

  function click(testId: string): void {
    (host.querySelector(`[data-testid="${testId}"]`) as HTMLButtonElement).click();
    fixture.detectChanges();
  }

  function items(): Element[] {
    return Array.from(host.querySelectorAll('[data-testid="rule-item"]'));
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [FieldRulesListComponent],
      providers: [BuilderStore, provideNoopAnimations()],
    }).compileComponents();

    fixture = TestBed.createComponent(FieldRulesListComponent);
    store = TestBed.inject(BuilderStore);
    host = fixture.nativeElement as HTMLElement;

    store.setEntityName('clients');
    store.addField('text'); // auto-selected, id text_1
    fixture.detectChanges();
  });

  it('shows the empty state when the field has no rules', () => {
    expect(host.querySelector('[data-testid="rules-empty"]')).not.toBeNull();
    expect(items().length).toBe(0);
  });

  it('disables the add button when no field is selected', () => {
    store.selectField(null);
    fixture.detectChanges();

    const add = host.querySelector('[data-testid="add-rule"]') as HTMLButtonElement;
    expect(add.disabled).toBe(true);
  });

  it('opens a draft targeting the selected field', () => {
    click('add-rule');

    expect(host.querySelector('ngx-rule-form')).not.toBeNull();
    expect(host.querySelector('[data-testid="rules-empty"]')).toBeNull();
  });

  it('lists only rules that trigger on or target the selected field', () => {
    store.addRule(rule('text_1'));
    store.addRule(rule('somewhere-else', { targets: [{ id: 'other', type: 'field' }] }));
    fixture.detectChanges();

    expect(items().length).toBe(1);
  });

  it('summarises a rule as trigger, condition, and action', () => {
    store.addRule(rule('text_1'));
    fixture.detectChanges();

    const summary = items()[0].textContent ?? '';
    expect(summary).toContain('text_1');
    expect(summary).toContain('EQUAL');
    expect(summary).toContain('hide');
  });

  it('summarises a show action and a message action distinctly', () => {
    store.addRule(rule('text_1', { action: { type: 'visibility', value: true } }));
    store.addRule(rule('text_1', { action: { type: 'info', value: 'Heads up' } }));
    fixture.detectChanges();

    const text = items().map(i => i.textContent ?? '');
    expect(text[0]).toContain('show');
    expect(text[1]).toContain('info: Heads up');
  });

  it('dims a disabled rule', () => {
    store.addRule(rule('text_1', { enabled: false }));
    fixture.detectChanges();

    expect(items()[0].classList.contains('deb-rule-item--off')).toBe(true);
  });

  it('removes a rule through the delete button', () => {
    const id = store.addRule(rule('text_1'));
    fixture.detectChanges();

    click(`rule-delete-${id}`);

    expect(store.rules()).toEqual([]);
  });

  it('opens an existing rule in the editor', () => {
    const id = store.addRule(rule('text_1'));
    fixture.detectChanges();

    click(`rule-edit-${id}`);

    expect(host.querySelector('ngx-rule-form')).not.toBeNull();
  });

  it('reorders rules and renumbers priorities', () => {
    const first = store.addRule(rule('text_1'));
    const second = store.addRule(rule('text_1'));
    fixture.detectChanges();

    click(`rule-up-${second}`);

    expect(store.rules().map(r => r.id)).toEqual([second, first]);
    expect(store.rules().map(r => r.priority)).toEqual([1, 2]);
  });

  it('shows priority and target count per rule', () => {
    store.addRule(rule('text_1', { priority: 4 }));
    fixture.detectChanges();

    expect(items()[0].textContent).toContain('priority 4');
    expect(items()[0].textContent).toContain('1 target');
  });
});
