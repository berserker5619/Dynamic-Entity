# Extending Dynamic Entity

Everything the library does is registered rather than built in, so most extension is a
provider call. This covers the seams a consumer actually needs on day two.

> Blocks fenced as `typescript` are complete and are compiled in CI against the published
> packages, so they cannot drift out of date. Blocks fenced as `ts` are fragments that
> reference your own classes and are illustrative only.

Contents: [custom field types](#a-custom-field-type) · [validators](#custom-validators) ·
[validation messages](#validation-messages-and-i18n) · [file uploads](#file-uploads) ·
[entity references](#entity-references-and-cascades) · [lookup lists](#named-lookup-lists) ·
[reading and driving the form](#reading-and-driving-the-form) ·
[schema migration](#schema-migration) · [styling](#styling) · [testing](#testing)

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

> **Async validation is not supported.** There is no async validator registry, and the
> `${entity}:beforeSave` hook cannot reject — its return value replaces the payload and the
> save proceeds. Validate asynchronously in your own submit handler.

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
    this.form.ruleValidationErrors;        // those rule errors, keyed by target id
  }
}
```

**Record shape matters.** A record is nested by tab id unless the tab sets `flatData: true`,
in both directions. Passing a flat record to a nested tab populates nothing; the renderer warns
in dev mode naming the keys it could not place.

---

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
.ngx-form {
  --ngx-color-accent: #6d28d9;
  --ngx-radius: 10px;
  --ngx-control-height: 44px;
}
```

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
