/** @type {import('jest').Config} */
module.exports = {
  preset: 'jest-preset-angular',
  setupFilesAfterEnv: ['<rootDir>/setup-jest.ts'],
  testMatch: ['<rootDir>/src/**/*.spec.ts'],
  modulePathIgnorePatterns: ['<rootDir>/dist/'],
  // Pre-existing specs written for Karma/Jasmine (jasmine.createSpyObj etc.) that predate
  // this Jest setup. They need a separate Jasmine→Jest migration; excluded until then so
  // `npm test` gives a clean signal for the Jest-native suites.
  testPathIgnorePatterns: [
    '<rootDir>/src/lib/services/config.service.spec.ts',
    '<rootDir>/src/lib/form/dynamic-form.component.spec.ts',
    '<rootDir>/src/lib/form/dynamic-field/dynamic-field.component.spec.ts',
    '<rootDir>/src/lib/table/dynamic-table.component.spec.ts',
    '<rootDir>/src/lib/field-types/entity-ref-field.component.spec.ts',
  ],
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
