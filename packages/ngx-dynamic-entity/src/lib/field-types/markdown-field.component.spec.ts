import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormControl } from '@angular/forms';
import type { NestedFieldConfig } from '@dynamic-entity/core';
import { MarkdownFieldComponent } from './markdown-field.component';
import { MARKDOWN_RENDERER } from '../tokens/injection-tokens';

describe('MarkdownFieldComponent', () => {
  const field: NestedFieldConfig = { id: 'notes', type: 'markdown', label: { en: 'Notes' } };

  let fixture: ComponentFixture<MarkdownFieldComponent>;
  let host: HTMLElement;

  function build(value: string, inputs: Partial<MarkdownFieldComponent> = {}): void {
    fixture = TestBed.createComponent(MarkdownFieldComponent);
    fixture.componentRef.setInput('field', field);
    fixture.componentRef.setInput('control', new FormControl(value));
    for (const [k, v] of Object.entries(inputs)) fixture.componentRef.setInput(k, v);
    fixture.detectChanges();
    host = fixture.nativeElement as HTMLElement;
  }

  const testid = (suffix: string) => host.querySelector(`[data-testid="field-notes-${suffix}"]`);

  afterEach(() => TestBed.resetTestingModule());

  describe('without a renderer', () => {
    beforeEach(() => TestBed.configureTestingModule({ imports: [MarkdownFieldComponent] }));

    it('edits the markdown source in a textarea', () => {
      build('# Title');
      const input = testid('input') as HTMLTextAreaElement;
      expect(input).toBeTruthy();
      expect(input.value).toBe('# Title');
    });

    it('offers no Preview tab, because it could only show the source back', () => {
      build('# Title');
      expect(testid('preview')).toBeNull();
      expect(testid('write')).toBeNull();
    });

    it('shows the source as text when read-only, and does not interpret it', () => {
      build('# Title', { readonly: true });
      const value = testid('value')!;
      expect(value.textContent).toContain('# Title');
      // The point of the no-renderer default: nothing is turned into markup.
      expect(value.querySelector('h1')).toBeNull();
    });

    it('masks the value rather than rendering it', () => {
      build('# Secret', { masked: true });
      expect(testid('masked')!.textContent).toContain('XXXXXXXXX');
      expect(host.textContent).not.toContain('Secret');
    });
  });

  describe('with a renderer', () => {
    beforeEach(() =>
      TestBed.configureTestingModule({
        imports: [MarkdownFieldComponent],
        providers: [
          { provide: MARKDOWN_RENDERER, useValue: (src: string) => `<h1>${src.replace(/^#\s*/, '')}</h1>` },
        ],
      }),
    );

    it('renders the markdown when read-only', () => {
      build('# Title', { readonly: true });
      expect(testid('value')!.querySelector('h1')?.textContent).toBe('Title');
    });

    it('offers a Preview tab that renders, and a Write tab that returns to the source', () => {
      build('# Title');
      expect(testid('input')).toBeTruthy();

      (testid('preview') as HTMLButtonElement).click();
      fixture.detectChanges();
      expect(testid('preview-body')!.querySelector('h1')?.textContent).toBe('Title');
      expect(testid('input')).toBeNull();

      (testid('write') as HTMLButtonElement).click();
      fixture.detectChanges();
      expect(testid('input')).toBeTruthy();
    });

    it('stores the source, never the rendered HTML', () => {
      build('# Title');
      expect(fixture.componentInstance.control.value).toBe('# Title');
    });
  });

  describe('when the renderer misbehaves', () => {
    it('falls back to the source instead of taking the form down', () => {
      TestBed.configureTestingModule({
        imports: [MarkdownFieldComponent],
        providers: [
          {
            provide: MARKDOWN_RENDERER,
            useValue: () => {
              throw new Error('parser exploded');
            },
          },
        ],
      });

      // A renderer is consumer code. One malformed field must not break the whole form.
      expect(() => build('# Title', { readonly: true })).not.toThrow();
      expect(testid('value')!.textContent).toContain('# Title');
    });
  });

  describe('sanitisation', () => {
    beforeEach(() =>
      TestBed.configureTestingModule({
        imports: [MarkdownFieldComponent],
        providers: [{ provide: MARKDOWN_RENDERER, useValue: (src: string) => src }],
      }),
    );

    it('strips a script a renderer let through', () => {
      // `[innerHTML]` runs Angular's sanitizer. This is the backstop for a renderer that
      // passes raw HTML along — it is not a reason to configure one that does.
      build('<p>ok</p><script>window.pwned = true;</script>', { readonly: true });
      const value = testid('value')!;
      expect(value.querySelector('p')?.textContent).toBe('ok');
      expect(value.querySelector('script')).toBeNull();
    });
  });
});
