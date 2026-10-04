import { cellText } from './cell-text';

describe('cellText', () => {
  it('renders an empty cell as empty text', () => {
    expect(cellText(null)).toBe('');
    expect(cellText(undefined)).toBe('');
  });

  it('passes text through untouched', () => {
    expect(cellText(' Ada ')).toBe(' Ada ');
  });

  it('renders numbers and booleans as their text', () => {
    expect(cellText(1.5)).toBe('1.5');
    expect(cellText(0)).toBe('0');
    expect(cellText(false)).toBe('false');
  });

  // A spreadsheet stores a calendar date as midnight UTC. String() would render it in local
  // time, a day early at a negative offset, so the preview would show a different day.
  it('renders a midnight-UTC date as the bare day', () => {
    expect(cellText(new Date(Date.UTC(2024, 2, 7)))).toBe('2024-03-07');
  });

  it('keeps any other instant as its full ISO form', () => {
    expect(cellText(new Date(Date.UTC(2024, 2, 7, 9, 30)))).toBe('2024-03-07T09:30:00.000Z');
  });

  it('renders an invalid date as empty text rather than "Invalid Date"', () => {
    expect(cellText(new Date('nope'))).toBe('');
  });
});
