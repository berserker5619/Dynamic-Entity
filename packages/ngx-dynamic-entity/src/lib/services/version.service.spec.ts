import { VersionService } from './version.service';
import type { EntityFormConfig } from '@dynamic-entity/core';

describe('VersionService', () => {
  describe('with default strategy (graceful)', () => {
    let service: VersionService;

    beforeEach(() => {
      service = new VersionService();
    });

    it('should identify stale record', () => {
      const config = { entity: 'test', tabs: [], version: 2 } as EntityFormConfig;
      expect(service.needsMigration({ _configVersion: 1 }, config)).toBe(true);
    });

    it('should identify record flagged for migration', () => {
      const config = { entity: 'test', tabs: [], version: 2 } as EntityFormConfig;
      expect(service.needsMigration({ _configVersion: 2, _needsMigration: true }, config)).toBe(true);
    });

    it('should NOT block submit in graceful mode', () => {
      const config = { entity: 'test', tabs: [], version: 2 } as EntityFormConfig;
      expect(service.shouldBlockSubmit({ _configVersion: 1 }, config)).toBe(false);
    });

    it('should handle missing _configVersion (assume fresh/ignore)', () => {
      const config = { entity: 'test', tabs: [], version: 5 } as EntityFormConfig;
      expect(service.needsMigration({}, config)).toBe(false);
    });
  });

  describe('with strict strategy', () => {
    let service: VersionService;

    beforeEach(() => {
      service = new VersionService('strict');
    });

    it('should block submit in strict mode if stale', () => {
      const config = { entity: 'test', tabs: [], version: 2 } as EntityFormConfig;
      expect(service.shouldBlockSubmit({ _configVersion: 1 }, config)).toBe(true);
    });

    it('should allow submit in strict mode if current', () => {
      const config = { entity: 'test', tabs: [], version: 2 } as EntityFormConfig;
      expect(service.shouldBlockSubmit({ _configVersion: 2 }, config)).toBe(false);
    });
  });

  describe('with invalid strategy token', () => {
    let service: VersionService;

    beforeEach(() => {
      service = new VersionService('invalid');
    });

    it('should return graceful for invalid strategy token', () => {
      expect(service.getStrategy()).toBe('graceful');
    });
  });
});
