# ngx-dynamic-entity

Angular dynamic form renderer and tabbed record editor, powered by `@dynamic-entity/core`.

## Features
- **DynamicFormComponent** — rich tabbed forms from `EntityFormConfig`, built on signals and reactive forms.
- **DynamicRecordFormComponent** — record editor with summary drawer (`showOnMinimize`), profile header, and session-baseline tracking.
- **Rules engine** — condition evaluation, info/warning/error banners, field and tab hiding.
- **Entity references with cascades** — consumer-registered loaders, parent→child filtering, `autoPatch`.
- **19 field type keys** across 18 components — including date, month-year, entity-ref, file, and image.

## Installation
```bash
npm install ngx-dynamic-entity @dynamic-entity/core
```

## Setup

Two providers: one for services and registries, one for field components.

```ts
import {
  provideNgxDynamicEntity,
  provideBuiltInFieldTypes,
} from 'ngx-dynamic-entity';

export const appConfig: ApplicationConfig = {
  providers: [
    provideNgxDynamicEntity({
      maskedRoles: ['IT_SUPPORT'],
      entityRefs: { countries: ctx => api.listCountries(ctx) },
    }),
    provideBuiltInFieldTypes(),
  ],
};
```

### Field components are opt-in (tree-shaking)

`FieldRegistryService` imports no components. Only what you register is bundled — so an app
that renders three field types does not ship nineteen.

```ts
// Everything (simplest):
provideBuiltInFieldTypes()

// Or only what this app renders:
provideFieldTypes({
  text: TextFieldComponent,
  number: NumberFieldComponent,
  dropdown: DropdownFieldComponent,
})
```

`provideFieldTypes` is a multi-provider: several calls compose, and a later set wins on a key
collision. `provideNgxDynamicEntity({ fieldTypes })` still overrides everything — use it to
swap a built-in for your own component. An unregistered type renders nothing and logs a
console warning in dev builds.

## Rendering

```html
<ngx-dynamic-form
  [config]="formConfig"
  [rules]="formRules"
  [initialData]="initialRecord"
  [originalData]="sessionBaseline"
  (formSubmit)="onSave($event)"
/>
```

## Entity references and cascades

Register a loader per entity key. It receives `{ parentValue, filters, lang }` and may return
an array, a Promise, or an Observable of `ReferenceOption[]`:

```ts
provideNgxDynamicEntity({
  entityRefs: {
    countries: () => http.get<ReferenceOption[]>('/api/countries'),
    cities: ctx => http.get<ReferenceOption[]>('/api/cities', { params: { country: ctx?.parentValue } }),
  },
});
```

A field cascades when its `entityReference.parentField` names a sibling. The child reloads on
every parent change, drops a now-invalid selection, and shows nothing until the parent has a
value. Filtering happens server-side (via `parentValue`) or client-side:

- `lookupFilter` — keep options whose record matches the parent value at that dot-path.
- `lookupPath` — take options from a nested array on the selected parent's record.

Raw records are labelled through `entityReference.displayFields`; the full record rides along on
`ReferenceOption.record`, which is what `autoPatch` copies from.

## autoPatch and patchOnTrue

```jsonc
// Selecting a company fills in its address on the "address" tab
{ "id": "company", "type": "entity-ref",
  "autoPatch": { "targetTab": "address", "mappings": [{ "source": "city", "target": "city" }] } }

// Ticking "same as home" copies one field into another
{ "id": "billingSame", "type": "boolean", "patchOnTrue": [{ "from": "home", "to": "billing" }] }
```

`patchOnTrue` fires on the false→true transition only, so a later manual edit is not clobbered.

## criticalField

A field marked `criticalField` renders read-only behind a lock toggle. Once unlocked and
changed, the form shows a deferred notice naming the field — compared against the session
baseline (`originalData`, or the values captured at first build). The same baseline feeds
`VALUE_CHANGED` rules.

## File and image fields

Both store a `FileRef`. Register an upload handler to persist on select:

```ts
{ provide: UPLOAD_HANDLER, useValue: (file: File) => http.post<{url: string}>('/upload', file) }
```

With a handler the value is `{ url, name, size, mimeType }`; without one it is
`{ file, name, size, mimeType }` for you to upload at submit time. Image previews use object
URLs for unpersisted files and revoke them automatically.

## Injection tokens

| Token | Purpose |
|---|---|
| `MASKED_ROLES` | Roles that see `XXXXXXXXX` for masked fields |
| `FIELD_TYPE_REGISTRY` | Consumer overrides: field type → component (highest priority) |
| `FIELD_TYPE_SETS` | Multi: field-type sets contributed by `provideFieldTypes()` |
| `ENTITY_REF_REGISTRY` | Entity key → `EntityReferenceLoader` |
| `VALIDATOR_REGISTRY` | Validator name → `ValidatorFn` |
| `HOOK_REGISTRY` | Hook key → handler (e.g. `entity:beforeSave`) |
| `COMMON_MODULES_REGISTRY` | Consumer-provided shared tab modules |
| `UPLOAD_HANDLER` | `(file) => UploadResult \| Promise \| Observable` |
