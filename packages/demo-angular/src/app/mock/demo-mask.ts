/**
 * The one mask string this demo shows, wherever a masked value appears.
 *
 * Its own module, with no imports, so the Playwright suite can read the same constant the
 * application does rather than repeating the literal in four assertions.
 *
 * There are two independent things called masking here, and they must not print
 * differently or the demo teaches the wrong model:
 *
 *   - `MASKED_PLACEHOLDER` (renderer) is **presentation**. The form holds the real value and
 *     declines to display it. This is not an access-control boundary — see SECURITY.md.
 *   - `LocalStore.applyMask` is a **mock server** withholding a value: the record handed to
 *     the list never contains it.
 *
 * The point of the feature is precisely that the first is not the second, and a visitor can
 * only compare them if both render the same string. `XXXXXXXXX` remains the *library*
 * default for an unconfigured install; this is what this application chose instead.
 */
export const DEMO_MASK = '••••••••';
