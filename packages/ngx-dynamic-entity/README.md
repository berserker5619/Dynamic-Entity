# ngx-dynamic-entity

High-performance Angular dynamic form renderer and tabbed record editor component powered by `@dynamic-entity/core`.

## Features
- **DynamicFormComponent**: Renders rich tabbed forms from `EntityFormConfig` with signals and reactive forms.
- **DynamicRecordFormComponent**: Tabbed record editor with summary drawer (`showOnMinimize`), profile header, and baseline modifications.
- **Rules Engine Service**: Dynamic condition evaluation, info banners, and tab/field hiding.
- **18 Field Components**: Native Angular field implementations including date pickers, month-year, entity references, file, and image fields.

## Installation
```bash
npm install ngx-dynamic-entity @dynamic-entity/core
```

## Usage
Add provider in `app.config.ts`:
```typescript
import { provideNgxDynamicEntity } from 'ngx-dynamic-entity';

export const appConfig: ApplicationConfig = {
  providers: [
    provideNgxDynamicEntity({
      maskedRoles: ['IT_SUPPORT'],
    }),
  ],
};
```

Render dynamic form:
```html
<ngx-dynamic-form
  [config]="formConfig"
  [rules]="formRules"
  [initialData]="initialRecord"
  (formSubmit)="onSave($event)"
/>
```
