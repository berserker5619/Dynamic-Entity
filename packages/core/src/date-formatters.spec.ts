import { formatDisplayValue, setDateFormatters } from './form-logic';

/**
 * Date display is configurable, and its default is deliberately *not* the form's language.
 *
 * `formatDisplayValue` takes a `lang` and honours it for labels and options, so tying dates
 * to it looks like the obvious fix. It is not: `language` selects which `LocalizedText` key
 * to read, and forcing it onto `toLocaleDateString` would change the format for every
 * consumer whose browser locale is not that language — silently, on upgrade, for a decision
 * nobody asked for. So the default stays the browser's locale and hosts that want otherwise
 * say so.
 */
describe('date formatters', () => {
  afterEach(() => setDateFormatters());

  it('uses the browser locale by default, whatever the form language says', () => {
    const iso = '2020-01-15';
    const expected = new Date(iso).toLocaleDateString();

    // Same output for two different content languages: formatting is not content.
    expect(formatDisplayValue('date', undefined, iso, 'en')).toBe(expected);
    expect(formatDisplayValue('date', undefined, iso, 'de')).toBe(expected);
  });

  it('lets a host take over one kind without touching the others', () => {
    setDateFormatters({ date: () => 'FIXED-DATE' });

    expect(formatDisplayValue('date', undefined, '2020-01-15')).toBe('FIXED-DATE');
    // datetime still uses the default — a partial override is partial.
    expect(formatDisplayValue('datetime', undefined, '2020-01-15T10:30')).toBe(
      new Date('2020-01-15T10:30').toLocaleString(),
    );
  });

  it('passes the form language through, for hosts that do want them tied', () => {
    const seen: (string | undefined)[] = [];
    setDateFormatters({ date: (_d, lang) => { seen.push(lang); return 'x'; } });

    formatDisplayValue('date', undefined, '2020-01-15', 'de');
    // The language is available to the formatter; the library just does not impose it.
    expect(seen).toEqual(['de']);
  });

  it('covers datetime and time as well as date', () => {
    setDateFormatters({
      datetime: () => 'DT',
      time: () => 'T',
    });
    expect(formatDisplayValue('datetime', undefined, '2020-01-15T10:30')).toBe('DT');
    expect(formatDisplayValue('time', undefined, '09:30')).toBe('T');
  });

  it('restores the defaults when called with nothing', () => {
    setDateFormatters({ date: () => 'FIXED' });
    setDateFormatters();
    expect(formatDisplayValue('date', undefined, '2020-01-15')).toBe(
      new Date('2020-01-15').toLocaleDateString(),
    );
  });

  it('still reports an unparseable value as empty, override or not', () => {
    setDateFormatters({ date: () => 'FIXED' });
    // The formatter is only reached for a real date; nonsense is caught before it.
    expect(formatDisplayValue('date', undefined, 'not-a-date')).toBe('—');
  });
});
