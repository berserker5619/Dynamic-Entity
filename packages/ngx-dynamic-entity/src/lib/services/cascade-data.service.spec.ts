import { TestBed } from '@angular/core/testing';
import type { EntityReferenceLoader, NestedFieldConfig } from '@dynamic-entity/core';
import { NEVER, Subject, of, throwError } from 'rxjs';
import { ENTITY_REF_REGISTRY } from '../tokens/injection-tokens';
import { CascadeDataService } from './cascade-data.service';

const CITIES = [
  { value: 'ber', label: 'Berlin', record: { country: 'de' } },
  { value: 'muc', label: 'Munich', record: { country: 'de' } },
  { value: 'par', label: 'Paris', record: { country: 'fr' } },
];

function configure(loaders: Record<string, EntityReferenceLoader> = {}): CascadeDataService {
  TestBed.configureTestingModule({
    providers: [{ provide: ENTITY_REF_REGISTRY, useValue: new Map(Object.entries(loaders)) }],
  });
  return TestBed.inject(CascadeDataService);
}

const field = (over: Partial<NestedFieldConfig> = {}): NestedFieldConfig => ({
  id: 'city',
  type: 'entity-ref',
  label: { en: 'City' },
  ...over,
});

describe('CascadeDataService', () => {
  afterEach(() => TestBed.resetTestingModule());

  describe('loader resolution', () => {
    it('uses linkedEntityKey when present, else the field id', () => {
      const service = configure();
      expect(service.entityKeyFor(field())).toBe('city');
      expect(
        service.entityKeyFor(field({ entityReference: { enabled: true, linkedEntityKey: 'cities' } })),
      ).toBe('cities');
    });

    it('reports whether a loader is registered', () => {
      const service = configure({ city: () => [] });
      expect(service.canLoad(field())).toBe(true);
      expect(service.canLoad(field({ id: 'nope' }))).toBe(false);
    });

    it('resolves to [] with no registered loader', async () => {
      expect(await configure().load(field())).toEqual([]);
    });
  });

  describe('return-type coercion', () => {
    it('accepts a plain array', async () => {
      const service = configure({ city: () => CITIES });
      expect((await service.load(field())).map(o => o.label)).toEqual(['Berlin', 'Munich', 'Paris']);
    });

    it('accepts a Promise', async () => {
      const service = configure({ city: () => Promise.resolve(CITIES) });
      expect((await service.load(field())).length).toBe(3);
    });

    it('accepts an Observable and takes the first emission', async () => {
      const subject = new Subject<typeof CITIES>();
      const service = configure({ city: () => subject });

      const pending = service.load(field());
      subject.next(CITIES);
      subject.next([]); // late emission must not win

      expect((await pending).length).toBe(3);
    });

    it('resolves [] when an Observable completes without emitting', async () => {
      const service = configure({ city: () => of<typeof CITIES>() });
      expect(await service.load(field())).toEqual([]);
    });

    it('resolves [] when an Observable errors', async () => {
      const service = configure({ city: () => throwError(() => new Error('boom')) });
      expect(await service.load(field())).toEqual([]);
    });

    it('resolves [] when a Promise rejects', async () => {
      const service = configure({ city: () => Promise.reject(new Error('boom')) });
      expect(await service.load(field())).toEqual([]);
    });

    it('resolves [] when the loader throws synchronously', async () => {
      const service = configure({
        city: () => {
          throw new Error('boom');
        },
      });
      expect(await service.load(field())).toEqual([]);
    });
  });

  describe('loader context', () => {
    it('merges config filters with caller filters, caller winning', async () => {
      const spy = jest.fn().mockReturnValue([]);
      const service = configure({ city: spy });

      await service.load(
        field({ entityReference: { enabled: true, filters: { active: true, tier: 'a' } } }),
        { filters: { tier: 'b' }, lang: 'de' },
      );

      expect(spy).toHaveBeenCalledWith(
        expect.objectContaining({ filters: { active: true, tier: 'b' }, lang: 'de' }),
      );
    });

    it('defaults lang to en and forwards parentValue', async () => {
      const spy = jest.fn().mockReturnValue([]);
      const service = configure({ city: spy });

      await service.load(field({ entityReference: { enabled: true, parentField: 'country' } }), {
        parentValue: 'de',
      });

      expect(spy).toHaveBeenCalledWith(expect.objectContaining({ lang: 'en', parentValue: 'de' }));
    });
  });

  describe('cascade gating and filtering', () => {
    const cascading = field({
      entityReference: { enabled: true, parentField: 'country', lookupFilter: 'country' },
    });

    it('does not call the loader when a cascade child has no parent value', async () => {
      const spy = jest.fn().mockReturnValue(CITIES);
      const service = configure({ city: spy });

      expect(await service.load(cascading, { parentValue: '' })).toEqual([]);
      expect(await service.load(cascading, {})).toEqual([]);
      expect(await service.load(cascading, { parentValue: null })).toEqual([]);
      expect(spy).not.toHaveBeenCalled();
    });

    it('filters by lookupFilter once a parent value is present', async () => {
      const service = configure({ city: () => CITIES });
      const options = await service.load(cascading, { parentValue: 'de' });
      expect(options.map(o => o.label)).toEqual(['Berlin', 'Munich']);
    });

    it('loads unfiltered for a non-cascading field', async () => {
      const service = configure({ city: () => CITIES });
      expect((await service.load(field(), { parentValue: 'de' })).length).toBe(3);
    });

    it('normalises bare records using displayFields', async () => {
      const service = configure({ city: () => [{ id: 1, name: 'Berlin' }] as never });
      const options = await service.load(
        field({ entityReference: { enabled: true, displayFields: ['name'] } }),
      );

      expect(options[0]).toEqual({ value: 1, label: 'Berlin', record: { id: 1, name: 'Berlin' } });
    });

    it('stays pending on a never-emitting Observable rather than resolving empty', async () => {
      // Documents a real constraint: the field shows its loading state until the loader
      // emits. A consumer's Observable must emit (or complete) for the load to finish.
      const service = configure({ city: () => NEVER as never });
      const pending = service.load(field()).then(() => 'settled' as const);
      const timeout = new Promise<'pending'>(resolve => setTimeout(() => resolve('pending'), 20));

      expect(await Promise.race([pending, timeout])).toBe('pending');
    });
  });
});

