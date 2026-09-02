import { Injectable, inject } from '@angular/core';
import { resolveLabel, type LocalizedText } from '@dynamic-entity/core';
import { UI_TEXT } from '../tokens/injection-tokens';

/** `{name}` — the slot a `UiTextParams` entry fills. */
const PLACEHOLDER = new RegExp('[{]([a-zA-Z0-9_]+)[}]', 'g');

/**
 * Every word this library puts on screen that does not come from a config.
 *
 * Field labels, placeholders and options are `LocalizedText` and already follow the form's
 * `language`. The library's *own* chrome — Save, Reset, "No rows yet." — was English
 * literals in twenty-odd templates, so an application in German rendered German labels
 * around English buttons. There was no way to change them short of forking a component.
 *
 * This map is the whole surface: the keys are what a host translates, and the values are
 * the English source strings to translate *from*. It is exported so a translation file can
 * be generated from it rather than transcribed by hand.
 *
 * Keys are grouped by where they appear rather than alphabetically, because a translator
 * works screen by screen and a list sorted by name hides which strings sit together.
 */
export const DEFAULT_UI_TEXT = {
  // Form actions
  save: 'Save',
  saving: 'Saving…',
  reset: 'Reset',
  saveShortcutHint: 'Shortcut: Ctrl+S',
  loading: 'Loading…',

  // Record view — the per-tab edit flow
  editSection: 'Edit section',
  saveSection: 'Save section',
  editingSection: 'Editing this section',
  cancel: 'Cancel',
  edit: 'Edit',
  delete: 'Delete',

  // Array rows
  addRow: '+ Row',
  addItem: '+ Add Item',
  itemNumber: 'Item #{number}',
  addRowTitle: 'Add {field} row',
  editRowTitle: 'Edit {field} row',
  saveRow: 'Save row',
  remove: 'Remove',
  noRows: 'No rows yet.',
  noItems: 'No items added yet.',

  // Choice fields
  selectPlaceholder: 'Select...',
  selectParentFirst: 'Select {field} first.',

  // Boolean and checkbox display
  yes: 'Yes',
  no: 'No',

  // Files and images
  uploading: 'Uploading…',
  chooseFile: 'Choose file',
  replaceFile: 'Replace file',
  removeFile: 'Remove file',
  downloadFile: 'Download file',
  noImage: 'No image',
  uploadImage: 'Upload',
  changeImage: 'Change',

  // Month / year pickers
  month: 'Month',
  year: 'Year',

  // Markdown editor
  write: 'Write',
  preview: 'Preview',
  markdownEditorMode: '{label} editor mode',

  // Accessible names for icon-only controls
  showPassword: 'Show password',
  hidePassword: 'Hide password',
  lockField: 'Lock {field}',
  unlockField: 'Unlock {field}',
  criticalFieldLockHint: 'Critical field — click to lock',
  criticalFieldUnlockHint: 'Critical field — click to unlock for editing',
  dismissBanner: 'Dismiss: {message}',
  jumpToField: 'Click to jump to {field}',

  // Banners and whole-record states
  entityLabel: 'Entity: {entity}',
  criticalFieldChanged: '🔒 Critical field changed: {fields} — this differs from the value at the start of this session.',
  recordModified: '🔒 Record modified from session baseline — unsaved changes pending.',
  accessDenied: 'You do not have permission to view this record.',
};

/**
 * The keys above, as a union. Templates are checked against it, so a mistyped key is an
 * AOT error rather than a blank button, and a host writing overrides gets completion.
 */
export type UiTextKey = keyof typeof DEFAULT_UI_TEXT;

/**
 * One replacement: a plain string, or the same `LocalizedText` map a config uses for a
 * field label — `{ en: 'Save', de: 'Speichern' }`, resolved against the form's `language`
 * by the very function that resolves the labels beside it.
 */
export type UiTextValue = string | LocalizedText;

/**
 * Asked for one key at render time, given the English default to fall back on and the
 * form's active language.
 *
 * This is the seam for an existing i18n setup — `$localize`, ngx-translate, Transloco —
 * whose catalogue is language-first (`de.json`) rather than key-first, and which already
 * holds its own idea of the current language. Take `language` or ignore it accordingly.
 */
export type UiTextResolverFor<K extends string> = (key: K, defaultText: string, language: string) => string;

/** The resolver for this library's own keys. */
export type UiTextResolver = UiTextResolverFor<UiTextKey>;

/**
 * Values substituted into a `{placeholder}` in the text.
 *
 * A sentence with a name in the middle has to travel as one string: word order moves
 * between languages, so splitting it into fragments around an interpolation produces
 * grammatical nonsense in the ones it was not written for.
 */
