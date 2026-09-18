/**
 * cell-text.ts — how a typed cell is rendered when text is what has to cross the wire.
 *
 * Its own module because both the reader and the preview need it, and a second copy would be
 * a second place for the date rule to be wrong.
 */

/**
 * Render a cell as the text a mapping screen shows.
 *
 * It mirrors `coerceTypedCell`'s date rule on purpose. A preview sample crosses the wire as
 * text and the browser then runs `coerceCell` over that text, so if this rendered a `Date`
 * with `String()` the preview would show — and the browser would coerce — a different day
 * from the one the import will store. That is a preview lying about the only thing it exists
 * to show, and it would be wrong by exactly one day, silently, only for users at a negative
 * UTC offset. `run-import.spec.ts` asserts the two agree rather than trusting this comment.
 */
export function sampleText(raw: unknown): string {
  if (raw === null || raw === undefined) return '';
  if (raw instanceof Date) {
    if (Number.isNaN(raw.getTime())) return '';
    const iso = raw.toISOString();
    // Midnight UTC is how a spreadsheet stores a calendar date, so nothing is lost by
    // dropping a time that was never meant. Any other instant keeps its whole ISO form.
    return raw.getTime() % 86_400_000 === 0 ? iso.slice(0, 10) : iso;
  }
  return typeof raw === 'string' ? raw : String(raw);
}
