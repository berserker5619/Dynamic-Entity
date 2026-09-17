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
  // No `global` entry, deliberately. Jest removes every file matched by a path or glob key
  // from the `global` group, so a glob of `./src/**/*.ts` — which matches everything — left
  // `global` measuring nothing. The 98/90/98/99 that used to sit here enforced none of itself.
  //
  // The per-file numbers are the real gate and are stronger than the aggregate they replace:
  // every file must clear them, so no single rotting file hides behind the average. Set just
  // under the weakest file in the package.
  coverageThreshold: {
    './src/**/*.ts': { statements: 95, branches: 83, functions: 93, lines: 96 },
  },
  modulePathIgnorePatterns: ['<rootDir>/dist/'],
  moduleNameMapper: {
    '^@dynamic-entity/core$': '<rootDir>/../core/src/index.ts',
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
