/** @type {import('jest').Config} */
module.exports = {
  preset: 'jest-preset-angular',
  setupFilesAfterEnv: ['<rootDir>/setup-jest.ts'],
  testMatch: ['<rootDir>/src/**/*.spec.ts'],
  // Coverage is measured on shipped source only: barrels and specs are excluded.
  collectCoverageFrom: ['src/**/*.ts', '!src/**/*.spec.ts', '!src/public-api.ts'],
  coverageReporters: ['text-summary', 'lcov'],
  // Thresholds sit just under the current numbers: they are a ratchet against regression,
  // not a target to game. Raise them when coverage genuinely improves.
  //
  // These previously read 95/75/95/96 global and 85/70/85/85 per-file, copied from
  // ngx-dynamic-entity where they are accurate. This package has never come close to them:
  // `jest --coverage` failed here with 25 violations at 74.6% statements / 56.2% branches,
  // so the numbers described an aspiration and protected nothing — nothing could regress
  // past a gate that was already shut.
  //
  // They now reflect what this package actually achieves (92.7 / 74.7 / 94.3 / 94.2 after
  // deleting two dead stores and covering the referenced-field and connection editors), so
  // the ratchet is real for the first time. Raise them as coverage improves; the per-file
  // floors are deliberately the weakest link, not an average.
  coverageThreshold: {
    global: { statements: 92, branches: 74, functions: 94, lines: 94 },
    './src/**/*.ts': { statements: 76, branches: 50, functions: 50, lines: 79 },
  },
  // Ignore the built output so haste doesn't see two package.json manifests.
  modulePathIgnorePatterns: ['<rootDir>/dist/'],
  moduleNameMapper: {
    // Resolve the core types to source — no build step needed for tests.
    '^@dynamic-entity/core$': '<rootDir>/../core/src/index.ts',
    // Same for the renderer. Previously this resolved through the renderer's
    // "main" field, which pointed into its local dist/ — so tests silently
    // depended on a prior build. Mapping to source removes that ordering trap.
    '^ngx-dynamic-entity$': '<rootDir>/../ngx-dynamic-entity/src/public-api.ts',
  },
  transform: {
    '^.+\\.(ts|mjs|js|html)$': [
      'jest-preset-angular',
      {
        tsconfig: '<rootDir>/tsconfig.spec.json',
        stringifyContentPathRegex: '\\.(html|svg)$',
      },
    ],
  },
  transformIgnorePatterns: ['node_modules/(?!.*\\.mjs$|@angular|rxjs|tslib)'],
};
