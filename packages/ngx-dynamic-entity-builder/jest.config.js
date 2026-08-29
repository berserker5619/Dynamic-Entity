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
  // They now reflect what this package actually achieves, so the ratchet is real. Raise
  // them as coverage improves; the per-file floors are deliberately the weakest link, not
  // an average.
  //
  // The per-file floor used to sit at 76 / 50 / 50 / 79, which let a single file ship with
  // half its branches and half its functions untested — and the builder is where the subtler
  // defects have historically lived. It now matches the other two packages exactly
  // (85 / 75 / 85 / 85). Getting there meant specs for the canvas and tree-node components,
  // which had none at all, edge coverage for the inspector and rules editor, and deleting a
  // dead onDrop/fieldTypeLabel/fieldTypeIcon/fieldLabel block that the canvas extraction had
  // left behind on EntityBuilderComponent.
  //
  // Actuals at the time of writing: 95.9 / 83.0 / 97.9 / 97.1 global, and the weakest file
  // (builder-store.service.ts) at 93.9 / 78.5 / 97.0 / 95.6.
  coverageThreshold: {
    global: { statements: 95, branches: 82, functions: 97, lines: 97 },
    './src/**/*.ts': { statements: 85, branches: 75, functions: 85, lines: 85 },
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
