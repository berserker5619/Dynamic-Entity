import type { EntityFormConfig } from './form-model.types';
import {
  configVersion,
  migrateRecord,
  needsMigration,
  recordVersion,
  stampRecord,
  validateMigrations,
  type RecordMigration,
} from './migration';

const cfg = (version?: number): EntityFormConfig => ({
  entity: 'clients',
  ...(version === undefined ? {} : { version }),
  tabs: [{ id: 'main', label: { en: 'Main' }, fields: [] }],
});

/** v1 stored a single `name`; v2 splits it; v3 renames a status value. */
const splitName: RecordMigration = {
  from: 1,
  to: 2,
  description: 'split name into firstName/lastName',
  migrate: record => {
    const [firstName = '', ...rest] = String(record['name'] ?? '').split(' ');
    const { name, ...others } = record;
    void name;
    return { ...others, firstName, lastName: rest.join(' ') };
  },
};

const renameStatus: RecordMigration = {
  from: 2,
  to: 3,
  description: 'active -> ACTIVE',
  migrate: record => ({
    ...record,
    status: record['status'] === 'active' ? 'ACTIVE' : record['status'],
  }),
};

describe('configVersion / recordVersion', () => {
  it('defaults a config with no declared version to 1', () => {
    expect(configVersion(cfg())).toBe(1);
    expect(configVersion(undefined)).toBe(1);
    expect(configVersion(cfg(4))).toBe(4);
  });

  it('reads a record version only when it is a real number', () => {
    expect(recordVersion({ _configVersion: 3 })).toBe(3);
    expect(recordVersion({})).toBeNull();
    expect(recordVersion(null)).toBeNull();
    expect(recordVersion({ _configVersion: '2' })).toBeNull();
    expect(recordVersion({ _configVersion: NaN })).toBeNull();
  });
});

describe('validateMigrations', () => {
  it('accepts an ordered, unambiguous set', () => {
    expect(validateMigrations([splitName, renameStatus])).toEqual([]);
  });

  it('rejects a step that does not move forward', () => {
    const problems = validateMigrations([{ from: 3, to: 2, migrate: r => r }]);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('does not move forward');
  });

  it('rejects two steps starting at the same version', () => {
    const problems = validateMigrations([
      splitName,
      { from: 1, to: 3, migrate: r => r },
    ]);
    expect(problems[0]).toContain('unambiguous');
  });

  it('rejects a non-numeric version', () => {
    const problems = validateMigrations([{ from: NaN, to: 2, migrate: r => r }]);
    expect(problems[0]).toContain('non-numeric');
  });
});

describe('migrateRecord', () => {
  it('chains every step between the record and the config', () => {
    const result = migrateRecord(
      { _configVersion: 1, name: 'Ada Lovelace', status: 'active' },
      cfg(3),
      [splitName, renameStatus],
    );

    expect(result.applied).toEqual([2, 3]);
    expect(result.record).toMatchObject({
      firstName: 'Ada',
      lastName: 'Lovelace',
      status: 'ACTIVE',
      _configVersion: 3,
    });
    expect(result.record['name']).toBeUndefined();
  });

  it('applies only the steps a partially-migrated record still needs', () => {
    const result = migrateRecord(
      { _configVersion: 2, firstName: 'Ada', lastName: 'Lovelace', status: 'active' },
      cfg(3),
      [splitName, renameStatus],
    );

    expect(result.applied).toEqual([3]);
    expect(result.record['firstName']).toBe('Ada');
    expect(result.record['status']).toBe('ACTIVE');
  });

  it('does nothing to a record already at the config version, but stamps it', () => {
    const result = migrateRecord({ _configVersion: 3, firstName: 'Ada' }, cfg(3), [splitName]);

    expect(result.applied).toEqual([]);
    expect(result.record._configVersion).toBe(3);
  });

  it('does not mutate the record it was given', () => {
    const original = { _configVersion: 1, name: 'Ada Lovelace' };
    const snapshot = JSON.stringify(original);

    migrateRecord(original, cfg(2), [splitName]);

    expect(JSON.stringify(original)).toBe(snapshot);
  });

  /**
   * The data-safety default. An unstamped record's version is genuinely unknown: assuming
   * the oldest would re-run every migration over records that may already be current.
   */
  it('leaves an unstamped record alone and says so', () => {
    const result = migrateRecord({ name: 'Ada Lovelace' }, cfg(3), [splitName, renameStatus]);

    expect(result.unversioned).toBe(true);
    expect(result.applied).toEqual([]);
    expect(result.from).toBeNull();
    expect(result.record['name']).toBe('Ada Lovelace');
    expect(result.record['_configVersion']).toBeUndefined();
  });

  it('migrates an unstamped record when the consumer states its version', () => {
    const result = migrateRecord({ name: 'Ada Lovelace' }, cfg(2), [splitName], {
      assumeVersion: 1,
    });

    expect(result.unversioned).toBe(false);
    expect(result.applied).toEqual([2]);
    expect(result.record['firstName']).toBe('Ada');
  });

  /**
   * A record newer than the config means a rolled-back deployment. Migrating downward would
   * discard fields no step describes, so nothing is applied.
   */
  it('refuses to migrate a record that is ahead of the config', () => {
    const record = { _configVersion: 5, firstName: 'Ada' };
    const result = migrateRecord(record, cfg(3), [splitName, renameStatus]);

    expect(result.ahead).toBe(true);
    expect(result.applied).toEqual([]);
    expect(result.record).toBe(record);
  });

  it('throws rather than half-migrating when a step is missing', () => {
    expect(() =>
      migrateRecord({ _configVersion: 1, name: 'Ada' }, cfg(3), [splitName]),
    ).toThrow(/No migration from config version 2 to 3/);
  });

  it('names the entity in the error, so the failure is actionable', () => {
    expect(() => migrateRecord({ _configVersion: 1 }, cfg(2), [])).toThrow(/"clients"/);
  });

  it('throws when a step overshoots the target version', () => {
    expect(() =>
      migrateRecord({ _configVersion: 1 }, cfg(2), [{ from: 1, to: 5, migrate: r => r }]),
    ).toThrow(/overshoots/);
  });

  it('rejects an unusable migration set before touching the record', () => {
    expect(() =>
      migrateRecord({ _configVersion: 1 }, cfg(2), [{ from: 1, to: 1, migrate: r => r }]),
    ).toThrow(/Unusable migration set/);
  });
});

describe('needsMigration', () => {
  it('is true only when a known version is behind the config', () => {
    expect(needsMigration({ _configVersion: 1 }, cfg(3))).toBe(true);
    expect(needsMigration({ _configVersion: 3 }, cfg(3))).toBe(false);
    expect(needsMigration({ _configVersion: 4 }, cfg(3))).toBe(false);
  });

  it('is false for an unstamped record unless a version is assumed', () => {
    expect(needsMigration({}, cfg(3))).toBe(false);
    expect(needsMigration({}, cfg(3), { assumeVersion: 1 })).toBe(true);
  });
});

describe('stampRecord', () => {
  it('stamps a copy with the config version', () => {
    const original = { firstName: 'Ada' };
    const stamped = stampRecord(original, cfg(7));

    expect(stamped._configVersion).toBe(7);
    expect(original).not.toHaveProperty('_configVersion');
  });
});