export type UiTextParams = Record<string, string | number>;

/** Either a partial map of replacements, or a resolver that answers per key. */
export type UiTextOverridesFor<K extends string> = Partial<Record<K, UiTextValue>> | UiTextResolverFor<K>;

/** The overrides for this library's own keys. */
export type UiTextOverrides = UiTextOverridesFor<UiTextKey>;

/**
 * The resolution rule itself, over any key vocabulary.
 *
 * Exported because the builder package renders a second, disjoint set of words and needs
 * the same rule — overrides first, then the English default, per key, with `{placeholder}`
 * substitution. Sharing the function rather than the vocabulary is what keeps a renderer
 * consumer from seeing a hundred and fifty builder keys in completion.
 */
export function resolveUiText<K extends string>(
  overrides: UiTextOverridesFor<K> | null | undefined,
  defaults: Readonly<Record<K, string>>,
  key: K,
  language: string,
  params?: UiTextParams,
): string {
  const fallback = ownString(defaults, key);
  const resolved = !overrides
    ? fallback
    : typeof overrides === 'function'
      ? askResolver(overrides, key, fallback, language)
      : // `resolveLabel` handles a bare string at runtime but does not say so in its
        // signature, so the branch is taken here rather than leaning on an undeclared one.
        resolveOne(own<UiTextValue | undefined>(overrides, key), language) || fallback;

  return interpolate(resolved, params);
}

/**
 * An **own** entry, or `undefined`.
 *
 * `map[key]` walks the prototype chain, so `toString` answers with `Function` and
 * `__proto__` with `Object.prototype` — neither of which is a string, and both of which
 * reach `interpolate` and then a template. The key type rules that out in TypeScript; a key
 * arriving from a translation catalogue at runtime, or from a host written in JavaScript,
 * does not.
 */
function own<T>(map: Partial<Record<string, T>>, key: string): T | undefined {
  return Object.prototype.hasOwnProperty.call(map, key) ? map[key] : undefined;
}

function ownString<K extends string>(defaults: Readonly<Record<K, string>>, key: K): string {
  const value = own(defaults as Record<string, unknown>, key);
  return typeof value === 'string' ? value : '';
}

/**
 * A resolver runs inside change detection, once per label per pass, in someone else's code.
 *
 * If it throws, the exception surfaces from a template expression and the form does not
 * render at all — every form in the application, over one bad catalogue entry. Falling back
 * to English is the same answer this function already gives for a resolver that returns
 * nothing, and it keeps a translation fault a translation fault rather than an outage.
 */
function askResolver<K extends string>(resolver: UiTextResolverFor<K>, key: K, fallback: string, language: string): string {
  try {
    const answer = resolver(key, fallback, language);
    return typeof answer === 'string' && answer ? answer : fallback;
  } catch {
    return fallback;
  }
}

function resolveOne(value: UiTextValue | undefined, language: string): string {
  if (typeof value === 'string') return value;
  const resolved = resolveLabel(value, language);
  // `resolveLabel` is typed to return a string and does, for every shape it is documented
  // to take. A host handing it a number reaches `Object.values(42)`, which is empty.
  return typeof resolved === 'string' ? resolved : '';
}

/**
 * Resolves the library's own UI text, honouring `UI_TEXT` before the defaults.
 *
 * Resolution is per key, not all-or-nothing, so a host replacing three buttons does not
 * have to supply the other thirty — and an override that yields nothing for a key still
 * renders English rather than a gap, which is what a translation catalogue asked for a
 * missing entry typically hands back.
 */
@Injectable({ providedIn: 'root' })
export class UiTextService {
  private readonly overrides = inject(UI_TEXT, { optional: true });

  /**
   * One label by key, in `language`; English if nothing overrides it. `params` fill the
   * `{placeholder}` slots, in whatever position the translation puts them.
   */
  text(key: UiTextKey, language = 'en', params?: UiTextParams): string {
    return resolveUiText(this.overrides, DEFAULT_UI_TEXT, key, language, params);
  }
}

/** A placeholder with no matching param is left as written, which is visible in review. */
function interpolate(text: string, params?: UiTextParams): string {
  if (!params) return text;
  // `name in params` would answer for `toString` and `constructor` too, substituting a
  // function body into a sentence. Only what the caller actually passed counts.
  return text.replace(PLACEHOLDER, (match, name) => {
    const value = own(params as Record<string, unknown>, name);
    return value === undefined || value === null ? match : String(value);
  });
}
