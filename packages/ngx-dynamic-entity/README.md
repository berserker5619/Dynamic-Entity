# ngx-dynamic-entity

[![npm version](https://img.shields.io/npm/v/ngx-dynamic-entity.svg?color=red)](https://www.npmjs.com/package/ngx-dynamic-entity)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](../../LICENSE)

Angular 17+ dynamic form renderer and tabbed record editor, powered by `@dynamic-entity/core`.

---

## 📦 Installation

```bash
npm install ngx-dynamic-entity @dynamic-entity/core
```

---

## ✨ Features

- **`DynamicFormComponent`**: Rich tabbed dynamic forms generated from `EntityFormConfig`, built on Angular 17 Signals & Reactive Forms.
- **`DynamicRecordFormComponent`**: Full-featured record editor with summary drawer (`showOnMinimize`), profile header, and RBAC permission masking.
- **Reactive Rules Engine**: Real-time condition evaluation, info/warning/error banners, and target field/tab visibility toggling.
- **Entity References & Cascades**: Consumer-registered loaders, parent→child dropdown filtering, and `autoPatch` record copying.
- **18 Field Types**: Standalone components for text, currency, monthYear, time, group, array, entityRef, referencedField, file, image, etc.

---

## 🚀 Setup & Registration

Add the providers to your Angular application config:

```typescript
import { ApplicationConfig } from '@angular/core';
import {
  provideNgxDynamicEntity,
  provideBuiltInFieldTypes,
} from 'ngx-dynamic-entity';

export const appConfig: ApplicationConfig = {
  providers: [
    provideNgxDynamicEntity({
      maskedRoles: ['IT_SUPPORT'],
      entityRefs: {
        countries: () => fetch('/api/countries').then(res => res.json()),
      },
    }),
    provideBuiltInFieldTypes(),
  ],
};
```

---

## 💡 Usage

```html
<ngx-dynamic-form
  [config]="formConfig"
  [initialValue]="initialRecord"
  [role]="'editor'"
  (formSubmit)="onSave($event)"
/>
```
