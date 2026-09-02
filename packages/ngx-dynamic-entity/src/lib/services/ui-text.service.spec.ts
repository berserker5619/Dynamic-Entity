import { TestBed } from '@angular/core/testing';
import { UI_TEXT } from '../tokens/injection-tokens';
import { DEFAULT_UI_TEXT, UiTextService, type UiTextOverrides } from './ui-text.service';

describe('UiTextService', () => {
  function make(overrides?: UiTextOverrides): UiTextService {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: overrides ? [{ provide: UI_TEXT, useValue: overrides }] : [],
    });
    return TestBed.inject(UiTextService);
  }

  it('uses the built-in English default when nothing is provided', () => {
    expect(make().text('save')).toBe('Save');
    expect(make().text('noRows', 'de')).toBe('No rows yet.');
  });

  it('takes a replacement string, whatever the language', () => {
    expect(make({ save: 'Speichern' }).text('save', 'de')).toBe('Speichern');
    expect(make({ save: 'Speichern' }).text('save', 'en')).toBe('Speichern');
  });

  /** The shape a config already uses for every field label. */
  it('resolves a LocalizedText value against the form language', () => {
    const ui = make({ save: { en: 'Save', de: 'Speichern', fr: 'Enregistrer' } });
    expect(ui.text('save', 'de')).toBe('Speichern');
    expect(ui.text('save', 'fr')).toBe('Enregistrer');
  });

  it('falls back to the English entry of a LocalizedText that lacks the language', () => {
    expect(make({ save: { en: 'Save', de: 'Speichern' } }).text('save', 'ja')).toBe('Save');
  });

  it('leaves unlisted keys on their default, so overriding one is not overriding all', () => {
    const ui = make({ save: { de: 'Speichern' } });
    expect(ui.text('save', 'de')).toBe('Speichern');
    expect(ui.text('reset', 'de')).toBe('Reset');
  });

  /** The seam for $localize / ngx-translate / Transloco: the host answers per key. */
  it('asks a resolver, handing it the key, the English default and the language', () => {
    const seen: Array<[string, string, string]> = [];
    const ui = make((key, defaultText, language) => {
      seen.push([key, defaultText, language]);
      return `${language}:${key}`;
    });

    expect(ui.text('reset', 'de')).toBe('de:reset');
    expect(seen).toEqual([['reset', 'Reset', 'de']]);
  });

  /**
   * A translation layer asked for a key it has no entry for typically returns '' or the key
   * itself; the first would render a blank button. English is the better answer.
   */
  it('falls back to English when an override yields nothing', () => {
    expect(make(() => '').text('cancel')).toBe('Cancel');
    expect(make(() => undefined as unknown as string).text('cancel')).toBe('Cancel');
    expect(make({ cancel: {} }).text('cancel')).toBe('Cancel');
  });

  describe('parameters', () => {
    it('fills a {placeholder} from params', () => {
      expect(make().text('itemNumber', 'en', { number: 3 })).toBe('Item #3');
    });

    /** The point of one whole string per sentence: a translation may reorder it. */
    it('lets a translation put the placeholder somewhere else in the clause', () => {
      const ui = make({ itemNumber: { en: 'Item #{number}', ja: '{number} 番目' } });
      expect(ui.text('itemNumber', 'ja', { number: 3 })).toBe('3 番目');
    });

    it('leaves a placeholder with no matching param as written', () => {
      expect(make().text('itemNumber', 'en', { other: 1 })).toBe('Item #{number}');
      expect(make().text('itemNumber')).toBe('Item #{number}');
    });

    it('interpolates what a resolver returns, so a host catalogue keeps the slots', () => {
      const ui = make((key, defaultText) => (key === 'itemNumber' ? 'Zeile {number}' : defaultText));
      expect(ui.text('itemNumber', 'de', { number: 7 })).toBe('Zeile 7');
    });
  });

  it('publishes every key it renders, so a translation file can be generated from it', () => {
    expect(Object.keys(DEFAULT_UI_TEXT).length).toBeGreaterThan(0);
    for (const [key, value] of Object.entries(DEFAULT_UI_TEXT)) {
      expect(typeof value).toBe('string');
      expect(value).not.toBe('');
      expect(key).toMatch(/^[a-z][a-zA-Z]*$/);
    }
  });
});
