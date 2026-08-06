import { ApplicationConfig } from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideAnimations } from '@angular/platform-browser/animations';
import { routes } from './app.routes';
import { provideNgxDynamicEntity } from 'ngx-dynamic-entity';
import { MASKED_ROLES } from './mock/sample-data';

export const appConfig: ApplicationConfig = {
  providers: [
    provideRouter(routes),
    provideAnimations(), // required by Angular Material (the form builder)
    // No API/HTTP — all data lives in localStorage via LocalStore. maskedRoles still drives
    // field masking inside the renderer's forms.
    provideNgxDynamicEntity({
      maskedRoles: MASKED_ROLES
    })
  ]
};
