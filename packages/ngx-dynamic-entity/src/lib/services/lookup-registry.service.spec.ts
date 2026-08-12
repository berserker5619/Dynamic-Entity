import { TestBed } from '@angular/core/testing';
import type { LookupListSource, NestedFieldConfig } from '@dynamic-entity/core';
import { LOOKUP_REGISTRY } from '../tokens/injection-tokens';
import { LookupRegistryService } from './lookup-registry.service';

function withLists(lists: Record<string, LookupListSource>): LookupRegistryService {
  TestBed.configureTestingModule({
    providers: [{ provide: LOOKUP_REGISTRY, useValue: new Map(Object.entries(lists)) }],
  });
  return TestBed.inject(LookupRegistryService);
}

const field = (over: Partial<NestedFieldConfig> = {}): NestedFieldConfig =>
  ({ id: 'status', type: 'dropdown', label: { en: 'Status' }, ...over }) as NestedFieldConfig;

describe('LookupRegistryService', () => {
  afterEach(() => TestBed.resetTestingModule());

  describe('sources', () => {
    it('resolves a plain array of values', async () => {
      const service = withLists({ status: [{ name: { en: 'Active' } }] });
      expect(await service.load('status')).toEqual([{ en: 'Active' }]);
    });

    it('resolves bare strings', async () => {
      const service = withLists({ grades: ['Junior', 'Senior'] });
      expect(await service.load('grades')).toEqual([{ en: 'Junior' }, { en: 'Senior' }]);
    });

    it('resolves a loader function, passing the language', async () => {
      const loader = jest.fn().mockReturnValue([{ name: { en: 'Active' } }]);
      const service = withLists({ status: loader });

      await service.load('status', 'de');

      expect(loader).toHaveBeenCalledWith({ lang: 'de' });
    });

    it('resolves a Promise', async () => {
      const service = withLists({ status: Promise.resolve([{ name: { en: 'Active' } }]) });
      expect(await service.load('status')).toEqual([{ en: 'Active' }]);
    });

    it('resolves an Observable-like source on its first emission', async () => {
      const service = withLists({
        status: {
          subscribe: (observer: any) => {
            observer.next([{ name: { en: 'Active' } }]);
            return { unsubscribe: () => undefined };
          },
        } as LookupListSource,
      });
      expect(await service.load('status')).toEqual([{ en: 'Active' }]);
    });

    it('treats a stream that completes without emitting as an empty list', async () => {
      const service = withLists({
        status: { subscribe: (observer: any) => observer.complete() } as LookupListSource,
      });
      expect(await service.load('status')).toEqual([]);
    });

    it('returns an empty list for an unregistered name, and reports `has`', () => {
      const service = withLists({ status: [] });
      expect(service.has('status')).toBe(true);
      expect(service.has('nope')).toBe(false);
      return expect(service.load('nope')).resolves.toEqual([]);
    });

    it('applies sortOrder from the list values', async () => {
      const service = withLists({
        status: [
          { name: { en: 'Second' }, sortOrder: 2 },
          { name: { en: 'First' }, sortOrder: 1 },
        ],
      });
      expect(await service.load('status')).toEqual([{ en: 'First' }, { en: 'Second' }]);
    });
  });

  describe('caching', () => {
    it('loads a list once, however many callers ask', async () => {
      const loader = jest.fn().mockResolvedValue([{ name: { en: 'Active' } }]);
      const service = withLists({ status: loader });

      const [a, b] = await Promise.all([service.load('status'), service.load('status')]);

      expect(loader).toHaveBeenCalledTimes(1);
      expect(a).toEqual(b);
    });

    it('serves a second load from cache', async () => {
      const loader = jest.fn().mockResolvedValue([{ name: { en: 'Active' } }]);
      const service = withLists({ status: loader });

      await service.load('status');
      await service.load('status');

      expect(loader).toHaveBeenCalledTimes(1);
    });

    it('keys the cache by language', async () => {
      const loader = jest.fn().mockResolvedValue([{ name: { en: 'Active' } }]);
      const service = withLists({ status: loader });

      await service.load('status', 'en');
      await service.load('status', 'de');

      expect(loader).toHaveBeenCalledTimes(2);
    });

    it('peeks without loading', async () => {
      const service = withLists({ status: [{ name: { en: 'Active' } }] });

      expect(service.peek('status')).toBeUndefined();
      await service.load('status');
      expect(service.peek('status')).toEqual([{ en: 'Active' }]);
    });

    it('does not cache a failed load, and retries on the next call', async () => {
      const loader = jest
        .fn()
        .mockRejectedValueOnce(new Error('network'))
        .mockResolvedValue([{ name: { en: 'Active' } }]);
      const service = withLists({ status: loader });

      expect(await service.load('status')).toEqual([]);
      expect(service.peek('status')).toBeUndefined();
      expect(await service.load('status')).toEqual([{ en: 'Active' }]);
      expect(loader).toHaveBeenCalledTimes(2);
    });

    it('treats a loader that throws synchronously as a failed load', async () => {
      const service = withLists({
        status: () => {
          throw new Error('boom');
        },
      });
      expect(await service.load('status')).toEqual([]);
      expect(service.peek('status')).toBeUndefined();
    });

    it('invalidates one list without touching the others', async () => {
      const service = withLists({
        status: [{ name: { en: 'Active' } }],
        grades: [{ name: { en: 'Senior' } }],
      });
      await service.load('status');
      await service.load('grades');

      service.invalidate('status');

      expect(service.peek('status')).toBeUndefined();
      expect(service.peek('grades')).toEqual([{ en: 'Senior' }]);
    });

    it('clears everything', async () => {
      const service = withLists({ status: [{ name: { en: 'Active' } }] });
      await service.load('status');

      service.clear();

      expect(service.peek('status')).toBeUndefined();
      expect(service.labelFor('status', 'Active')).toBeUndefined();
    });
  });

  describe('valuesFor', () => {
    it('exposes the metadata the option shape drops', async () => {
      const service = withLists({
        status: [{ _id: 'a1', code: 'ACT', name: { en: 'Active' }, isSystemDefined: true }],
      });
      await service.load('status');

      expect(service.valuesFor('status')).toEqual([
        { _id: 'a1', code: 'ACT', name: { en: 'Active' }, isSystemDefined: true },
      ]);
    });

    it('is undefined before the list loads', () => {
      expect(withLists({ status: [] }).valuesFor('status')).toBeUndefined();
    });
  });

  describe('labelFor — the synchronous read-only path (§6.2)', () => {
    it('resolves a stored value without awaiting, once the list is warm', async () => {
      const service = withLists({ status: [{ name: { en: 'Active', de: 'Aktiv' } }] });
      await service.load('status', 'en');

      expect(service.labelFor('status', { en: 'Active', de: 'Aktiv' }, 'en')).toBe('Active');
    });

    it('resolves a value stored under another language', async () => {
      const service = withLists({ status: [{ name: { en: 'Active', de: 'Aktiv' } }] });
      await service.load('status', 'en');

      expect(service.labelFor('status', 'Aktiv', 'en')).toBe('Active');
    });

    it('returns the text for the requested language', async () => {
      const service = withLists({ status: [{ name: { en: 'Active', de: 'Aktiv' } }] });
      await service.load('status', 'de');

      expect(service.labelFor('status', 'Active', 'de')).toBe('Aktiv');
    });

    it('is undefined on a cold miss, so the caller keeps its own fallback', () => {
      const service = withLists({ status: [{ name: { en: 'Active' } }] });
      expect(service.labelFor('status', { en: 'Active' })).toBeUndefined();
    });

    it('is undefined for an unknown value, an empty value, or no list name', async () => {
      const service = withLists({ status: [{ name: { en: 'Active' } }] });
      await service.load('status');

      expect(service.labelFor('status', { en: 'Retired' })).toBeUndefined();
      expect(service.labelFor('status', '')).toBeUndefined();
      expect(service.labelFor('status', null)).toBeUndefined();
      expect(service.labelFor(undefined, { en: 'Active' })).toBeUndefined();
    });
  });

  describe('field resolution — inline options win (§6.3)', () => {
    it('needs no resolve for inline options, or for a field with neither source', () => {
      const service = withLists({ status: [] });

      expect(service.needsResolve(field({ options: [{ en: 'A' }] }))).toBe(false);
      expect(service.needsResolve(field())).toBe(false);
      expect(service.needsResolve(field({ listName: 'status' }))).toBe(true);
      expect(service.needsResolve(undefined)).toBe(false);
    });

    it('prefers inline options over a named list when a field carries both', async () => {
      const loader = jest.fn().mockResolvedValue([{ name: { en: 'FromList' } }]);
      const service = withLists({ status: loader });
      const both = field({ listName: 'status', options: [{ en: 'Inline' }] });

      expect(service.optionsFor(both)).toEqual([{ en: 'Inline' }]);
      expect(await service.resolveOptions(both)).toEqual([{ en: 'Inline' }]);
      expect(loader).not.toHaveBeenCalled();
    });

    it('is empty synchronously on a cold list, and filled after resolve', async () => {
      const service = withLists({ status: [{ name: { en: 'Active' } }] });
      const listField = field({ listName: 'status' });

      expect(service.optionsFor(listField)).toEqual([]);
      expect(await service.resolveOptions(listField)).toEqual([{ en: 'Active' }]);
      expect(service.optionsFor(listField)).toEqual([{ en: 'Active' }]);
    });

    it('is empty for a missing field', () => {
      expect(withLists({}).optionsFor(undefined)).toEqual([]);
    });
  });
});
