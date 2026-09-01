/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'node',
  testMatch: ['<rootDir>/src/**/*.spec.ts'],
  // Coverage is measured on shipped source only: barrels and specs are excluded.
  collectCoverageFrom: ['src/**/*.ts', '!src/**/*.spec.ts', '!src/index.ts'],
  coverageReporters: ['text-summary', 'lcov'],
  // Thresholds sit just under the current numbers: they are a ratchet against regression,
  // not a target to game. Raise them when coverage genuinely improves.
  coverageThreshold: {
    global: { statements: 96, branches: 89, functions: 98, lines: 98 },
    './src/**/*.ts': { statements: 85, branches: 75, functions: 85, lines: 85 },
  },
  modulePathIgnorePatterns: ['<rootDir>/dist/'],
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: { strict: true, esModuleInterop: true, skipLibCheck: true } }],
  },
};
