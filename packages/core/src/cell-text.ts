/**
 * cell-text.ts — how a typed cell is rendered when text is what has to be shown or sent.
 *
 * In core, not in each transport, because the browser and the server both render samples and
 * a second copy would be a second place for the date rule to be wrong.
 */

/**
 * Render a cell as the text a mapping screen shows.
 *
 * It mirrors `coerceTypedCell`'s date rule on purpose. A preview sample is text, and the
 * preview then runs `coerceCell` over that text, so if this rendered a `Date` with `String()`
 * the preview would show — and coerce — a different day from the one the import will store.
 * That is a preview lying about the only thing it exists to show, wrong by exactly one day,
 * silently, and only for users at a negative UTC offset.
 */
export function cellText(raw: unknown): string {
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
