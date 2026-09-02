import { TestBed } from '@angular/core/testing';
import { ReactiveFormsModule } from '@angular/forms';
import type { EntityFormConfig } from '@dynamic-entity/core';
import { DynamicFormComponent } from './dynamic-form.component';
import { provideBuiltInFieldTypes } from '../providers/provide-field-types';
import { UI_TEXT } from '../tokens/injection-tokens';

/**
 * The critical-field banner names the fields that changed, in one sentence.
 *
 * It used to be a `<span>` per field looped in the template, with the words around them
 * written as literals. That shape cannot be translated: German puts the list somewhere else
 * in the clause, and fragments joined by a template have a fixed order. So the list is
 * joined into a single `{fields}` parameter and the whole sentence is one key.
 *
 * What that trades away is the ability to style one name; what it buys is a sentence a
 * translator can actually move. This pins both halves — the sentence resolves through
 * `UI_TEXT`, and the names in it are the changed fields' labels in the form's language.
 */
describe('the critical-field banner', () => {
  const CONFIG: EntityFormConfig = {
    entity: 'clients',
    version: 1,
    tabs: [
      {
        id: 'main',
        label: { en: 'Main' },
        fields: [
          { id: 'salary', type: 'number', label: { en: 'Salary', de: 'Gehalt' }, criticalField: true },
          { id: 'tier', type: 'text', label: { en: 'Tier', de: 'Stufe' }, criticalField: true },
          { id: 'notes', type: 'text', label: { en: 'Notes' } },
          {
            id: 'plan',
            type: 'dropdown',
            label: { en: 'Plan' },
            options: [{ en: 'Basic' }, { en: 'Pro' }],
            criticalField: true,
          },
        ],
      },
    ],
  } as EntityFormConfig;

  function mount(language = 'en', uiText?: unknown) {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [DynamicFormComponent, ReactiveFormsModule],
      providers: [provideBuiltInFieldTypes(), ...(uiText ? [{ provide: UI_TEXT, useValue: uiText }] : [])],
    });
    const fixture = TestBed.createComponent(DynamicFormComponent);
    fixture.componentRef.setInput('config', CONFIG);
    // Nested by tab id: that is the record shape, and a flat object would leave the form
    // empty and the baseline null — which is a passing test for the wrong reason.
    fixture.componentRef.setInput('initialData', { main: { salary: 100, tier: 'Gold', notes: 'x', plan: { en: 'Basic' } } });
    fixture.componentRef.setInput('language', language);
    fixture.detectChanges();
    return fixture;
  }

  const banner = (fixture: ReturnType<typeof mount>) =>
    (fixture.nativeElement as HTMLElement).querySelector('[data-testid="critical-change-banner"]');

  it('stays away while nothing has moved from the session baseline', () => {
    expect(banner(mount())).toBeNull();
  });

  it('names one changed field', () => {
    const fixture = mount();
    fixture.componentInstance.getControl('salary')!.setValue(200);
    fixture.detectChanges();

    expect(banner(fixture)!.textContent).toContain('Salary');
    expect(banner(fixture)!.textContent).not.toContain('Tier');
  });

  it('joins several into one list, in config order', () => {
    const fixture = mount();
    fixture.componentInstance.getControl('tier')!.setValue('Platinum');
    fixture.componentInstance.getControl('salary')!.setValue(200);
    fixture.detectChanges();

    expect(banner(fixture)!.textContent).toContain('Salary, Tier');
  });

  it('ignores a field that is not critical', () => {
    const fixture = mount();
    fixture.componentInstance.getControl('notes')!.setValue('changed');
    fixture.detectChanges();

    expect(banner(fixture)).toBeNull();
  });

  it('goes away again when the value returns to the baseline', () => {
    const fixture = mount();
    fixture.componentInstance.getControl('salary')!.setValue(200);
    fixture.detectChanges();
    expect(banner(fixture)).not.toBeNull();

    fixture.componentInstance.getControl('salary')!.setValue(100);
    fixture.detectChanges();
    expect(banner(fixture)).toBeNull();
  });

  describe('a value that is an object, not a scalar', () => {
    // A dropdown stores the option object itself, so comparing against the baseline by
    // identity would report every rebuild as a change: the form builds a new object from the
    // same record. The comparison is structural for exactly this case.
    it('says nothing while an equal object is rebuilt', () => {
      const fixture = mount();
      fixture.componentInstance.getControl('plan')!.setValue({ en: 'Basic' });
      fixture.detectChanges();

      expect(banner(fixture)).toBeNull();
    });

    it('reports a different option', () => {
      const fixture = mount();
      fixture.componentInstance.getControl('plan')!.setValue({ en: 'Pro' });
      fixture.detectChanges();

      expect(banner(fixture)!.textContent).toContain('Plan');
    });

    it('treats null and empty as the same absence', () => {
      const fixture = mount();
      fixture.componentInstance.getControl('notes')!.setValue(null);
      fixture.componentInstance.getControl('plan')!.setValue(null);
      fixture.detectChanges();

      // `plan` moved from an object to null, which is a change; `notes` is not critical.
      expect(banner(fixture)!.textContent).toContain('Plan');
      expect(banner(fixture)!.textContent).not.toContain('Notes');
    });
  });

  it('names the fields in the form language, not always English', () => {
    const fixture = mount('de');
    fixture.componentInstance.getControl('salary')!.setValue(200);
    fixture.detectChanges();

    expect(banner(fixture)!.textContent).toContain('Gehalt');
  });

  it('resolves the whole sentence through UI_TEXT, with the list as a parameter', () => {
    const fixture = mount('de', {
      criticalFieldChanged: { de: 'Geändert: {fields}. Bitte prüfen.' },
    });
    fixture.componentInstance.getControl('salary')!.setValue(200);
    fixture.detectChanges();

    expect(banner(fixture)!.textContent!.trim()).toBe('Geändert: Gehalt. Bitte prüfen.');
  });

  it('lets a translation put the list somewhere else in the clause', () => {
    // The reason the sentence is one key: this word order is impossible to produce from
    // fragments joined around a loop in the template.
    const fixture = mount('de', {
      criticalFieldChanged: { de: 'Bitte prüfen — {fields} wurde seit Sitzungsbeginn geändert.' },
    });
    fixture.componentInstance.getControl('tier')!.setValue('Platinum');
    fixture.detectChanges();

    expect(banner(fixture)!.textContent!.trim()).toBe('Bitte prüfen — Stufe wurde seit Sitzungsbeginn geändert.');
  });
});
