module.exports = {
  root: true,
  env: {
    node: true,
    es2021: true,
  },
  extends: ['eslint:recommended'],
  parserOptions: {
    ecmaVersion: 2021,
    sourceType: 'module',
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
  overrides: [
    {
      // Every TypeScript package, not just two of the three. The parser this declares was
      // never installed, so eslint could not load at all — which is why every package's
      // "lint" script quietly became `tsc --noEmit` and no rule here was ever enforced.
      files: ['**/*.ts'],
      parser: '@typescript-eslint/parser',
      parserOptions: {
        // Type-aware linting. The rules below cannot be decided from syntax alone: whether a
        // call returns a promise, or whether a function passed where `void` is expected
        // returns one, are questions about types.
        //
        // Every package's tsconfig, plus the spec configs — a file has to belong to one of
        // them or the parser cannot answer a type question about it. `@typescript-eslint` 7
        // has no `projectService`, so the list is explicit; `check-build-graph.mjs` is what
        // notices when a package is added without one.
        project: [
          './packages/core/tsconfig.json',
          './packages/server/tsconfig.json',
          './packages/ngx-dynamic-entity/tsconfig.json',
          './packages/ngx-dynamic-entity/tsconfig.spec.json',
          './packages/ngx-dynamic-entity-builder/tsconfig.json',
          './packages/ngx-dynamic-entity-builder/tsconfig.spec.json',
          './packages/demo-angular/tsconfig.json',
        ],
        tsconfigRootDir: __dirname,
      },
      plugins: ['@typescript-eslint'],
      extends: ['eslint:recommended', 'plugin:@typescript-eslint/recommended'],
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
         * `no-unnecessary-condition` is deliberately NOT enabled, despite being the obvious
         * third rule of this set. This codebase guards typed-but-untrusted data on purpose —
         * `Array.isArray(field.children)` on a `NestedFieldConfig[]`, `typeof reference ===
         * 'string'` on a `string` — because a config is JSON from a database or a builder,
         * and the type is a compile-time claim the runtime never checked. That rule flags
         * exactly those guards as unnecessary, and they are the library's whole defensive
         * posture. Enabling it would mean either hundreds of disable comments or deleting
         * the guards, and the second is how the validator used to crash on the input it
         * exists to describe.
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
      extends: ['plugin:@angular-eslint/recommended'],
      rules: {
        // The libraries publish `ngx-`-prefixed selectors and `deb-`-prefixed builder ones;
        // both are deliberate and neither matches the default expectation.
        '@angular-eslint/component-selector': 'off',
        '@angular-eslint/directive-selector': 'off',
        // `@Input()`/`@Output()` decorators over signal inputs: the packages support Angular
        // 17, where the signal forms do not exist.
        '@angular-eslint/prefer-standalone': 'off',
      },
    },
    {
      // Component templates. `strictTemplates` catches type errors; these catch the ones
      // that type-check and still misbehave — a click handler on a non-interactive element,
      // a two-way binding that writes back into a getter.
      files: ['packages/*/src/**/*.html'],
      parser: '@angular-eslint/template-parser',
      plugins: ['@angular-eslint/template'],
      extends: ['plugin:@angular-eslint/template/recommended'],
      rules: {},
    },
    {
      files: ['**/*.spec.ts', '**/setup-jest.ts', '**/jest.config.js'],
      env: { jest: true },
      rules: {
        '@typescript-eslint/no-non-null-assertion': 'off',
        // A spec that asserts on a promise's result awaits it; one that asserts a call was
        // made does not have to.
        '@typescript-eslint/no-floating-promises': 'off',
      },
    },
    {
      files: ['**/*.mjs'],
      parserOptions: { sourceType: 'module' },
    },
    {
      // Command-line scripts: printing to the console is their job.
      files: ['scripts/**', 'packages/core/bin.mjs'],
      rules: { 'no-console': 'off' },
    },
  ],
  ignorePatterns: [
    'dist/',
    'node_modules/',
    '*.js.map',
    'packages/*/dist/',
    'packages/demo-angular/.angular/',
    'projects/',
  ],
};
