import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormArray, FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import type { NestedFieldConfig } from '@dynamic-entity/core';
import { ArrayFieldComponent } from './array-field.component';
import { DateFieldComponent } from './date-field.component';
import { DropdownFieldComponent } from './dropdown-field.component';
import { ImageFieldComponent } from './image-field.component';
import { MultiSelectFieldComponent } from './multi-select-field.component';
import { RadioFieldComponent } from './radio-field.component';

/**
 * What a choice field shows when the stored value matches no option.
 *
 * This is not a contrived edge. Options live in the config and values live in records, and
 * the two drift the moment someone removes an option from a dropdown people have already
 * answered. The field then holds a value it cannot look up, and the branch that handles it
 * decides between showing the raw value and showing nothing at all.
 */
describe('choice fields with a value that matches no option', () => {
  const options = [{ en: 'Red', de: 'Rot' }, { en: 'Blue' }];

  function make<T>(type: new (...args: never[]) => T, value: unknown, field: Partial<NestedFieldConfig> = {}) {
    const fixture = TestBed.createComponent(type as never) as ComponentFixture<T>;
    fixture.componentRef.setInput('field', {
      id: 'colour',
      type: 'dropdown',
      label: { en: 'Colour' },
      options,
      ...field,
    } as NestedFieldConfig);
    fixture.componentRef.setInput('control', new FormControl(value));
    fixture.componentRef.setInput('readonly', true);
    fixture.detectChanges();
    return fixture;
  }

  const shown = (fixture: ComponentFixture<unknown>) =>
    (fixture.nativeElement as HTMLElement).querySelector('[data-testid$="-value"]')?.textContent?.trim();

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DropdownFieldComponent, RadioFieldComponent, MultiSelectFieldComponent, ReactiveFormsModule],
    }).compileComponents();
  });

  afterEach(() => TestBed.resetTestingModule());

  describe('dropdown', () => {
    it('falls back to the localized text of an unmatched object value', () => {
      // The option was deleted from the config; the record still holds what was chosen.
      expect(shown(make(DropdownFieldComponent, { en: 'Green', de: 'Gruen' }))).toBe('Green');
    });

    it('falls back to the raw text of an unmatched scalar value', () => {
      expect(shown(make(DropdownFieldComponent, 'Chartreuse'))).toBe('Chartreuse');
    });

    it('shows a dash rather than the word null for an empty value', () => {
      expect(shown(make(DropdownFieldComponent, null))).toBe('—');
    });
  });

  describe('radio', () => {
    it('falls back to the localized text of an unmatched object value', () => {
      expect(shown(make(RadioFieldComponent, { en: 'Green' }, { type: 'radio' }))).toBe('Green');
    });

    it('falls back to the raw text of an unmatched scalar value', () => {
      expect(shown(make(RadioFieldComponent, 'Chartreuse', { type: 'radio' }))).toBe('Chartreuse');
    });

    it('builds a stable input id even for an option with no value', () => {
      const fixture = make(RadioFieldComponent, null, { type: 'radio' });
      // Ids feed a label's `for`, so an option with nothing to name it still needs one. The
      // middle segment is this component instance — two rows of an array render the same
      // option list, and the ids must not collide.
      expect(fixture.componentInstance.getRadioId(null as never)).toMatch(/^colour-de\d+-opt$/);
      expect(fixture.componentInstance.optionSlug(null as never)).toBe('opt');
    });
  });

  describe('multi-select', () => {
    it('falls back per item, mixing matched and unmatched values', () => {
      const text = shown(
        make(MultiSelectFieldComponent, [{ en: 'Red' }, { en: 'Green' }, 'Chartreuse'], {
          type: 'multiSelect',
        }),
      );
      // A value the config no longer offers must still be readable beside ones it does.
      expect(text).toContain('Red');
      expect(text).toContain('Green');
      expect(text).toContain('Chartreuse');
    });
  });
});

describe('date field with an unparseable value', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DateFieldComponent, ReactiveFormsModule],
    }).compileComponents();
  });

  afterEach(() => TestBed.resetTestingModule());

  it('shows the raw value rather than Invalid Date', () => {
    const fixture = TestBed.createComponent(DateFieldComponent);
    fixture.componentRef.setInput('field', { id: 'when', type: 'date', label: { en: 'When' } });
    fixture.componentRef.setInput('control', new FormControl('not-a-date'));
    fixture.componentRef.setInput('readonly', true);
    fixture.detectChanges();

    // Records outlive schemas; a field retyped from text to date can hold anything. The
    // stored text is more use to a reader than the string "Invalid Date".
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('not-a-date');
    expect(text).not.toContain('Invalid Date');
  });
});

describe('image field', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ImageFieldComponent, ReactiveFormsModule],
    }).compileComponents();
  });

  afterEach(() => TestBed.resetTestingModule());

  it('does nothing when the picker is dismissed without a file', async () => {
    const fixture = TestBed.createComponent(ImageFieldComponent);
    fixture.componentRef.setInput('field', { id: 'avatar', type: 'image', label: { en: 'Avatar' } });
    const control = new FormControl(null);
    fixture.componentRef.setInput('control', control);
    fixture.detectChanges();

    // Cancelling a file dialog fires change with no file. Treating that as an upload would
    // start a request for nothing and clear a value the user never touched.
    await fixture.componentInstance.onFileSelect(undefined);
    expect(control.value).toBeNull();
  });
});

describe('array field', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ArrayFieldComponent, ReactiveFormsModule],
    }).compileComponents();
  });

  afterEach(() => TestBed.resetTestingModule());

  it('seeds a new row from each child default, and null where there is none', () => {
    const fixture = TestBed.createComponent(ArrayFieldComponent);
    fixture.componentRef.setInput('field', {
      id: 'lines',
      type: 'array',
      label: { en: 'Lines' },
      children: [
        { id: 'description', type: 'text', label: { en: 'Description' } },
        { id: 'quantity', type: 'number', label: { en: 'Quantity' }, defaultValue: 1 },
      ],
    } as NestedFieldConfig);
    fixture.componentRef.setInput('control', new FormArray<FormGroup>([]));
    fixture.detectChanges();

    fixture.componentInstance.addItem();
    // A default that is not applied on Add is a default that only exists in the config.
    expect(fixture.componentInstance.formArray.at(0).value).toEqual({ description: null, quantity: 1 });
  });
});
