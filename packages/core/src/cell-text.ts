/**
 * cell-text.ts — how a typed cell is rendered when text is what has to be shown or sent.
 *
 * Since 3.0 the rule is sheet-to-schema's, which the browser and the server both run, so
 * there is still one place for the date rule to be right.
 */

import { cellText as importerCellText } from 'sheet-to-schema';

/**
 * Render a cell as the text a mapping screen shows.
 *
 * It mirrors `coerceTypedCell`'s date rule on purpose. A preview sample is text, and the
 * preview then runs `coerceCell` over that text, so if this rendered a `Date` with `String()`
 * the preview would show — and coerce — a different day from the one the import will store.
 *
 * @deprecated Import `cellText` from `sheet-to-schema`. Removed in 4.0.
 */
export const cellText = importerCellText;
