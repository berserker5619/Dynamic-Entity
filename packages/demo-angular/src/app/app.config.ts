import { ApplicationConfig } from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideAnimations } from '@angular/platform-browser/animations';
import { routes } from './app.routes';
import { provideBuiltInFieldTypes, provideNgxDynamicEntity } from 'ngx-dynamic-entity';
import { MASKED_ROLES, ORDER_REFERENCE_DATA } from './mock/sample-data';

export const appConfig: ApplicationConfig = {
  providers: [
    provideRouter(routes),
    provideAnimations(), // required by Angular Material (the form builder)
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
    }),
    // Field components are opt-in so unused ones tree-shake out. The demo renders every
    // configuration in test_data.json, so it registers the full built-in set.
    provideBuiltInFieldTypes()
  ]
};
