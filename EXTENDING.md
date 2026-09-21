# Extending Dynamic Entity

Everything the library does is registered rather than built in, so most extension is a
provider call. This covers the seams a consumer actually needs on day two.

> Blocks fenced as `typescript` are complete and are compiled in CI against the published
> packages, so they cannot drift out of date. Blocks fenced as `ts` **in this file** are
> fragments that reference your own classes and are illustrative only.
>
> The same fence means something else in `README.md` and `packages/server/README.md`, where a
> `ts` block is a **Node** snippet compiled against `@dynamic-entity/server` — the Angular
> consumer project that checks everything else does not have that package installed.
> `CONTRIBUTING.md` carries the full table.

Contents: [how a field is addressed](#how-a-field-is-addressed) ·
[custom field types](#a-custom-field-type) · [validators](#custom-validators) ·
[validation messages](#validation-messages-and-i18n) · [file uploads](#file-uploads) ·
[entity references](#entity-references-and-cascades) · [lookup lists](#named-lookup-lists) ·
[markdown](#markdown) · [presentation defaults](#presentation-defaults) ·
[reading and driving the form](#reading-and-driving-the-form) ·
[schema migration](#schema-migration) · [styling](#styling) · [testing](#testing)

---

## How a field is addressed

Read this before the rest: `showWhen`, cascades, `autoPatch`, rules and the submitted
record all name fields, and they all use the model below.

**A field id is unique within its scope, not across the config.** A person may have a home
address and a work address, and both are naturally called `address`:

```json
{
  "entity": "people",
  "tabs": [
    { "id": "personal", "fields": [{ "id": "address", "type": "text" }] },
    { "id": "work",     "fields": [{ "id": "address", "type": "text" }, { "id": "deskNumber", "type": "text" }] }
  ]
}
```

That is valid. The two fields build separate controls and submit separately:

```json
{ "personal": { "address": "…" }, "work": { "address": "…", "deskNumber": "…" } }
```

### What opens a scope

A scope is the object a value nests under, and the record mirrors it exactly.

| Construct | Effect on scope |
|---|---|
| A tab | Adds its id — `policy` → `policy.sumInsured` |
| A tab with `flatData: true` | Adds **nothing**; its fields sit in the parent scope |
| A sub-tab | Nests under its parent — `incident.incidentDetails.incidentDate` |
| A `group` or `array` field | Adds its own id for its children — `settlement.lineItems.itemDescription` |

Everything else — a plain field on a `flatData` tab at the top level — sits at the root and
is addressed by its bare id.

### `refererField` is the address

Every field carries the resulting path in `refererField`. It is written for you when a
config is loaded, and the builder maintains it as you edit:

```json
{ "id": "address", "type": "text", "refererField": "work.address" }
```

Two fields may share `address`; only one is `work.address`.

### Naming a field in a reference

Anywhere the config points at a field — a `showWhen` key, `entityReference.parentField`, an
`autoPatch` target, a rule's `fieldId` or targets — the name may take either form:

| Form | Example | Use when |
|---|---|---|
| Bracketed path | `[work.address]` | Always. This is what the builder writes. |
| Bare id | `address` | The id exists in exactly one scope. |

Bare ids are **backward compatibility, not the recommended form**. Every config written
before paths existed uses them and keeps working, but a bare id stops naming anything the
moment a second scope reuses it, so nothing new should be authored that way.

### The failure this prevents

An ambiguous bare reference is not a silent misfire — `validateConfig` reports it, names
both scopes, and tells you what to write instead:

```
Ambiguous reference to "address": defined in personal and work.
Name it by path instead, as [personal.address]. This field will never show.
```

`dynamic-entity validate ./config.json` runs the same check, so a CI job catches it before
the config ships.

What remains an error is two fields sharing an id **in one scope**, because there they would
share a single control and a single record key, and the second would overwrite the first:

```
Duplicate field id "dup" (also at tabs[0].fields[0]).
Two fields in main would share one control and one record key.
```

---

## A custom field type

Two registrations, deliberately separate: the **renderer** needs a component, and the
**builder** needs metadata to show the type in its palette. Add only the first if you never
author schemas visually.

### 1. Write the component

Implement `DynamicFieldComponentContract`. The renderer creates the component dynamically and
assigns exactly these five inputs — nothing else.

```typescript
import { Component, Input } from '@angular/core';
import { AbstractControl, ReactiveFormsModule } from '@angular/forms';
import type { DynamicFieldComponentContract } from 'ngx-dynamic-entity';
import type { NestedFieldConfig } from '@dynamic-entity/core';
import { resolveLabel } from '@dynamic-entity/core';

@Component({
  selector: 'app-slider-field',
  standalone: true,
  imports: [ReactiveFormsModule],
  template: `
    <div class="ngx-field ngx-field--slider">
      <label class="ngx-field__label" [attr.for]="field.id">{{ label }}</label>
      @if (masked) {
        <span class="ngx-field__value ngx-field__value--masked">XXXXXXXXX</span>
      } @else {
        <input
          [id]="field.id"
          type="range"
          class="ngx-field__input"
          [formControl]="$any(control)"
          [attr.disabled]="readonly ? true : null"
        />
      }
    </div>
  `,
})
export class SliderFieldComponent implements DynamicFieldComponentContract {
  @Input() field!: NestedFieldConfig;
  @Input() control!: AbstractControl;
  @Input() language = 'en';
  @Input() readonly = false;
  @Input() masked = false;

  get label(): string {
    return resolveLabel(this.field.label, this.language);
  }
}
```

Three things that are easy to get wrong:

- **Declare inputs with definite assignment** (`field!: …`) or an initialiser. They are set
  through `ComponentRef.setInput()` after construction, so they really are undefined until
  the first assignment.
- **`masked` means do not display the value.** Render a placeholder. This is presentational —
  the real value stays in the control and is submitted, so it is not an access boundary.
- **`readonly` means render as text or disable the control**, not that the value is absent.

### 2. Register it with the renderer

```ts
provideFieldTypes({ slider: SliderFieldComponent });
```

Calls merge and later registrations win on a key collision, so this also **overrides a
built-in**:

```ts
provideFieldTypes({ text: MyOwnTextFieldComponent });
```

Registering only what you use is what keeps unused field components out of the bundle.
`provideBuiltInFieldTypes()` is a convenience that pulls in all eighteen.

If a config names a type with no registered component, the field renders nothing and the
renderer warns once per type in dev mode, naming the type and the fix.

### 3. Optionally, tell the builder about it

```typescript
import { registerFieldType } from '@dynamic-entity/core';

registerFieldType({
  type: 'slider' as never, // not in the built-in RichFieldType union
  label: 'Slider',
  icon: 'tune',
  description: 'Numeric value chosen on a track',
  idPrefix: 'slider',
  hasOptions: false,
  isEntityRef: false,
  flagValidators: ['required'],
  paramValidators: ['min', 'max'],
  supportsDefaultValue: true,
  supportsPlaceholder: false,
});
```

Call it once at startup, before the builder renders. It affects the palette,
`getFieldTypeMeta` and `createFieldConfig`; it does not register a component.

---

## Custom validators

Register by name, then name them from a schema:

```ts
provideNgxDynamicEntity({
  validators: {
    noShouting: (control: AbstractControl) =>
      /[A-Z]{4,}/.test(String(control.value ?? '')) ? { shouting: true } : null,
  },
});
```

```typescript
import type { NestedFieldConfig } from '@dynamic-entity/core';

const headlineField: NestedFieldConfig = {
  id: 'headline',
  type: 'text',
  label: { en: 'Headline' },
  validators: { required: true, custom: ['noShouting'] },
};
```

An unknown name is ignored rather than throwing, so a schema referencing a validator you have
not registered yet still renders.

### Async validators

For checks that need a server — uniqueness, availability, a remote rule:

```ts
provideNgxDynamicEntity({
  asyncValidators: {
    uniqueEmail: (control: AbstractControl) =>
      http.get<boolean>(`/api/email-taken?v=${control.value}`).pipe(
        map(taken => (taken ? { taken: true } : null)),
      ),
  },
});
```

```ts
validators: { required: true, customAsync: ['uniqueEmail'] }
```

A separate key from `custom` because Angular treats them differently: async validators run
only once the synchronous ones pass, and hold the control in `pending` while they do. The
form cannot be submitted while anything is pending — `submitBlocked`, `submitDisabled` and
`isValidating` all reflect it — so there is no window in which a half-checked record can be
saved, and Save is genuinely unavailable for that window rather than merely refusing.

**Name one that is not registered and it is dropped.** The renderer warns once per name in
dev mode, because for an async uniqueness check the alternative is a duplicate saved with
nothing anywhere having said so. To catch it before it ships, hand `validateConfig` the names
you registered:

```ts
validateConfig(config, { knownValidators: ['noShouting', 'uniqueEmail'] });
```

or `npx dynamic-entity validate config.json --validators noShouting,uniqueEmail` in CI. The
built-ins the registry resolves on its own — `required`, `email`, and `min:`/`max:`/
`minLength:`/`maxLength:` with a numeric argument — never need listing.

---

## Validation messages and i18n

Labels, placeholders and options are `LocalizedText` and follow the `language` input. Error
messages have their own registry:

```ts
provideNgxDynamicEntity({
  validationMessages: {
    required: lang => (lang === 'de' ? 'Pflichtfeld.' : 'This field is required.'),
    minlength: (lang, err) =>
      lang === 'de'
        ? `Mindestens ${err.requiredLength} Zeichen.`
        : `Minimum ${err.requiredLength} characters required.`,
  },
});
```

Keys are Angular error keys (`required`, `email`, `pattern`, `minlength`, `maxlength`, `min`,
`max`) plus `requiredSelection`, `invalid`, `invalidNumber` and `invalidSelection`. A value is
a string or `(language, error) => string`. Unlisted keys keep their English default, so
overriding one does not mean supplying them all.

### The library's own chrome

`Save`, `Reset`, `No rows yet.` and the forty-odd other strings the renderer prints itself
were English literals in the templates, so an application in German rendered German labels
around English buttons. They resolve through `UI_TEXT`.

The library does no translating. It publishes the keys it renders and resolves whatever you
hand back, per key — overriding three buttons does not mean supplying the other forty-six,
and a value that comes back empty falls through to English rather than rendering a blank
control. Three accepted forms:

**`LocalizedText` per key.** The shape the config already uses, resolved against the form's
`language` by the same function that resolves the label beside it:

```typescript
import { provideNgxDynamicEntity } from 'ngx-dynamic-entity';

export const germanChrome = provideNgxDynamicEntity({
  uiText: {
    save: { en: 'Save', de: 'Speichern' },
    reset: { en: 'Reset', de: 'Zurücksetzen' },
    noRows: { en: 'No rows yet.', de: 'Noch keine Zeilen.' },
  },
});
```

**Flat strings.** One language, or a host that re-provides on switch:

```typescript
import { provideNgxDynamicEntity } from 'ngx-dynamic-entity';

export const oneLanguage = provideNgxDynamicEntity({ uiText: { save: 'Speichern' } });
```

**A resolver.** For an existing i18n layer — ngx-translate, Transloco, `$localize` — whose
catalogue is language-first (`de.json`) and which already holds its own idea of the current
language:

```typescript
import { UI_TEXT } from 'ngx-dynamic-entity';

/** Whatever your app already translates through. */
declare const translate: { instant(key: string): string };

export const uiTextProvider = {
  provide: UI_TEXT,
  useValue: (key: string, defaultText: string) => translate.instant(`dynamicEntity.${key}`) || defaultText,
};
```

It is read during change detection, so it must be synchronous and cheap.

`DEFAULT_UI_TEXT` is exported — every key with its English source string, so a translation
file can be generated from it rather than transcribed by hand. `UiTextKey` is the key union,
which makes a mistyped key a compile error instead of a blank button.

#### Sentences with a value in them

A sentence containing a value travels as one string, because word order moves between
languages and fragments joined in a template cannot be translated:

```typescript
import { provideNgxDynamicEntity } from 'ngx-dynamic-entity';

export const bannerText = provideNgxDynamicEntity({
  uiText: {
    criticalFieldChanged: {
      en: '🔒 Critical field changed: {fields} — this differs from the value at the start of this session.',
      de: '🔒 Kritisches Feld geändert: {fields} — Abweichung vom Wert zu Sitzungsbeginn.',
    },
  },
});
```

The `{placeholder}` slots are filled wherever the translation puts them. One with no matching
value is left as written, so a wrong name shows on screen rather than silently blanking.

### The builder's chrome

Same contract, deliberately a separate vocabulary: `BUILDER_TEXT`, `DEFAULT_BUILDER_TEXT`,
`BuilderTextKey`, `BuilderTextService`. An application shipping only the renderer should not
see a hundred and fifty builder keys in completion. What the two share is `resolveUiText`,
the resolution rule itself.

```typescript
import { BUILDER_TEXT } from 'ngx-dynamic-entity-builder';

export const builderTextProvider = {
  provide: BUILDER_TEXT,
  useValue: { save: { en: 'Save', de: 'Speichern' } },
};
```

The builder has two languages on screen at once, and they are not the same thing:

```html
<ngx-entity-builder [uiLanguage]="'de'" [languages]="['en', 'de']" />
```

`languages` is the vocabulary a label is **authored** in; `uiLanguage` is the language the
builder's own interface is in. Switching the label language you are editing should not
translate the panel around it.

---

## File uploads

Without a handler, `image` and `file` fields store `{ file, name, size, mimeType }` and leave
uploading to you at submit time. With one, they upload immediately and store the returned URL:

```typescript
import { UPLOAD_HANDLER } from 'ngx-dynamic-entity';
import type { UploadResult } from '@dynamic-entity/core';

declare const uploadService: { put(file: File): Promise<UploadResult> };

export const uploadProvider = {
  provide: UPLOAD_HANDLER,
  useFactory: () => (file: File) => uploadService.put(file), // UploadResult | Promise | Observable
};
```

An `UploadResult` is `{ url, name? }`. A rejection surfaces as an error on the field and the
control keeps its previous value.

---

## Entity references and cascades

An `entity-ref` field takes its options from a registered loader:

```ts
provideNgxDynamicEntity({
  entityRefs: {
    countries: () => http.get<ReferenceOption[]>('/api/countries'),
    cities: ctx => http.get(`/api/cities?country=${ctx?.parentValue ?? ''}`),
  },
});
```

A loader receives `{ parentValue, filters, lang }` and may return an array, a Promise or an
Observable. `ctx` is optional, so a zero-argument loader is a valid registration.

For a cascade, name the parent field in the schema:

```typescript
import type { NestedFieldConfig } from '@dynamic-entity/core';

const cityField: NestedFieldConfig = {
  id: 'city',
  type: 'entity-ref',
  label: { en: 'City' },
  entityReference: { enabled: true, linkedEntityKey: 'cities', parentField: 'country' },
};
```

A cascading child holds until its parent has a value rather than loading the unfiltered list.

---

## Presentation defaults

Two things the library prints were literals until they were asked about, so neither could be
changed. Both keep their previous default: an unconfigured install looks exactly as it did.

### What a masked field shows

Masking is presentational (see [Security](README.md#-security)), and the text it prints is a
product decision — bullets read as a redaction, a word reads as a permission, and English
reads as neither if your app is not in English.

```typescript
import { ApplicationConfig } from '@angular/core';
import { MASKED_PLACEHOLDER, provideNgxDynamicEntity } from 'ngx-dynamic-entity';

export const appConfig: ApplicationConfig = {
  providers: [
    provideNgxDynamicEntity({}),
    { provide: MASKED_PLACEHOLDER, useValue: '••••••••' },
  ],
};
```

Defaults to `XXXXXXXXX`.

### How dates are formatted

`date`, `datetime` and `time` display through `toLocaleDateString` and friends in the
**browser's** locale, not the form's `language`. That is deliberate: `language` selects which
`LocalizedText` key to read, which is a different question from how to punctuate a date, and
tying them together would change the format for every consumer whose browser is set to
something else.

If your app does want them tied — or wants a fixed format — say so:

```typescript
import { setDateFormatters } from '@dynamic-entity/core';

setDateFormatters({
  date: (value, lang) => value.toLocaleDateString(lang ?? []),
});
```

A partial object overrides one kind and leaves the rest; calling `setDateFormatters()` with
no argument restores the defaults. It is module-level rather than an injection token because
`formatDisplayValue` is a pure function in a framework-agnostic package — the renderer, the
builder and the CLI all call it, and only one of those has an injector.

What it reaches: every read-only `date`, `datetime` and `time` field, and the record view's
summary panel. Until 1.10.0 the `date` and `datetime` *fields* formatted themselves, so
configuring formatters changed the summary and not the field — the two surfaces disagreed
about the same value.

`monthYear` is not covered, deliberately: it renders a month name and a year, and has no day
component to format.

---

## Markdown

The `markdown` field stores **markdown source**, never HTML. The record stays plain text —
diffable, portable, safe to log, and impossible to turn into stored XSS by writing it to a
database.

It works with no configuration: the editor is a textarea, and a read-only view shows the
source with its line breaks preserved and nothing interpreted. That is deliberate. These
packages declare no runtime dependencies beyond `tslib`, and a markdown parser is a large
thing to force on someone who wanted a form library.

To render it, provide one. Any function from source to HTML will do:

```typescript
import { ApplicationConfig } from '@angular/core';
import { MARKDOWN_RENDERER, provideNgxDynamicEntity } from 'ngx-dynamic-entity';

export const appConfig: ApplicationConfig = {
  providers: [
    provideNgxDynamicEntity({}),
    {
      provide: MARKDOWN_RENDERER,
      useValue: (source: string) => renderMarkdown(source),
    },
  ],
};

declare function renderMarkdown(source: string): string;
```

With a renderer the editor also gains Write and Preview tabs; without one there is no
Preview tab, because it could only ever show the source back.

**On safety.** The returned HTML is bound through `[innerHTML]`, so Angular's sanitizer
strips scripts and event handlers before anything reaches the DOM. Treat that as a backstop,
not a licence: configure your renderer to escape raw HTML in its input as well. Sanitizing
removes the dangerous parts *silently*, so an author who pastes a `<script>` is not told
their content was altered — they simply lose it.

A renderer is your code, and it may throw on input it dislikes. If it does, the field falls
back to showing the source rather than letting the exception take down the whole form.

---

## Named lookup lists

Shared master lists, resolved by name from `field.listName`:

```ts
provideNgxDynamicEntity({
  lookups: {
    employeeStatus: () => listService.getByName('employeeStatus'), // loader — preferred
    grades: ['Junior', 'Senior'],                                   // or the values themselves
  },
});
```

Prefer a loader for anything fetched: a bare Promise runs when the provider is built, so every
list would load whether or not a form uses it. Values may be plain strings, `LocalizedText`, or
the full `{ code, name, sortOrder }` shape.

---

## Aborting a save

A `${entity}:beforeSave` hook can veto:

```ts
provideNgxDynamicEntity({
  hooks: {
    'clients:beforeSave': async record => {
      const ok = await confirmService.ask('Save these changes?');
      return ok ? record : false;   // false aborts; the record replaces the payload
    },
  },
});
```

Returning `false` or throwing aborts the save: `formSubmit` does not fire, and
`(saveRejected)` emits `{ reason, error? }` instead. Returning `undefined` means "unchanged";
anything else becomes the submitted payload.

The hook governs **both** ways out of `ngx-dynamic-record-form` — the whole-record Save and
the per-tab "Save section" — and that component emits `(saveRejected)` for either. Bind it:
an aborted save with nothing listening looks exactly like a button that does nothing.

```html
<ngx-dynamic-record-form
  [config]="config"
  (formSubmit)="save($event)"
  (sectionSave)="saveSection($event)"
  (saveRejected)="explain($event.reason)"
/>
```

`sectionSave` carries the whole record plus the tab that was edited, so it is the same
payload `formSubmit` would have sent — which is why it is put to the same hook.

---

## Reading and driving the form

`DynamicFormComponent` exposes its internals deliberately:

```typescript
import { Component, ViewChild } from '@angular/core';
import { DynamicFormComponent } from 'ngx-dynamic-entity';

@Component({ selector: 'app-host', standalone: true, template: '' })
export class HostComponent {
  @ViewChild(DynamicFormComponent) form!: DynamicFormComponent;

  inspect(): void {
    this.form.form;                        // the underlying FormGroup
    this.form.extractRecord();             // the record in its persisted shape
    this.form.getControl('email', 'main'); // one control, by field id and optional tab id
    this.form.submit();                    // same path as the Save button
    this.form.reset();
    this.form.canView;                     // permissions.view for the current roles
    this.form.canDelete;                   // for gating your own delete affordance
    this.form.submitBlocked;               // form invalid, or a validation rule is failing
    this.form.submitDisabled;              // what the Save button binds: saving, or pending
    this.form.ruleValidationErrors;        // those rule errors, keyed by target id
    this.form.invalidFields();             // each invalid field, its message, and its tab
    this.form.jumpToField('email');        // switch to its tab, scroll to it, focus it
  }
}
```

**Record shape matters.** A record is nested by tab id unless the tab sets `flatData: true`,
in both directions. Passing a flat record to a nested tab populates nothing; the renderer warns
in dev mode naming the keys it could not place.

---

## Spreadsheet import

`<ngx-entity-import>` turns a CSV or spreadsheet into records. **It works with no backend and
nothing registered** — the file is read in the tab by a dependency-free parser and mapped by
`@dynamic-entity/core`. Two seams exist for the cases where that has to change, and they answer
different questions: `sheetParser` reads the file, `importTransport` decides *where the work
happens*. Collapsing them into one option would make each answer imply the other.

```typescript
import { provideNgxDynamicEntity } from 'ngx-dynamic-entity';
import type { SheetData } from '@dynamic-entity/core';

declare const XLSX: {
  read(data: ArrayBuffer): { SheetNames: string[]; Sheets: Record<string, unknown> };
  utils: { sheet_to_json(sheet: unknown, options: unknown): unknown[][] };
};

export const importProviders = [
  provideNgxDynamicEntity({
    // Only needed for formats beyond CSV. Rows are positional, never keyed by header: a real
    // sheet has two columns both called "Notes", and a header-keyed row loses one of them.
    sheetParser: async (file: File): Promise<SheetData> => {
      const workbook = XLSX.read(await file.arrayBuffer());
      const rows = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], {
        header: 1,
        raw: true,
        defval: '',
      });
      return { headers: (rows[0] ?? []) as string[], rows: rows.slice(1) as string[][] };
    },
  }),
];
```

`raw: true` rather than `raw: false`, deliberately. A date cell should arrive as a `Date`, and
`coerceCell` reads a typed cell by its **UTC** components — a spreadsheet date is a calendar
date with no zone, which is exactly why it is stored at UTC midnight. Stringify it first and
you get *local* time, which moves every date back a day for anyone west of Greenwich.

### The column contract

What a sheet may carry is **derived from the config, never authored**. `deriveImportColumns`
walks it and produces one `ImportColumn` per field a cell can hold; anything it cannot hold
comes back in `unsupported`, with a reason, rather than being silently dropped.

A column's `ref` is the field's address in the record — the same dotted string `refOf` produces
and the same one a rule names. There is one address language in this library, not two.

```typescript
import { deriveImportColumns } from '@dynamic-entity/core';
import type { EntityFormConfig } from '@dynamic-entity/core';

declare const config: EntityFormConfig;

const { columns, unsupported } = deriveImportColumns(config, { lang: 'en' });
// columns[0].ref  — 'work.address', or 'contacts.0.email' for a repeating field
// unsupported[0]  — { ref, field, reason: 'An image is a file reference, …' }
```

`image` and `file` fields are always unsupported: a cell cannot carry a file reference. Fields
marked `readonly` or `systemDefault` are left out of a *suggestion* — nobody maps a column onto
a field the form fills in — but included when a plan is applied, so a stored plan may target
one deliberately.

### Repeating fields, and `maxArrayRows`

A flat sheet cannot express an unbounded repeating list, so an `array` field is unrolled into
numbered columns: `contacts.0.email`, `contacts.1.email`, `contacts.2.email`. **`maxArrayRows`
is where that stops, and it defaults to 3.** Raising it multiplies the column count by the
array's child count, which is why the default is small.

A field inside an array *inside another array* gets no columns at all — the count would be the
product of both limits, and a template nobody can read is not a template. It is reported as
`unsupported`, so the gap is visible rather than mysterious.

**Never pass `maxArrayRows` when applying a plan.** `applyMapping` reads the bound out of the
plan's own refs. That parameter used to be the caller's to supply and was a source of silent
data loss: a plan authored for five rows, applied with the default three, had two of its
columns quietly discarded and reported a clean import. The information was in the plan all
along, and asking for it again is what created the chance to disagree.

The template picker offers a repeating field **once**, as `contacts.email`, and
`buildTemplateSpec` matches a column by its ref *or* by its ref with row numbers stripped.
Selecting one selects every row.

### What an import checks, and what it cannot

`validateImportedRecord` runs the **rules engine as well as the field validators**, because
that is the renderer's actual contract: a `validation` rule attaches an error, and a
`visibility` rule hides a field, which must relax its `required`. Checking only the validators
would both accept records the form rejects and reject records the form accepts — a required
field hidden by a rule being the case that bites first.

So pass the rules. A wizard given none checks field validators only:

```html
<ngx-entity-import [config]="config" [rules]="rules" (importComplete)="save($event)" />
```

**The parity gap, stated rather than left to be discovered:** `validators.custom` and
`validators.customAsync` name functions in the renderer's Angular registries, which a
framework-agnostic engine has no way to call. Parity here means "everything the schema and the
rules express", not "everything the form enforces". If a custom validator is load-bearing for
correctness rather than convenience, register an equivalent on whichever side runs the import —
or re-check on save, which you should be doing regardless.

### Duplicates are yours

**Nothing here deduplicates.** An `EntityFormConfig` has no natural-key concept, so the library
has nothing to deduplicate *on*: it cannot know whether two rows with the same email are the
same person. Importing the same file twice produces two sets of records.

`importComplete` is where you decide, and where an upsert belongs — it is the only place that
knows what your keys are.

### Running the import on a server

The default transport reads the file into memory whole, which is right for a sheet somebody
assembled by hand and wrong for a fifty-thousand-row export. `@dynamic-entity/server` streams
instead, and the wizard components do not change at all — they already talk to a transport:

```typescript
import { provideNgxDynamicEntity, provideHttpImportTransport } from 'ngx-dynamic-entity';

export const serverImportProviders = [
  provideNgxDynamicEntity({}),
  provideHttpImportTransport({ baseUrl: '/api/import' }),
];
```

The engine underneath is the same pure code either way, which is what keeps a client-side
import and a server-side one from disagreeing about what they produced. Three things do change,
and each is a consequence of crossing a network rather than a defect:

- **`result.records` is empty and `result.imported` is the count.** The server streamed the file
  precisely so that fifty thousand records never existed at once; sending them back would undo
  that. Read `imported ?? records.length`, and `failed` for the rows that did not make it —
  never the distinct rows in `errors`, which is a capped sample and will under-report.
- **An import is not transactional.** A failure part-way leaves the rows before it written, and
  over HTTP a retry is likely rather than possible, so your writer must be idempotent.
  `POST /:entity/validate` runs the identical pipeline and writes nothing, which is how a user
  sees every problem before anything is stored.
- **The two engines are separately deployed.** `MappingPlan.configVersion` catches config drift
  and says nothing about engine drift, so the transport compares `CORE_VERSION` and warns when
  the halves are a minor version apart.

One thing is *gained*: `[templateFormat]="'xlsx'"` on `<ngx-entity-import>` writes a real
workbook instead of a CSV.

```html
<ngx-entity-import [config]="config" [rules]="rules" [templateFormat]="'xlsx'" />
```

`LocalImportTransport` **refuses** `xlsx` rather than writing a CSV under an `.xlsx` name — a
file that opens wrong in Excel is worse than a download that did not happen, because the user
finds out later and somewhere else. So the input is safe to bind unconditionally: with no
transport registered the wizard says it can only write CSV, and with a server transport the
same input produces the workbook. The demo's import page has a format picker that shows both
answers.

### A transport of your own

`ImportTransport` is three methods, and a backend that is not Express implements them against
the framework-neutral half of `@dynamic-entity/server` — `previewSheet`, `runImport` and
`writeTemplate`, none of which import an HTTP type.

```typescript
import { IMPORT_TRANSPORT } from 'ngx-dynamic-entity';
import type { ImportTransport } from 'ngx-dynamic-entity';

declare const mine: ImportTransport;

export const customTransport = [{ provide: IMPORT_TRANSPORT, useValue: mine }];
```

- `preview(file, context)` → headers, a sample as text, a suggested `MappingPlan`, a row count.
- `commit(file, plan, context)` → an `ImportResult`.
- `template(spec, format, context, fields?)` → a `Blob`. `spec` is the selection already
  expanded against the config; `fields` is the selection itself, which is what a server wants —
  it has the config, so only the choice needs to cross the wire.

The wire shapes — `ImportPreviewResponse`, `ImportCommitResponse`, `ImportErrorResponse` — live
in `@dynamic-entity/core` as plain interfaces with no HTTP in them, because both sides need them
and core is the only thing both already depend on. On a response the counts reconcile:
`imported + skipped + failed === rowsRead`.

## Schema migration

See the [Schema versioning](README.md#-schema-versioning) section of the README.
`migrateRecord`, `needsMigration`, `stampRecord` and `validateMigrations` are exported from
`@dynamic-entity/core` and are pure, so the same steps run on a server.

---

## Styling

The renderer ships no styles by default — components emit BEM-style hooks
(`ngx-field`, `ngx-field__input`, `ngx-form__tabs`, `ngx-record-editor__header`, …) and
nothing else. An optional base stylesheet is included:

```css
@import 'ngx-dynamic-entity/styles.css';
```

It is driven by custom properties scoped to `.ngx-form` / `.ngx-record-editor`, so theming
usually means redefining a few variables rather than overriding rules:

```css
.ngx-form,
.ngx-record-editor {
  --ngx-color-accent: #6d28d9;
  --ngx-radius: 10px;
  --ngx-control-height: 44px;
}
```

Declare them on both selectors, not on `:root`: the stylesheet scopes its own tokens to those
two, which is what keeps importing it from leaking into the rest of your app — and also means
a `:root` override never wins.

Dark mode follows `prefers-color-scheme` out of the box; redeclare the palette under your own
selector to pin it either way.

Two behaviours are opt-in:

- **`ngx-form-sticky-actions`** on a wrapper keeps the Save/Reset bar in view down a long
  form. It is opt-in because `position: sticky` resolves against the nearest scrolling
  ancestor — a form embedded in the middle of a longer page would detach its bar and float it
  over whatever is below. Add the class when the form owns the scroll.
- **`layout="auto"`** on the component sizes a field with no `colSpan` of its own by its type
  rather than giving it the full row. An authored `colSpan` still wins.

The renderer has no Angular Material dependency. **The builder does**, and also needs
`provideAnimations()`.

---

## Testing

Field components are standalone, so a unit test needs no library module:

```ts
await TestBed.configureTestingModule({
  imports: [SliderFieldComponent, ReactiveFormsModule],
}).compileComponents();

const fixture = TestBed.createComponent(SliderFieldComponent);
fixture.componentInstance.field = { id: 'volume', type: 'slider' as never, label: { en: 'Volume' } };
fixture.componentInstance.control = new FormControl(50);
fixture.detectChanges();
```

Testing a component that hosts `ngx-dynamic-form` needs the field types registered, or it
renders no fields:

```ts
await TestBed.configureTestingModule({
  imports: [MyHostComponent],
  providers: [provideNgxDynamicEntity({}), provideBuiltInFieldTypes()],
}).compileComponents();
```

To assert on a specific field, every field renders `data-testid="field-<id>"`, with
`-input`, `-value`, `-masked` and `-error` suffixes for its parts.
