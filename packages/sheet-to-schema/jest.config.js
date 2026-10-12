/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'node',
  testMatch: ['<rootDir>/src/**/*.spec.ts'],
  // Coverage is measured on shipped source only: barrels and specs are excluded.
  collectCoverageFrom: ['src/**/*.ts', '!src/**/*.spec.ts', '!src/**/*.fixtures.ts', '!src/index.ts', '!src/node/index.ts'],
  coverageReporters: ['text-summary', 'lcov'],
  // Per-file, not aggregate, for the reason given in packages/core/jest.config.js.
  // Two bars. The main entry was written for this package and is held to its own. What is
  // under src/node moved here from @dynamic-entity/server and keeps the bar it was held to
  // there, so that moving code is never the reason a test gets written to a number.
  coverageThreshold: {
    './src/*.ts': { statements: 95, branches: 90, functions: 100, lines: 95 },
    './src/node/**/*.ts': { statements: 90, branches: 80, functions: 100, lines: 90 },
  },
  testTimeout: 60_000,
  modulePathIgnorePatterns: ['<rootDir>/dist/'],
  // `/node` imports the main entry by the package's own name (see tsup.config.ts). Under test
  // that name is the source, as tsconfig's `paths` has it.
  moduleNameMapper: {
    '^sheet-to-schema$': '<rootDir>/src/index.ts',
  },
  transform: {
    '^.+\.ts$': ['ts-jest', { tsconfig: { strict: true, esModuleInterop: true, skipLibCheck: true } }],
  },
};
