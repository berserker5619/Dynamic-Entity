import { TestBed } from '@angular/core/testing';
import { BUILDER_TEXT, BuilderTextService, DEFAULT_BUILDER_TEXT, type BuilderTextOverrides } from './builder-text';

describe('BuilderTextService', () => {
  function make(overrides?: BuilderTextOverrides): BuilderTextService {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: overrides ? [{ provide: BUILDER_TEXT, useValue: overrides }] : [],
    });
    return TestBed.inject(BuilderTextService);
  }

  it('uses the built-in English default when nothing is provided', () => {
    expect(make().text('save')).toBe('Save');
    expect(make().text('noRulesOnField')).toBe('No rules on this field.');
  });

  it('takes a replacement string', () => {
    expect(make({ save: 'Speichern' }).text('save')).toBe('Speichern');
  });

  it('resolves a LocalizedText value against the chrome language', () => {
    const ui = make({ save: { en: 'Save', de: 'Speichern' } });
    expect(ui.text('save')).toBe('Save');

    ui.language.set('de');
    expect(ui.text('save')).toBe('Speichern');
  });

  it('leaves unlisted keys on their default', () => {
    const ui = make({ save: 'Speichern' });
    expect(ui.text('save')).toBe('Speichern');
    expect(ui.text('cancel')).toBe('Cancel');
  });

  it('asks a resolver, handing it the key, the default and the chrome language', () => {
    const seen: Array<[string, string, string]> = [];
    const ui = make((key, defaultText, language) => {
      seen.push([key, defaultText, language]);
      return `${language}:${key}`;
    });
    ui.language.set('fr');

    expect(ui.text('cancel')).toBe('fr:cancel');
    expect(seen).toEqual([['cancel', 'Cancel', 'fr']]);
  });

  it('falls back to English when an override yields nothing', () => {
    expect(make(() => '').text('cancel')).toBe('Cancel');
    expect(make({ cancel: {} }).text('cancel')).toBe('Cancel');
  });

  it('fills {placeholder} slots from params', () => {
    expect(make().text('fieldsHeading', { count: 4 })).toBe('Fields (4)');
    expect(make().text('moveFieldUp', { field: 'IBAN' })).toBe('Move IBAN up');
  });

  /**
   * The builder's chrome language is not `BuilderStore.activeLanguage()`, which selects the
   * `LocalizedText` entry being authored. Nothing here may read the authoring language.
   */
  it('defaults the chrome language to English, independent of any authoring language', () => {
    expect(make().language()).toBe('en');
  });

  it('publishes every key it renders, so a translation file can be generated from it', () => {
    expect(Object.keys(DEFAULT_BUILDER_TEXT).length).toBeGreaterThan(0);
    for (const [key, value] of Object.entries(DEFAULT_BUILDER_TEXT)) {
      expect(typeof value).toBe('string');
      expect(value).not.toBe('');
      expect(key).toMatch(/^[a-z][a-zA-Z]*$/);
    }
  });
});
