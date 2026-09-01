import { ApplicationConfig } from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideAnimations } from '@angular/platform-browser/animations';
import { routes } from './app.routes';
import {
  COMMON_MODULES_REGISTRY,
  CONFIG_SOURCE,
  MARKDOWN_RENDERER,
  provideBuiltInFieldTypes,
  provideNgxDynamicEntity,
} from 'ngx-dynamic-entity';
import { CLIENT_TIER_LIST, MASKED_ROLES, ORDER_REFERENCE_DATA } from './mock/sample-data';
import { SampleModuleTabComponent } from './mock/sample-module.component';
import { LocalStore } from './mock/local-store.service';
import { renderMarkdown } from './mock/markdown-renderer';

export const appConfig: ApplicationConfig = {
  providers: [
    provideRouter(routes),
    provideAnimations(), // required by Angular Material (the form builder)
    {
      provide: CONFIG_SOURCE,
      useFactory: (store: LocalStore) => (entityKey: string) => store.getConfig(entityKey) ?? undefined,
      deps: [LocalStore],
    },
    {
      provide: COMMON_MODULES_REGISTRY,
      useValue: [
        { id: 'documents-view', label: { en: 'Documents' }, component: SampleModuleTabComponent },
      ],
    },
    // No API/HTTP — all data lives in localStorage via LocalStore. maskedRoles still drives
    // field masking inside the renderer's forms.
    provideNgxDynamicEntity({
      maskedRoles: MASKED_ROLES,
      entityRefs: {
        // Plain array loader.
        companies: () => ORDER_REFERENCE_DATA.companies,
        // Promise loader.
        countries: () => Promise.resolve(ORDER_REFERENCE_DATA.countries),
        // Cascade loader: filters server-side from ctx.parentValue. The renderer would also
        // apply `lookupFilter` client-side, so this stays correct either way.
        cities: ctx =>
          Promise.resolve(
            ORDER_REFERENCE_DATA.cities.filter(
              c => !ctx?.parentValue || c.record.country === ctx.parentValue,
            ),
          ),
      },
      // Named master lists for fields that set `listName`. A loader, not a bare Promise, so
      // an unused list is never fetched.
      lookups: {
        clientTier: () => Promise.resolve(CLIENT_TIER_LIST),
      },
    }),
    // Field components are opt-in so unused ones tree-shake out. The demo renders every
    // configuration in test_data.json, so it registers the full built-in set.
    provideBuiltInFieldTypes(),
    // A `markdown` field works with no renderer — it shows its source. Registering one is
    // what turns on the Preview tab and the rendered read-only view, so the demo supplies a
    // small local function rather than a parser dependency: the token takes any
    // source-to-HTML function, and saying so is the point.
    { provide: MARKDOWN_RENDERER, useValue: renderMarkdown }
  ]
};
