import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import type { NestedFieldConfig } from '@dynamic-entity/core';
import { TagsFieldComponent } from './tags-field.component';

describe('TagsFieldComponent', () => {
  let fixture: ComponentFixture<TagsFieldComponent>;

  const field: NestedFieldConfig = { id: 'labels', type: 'tags', label: { en: 'Labels' } };

  function mount(control: FormControl, readonly = false) {
    fixture = TestBed.createComponent(TagsFieldComponent);
    fixture.componentRef.setInput('field', field);
    fixture.componentRef.setInput('control', control);
    fixture.componentRef.setInput('readonly', readonly);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  const input = (host: HTMLElement) => host.querySelector('input') as HTMLInputElement;
  const chips = (host: HTMLElement) =>
    Array.from(host.querySelectorAll('[data-testid="field-labels-tag"]')).map(c => c.firstChild!.textContent!.trim());

  function type(host: HTMLElement, text: string, key = 'Enter'): KeyboardEvent {
    input(host).value = text;
    const event = new KeyboardEvent('keydown', { key, cancelable: true });
    input(host).dispatchEvent(event);
    fixture.detectChanges();
    return event;
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [TagsFieldComponent, ReactiveFormsModule] }).compileComponents();
  });

  it('adds a tag on Enter, and stops Enter submitting the form', () => {
    const control = new FormControl<string[] | null>(null);
    const host = mount(control);
    const event = type(host, ' urgent ');
    expect(event.defaultPrevented).toBe(true);
    expect(control.value).toEqual(['urgent']);
    expect(input(host).value).toBe('');
    expect(chips(host)).toEqual(['urgent']);
  });

  it('adds a tag on a comma, and ignores a duplicate', () => {
    const control = new FormControl<string[]>(['a']);
    const host = mount(control);
    type(host, 'b', ',');
    type(host, 'a', ',');
    expect(control.value).toEqual(['a', 'b']);
  });

  it('removes the last tag on Backspace in an empty box', () => {
    const control = new FormControl<string[]>(['a', 'b']);
    const host = mount(control);
    type(host, '', 'Backspace');
    expect(control.value).toEqual(['a']);
  });

  it('keeps Backspace as ordinary editing while there is text in the box', () => {
    const control = new FormControl<string[]>(['a', 'b']);
    const host = mount(control);
    type(host, 'dra', 'Backspace');
    expect(control.value).toEqual(['a', 'b']);
  });

  it('removes a tag from its own button, which says which tag it removes', () => {
    const control = new FormControl<string[]>(['a', 'b']);
    const host = mount(control);
    const button = host.querySelector('.ngx-field__tag-remove') as HTMLButtonElement;
    expect(button.getAttribute('aria-label')).toBe('Remove a');
    button.click();
    expect(control.value).toEqual(['b']);
  });

  it('commits a typed tag when focus leaves, rather than losing it', () => {
    const control = new FormControl<string[] | null>(null);
    const host = mount(control);
    input(host).value = 'draft';
    input(host).dispatchEvent(new Event('blur'));
    expect(control.value).toEqual(['draft']);
    expect(control.touched).toBe(true);
  });

  it('splits pasted text on commas, semicolons and line breaks', () => {
    const control = new FormControl<string[] | null>(null);
    const host = mount(control);
    const event = new Event('paste', { cancelable: true }) as ClipboardEvent;
    Object.defineProperty(event, 'clipboardData', { value: { getData: () => 'x, y;z\nw' } });
    input(host).dispatchEvent(event);
    expect(control.value).toEqual(['x', 'y', 'z', 'w']);
  });

  it('shows a stored single string as one tag rather than dropping it', () => {
    expect(chips(mount(new FormControl('legacy')))).toEqual(['legacy']);
  });

  it('lists the tags when read-only, and a dash when there are none', () => {
    expect(mount(new FormControl(['a', 'b']), true).textContent).toContain('a');
    expect(mount(new FormControl([]), true).querySelector('[data-testid="field-labels-value"]')!.textContent!.trim()).toBe(
      '—',
    );
  });

  it('counts tags, not characters, in its length messages', () => {
    const control = new FormControl(['a'], [Validators.minLength(2)]);
    control.markAsTouched();
    expect(mount(control).querySelector('.ngx-field__error')!.textContent).toContain('At least 2 required');
  });
});
