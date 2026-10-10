/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'node',
  testMatch: ['<rootDir>/src/**/*.spec.ts'],
  // Coverage is measured on shipped source only: barrels and specs are excluded.
  collectCoverageFrom: ['src/**/*.ts', '!src/**/*.spec.ts', '!src/**/*.fixtures.ts', '!src/index.ts'],
  coverageReporters: ['text-summary', 'lcov'],
  // Per-file, not aggregate, for the reason given in packages/core/jest.config.js.
  coverageThreshold: {
    './src/**/*.ts': { statements: 95, branches: 90, functions: 100, lines: 95 },
  },
  modulePathIgnorePatterns: ['<rootDir>/dist/'],
  transform: {
    '^.+\.ts$': ['ts-jest', { tsconfig: { strict: true, esModuleInterop: true, skipLibCheck: true } }],
  },
};
