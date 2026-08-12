import { TestBed } from '@angular/core/testing';
import type { EntityReferenceLoader } from '@dynamic-entity/core';
import { ENTITY_REF_CACHE_STORE, ENTITY_REF_REGISTRY } from '../tokens/injection-tokens';
import { InMemoryEntityRefCacheStore } from './entity-ref-cache';
import { EntityReferenceService } from './entity-reference.service';

const COUNTRIES = [
  { value: 'de', label: 'Germany' },
  { value: 'fr', label: 'France' },
];

function configure(loaders: Record<string, EntityReferenceLoader>): EntityReferenceService {
  TestBed.configureTestingModule({
    providers: [{ provide: ENTITY_REF_REGISTRY, useValue: new Map(Object.entries(loaders)) }],
  });
  return TestBed.inject(EntityReferenceService);
}

describe('EntityReferenceService', () => {
  afterEach(() => TestBed.resetTestingModule());

  describe('options cache', () => {
    it('calls the loader once and serves the second call from cache', async () => {
      const loader = jest.fn().mockResolvedValue(COUNTRIES);
      const service = configure({ countries: loader });

      const first = await service.load('countries');
      const second = await service.load('countries');

      expect(loader).toHaveBeenCalledTimes(1);
      expect(second).toBe(first);
    });

    it('de-duplicates concurrent loads into one request', async () => {
      // The layer that actually removes duplicate HTTP calls: an options cache alone does
      // nothing when N fields load the same entity simultaneously on form init.
      let resolveLoad!: (v: typeof COUNTRIES) => void;
      const loader = jest.fn().mockReturnValue(new Promise(res => (resolveLoad = res)));
      const service = configure({ countries: loader });

      const a = service.load('countries');
      const b = service.load('countries');
      resolveLoad(COUNTRIES);

      expect(await a).toEqual(await b);
      expect(loader).toHaveBeenCalledTimes(1);
    });

    it('caches per language', async () => {
      const loader = jest.fn().mockResolvedValue(COUNTRIES);
      const service = configure({ countries: loader });

      await service.load('countries', { lang: 'en' });
      await service.load('countries', { lang: 'de' });

      expect(loader).toHaveBeenCalledTimes(2);
    });

    it('does not fork the cache on filter or displayField ordering', async () => {
      const loader = jest.fn().mockResolvedValue(COUNTRIES);
      const service = configure({ countries: loader });

      await service.load('countries', { filters: { a: 1, b: 2 }, displayFields: ['x', 'y'] });
      await service.load('countries', { filters: { b: 2, a: 1 }, displayFields: ['y', 'x'] });

      expect(loader).toHaveBeenCalledTimes(1);
    });

    it('caches distinct filters separately', async () => {
      const loader = jest.fn().mockResolvedValue(COUNTRIES);
      const service = configure({ countries: loader });

      await service.load('countries', { filters: { active: true } });
      await service.load('countries', { filters: { active: false } });

      expect(loader).toHaveBeenCalledTimes(2);
    });

    it('returns [] and caches nothing when no loader is registered', async () => {
      const service = configure({});
      expect(await service.load('missing')).toEqual([]);
      expect(service.peek('missing')).toBeUndefined();
    });

    it('recovers from a rejected load rather than caching the failure', async () => {
      const loader = jest.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValue(COUNTRIES);
      const service = configure({ countries: loader });

      expect(await service.load('countries')).toEqual([]);
      expect(await service.load('countries')).toHaveLength(2);
    });
  });

  describe('peek', () => {
    it('returns undefined before a load and the options after', async () => {
      const service = configure({ countries: () => COUNTRIES });

      expect(service.peek('countries')).toBeUndefined();
      await service.load('countries');
      expect(service.peek('countries')).toHaveLength(2);
    });

    it('never triggers a load', () => {
      const loader = jest.fn().mockResolvedValue(COUNTRIES);
      const service = configure({ countries: loader });

      service.peek('countries');
      expect(loader).not.toHaveBeenCalled();
    });
  });

  describe('label cache', () => {
    it('resolves a stored value to its text synchronously once loaded', async () => {
      const service = configure({ countries: () => COUNTRIES });
      await service.load('countries');

      expect(service.labelFor('countries', 'de')).toBe('Germany');
    });

    it('returns undefined for an unknown value or an unloaded entity', async () => {
      const service = configure({ countries: () => COUNTRIES });
      expect(service.labelFor('countries', 'de')).toBeUndefined();

      await service.load('countries');
      expect(service.labelFor('countries', 'zz')).toBeUndefined();
    });
  });

  describe('invalidation', () => {
    it('drops one entity and leaves the others cached', async () => {
      const countries = jest.fn().mockResolvedValue(COUNTRIES);
      const cities = jest.fn().mockResolvedValue([{ value: 'ber', label: 'Berlin' }]);
      const service = configure({ countries, cities });

      await service.load('countries');
      await service.load('cities');

      service.invalidate('countries');

      expect(service.peek('countries')).toBeUndefined();
      expect(service.peek('cities')).toHaveLength(1);
    });

    it('drops the entity label cache too', async () => {
      const service = configure({ countries: () => COUNTRIES });
      await service.load('countries');

      service.invalidate('countries');
      expect(service.labelFor('countries', 'de')).toBeUndefined();
    });

    it('invalidates every language and filter variant of that entity', async () => {
      const loader = jest.fn().mockResolvedValue(COUNTRIES);
      const service = configure({ countries: loader });
      await service.load('countries', { lang: 'en' });
      await service.load('countries', { lang: 'de' });

      service.invalidate('countries');

      expect(service.peek('countries', { lang: 'en' })).toBeUndefined();
      expect(service.peek('countries', { lang: 'de' })).toBeUndefined();
    });

    it('clear() empties everything', async () => {
      const service = configure({ countries: () => COUNTRIES });
      await service.load('countries');

      service.clear();
      expect(service.peek('countries')).toBeUndefined();
      expect(service.labelFor('countries', 'de')).toBeUndefined();
    });
  });

  describe('pluggable store', () => {
    it('reads options seeded into a consumer-supplied store without calling the loader', async () => {
      // Proves the cache can outlive a page refresh when backed by persistent storage.
      const store = new InMemoryEntityRefCacheStore();
      const loader = jest.fn().mockResolvedValue(COUNTRIES);

      TestBed.configureTestingModule({
        providers: [
          { provide: ENTITY_REF_REGISTRY, useValue: new Map([['countries', loader]]) },
          { provide: ENTITY_REF_CACHE_STORE, useValue: store },
        ],
      });
      const service = TestBed.inject(EntityReferenceService);
      await service.load('countries');

      TestBed.resetTestingModule();
      TestBed.configureTestingModule({
        providers: [
          { provide: ENTITY_REF_REGISTRY, useValue: new Map([['countries', loader]]) },
          { provide: ENTITY_REF_CACHE_STORE, useValue: store },
        ],
      });
      const revived = TestBed.inject(EntityReferenceService);

      expect(await revived.load('countries')).toHaveLength(2);
      expect(loader).toHaveBeenCalledTimes(1);
    });
  });
});
