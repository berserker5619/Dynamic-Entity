import { COMMON_MODULES, DEFAULT_LANGUAGE, SUPPORTED_LANGUAGES } from './constants';

describe('constants', () => {
  it('exports DEFAULT_LANGUAGE', () => {
    expect(DEFAULT_LANGUAGE).toBe('en');
  });

  it('exports SUPPORTED_LANGUAGES with en and de', () => {
    expect(SUPPORTED_LANGUAGES.length).toBeGreaterThanOrEqual(2);
    expect(SUPPORTED_LANGUAGES.some(l => l.code === 'en')).toBe(true);
    expect(SUPPORTED_LANGUAGES.some(l => l.code === 'de')).toBe(true);
  });

  it('COMMON_MODULES has 14 built-in entries with id, label, component', () => {
    expect(COMMON_MODULES).toHaveLength(14);
    for (const mod of COMMON_MODULES) {
      expect(mod.id).toBeTruthy();
      expect(mod.component).toBeTruthy();
      expect(mod.label.en).toBeTruthy();
    }
  });
});
