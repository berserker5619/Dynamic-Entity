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

  /**
   * The editor's own entry points. `startCreate` guards on there being a selected field,
   * `commit` branches on whether the rule already exists, and `summarize` has to render a
   * field-to-field comparison as well as a literal one.
   */
  describe('the rule editor', () => {
    const api = () => fixture.componentInstance as unknown as {
      startCreate(): void;
      startEdit(r: FormRule): void;
      commit(r: FormRule): void;
      summarize(r: FormRule): string;
      editing(): FormRule | null;
    };

    it('refuses to start a draft with no field selected', () => {
      store.selectField(null);
      api().startCreate();
      expect(api().editing()).toBeNull();
    });

    it('falls back to a placeholder form id when the entity is unnamed', () => {
      store.setEntityName('');
      const id = store.addField('text');
      store.selectField(id);

      api().startCreate();

      expect(api().editing()?.formConfigId).toBe('form-1');
      expect(api().editing()?.fieldId).toBe(id);
    });

    it('opens an existing rule as a detached copy', () => {
      const id = store.addRule(rule('text_1'));
      const original = store.rules().find(r => r.id === id)!;

      api().startEdit(original);
      api().editing()!.conditions[0].value = 'mutated';

      expect(store.rules().find(r => r.id === id)!.conditions[0].value).toBe('archived');
    });

    it('updates on commit when the rule has an id, and adds when it does not', () => {
      const id = store.addRule(rule('text_1'));
      const edited = { ...store.rules().find(r => r.id === id)!, priority: 9 };

      api().commit(edited);
      expect(store.rules()).toHaveLength(1);
      expect(store.rules()[0].priority).toBe(9);
      expect(api().editing()).toBeNull();

      api().commit(rule('text_1', { priority: 2 }));
      expect(store.rules()).toHaveLength(2);
    });

    it('summarises a literal comparison and a field-to-field one', () => {
      expect(api().summarize(rule('status'))).toBe('status EQUAL "archived" → hide');

      expect(
        api().summarize(
          rule('status', {
            conditions: [{ operator: 'EQUAL', compareType: 'field', compareToField: 'other' }],
            action: { type: 'visibility', value: true },
          }),
        ),
      ).toBe('status EQUAL other → show');
    });

    it('summarises a non-visibility action by naming it', () => {
      expect(
        api().summarize(rule('status', { action: { type: 'required', value: true } })),
      ).toBe('status EQUAL "archived" → required: true');
    });

    it('renders a field comparison that names no field without a trailing space', () => {
      expect(
        api().summarize(rule('status', { conditions: [{ operator: 'EQUAL', compareType: 'field' }] })),
      ).toBe('status EQUAL → hide');
    });

    it('renders an empty condition value without trailing space', () => {
      expect(
        api().summarize(rule('status', { conditions: [{ operator: 'EQUAL', compareType: 'value' }] })),
      ).toBe('status EQUAL "" → hide');
    });
  });
});
