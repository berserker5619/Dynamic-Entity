import { ChangeDetectionStrategy, Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormControl, Validators } from '@angular/forms';
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

  describe('labels, placeholder and language', () => {
    beforeEach(() => TestBed.configureTestingModule({ imports: [MarkdownFieldComponent] }));

    it('resolves the label and placeholder in the active language', () => {
      fixture = TestBed.createComponent(MarkdownFieldComponent);
      fixture.componentRef.setInput('field', {
        id: 'notes',
        type: 'markdown',
        label: { en: 'Notes', de: 'Notizen' },
        placeholder: { en: 'Write…', de: 'Schreiben…' },
      } as NestedFieldConfig);
      fixture.componentRef.setInput('control', new FormControl(''));
      fixture.componentRef.setInput('language', 'de');
      fixture.detectChanges();
      host = fixture.nativeElement as HTMLElement;

      expect(host.querySelector('.ngx-field__label')!.textContent).toContain('Notizen');
      expect((testid('input') as HTMLTextAreaElement).placeholder).toBe('Schreiben…');
    });
  });

  describe('validation', () => {
    beforeEach(() => TestBed.configureTestingModule({ imports: [MarkdownFieldComponent] }));

    it('shows an error only once the control is invalid and touched', () => {
      const control = new FormControl('', { validators: [Validators.required] });
      fixture = TestBed.createComponent(MarkdownFieldComponent);
      fixture.componentRef.setInput('field', field);
      fixture.componentRef.setInput('control', control);
      fixture.detectChanges();
      host = fixture.nativeElement as HTMLElement;

      // Invalid, but untouched — an error here would shout at someone who has not typed yet.
      expect(testid('error')).toBeNull();

      control.markAsTouched();
      fixture.detectChanges();
      expect(testid('error')).toBeTruthy();
    });
  });

  describe('edge values', () => {
    beforeEach(() =>
      TestBed.configureTestingModule({
        imports: [MarkdownFieldComponent],
        providers: [{ provide: MARKDOWN_RENDERER, useValue: (src: string) => `<p>${src}</p>` }],
      }),
    );

    it('renders nothing for an empty document rather than empty markup', () => {
      build('', { readonly: true });
      // `<p></p>` would be a visually empty box the author cannot explain.
      expect(testid('value')!.querySelector('p')).toBeNull();
    });

    it('survives a non-string value without calling the renderer', () => {
      // A config edited by hand, or a migration, can put anything in a control.
      expect(() => build(42 as unknown as string, { readonly: true })).not.toThrow();
    });

    it('masks in preference to rendering, even with a renderer present', () => {
      build('# Secret', { readonly: true, masked: true });
      expect(testid('masked')).toBeTruthy();
      expect(testid('value')).toBeNull();
      expect(host.textContent).not.toContain('Secret');
    });
  });

  describe('preview tracks the source', () => {
    beforeEach(() =>
      TestBed.configureTestingModule({
        imports: [MarkdownFieldComponent],
        providers: [{ provide: MARKDOWN_RENDERER, useValue: (src: string) => `<p>${src}</p>` }],
      }),
    );

    it('renders the current value, not the one present when Preview was opened', () => {
      build('first');
      (testid('preview') as HTMLButtonElement).click();
      fixture.detectChanges();
      expect(testid('preview-body')!.textContent).toContain('first');

      fixture.componentInstance.control.setValue('second');
      fixture.detectChanges();
      expect(testid('preview-body')!.textContent).toContain('second');
    });
  });

  describe('subscription lifecycle', () => {
    beforeEach(() =>
      TestBed.configureTestingModule({
        imports: [MarkdownFieldComponent],
        providers: [{ provide: MARKDOWN_RENDERER, useValue: (src: string) => `<p>${src}</p>` }],
      }),
    );

    it('re-renders when the value is changed from outside the component', () => {
      // Deliberately hosted rather than created as the fixture root. A root component is
      // always checked, so an OnPush bug is invisible there — this assertion would pass with
      // the subscription deleted. Inside a host, the child is skipped unless it is marked.
      @Component({
        standalone: true,
        imports: [MarkdownFieldComponent],
        changeDetection: ChangeDetectionStrategy.OnPush,
        template: `<ngx-markdown-field [field]="field" [control]="control" [readonly]="true" />`,
      })
      class HostComponent {
        field: NestedFieldConfig = { id: 'notes', type: 'markdown', label: { en: 'Notes' } };
        control = new FormControl('first');
      }

      const hostFixture = TestBed.createComponent(HostComponent);
      hostFixture.detectChanges();
      const el = hostFixture.nativeElement as HTMLElement;
      const value = () => el.querySelector('[data-testid="field-notes-value"]')!.textContent;
      expect(value()).toContain('first');

      // Under OnPush this is neither an input nor a template event, so without the
      // valueChanges subscription the view keeps the old document.
      hostFixture.componentInstance.control.setValue('second');
      hostFixture.detectChanges();
      expect(value()).toContain('second');
    });

    it('follows a replacement control and drops the previous subscription', () => {
      build('first', { readonly: true });
      const original = fixture.componentInstance.control;

      const replacement = new FormControl('replaced');
      fixture.componentRef.setInput('control', replacement);
      fixture.detectChanges();
      expect(testid('value')!.textContent).toContain('replaced');

      // The old control must no longer drive this view, or a stale form would keep
      // repainting a field that has moved on.
      original.setValue('stale');
      fixture.detectChanges();
      expect(testid('value')!.textContent).toContain('replaced');
    });

    it('survives being destroyed with a live subscription', () => {
      build('first', { readonly: true });
      expect(() => fixture.destroy()).not.toThrow();
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

    it('strips inline event handlers, which no tag name would catch', () => {
      // The obvious test is <script>. The likelier payload is an attribute on a tag that
      // looks harmless, so assert the attribute is gone rather than that the tag is.
      build('<img src="x" onerror="window.pwned = true">', { readonly: true });
      const img = testid('value')!.querySelector('img');
      expect(img?.getAttribute('onerror')).toBeNull();
    });

    it('strips a javascript: URL on a link', () => {
      build('<a href="javascript:alert(1)">click</a>', { readonly: true });
      const href = testid('value')!.querySelector('a')?.getAttribute('href') ?? '';
      expect(href.startsWith('javascript:')).toBe(false);
    });

    it('does the same in the editor preview, not only in read-only', () => {
      // Two separate [innerHTML] bindings; covering one proves nothing about the other.
      build('<p>ok</p><script>window.pwned = true;</script>');
      (testid('preview') as HTMLButtonElement).click();
      fixture.detectChanges();
      expect(testid('preview-body')!.querySelector('script')).toBeNull();
    });
  });
});
