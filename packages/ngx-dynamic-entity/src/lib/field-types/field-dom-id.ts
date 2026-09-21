/**
 * DOM ids that survive being rendered more than once.
 *
 * A field component used to derive its control's id straight from `field.id`. That is unique
 * in a config and *not* unique in a document: an `array` field renders the same child fields
 * once per row, so a two-row Contacts array put two `#name` inputs on the page. `<label for>`
 * resolves to the first match in document order, so clicking the second row's label focused
 * the first row's input, and a screen reader read the same association twice. Duplicate ids on
 * focusable elements are also a WCAG failure in their own right.
 *
 * The fix is a counter, which is what Angular Material does for the same reason: the id stays
 * readable — `email-de7` — and is unique for the lifetime of the page. It is deliberately not
 * derived from the row index, because a field component is given exactly five inputs and none
 * of them says where it is; adding a sixth would change the contract every custom field type
 * implements.
 *
 * Ids are not a public contract. Address a control in a test through its `data-testid`, which
 * is stable, or through its label, which is what a user sees.
 */
let sequence = 0;

/** A token unique to one component instance, for the lifetime of the page. */
export function nextFieldInstanceId(): string {
  sequence += 1;
  return `de${sequence}`;
}

/**
 * `{fieldId}-{instance}{suffix}` — the field first, so the id still reads as the field it
 * belongs to when someone is looking at the DOM.
 *
 * `field` is undefined until the renderer assigns it, and a template can be checked once
 * before that happens.
 */
export function fieldDomId(field: { id?: string } | undefined, instance: string, suffix = ''): string {
  return `${field?.id ?? 'field'}-${instance}${suffix}`;
}

/**
 * The `aria-describedby` a control needs, given what is rendered beside it right now.
 *
 * A field can show two things under its control — the author's help text and, once touched, a
 * validation message — and a screen reader announces only what this attribute names. Three
 * field components named the error; the other sixteen named nothing at all, so their error
 * messages were on screen and silent. Help text would have inherited the same gap.
 *
 * Order matters: the hint describes the field and the error describes the attempt, so the hint
 * is read first. `null` rather than an empty string when there is nothing to describe — an
 * empty `aria-describedby` is a dangling reference, not an absent one.
 *
 * Shared rather than written into each of the twenty-one field components, because the rule is
 * the same everywhere and getting it wrong is invisible until somebody uses a screen reader.
 */
export function fieldDescribedBy(
  domId: (suffix?: string) => string,
  parts: { hint?: boolean; error?: boolean },
): string | null {
  const ids: string[] = [];
  if (parts.hint) ids.push(domId('-hint'));
  if (parts.error) ids.push(domId('-error'));
  return ids.length ? ids.join(' ') : null;
}
