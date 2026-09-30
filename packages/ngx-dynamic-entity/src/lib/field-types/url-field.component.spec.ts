import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import type { NestedFieldConfig } from '@dynamic-entity/core';
import { UrlFieldComponent } from './url-field.component';
import { urlValidator } from '../services/validator-registry.service';

describe('UrlFieldComponent', () => {
  let fixture: ComponentFixture<UrlFieldComponent>;

  const field: NestedFieldConfig = { id: 'site', type: 'url', label: { en: 'Website' } };

  function mount(value: unknown, readonly = false, control = new FormControl(value)) {
    fixture = TestBed.createComponent(UrlFieldComponent);
    fixture.componentRef.setInput('field', field);
    fixture.componentRef.setInput('control', control);
    fixture.componentRef.setInput('readonly', readonly);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [UrlFieldComponent, ReactiveFormsModule] }).compileComponents();
  });

  it('renders a url input bound to the control', () => {
    const input = mount('https://example.com').querySelector('input') as HTMLInputElement;
    expect(input.type).toBe('url');
    expect(input.autocomplete).toBe('url');
    expect(input.value).toBe('https://example.com');
  });

  it('links an http(s) address when read-only, opening safely in a new tab', () => {
    const link = mount('https://example.com/a', true).querySelector('a') as HTMLAnchorElement;
    expect(link.getAttribute('href')).toBe('https://example.com/a');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('never turns a stored script URL into a link', () => {
    const host = mount('javascript:alert(1)', true);
    expect(host.querySelector('a')).toBeNull();
    expect(host.querySelector('[data-testid="field-site-value"]')!.textContent).toContain('javascript:alert(1)');
  });

  it('shows a dash when read-only and empty', () => {
    expect(mount('', true).querySelector('[data-testid="field-site-value"]')!.textContent!.trim()).toBe('—');
  });

  it('shows the url message once touched', () => {
    const control = new FormControl('example.com', [urlValidator]);
    control.markAsTouched();
    const host = mount(null, false, control);
    expect(host.querySelector('.ngx-field__error')!.textContent).toContain('https://');
  });
});
