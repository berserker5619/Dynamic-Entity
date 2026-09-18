/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'node',
  testMatch: ['<rootDir>/src/**/*.spec.ts'],
  // Coverage is measured on shipped source only: barrels and specs are excluded.
  collectCoverageFrom: ['src/**/*.ts', '!src/**/*.spec.ts', '!src/**/*.fixtures.ts', '!src/index.ts'],
  coverageReporters: ['text-summary', 'lcov'],
  // Per-file, not aggregate — see the note in packages/core/jest.config.js. A glob key removes
  // every file it matches from the `global` group, so a `global` entry beside this one would
  // read as a gate and enforce nothing.
  coverageThreshold: {
    './src/**/*.ts': { statements: 90, branches: 80, functions: 100, lines: 90 },
  },
  modulePathIgnorePatterns: ['<rootDir>/dist/'],
  transform: {
    '^.+\.ts$': ['ts-jest', { tsconfig: { strict: true, esModuleInterop: true, skipLibCheck: true } }],
  },
  // A 50k-row streaming test and a deliberately slow onBatch are both slower than the default.
  testTimeout: 60_000,
};
