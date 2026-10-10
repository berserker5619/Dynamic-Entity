// @ts-check
import js from '@eslint/js';
import angular from 'angular-eslint';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/dist/',
      '**/node_modules/',
      '**/*.js.map',
      '**/coverage/',
      'packages/demo-angular/.angular/',
      'projects/',
    ],
  },

  {
    files: ['**/*.{js,mjs,cjs,ts}'],
    extends: [js.configs.recommended],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.node },
    },
    rules: {
      'no-console': 'warn',
      'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'prefer-const': 'error',
      'no-var': 'error',
      // `x == null` is the deliberate idiom for "null or undefined" and is used throughout
      // core; requiring === there would mean writing both checks at every call site.
      eqeqeq: ['error', 'always', { null: 'ignore' }],
    },
  },

  {
    files: ['**/*.ts'],
    extends: [tseslint.configs.recommended],
    languageOptions: {
      parserOptions: {
        // Type-aware linting. The rules below cannot be decided from syntax alone: whether a
        // call returns a promise, or whether a function passed where `void` is expected
        // returns one, are questions about types.
        //
        // Explicit rather than `projectService`: the Angular packages keep their specs in a
        // separate tsconfig.spec.json, which the project service would not find for them.
        // `check-build-graph.mjs` is what notices when a package is added without one.
        project: [
          './packages/core/tsconfig.json',
          './packages/server/tsconfig.json',
          './packages/ngx-dynamic-entity/tsconfig.json',
          './packages/ngx-dynamic-entity/tsconfig.spec.json',
          './packages/ngx-dynamic-entity-builder/tsconfig.json',
          './packages/ngx-dynamic-entity-builder/tsconfig.spec.json',
          './packages/demo-angular/tsconfig.json',
          './packages/sheet-importer/tsconfig.json',
        ],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // TypeScript resolves identifiers itself; eslint's version does not understand
      // types, decorators, or ambient globals and only produces false positives here.
      'no-undef': 'off',
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      // The libraries warn deliberately in dev mode; those call sites are the feature.
      'no-console': 'off',
      // Pragmatic for a form library whose values are genuinely dynamic.
      '@typescript-eslint/no-explicit-any': 'off',

      /*
       * Type-aware rules.
       *
       * A dropped promise in a form library is a save that silently did not happen, and a
       * promise-returning handler passed to something expecting `void` is the same defect
       * wearing a callback. Neither is visible to a syntax-only linter.
       *
       * `no-unnecessary-condition` is deliberately NOT enabled. This codebase guards
       * typed-but-untrusted data on purpose — `Array.isArray(field.children)` on a
       * `NestedFieldConfig[]` — because a config is JSON from a database or a builder, and
       * the type is a compile-time claim the runtime never checked. That rule flags exactly
       * those guards, and they are the library's whole defensive posture.
       */
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': [
        'error',
        // Angular templates bind `(click)="save()"` to async methods routinely, and the
        // return value genuinely is discarded there. The argument case is the one that
        // hides a bug.
        { checksVoidReturn: { attributes: false, properties: false } },
      ],
    },
  },

  {
    // Angular-specific rules: lifecycle misuse and component declaration faults that the
    // base TypeScript rules cannot see.
    files: ['packages/ngx-dynamic-entity/**/*.ts', 'packages/ngx-dynamic-entity-builder/**/*.ts'],
    extends: [angular.configs.tsRecommended],
    processor: angular.processInlineTemplates,
    rules: {
      // The libraries publish `ngx-`-prefixed selectors and `deb-`-prefixed builder ones;
      // both are deliberate and neither matches the default expectation.
      '@angular-eslint/component-selector': 'off',
      '@angular-eslint/directive-selector': 'off',
      // `@Input()`/`@Output()` decorators over signal inputs: the packages support Angular
      // 17, where the signal forms do not exist.
      '@angular-eslint/prefer-standalone': 'off',
      '@angular-eslint/prefer-inject': 'off',
      '@angular-eslint/prefer-signals': 'off',
    },
  },

  {
    // Component templates. `strictTemplates` catches type errors; these catch the ones
    // that type-check and still misbehave — a click handler on a non-interactive element,
    // a two-way binding that writes back into a getter.
    files: ['packages/*/src/**/*.html'],
    extends: [angular.configs.templateRecommended],
  },

  {
    files: ['**/*.spec.ts', '**/setup-jest.ts', '**/jest.config.js'],
    languageOptions: { globals: { ...globals.jest } },
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
      // A spec that asserts on a promise's result awaits it; one that asserts a call was
      // made does not have to.
      '@typescript-eslint/no-floating-promises': 'off',
    },
  },

  {
    // The importer depends on nothing in Dynamic Entity (docs/import-phase1-spec.md, "Package
    // boundaries"): the DE adapter imports it, never the reverse, or core's re-exports make a
    // cycle. A rule rather than a convention, so a stray import fails `npm run lint`.
    files: ['packages/sheet-importer/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['@dynamic-entity/*', 'ngx-dynamic-entity', 'ngx-dynamic-entity-builder'], message: 'The importer must not depend on Dynamic Entity.' },
            { group: ['../../*'], message: 'The importer must not reach into another package.' },
          ],
        },
      ],
    },
  },

  {
    // Command-line scripts: printing to the console is their job.
    files: ['scripts/**', 'packages/core/bin.mjs'],
    rules: { 'no-console': 'off' },
  },
);
