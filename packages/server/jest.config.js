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
  // sheet-to-schema is read from its source here, as its own suites read it. Its built
  // CommonJS entry loads exceljs and busboy with a real `import()`, which Node runs and Jest's
  // module sandbox does not. The built packages are exercised, installed from tarballs, by
  // scripts/verify-server-consumer.mjs.
  moduleNameMapper: {
    '^sheet-to-schema$': '<rootDir>/../sheet-to-schema/src/index.ts',
    '^sheet-to-schema/node$': '<rootDir>/../sheet-to-schema/src/node/index.ts',
  },
  transform: {
    '^.+\.ts$': ['ts-jest', { tsconfig: { strict: true, esModuleInterop: true, skipLibCheck: true } }],
  },
  // A 50k-row streaming test and a deliberately slow onBatch are both slower than the default.
  testTimeout: 60_000,
};
