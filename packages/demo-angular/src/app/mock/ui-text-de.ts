import type { UiTextOverrides } from 'ngx-dynamic-entity';
import type { BuilderTextOverrides } from 'ngx-dynamic-entity-builder';

/**
 * A translation pack for the two libraries' own chrome.
 *
 * The libraries translate nothing themselves: they render a fixed set of keys and resolve
 * whatever a host provides. This file is what a host provides — the `LocalizedText` form,
 * which is the same shape a field label uses, so one provider covers both languages and the
 * form's `language` input picks between them. No re-providing on switch.
 *
 * Partial on purpose. Resolution is per key, so a key that is absent here still renders its
 * English default rather than a blank control — which is what makes it safe to translate a
 * screen at a time. `DEFAULT_UI_TEXT` and `DEFAULT_BUILDER_TEXT` list every key with its
 * English source string, so a full pack can be generated from them.
 */
export const DEMO_UI_TEXT: UiTextOverrides = {
  save: { en: 'Save', de: 'Speichern' },
  saving: { en: 'Saving…', de: 'Wird gespeichert…' },
  reset: { en: 'Reset', de: 'Zurücksetzen' },
  saveShortcutHint: { en: 'Shortcut: Ctrl+S', de: 'Tastenkürzel: Strg+S' },
  editSection: { en: 'Edit section', de: 'Abschnitt bearbeiten' },
  editingSection: { en: 'Editing this section', de: 'Dieser Abschnitt wird bearbeitet' },
  cancel: { en: 'Cancel', de: 'Abbrechen' },
  edit: { en: 'Edit', de: 'Bearbeiten' },
  delete: { en: 'Delete', de: 'Löschen' },
  addRow: { en: '+ Row', de: '+ Zeile' },
  saveRow: { en: 'Save row', de: 'Zeile speichern' },
  remove: { en: 'Remove', de: 'Entfernen' },
  noRows: { en: 'No rows yet.', de: 'Noch keine Zeilen.' },
  noItems: { en: 'No items added yet.', de: 'Noch keine Einträge.' },
  selectPlaceholder: { en: 'Select...', de: 'Auswählen…' },
  yes: { en: 'Yes', de: 'Ja' },
  no: { en: 'No', de: 'Nein' },
  chooseFile: { en: 'Choose file', de: 'Datei auswählen' },
  replaceFile: { en: 'Replace file', de: 'Datei ersetzen' },
  removeFile: { en: 'Remove file', de: 'Datei entfernen' },
  noImage: { en: 'No image', de: 'Kein Bild' },
  month: { en: 'Month', de: 'Monat' },
  year: { en: 'Year', de: 'Jahr' },
  write: { en: 'Write', de: 'Schreiben' },
  preview: { en: 'Preview', de: 'Vorschau' },
  showPassword: { en: 'Show password', de: 'Passwort anzeigen' },
  hidePassword: { en: 'Hide password', de: 'Passwort verbergen' },
  accessDenied: {
    en: 'You do not have permission to view this record.',
    de: 'Sie haben keine Berechtigung, diesen Datensatz zu sehen.',
  },
};

/**
 * The builder's chrome. A separate vocabulary from the renderer's, because an application
 * that ships only the renderer has no use for these keys — and the two lists share no
 * strings worth deduplicating.
 *
 * `{placeholder}` slots are filled wherever the translation puts them, which is the reason a
 * sentence with a value in it travels as one key: German puts the count in a different
 * position from English, and fragments joined in a template could not express that.
 */
export const DEMO_BUILDER_TEXT: BuilderTextOverrides = {
  builderTitle: { en: 'Entity Builder', de: 'Entitäten-Baukasten' },
  undo: { en: 'Undo', de: 'Rückgängig' },
  redo: { en: 'Redo', de: 'Wiederherstellen' },
  copyJson: { en: 'Copy JSON', de: 'JSON kopieren' },
  save: { en: 'Save', de: 'Speichern' },
  entityName: { en: 'Entity name', de: 'Name der Entität' },
  editingLanguage: { en: 'Editing language', de: 'Bearbeitungssprache' },
  permissions: { en: 'Permissions', de: 'Berechtigungen' },
  addField: { en: 'Add field', de: 'Feld hinzufügen' },
  fieldProperties: { en: 'Field properties', de: 'Feldeigenschaften' },
  configJson: { en: 'Config JSON', de: 'Konfigurations-JSON' },
  fieldsHeading: { en: 'Fields ({count})', de: '{count} Felder' },
  canvasEmpty: {
    en: 'No fields yet. Pick a type from Add field to get started.',
    de: 'Noch keine Felder. Wählen Sie unter „Feld hinzufügen" einen Typ aus.',
  },
  required: { en: 'Required', de: 'Pflichtfeld' },
  moveUp: { en: 'Move up', de: 'Nach oben' },
  moveDown: { en: 'Move down', de: 'Nach unten' },
  duplicate: { en: 'Duplicate', de: 'Duplizieren' },
  delete: { en: 'Delete', de: 'Löschen' },
  inspectorEmpty: {
    en: 'Select a field to edit its properties.',
    de: 'Wählen Sie ein Feld aus, um seine Eigenschaften zu bearbeiten.',
  },
  fieldId: { en: 'Field id', de: 'Feld-ID' },
  tab: { en: 'Tab', de: 'Registerkarte' },
  validation: { en: 'Validation', de: 'Validierung' },
  options: { en: 'Options', de: 'Optionen' },
};
