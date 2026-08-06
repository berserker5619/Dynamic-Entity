import { CURRENT_CONFIG_VERSION, detectConfigVersion, migrateConfig } from './config-migration';

describe('detectConfigVersion', () => {
  it('returns explicit version when present', () => {
    expect(detectConfigVersion({ version: 1, tabs: [] })).toBe(1);
  });

  it('detects version 0 for flat fields[]', () => {
    expect(detectConfigVersion({ fields: [] })).toBe(0);
  });

  it('detects version 1 for nested tabs[]', () => {
    expect(detectConfigVersion({ tabs: [] })).toBe(1);
  });
});

describe('migrateConfig', () => {
  it('sets CURRENT_CONFIG_VERSION on output', () => {
    const result = migrateConfig({ entity: 'x', fields: [{ id: 'a', type: 'text', label: 'A' }] });
    expect(result.version).toBe(CURRENT_CONFIG_VERSION);
  });

  it('throws when no upcaster covers the gap', () => {
    expect(() =>
      migrateConfig({ version: 99, tabs: [] }, { targetVersion: 100 }),
    ).toThrow(/No upcaster registered/);
  });
});