/**
 * Preload (Parity Plan phase 5). Warms the option cache for a config's cascades so that
 * changing a parent resolves from memory rather than a round-trip.
 */
describe('CascadeDataService — preload', () => {
  const CONFIG = {
    entity: 'orders',
    tabs: [
      {
        id: 'main',
        label: { en: 'Main' },
        fields: [
          { id: 'plain', type: 'text' as const, label: { en: 'Plain' } },
          {
            id: 'city',
            type: 'entity-ref' as const,
            label: { en: 'City' },
            entityReference: {
              enabled: true,
              linkedEntityKey: 'cities',
              parentField: 'country',
              lookupFilter: 'country',
            },
          },
        ],
        children: [
          {
            id: 'sub',
            label: { en: 'Sub' },
            fields: [
              {
                id: 'district',
                type: 'entity-ref' as const,
                label: { en: 'District' },
                entityReference: {
                  enabled: true,
                  linkedEntityKey: 'districts',
                  parentField: 'city',
                  lookupFilter: 'city',
                },
              },
            ],
          },
        ],
      },
    ],
  };

  afterEach(() => TestBed.resetTestingModule());

  it('loads every cascading entity once, including nested tabs', async () => {
    const cities = jest.fn().mockResolvedValue(CITIES);
    const districts = jest.fn().mockResolvedValue([]);
    const service = configure({ cities, districts });

    await service.initializeCascadeData('orders', CONFIG as never);

    expect(cities).toHaveBeenCalledTimes(1);
    expect(districts).toHaveBeenCalledTimes(1);
  });

  it('joins an in-flight run rather than fetching twice', async () => {
    const cities = jest.fn().mockResolvedValue(CITIES);
    const service = configure({ cities, districts: () => [] });

    await Promise.all([
      service.initializeCascadeData('orders', CONFIG as never),
      service.initializeCascadeData('orders', CONFIG as never),
    ]);

    expect(cities).toHaveBeenCalledTimes(1);
  });

  it('waitForData reports false before a preload and true after', async () => {
    const service = configure({ cities: () => CITIES, districts: () => [] });

    expect(await service.waitForData('orders')).toBe(false);
    await service.initializeCascadeData('orders', CONFIG as never);
    expect(await service.waitForData('orders')).toBe(true);
  });

  it('serves child options from cache with no further loader call', async () => {
    const cities = jest.fn().mockResolvedValue(CITIES);
    const service = configure({ cities, districts: () => [] });
    await service.initializeCascadeData('orders', CONFIG as never);

    const field = CONFIG.tabs[0].fields[1];
    expect(service.getCachedChildOptions(field as never, 'de').map(o => o.label)).toEqual([
      'Berlin',
      'Munich',
    ]);
    expect(cities).toHaveBeenCalledTimes(1);
  });

  it('returns [] from the cache-only path when nothing was preloaded', () => {
    const service = configure({ cities: () => CITIES });
    expect(service.getCachedChildOptions(CONFIG.tabs[0].fields[1] as never, 'de')).toEqual([]);
  });

  it('clearCache lets a later preload run again', async () => {
    const cities = jest.fn().mockResolvedValue(CITIES);
    const service = configure({ cities, districts: () => [] });

    await service.initializeCascadeData('orders', CONFIG as never);
    service.clearCache('orders');
    await service.initializeCascadeData('orders', CONFIG as never);

    // The preload re-runs, but the option cache still answers, so no second fetch.
    expect(cities).toHaveBeenCalledTimes(1);
    expect(await service.waitForData('orders')).toBe(true);
  });
});
