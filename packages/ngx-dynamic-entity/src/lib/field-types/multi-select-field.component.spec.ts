import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { MultiSelectFieldComponent } from './multi-select-field.component';

describe('MultiSelectFieldComponent', () => {
  let component: MultiSelectFieldComponent;
  let fixture: ComponentFixture<MultiSelectFieldComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [MultiSelectFieldComponent, ReactiveFormsModule]
    }).compileComponents();

    fixture = TestBed.createComponent(MultiSelectFieldComponent);
    component = fixture.componentInstance;
    component.field = { 
      label: { en: 'Tags' },
      options: [
        { en: 'One' },
        { en: 'Two' }
      ]
    } as any;
    component.control = new FormControl([{ en: 'One' }, { en: 'Two' }]);
    fixture.detectChanges();
  });

  it('should render multiple select', () => {
    const el = fixture.nativeElement.querySelector('select');
    expect(el.multiple).toBeTrue();
  });

  it('should join labels in readonly mode', () => {
    component.readonly = true;
    fixture.detectChanges();
    const val = fixture.nativeElement.querySelector('.ngx-field__value');
    expect(val.textContent).toBe('One, Two');
  });

  it('renders the localized field label', () => {
    expect(fixture.nativeElement.querySelector('.ngx-field__label').textContent).toContain('Tags');
  });

  it('masks the value, and renders no select, for masked roles', () => {
    component.masked = true;
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.ngx-field__value--masked')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('select')).toBeNull();
  });

  it('disables the select when the field is disabled', () => {
    component.field = { ...component.field, disabled: true };
    fixture.detectChanges();

    expect((fixture.nativeElement.querySelector('select') as HTMLSelectElement).disabled).toBe(true);
  });

  describe('read-only label joining', () => {
    it('shows an em dash for an empty selection', () => {
      expect(component.getLabels([])).toBe('—');
      expect(component.getLabels(null as never)).toBe('—');
      expect(component.getLabels('not-an-array' as never)).toBe('—');
    });

    it('falls back to the stored text for a value no option matches', () => {
      expect(component.getLabels([{ en: 'Three' }])).toBe('Three');
    });

    it('stringifies a plain scalar value', () => {
      expect(component.getLabels(['Four' as never])).toBe('Four');
    });

    it('mixes matched and unmatched values in one line', () => {
      expect(component.getLabels([{ en: 'One' }, { en: 'Gone' }])).toBe('One, Gone');
    });
  });

  it('compares option identity by value, not reference', () => {
    // The select binds objects with [ngValue]; a record loaded from JSON is a different
    // object than the option in the config, so compareWith has to match on content.
    expect(component.compareFn({ en: 'One' }, { en: 'One' })).toBe(true);
    expect(component.compareFn({ en: 'One' }, { en: 'Two' })).toBe(false);
  });
});

describe('MultiSelectFieldComponent — language and unresolved values', () => {
  let fixture: ComponentFixture<MultiSelectFieldComponent>;
  let component: MultiSelectFieldComponent;

  beforeEach(async () => {
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [MultiSelectFieldComponent, ReactiveFormsModule],
    }).compileComponents();

    fixture = TestBed.createComponent(MultiSelectFieldComponent);
    component = fixture.componentInstance;
    component.field = {
      id: 'tags',
      type: 'multiSelect',
      label: { en: 'Tags', de: 'Schlagworte' },
      options: [{ en: 'One', de: 'Eins' }, { en: 'Two', de: 'Zwei' }],
    } as never;
    component.control = new FormControl([]);
    fixture.detectChanges();
  });

  it('re-resolves option labels when the language changes', () => {
    component.control.setValue([{ en: 'One', de: 'Eins' }]);
    component.readonly = true;

    component.language = 'en';
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.ngx-field__value').textContent).toContain('One');

    component.language = 'de';
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.ngx-field__value').textContent).toContain('Eins');
  });

  it('defaults a blank language to en', () => {
    component.language = '';
    expect(component.language).toBe('en');
  });

  it('renders an em dash when nothing is selected', () => {
    component.control.setValue([]);
    component.readonly = true;
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.ngx-field__value').textContent.trim()).toBe('—');
  });

  /**
   * A stored value that matches no current option still has to render something: the option
   * may have been renamed or removed after the record was saved.
   */
  it('falls back to the raw value when no option matches', () => {
    component.control.setValue(['legacy-code', { en: 'Gone' }]);
    component.readonly = true;
    fixture.detectChanges();

    const text = fixture.nativeElement.querySelector('.ngx-field__value').textContent;
    expect(text).toContain('legacy-code');
    expect(text).toContain('Gone');
  });
});
