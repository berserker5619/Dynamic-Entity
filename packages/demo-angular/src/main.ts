import { bootstrapApplication } from '@angular/platform-browser';
import { registerFieldType, setDateFormatters } from '@dynamic-entity/core';
import { appConfig } from './app/app.config';
import { AppComponent } from './app/app.component';
import { RATING_TYPE } from './app/mock/extensions-entity';

/**
 * Tie date display to the interface language.
 *
 * The library's defaults call `toLocaleDateString()` with no locale, so they follow the
 * *browser's* setting — and deliberately so: `language` selects which `LocalizedText` entry
 * to show, which is a question about content, not about how to render a date. Changing that
 * default would silently reformat every date for every existing consumer whose browser is
 * set to something else.
 *
 * This application does want the two tied together, so it says so. That is the whole point
 * of the seam: the decision belongs to the host.
 *
 * Called here rather than through a provider because `formatDisplayValue` is a pure function
 * in a framework-agnostic package — the renderer, the builder and the Node CLI all call it,
 * and only one of the three has an injector. It must run before the first render, so it runs
 * before `bootstrapApplication`.
 */
setDateFormatters({
  date: (value, lang) => value.toLocaleDateString(lang ?? []),
  datetime: (value, lang) => value.toLocaleString(lang ?? []),
  time: (value, lang) => value.toLocaleTimeString(lang ?? [], { hour: '2-digit', minute: '2-digit' }),
});

/**
 * Describe the custom `rating` type to the *authoring* side.
 *
 * The renderer's half is `provideFieldTypes({ rating: RatingFieldComponent })` in
 * `app.config.ts`. This is the other half: the builder's palette, `getFieldTypeMeta` and
 * `createFieldConfig` all read core's catalog, which holds metadata and no component
 * reference — the separation that keeps core free of Angular.
 *
 * Registering only one of the two is the mistake this exists to demonstrate the shape of:
 * with only the renderer's, `extensions` opens in the builder as a field of unknown type;
 * with only this, the palette offers a type that renders nothing.
 */
registerFieldType({
  type: RATING_TYPE,
  label: 'Rating',
  icon: 'star',
  description: 'Five-point rating, stored as a number',
  idPrefix: 'rating',
  hasOptions: false,
  isEntityRef: false,
  flagValidators: ['required'],
  paramValidators: ['min', 'max'],
  supportsDefaultValue: true,
  supportsPlaceholder: false,
});

bootstrapApplication(AppComponent, appConfig)
  .catch((err) => console.error(err));
