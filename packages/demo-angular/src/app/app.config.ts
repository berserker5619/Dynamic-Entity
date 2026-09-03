import { ApplicationConfig } from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideAnimations } from '@angular/platform-browser/animations';
import { routes } from './app.routes';
import {
  COMMON_MODULES_REGISTRY,
  CONFIG_SOURCE,
  ENTITY_REF_CACHE_STORE,
  MARKDOWN_RENDERER,
  MASKED_PLACEHOLDER,
  SYSTEM_DEFAULT_CAN_EDIT,
  UPLOAD_HANDLER,
  provideBuiltInFieldTypes,
  provideFieldTypes,
  provideNgxDynamicEntity,
} from 'ngx-dynamic-entity';
import { CLIENT_TIER_LIST, MASKED_ROLES } from './mock/sample-data';
import { DEMO_MASK } from './mock/demo-mask';
import { SampleModuleTabComponent } from './mock/sample-module.component';
import { LocalStore } from './mock/local-store.service';
import { renderMarkdown } from './mock/markdown-renderer';
import { BUILDER_TEXT } from 'ngx-dynamic-entity-builder';
import { DEMO_BUILDER_TEXT, DEMO_UI_TEXT } from './mock/ui-text-de';
import { DEMO_ENTITY_REF_LOADERS } from './mock/entity-ref-loaders';
import { RATING_TYPE } from './mock/extensions-entity';
import { RatingFieldComponent } from './mock/rating-field.component';
import { SessionEntityRefCacheStore } from './mock/session-ref-cache';
import {
  DEMO_ASYNC_VALIDATORS,
  DEMO_HOOKS,
  DEMO_MIGRATIONS,
  DEMO_VALIDATORS,
  demoUploadHandler,
} from './mock/demo-extensions';

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
      useValue: [{ id: 'documents-view', label: { en: 'Documents' }, component: SampleModuleTabComponent }],
    },
    // No API/HTTP — all data lives in localStorage via LocalStore. maskedRoles still drives
    // field masking inside the renderer's forms.
    provideNgxDynamicEntity({
      maskedRoles: MASKED_ROLES,
      // Three loader shapes — a plain array, a Promise, and a cascade reading
      // `ctx.parentValue`. Moved out of this file so the loaders can count their own calls,
      // which is the only way to prove the options cache below is doing anything.
      entityRefs: DEMO_ENTITY_REF_LOADERS,
      // Named master lists for fields that set `listName`. A loader, not a bare Promise, so
      // an unused list is never fetched.
      lookups: {
        clientTier: () => Promise.resolve(CLIENT_TIER_LIST),
      },
      // The library's own buttons and empty states, in both languages the demo offers. Field
      // labels come from the config and already follow `language`; without this the chrome
      // around them stays English whatever `language` says.
      uiText: DEMO_UI_TEXT,
      /**
       * The messages shown under an invalid field.
       *
       * Registered as functions rather than strings so one provider demonstrates both halves
       * of the feature: that the registry reaches every field type, and that error text
       * follows the form's `language` the way labels already did. A plain string is accepted
       * too, wherever a message never varies.
       *
       * `required`'s English is character-for-character the library default, deliberately —
       * it keeps the existing assertion in `ui-ux-enhancements.spec.ts` green. That spec now
       * carries a note saying it covers this override rather than the library's own text.
       * Unlisted keys keep their English default, so a partial pack is the intended shape.
       */
      validationMessages: {
        required: lang => (lang === 'de' ? 'Pflichtfeld.' : 'This field is required.'),
        minlength: (lang, err) =>
          lang === 'de'
            ? `Mindestens ${err?.requiredLength} Zeichen.`
            : `Minimum ${err?.requiredLength} characters required.`,
        /**
         * The fallback — and therefore the message a *custom* validator's error key gets on a
         * built-in field type. Each type resolves against a fixed list of error keys, and a
         * key the library has never heard of is not on it. Overriding this is what stops the
         * `noShouting` and `uniqueEmail` rules reporting English "Invalid value." to a
         * German-speaking user.
         */
        invalid: lang => (lang === 'de' ? 'Wert ist nicht zulässig.' : 'That value is not allowed.'),
      },
      // Named validators the `extensions` schema refers to by string. The schema stays data
      // that the builder can author; the rule stays code.
      validators: DEMO_VALIDATORS,
      asyncValidators: DEMO_ASYNC_VALIDATORS,
      // `extensions:beforeSave` vetoes a save. Bound to `(saveRejected)` in the template —
      // an abort with nothing listening looks exactly like a button that does nothing.
      hooks: DEMO_HOOKS,
      // Ordered steps that move a saved record forward when a config's `version` does.
      migrations: DEMO_MIGRATIONS,
    }),
    // Field components are opt-in so unused ones tree-shake out. The demo renders every
    // configuration in test_data.json, so it registers the full built-in set.
    provideBuiltInFieldTypes(),
    /**
     * A field type the library does not ship.
     *
     * This is only half of the registration. The renderer resolves a type to a component
     * through this token; the *builder* resolves it through core's field catalog, which
     * holds no component reference at all — that separation is what keeps core free of
     * Angular. `main.ts` makes the other half of the call, before bootstrap, so the
     * builder's palette offers `rating` as well.
     */
    provideFieldTypes({ [RATING_TYPE]: RatingFieldComponent }),
    // A `markdown` field works with no renderer — it shows its source. Registering one is
    // what turns on the Preview tab and the rendered read-only view, so the demo supplies a
    // small local function rather than a parser dependency: the token takes any
    // source-to-HTML function, and saying so is the point.
    { provide: MARKDOWN_RENDERER, useValue: renderMarkdown },
    /**
     * What a masked field prints, in place of the library's `XXXXXXXXX` default.
     *
     * The same constant backs `LocalStore`'s record masking, so the demo shows one mask
     * however a value came to be withheld. See `DEMO_MASK` for why that matters.
     */
    { provide: MASKED_PLACEHOLDER, useValue: DEMO_MASK },
    /**
     * Persist a chosen file and store its URL, rather than keeping the raw `File` for the
     * host to upload at submit time. Without this the demo's attachments do not survive a
     * save at all: a `File` cannot be serialised into localStorage.
     */
    { provide: UPLOAD_HANDLER, useValue: demoUploadHandler },
    /**
     * Make the entity-reference options cache outlive a page reload.
     *
     * The library's in-memory default is the correct default — a library must not decide on
     * its own to write a tenant's data to disk. The token exists so a host that wants it
     * persisted can say so, which is what this is.
     */
    { provide: ENTITY_REF_CACHE_STORE, useClass: SessionEntityRefCacheStore },
    /**
     * Who may edit a tab the schema marks `systemDefault`, in the builder.
     *
     * The predicate receives the roles of the person using the builder — which the builder
     * only knows because `BuilderPageComponent` now passes `[userRoles]`. Registering this
     * without passing them would answer `false` for everybody and lock every system-default
     * tab, which is worse than the permissive default it replaces.
     */
    { provide: SYSTEM_DEFAULT_CAN_EDIT, useValue: (roles: string[]) => roles.includes('admin') },
    // The builder's chrome is a separate vocabulary with its own token — an app that ships
    // only the renderer has no use for these keys.
    { provide: BUILDER_TEXT, useValue: DEMO_BUILDER_TEXT },
  ],
};
