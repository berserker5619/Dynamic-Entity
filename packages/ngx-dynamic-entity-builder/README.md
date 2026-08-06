# ngx-dynamic-entity-builder

Angular 17 standalone **visual builder** for authoring `@dynamic-entity/core` `EntityConfig`
objects — the JSON consumed by [`ngx-dynamic-entity`](../ngx-dynamic-entity)'s
`<ngx-dynamic-form>` renderer and by `dynamic-entity-server`.

Design fields from a palette, reorder them with drag-and-drop, define tabs, set
validators, options and RBAC — and get a live, validated `EntityConfig` out.

> The builder depends only on `@dynamic-entity/core` **types** (zero runtime coupling to
> the renderer). It emits an `EntityConfig`; wire it to `saveConfig()` yourself.

## Requirements

Built on **Angular Material 17**. In the consuming app you must provide:

1. **Animations** — `provideAnimations()` (or `provideAnimationsAsync()`).
2. **A Material theme** — include a prebuilt theme, e.g. in `styles.css`:
   ```css
   @import '@angular/material/prebuilt-themes/indigo-pink.css';
   ```
3. **The Material Icons font** — the palette/toolbar use icon ligatures:
   ```html
   <link href="https://fonts.googleapis.com/icon?family=Material+Icons" rel="stylesheet" />
   ```

Install peers:

```bash
npm i ngx-dynamic-entity-builder @angular/material @angular/cdk
```

## Usage

```ts
import { Component } from '@angular/core';
import { EntityBuilderComponent, EntityConfig } from 'ngx-dynamic-entity-builder';

@Component({
  standalone: true,
  imports: [EntityBuilderComponent],
  template: `
    <ngx-entity-builder
      [config]="existing"
      [languages]="['en', 'de']"
      [availableRoles]="['ADMIN', 'HR', 'IT_SUPPORT']"
      (configChange)="draft = $event"
      (save)="persist($event)"
    ></ngx-entity-builder>
  `,
})
export class DesignerPage {
  existing?: EntityConfig;
  draft?: EntityConfig;

  persist(config: EntityConfig) {
    // e.g. configService.saveConfig(config).subscribe();
  }
}
```

### Inputs

| Input            | Type             | Default  | Description                                                        |
| ---------------- | ---------------- | -------- | ------------------------------------------------------------------ |
| `config`         | `EntityConfig?`  | —        | Existing config to edit. Deep-cloned — the input is never mutated. |
| `languages`      | `string[]`       | `['en']` | Languages available for label/placeholder editing.                 |
| `availableRoles` | `string[]`       | `[]`     | When set, RBAC uses multi-select pickers instead of free text.     |

### Outputs

| Output         | Payload        | When                                             |
| -------------- | -------------- | ------------------------------------------------ |
| `configChange` | `EntityConfig` | On every edit (live).                            |
| `save`         | `EntityConfig` | On **Save** — a clean deep clone. Disabled while invalid. |

### Live form preview (optional)

Project the renderer into the `[ngxBuilderPreview]` slot to preview the form as you build:

```html
<ngx-entity-builder [config]="config" (configChange)="config = $event">
  <ngx-dynamic-form ngxBuilderPreview [config]="config"></ngx-dynamic-form>
</ngx-entity-builder>
```

## What you can build

Field types: `text`, `textarea`, `number`, `checkbox`, `date`, `dropdown`,
`multiSelect`, `entity-ref`, `array` — see [`field-catalog.ts`](./src/lib/field-catalog.ts).

Per field: id, localized labels/placeholders, validators (`required`, `email`, `min`,
`max`, `minLength`, `maxLength`), dropdown/multiSelect options, entity-ref registry key,
tab assignment, and display flags (`visible`, `tableColumn`, `readonly`, `disabled`,
`maskData`).

Entity level: name, default/editing language, `maskData`, and `view`/`edit`/`delete` RBAC roles.

## Building blocks (all exported)

- `EntityBuilderComponent` — the full builder.
- `FieldPaletteComponent`, `FieldInspectorComponent`, `TabManagerComponent` — composable pieces.
- `BuilderStore` — the signal-backed working state (provided per builder instance). Drive a
  fully custom UI with it.
- `FIELD_TYPE_CATALOG`, `getFieldTypeMeta`, `createFieldConfig`, `humanizeId` — catalog helpers.

## Validation

`BuilderStore` continuously validates: entity-name presence/format, duplicate/invalid field
ids, unknown tab references (errors), plus missing-label and empty-option-list (warnings).
**Save** is disabled while any error is present (`store.isValid()`).
