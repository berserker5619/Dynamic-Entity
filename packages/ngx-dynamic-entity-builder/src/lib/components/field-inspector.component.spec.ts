import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { FieldInspectorComponent } from './field-inspector.component';
import { BuilderStore } from '../builder-store.service';

describe('FieldInspectorComponent', () => {
  let fixture: ComponentFixture<FieldInspectorComponent>;
  let store: BuilderStore;
  let host: HTMLElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [FieldInspectorComponent],
      providers: [BuilderStore, provideNoopAnimations()],
    }).compileComponents();

    fixture = TestBed.createComponent(FieldInspectorComponent);
    store = TestBed.inject(BuilderStore);
    host = fixture.nativeElement as HTMLElement;
    fixture.detectChanges();
  });

  it('shows the empty state when no field is selected', () => {
    expect(host.textContent).toContain('Select a field');
    expect(host.querySelector('input')).toBeNull();
  });

  it('renders the selected field id', () => {
    store.setEntityName('clients');
    const id = store.addField('text'); // auto-selected
    fixture.detectChanges();

    const idInput = host.querySelector('input') as HTMLInputElement;
    expect(idInput.value).toBe(id);
  });

  describe('field id', () => {
    function idInput(): HTMLInputElement {
      return host.querySelector('[data-testid="field-id"]') as HTMLInputElement;
    }

    beforeEach(() => {
      store.setEntityName('clients');
      store.addField('text');
      fixture.detectChanges();
    });

    it('is read-only — the id is not author-editable', () => {
      expect(idInput().disabled).toBe(true);
    });

    it('follows the label as it is typed', async () => {
      const labelField = Array.from(host.querySelectorAll('mat-form-field')).find(f =>
        /Label/.test(f.textContent ?? ''),
      )!;
      const input = labelField.querySelector('input') as HTMLInputElement;

      input.value = 'Employee Count';
      input.dispatchEvent(new Event('input'));
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();

      expect(store.fields()[0].id).toBe('employeeCount');
      expect(idInput().value).toBe('employeeCount');
    });

    it('explains that the id is derived for a new field', () => {
      expect(host.textContent).toContain('Derived from the label');
    });

    it('explains that the id is fixed for a saved field', () => {
      store.load({
        entity: 'clients',
        tabs: [{ id: 'main', label: { en: 'Main' }, fields: [{ id: 'legacy_key', type: 'text', label: { en: 'Old' } }] }],
      });
      fixture.detectChanges();

      expect(host.textContent).toContain('fixed');
    });
  });

  it('adds an option to an option-backed field via the Option button', () => {
    store.setEntityName('clients');
    store.addField('dropdown');
    fixture.detectChanges();

    const optionBtn = Array.from(host.querySelectorAll('button')).find(b =>
      (b.textContent || '').includes('Option'),
    ) as HTMLButtonElement;
    expect(optionBtn).toBeTruthy();

    optionBtn.click();
    fixture.detectChanges();

    expect(store.fields()[0].options?.length).toBe(1);
  });

  describe('display flags', () => {
    beforeEach(() => {
      store.setEntityName('clients');
      store.addField('text');
      fixture.detectChanges();
    });

    it('toggles criticalField', () => {
      const toggle = host.querySelector('[data-testid="toggle-critical"] button') as HTMLButtonElement;
      toggle.click();
      fixture.detectChanges();

      expect(store.selectedField()?.criticalField).toBe(true);
    });
  });

  describe('showWhen conditions', () => {
    function addCondition(): void {
      (host.querySelector('[data-testid="add-show-when"]') as HTMLButtonElement).click();
      fixture.detectChanges();
    }

    function conditionRows(): HTMLInputElement[][] {
      return Array.from(host.querySelectorAll('.deb-option-row')).map(
        row => Array.from(row.querySelectorAll('input')) as HTMLInputElement[],
      );
    }

    beforeEach(() => {
      store.setEntityName('clients');
      store.addField('text');
      fixture.detectChanges();
    });

    it('shows a hint when the field is unconditional', () => {
      expect(host.textContent).toContain('Always visible');
    });

    it('adds a condition defaulting to true', () => {
      addCondition();
      expect(store.selectedField()?.showWhen).toEqual({ field: true });
      expect(host.textContent).not.toContain('Always visible');
    });

    it('generates a unique key for each added condition', () => {
      addCondition();
      addCondition();
      expect(Object.keys(store.selectedField()?.showWhen ?? {})).toEqual(['field', 'field_2']);
    });

    it('renames the key while preserving order and value', async () => {
      addCondition();
      addCondition();
      await fixture.whenStable();
      fixture.detectChanges();

      const [keyInput] = conditionRows()[0];
      keyInput.value = 'isEmployee';
      keyInput.dispatchEvent(new Event('input'));
      fixture.detectChanges();

      expect(Object.keys(store.selectedField()?.showWhen ?? {})).toEqual(['isEmployee', 'field_2']);
    });

    it('ignores a rename that collides with an existing key', () => {
      addCondition();
      addCondition();

      const [keyInput] = conditionRows()[0];
      keyInput.value = 'field_2';
      keyInput.dispatchEvent(new Event('input'));
      fixture.detectChanges();

      expect(Object.keys(store.selectedField()?.showWhen ?? {})).toEqual(['field', 'field_2']);
    });

    it('ignores an empty rename', () => {
      addCondition();
      const [keyInput] = conditionRows()[0];
      keyInput.value = '   ';
      keyInput.dispatchEvent(new Event('input'));
      fixture.detectChanges();

      expect(Object.keys(store.selectedField()?.showWhen ?? {})).toEqual(['field']);
    });

    /**
     * `showWhen` compares with `!==`, so "true" must round-trip as a boolean rather than a
     * string — otherwise the condition can never match a real boolean field value.
     */
    it.each([
      ['true', true],
      ['false', false],
      ['null', null],
      ['42', 42],
      ['-1.5', -1.5],
      ['active', 'active'],
      ['', ''],
    ])('parses the typed value %p as %p', (typed, expected) => {
      addCondition();
      const [, valueInput] = conditionRows()[0];
      valueInput.value = typed as string;
      valueInput.dispatchEvent(new Event('input'));
      fixture.detectChanges();

      expect(store.selectedField()?.showWhen?.['field']).toBe(expected);
    });

    it('renders the stored value back as text', async () => {
      store.setShowWhen(store.selectedFieldId()!, { isEmployee: false });
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();

      const [, valueInput] = conditionRows()[0];
      expect(valueInput.value).toBe('false');
    });

    it('removes a condition and restores the hint when the last one goes', () => {
      addCondition();

      const remove = host.querySelector('.deb-option-row button') as HTMLButtonElement;
      remove.click();
      fixture.detectChanges();

      expect(store.selectedField()?.showWhen).toBeUndefined();
      expect(host.textContent).toContain('Always visible');
    });
  });

  describe('patchOnTrue', () => {
    it('is offered for boolean fields only', () => {
      store.setEntityName('clients');
      store.addField('text');
      fixture.detectChanges();
      expect(host.querySelector('[data-testid="add-patch-on-true"]')).toBeNull();

      store.addField('boolean');
      fixture.detectChanges();
      expect(host.querySelector('[data-testid="add-patch-on-true"]')).not.toBeNull();
    });

    it('adds a mapping through the button', () => {
      store.setEntityName('clients');
      store.addField('checkbox');
      fixture.detectChanges();

      (host.querySelector('[data-testid="add-patch-on-true"]') as HTMLButtonElement).click();
      fixture.detectChanges();

      expect(store.selectedField()?.patchOnTrue).toEqual([{ from: '', to: '' }]);
    });
  });

  describe('data source', () => {
    const listNameInput = () => host.querySelector('[data-testid="list-name"]') as HTMLInputElement;

    beforeEach(() => {
      store.setEntityName('clients');
      store.addField('dropdown');
      fixture.detectChanges();
    });

    it('is offered for choice fields only', () => {
      expect(host.querySelector('[data-testid="data-source"]')).not.toBeNull();

      store.addField('text');
      fixture.detectChanges();
      expect(host.querySelector('[data-testid="data-source"]')).toBeNull();
    });

    it('shows the option editor, not the list name, while the source is manual', () => {
      expect(listNameInput()).toBeNull();
      expect(host.textContent).toContain('Options');
    });

    it('swaps the option editor for a list name when the source becomes a list', () => {
      store.setFieldDataSource(store.selectedField()!.id, 'lookup');
      fixture.detectChanges();

      expect(listNameInput()).not.toBeNull();
      expect(host.querySelector('[data-testid="option-0"]')).toBeNull();
    });

    it('writes the typed list name to the field', () => {
      store.setFieldDataSource(store.selectedField()!.id, 'lookup');
      fixture.detectChanges();

      const input = listNameInput();
      input.value = 'employeeStatus';
      input.dispatchEvent(new Event('input'));
      fixture.detectChanges();

      expect(store.selectedField()?.listName).toBe('employeeStatus');
    });
  });

  /**
   * `toNum` backs the numeric validator inputs and the showWhen helpers back the condition
   * editor. Both are reached through the template in normal use, which left their edge
   * branches — blank input, non-numeric text, a field with no `showWhen` at all — untested.
   */
  describe('value coercion and showWhen editing', () => {
    const api = () => fixture.componentInstance as unknown as {
      toNum(v: unknown): number | null;
      renameShowWhen(f: unknown, oldKey: string, newKey: string): void;
      setShowWhenValue(f: unknown, key: string, raw: string): void;
      removeShowWhen(f: unknown, key: string): void;
      stringifyShowWhen(v: unknown): string;
    };

    function selectedField(): Record<string, any> {
      return store.selectedField() as unknown as Record<string, any>;
    }

    beforeEach(() => {
      store.setEntityName('clients');
      store.addField('text');
      fixture.detectChanges();
    });

    it('coerces an empty, null or undefined value to null', () => {
      expect(api().toNum('')).toBeNull();
      expect(api().toNum(null)).toBeNull();
      expect(api().toNum(undefined)).toBeNull();
    });

    it('coerces numeric text and rejects anything else', () => {
      expect(api().toNum('42')).toBe(42);
      expect(api().toNum(0)).toBe(0);
      expect(api().toNum('not a number')).toBeNull();
    });

    it('adds a showWhen entry to a field that has none', () => {
      api().setShowWhenValue(selectedField(), 'status', 'archived');
      expect(store.selectedField()?.showWhen).toEqual({ status: 'archived' });
    });

    it('parses booleans, null and numbers out of the typed value', () => {
      api().setShowWhenValue(selectedField(), 'a', 'true');
      api().setShowWhenValue(selectedField(), 'b', 'false');
      api().setShowWhenValue(selectedField(), 'c', 'null');
      api().setShowWhenValue(selectedField(), 'd', '7');
      api().setShowWhenValue(selectedField(), 'e', ' spaced ');

      expect(store.selectedField()?.showWhen).toEqual({
        a: true, b: false, c: null, d: 7, e: ' spaced ',
      });
    });

    it('renames a key, and refuses a blank, unchanged or colliding one', () => {
      api().setShowWhenValue(selectedField(), 'status', 'archived');

      api().renameShowWhen(selectedField(), 'status', '   ');
      expect(Object.keys(store.selectedField()!.showWhen!)).toEqual(['status']);

      api().renameShowWhen(selectedField(), 'status', 'status');
      expect(Object.keys(store.selectedField()!.showWhen!)).toEqual(['status']);

      api().setShowWhenValue(selectedField(), 'other', 'x');
      api().renameShowWhen(selectedField(), 'status', 'other');
      expect(Object.keys(store.selectedField()!.showWhen!)).toEqual(['status', 'other']);

      api().renameShowWhen(selectedField(), 'status', 'state');
      expect(store.selectedField()?.showWhen).toEqual({ state: 'archived', other: 'x' });
    });

    it('renames on a field with no showWhen without throwing', () => {
      expect(() => api().renameShowWhen(selectedField(), 'nope', 'other')).not.toThrow();
    });

    it('removes a key, including from a field that has none', () => {
      api().setShowWhenValue(selectedField(), 'status', 'archived');
      expect(store.selectedField()?.showWhen).toEqual({ status: 'archived' });

      // The store drops showWhen entirely once the last key goes, so the second call is the
      // `?? {}` path: removing from a field that no longer has the object at all.
      api().removeShowWhen(selectedField(), 'status');
      expect(store.selectedField()?.showWhen).toBeUndefined();

      expect(() => api().removeShowWhen(selectedField(), 'status')).not.toThrow();
      expect(store.selectedField()?.showWhen).toBeUndefined();
    });

    // `meta` feeds the type-specific sections of the inspector. Nothing reads it while the
    // empty state is showing, so the "no field selected" arm was never evaluated.
    it('resolves catalog metadata only while a field is selected', () => {
      const metaOf = () => (fixture.componentInstance as unknown as {
        meta(): { label: string } | undefined;
      }).meta();

      expect(metaOf()?.label).toBe('Text');

      store.selectField(null);
      fixture.detectChanges();
      expect(metaOf()).toBeUndefined();
    });

    it('stringifies null and object values for display', () => {
      expect(api().stringifyShowWhen(null)).toBe('null');
      expect(api().stringifyShowWhen({ en: 'Active' })).toBe('{"en":"Active"}');
      expect(api().stringifyShowWhen(12)).toBe('12');
    });
  });
});
