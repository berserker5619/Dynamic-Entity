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
      },
    },
    {
      files: ['**/*.spec.ts', '**/setup-jest.ts', '**/jest.config.js'],
      env: { jest: true },
      rules: {
        '@typescript-eslint/no-non-null-assertion': 'off',
      },
    },
    {
      files: ['**/*.mjs'],
      parserOptions: { sourceType: 'module' },
    },
    {
      // Command-line scripts: printing to the console is their job.
      files: ['scripts/**', 'packages/core/cli.mjs'],
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
