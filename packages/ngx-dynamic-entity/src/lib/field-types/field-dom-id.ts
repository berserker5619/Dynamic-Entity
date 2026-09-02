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
