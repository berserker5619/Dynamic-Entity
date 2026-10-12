/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'node',
  testMatch: ['<rootDir>/src/**/*.spec.ts'],
  // Coverage is measured on shipped source only: barrels and specs are excluded.
  collectCoverageFrom: ['src/**/*.ts', '!src/**/*.spec.ts', '!src/index.ts'],
  coverageReporters: ['text-summary', 'lcov'],
  // Thresholds sit just under the current numbers: they are a ratchet against regression,
  // not a target to game. Raise them when coverage genuinely improves.
  //
  // There is no `global` entry, and that is deliberate. Jest removes every file matched by a
  // path or glob key from the `global` group, so a glob of `./src/**/*.ts` — which matches
  // everything — left `global` measuring nothing at all. It read as a 96% aggregate gate and
  // enforced zero: the suite exited 0 at 95.11% statements while that line sat in this file.
  // A misleading gate is worse than a missing one, because it is the reason nobody looks.
  //
  // The per-file numbers below are the real gate, and they are stronger than the aggregate
  // they replace: every file must clear them, so no single rotting file can hide behind the
  // average. They are set just under the weakest file currently in the package.
  coverageThreshold: {
    './src/**/*.ts': { statements: 90, branches: 80, functions: 100, lines: 91 },
  },
  modulePathIgnorePatterns: ['<rootDir>/dist/'],
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: { strict: true, esModuleInterop: true, skipLibCheck: true } }],
  },
};
