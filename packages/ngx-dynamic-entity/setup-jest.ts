// Zone and Angular's test environment, for the specs that run in jsdom: every one but those
// that ask for `@jest-environment node` (the grouping parity spec, which needs Node's streams
// and only Angular's DI). Under Node, zone.js patches MessagePort and the rest of Node's event
// targets, and a message delivered after a suite finished crashed it ("Cannot read properties of
// undefined (reading 'false')" in zone's globalCallback), failing a suite whose tests had all
// passed. Required, not imported, so a Node spec never loads zone at all.
if (typeof document !== 'undefined') {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { setupZoneTestEnv } = require('jest-preset-angular/setup-env/zone') as typeof import('jest-preset-angular/setup-env/zone');
  setupZoneTestEnv();
}

// Bridge the few Jasmine matchers the pre-existing specs use so they run under Jest.
expect.extend({
  toBeTrue(received: unknown) {
    return {
      pass: received === true,
      message: () => `expected ${received} to be true`,
    };
  },
  toBeFalse(received: unknown) {
    return {
      pass: received === false,
      message: () => `expected ${received} to be false`,
    };
  },
});
