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
  coverageThreshold: {
    global: { statements: 98, branches: 90, functions: 98, lines: 99 },
    './src/**/*.ts': { statements: 85, branches: 75, functions: 85, lines: 85 },
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
