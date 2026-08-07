# ngx-dynamic-entity-builder

Visual drag-and-drop Angular form builder for `@dynamic-entity/core` and `ngx-dynamic-entity`.

## Features
- **Visual Palette & Canvas**: Drag-and-drop authoring for 18 field types.
- **Inspector**: Fine-grained property, validation, option, and rule authoring.
- **Tab & Module Manager**: Manage primary and nested tab structures.
- **Live Preview**: Real-time live form preview during design.

## Installation
```bash
npm install ngx-dynamic-entity-builder ngx-dynamic-entity @dynamic-entity/core
```

## Usage
```html
<ngx-entity-builder
  [config]="initialConfig"
  [rules]="initialRules"
  (configChange)="onConfigUpdated($event)"
/>
```
