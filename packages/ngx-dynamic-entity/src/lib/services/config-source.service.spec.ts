import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import type { EntityFormConfig } from '@dynamic-entity/core';
import { CONFIG_SOURCE } from '../tokens/injection-tokens';
import { ConfigSourceService } from './config-source.service';

describe('ConfigSourceService', () => {
  const mockUserConfig: EntityFormConfig = {
    entity: 'users',
    version: 1,
    tabs: [
      {
        id: 'main',
        label: { en: 'Main' },
        fields: [
          { id: 'email', type: 'email', label: { en: 'Email' } },
        ],
      },
    ],
  };

  it('returns undefined gracefully when no CONFIG_SOURCE is provided', async () => {
    TestBed.configureTestingModule({});
    const service = TestBed.inject(ConfigSourceService);
    const result = await service.getConfig('users');
    expect(result).toBeUndefined();
  });

  it('resolves config synchronously or asynchronously from handler', async () => {
    const handler = jest.fn((key: string) => {
      if (key === 'users') return Promise.resolve(mockUserConfig);
      if (key === 'orders') return of({ entity: 'orders', version: 1, tabs: [] });
      return undefined;
    });

    TestBed.configureTestingModule({
      providers: [{ provide: CONFIG_SOURCE, useValue: handler }],
    });

    const service = TestBed.inject(ConfigSourceService);

    const userCfg = await service.getConfig('users');
    expect(userCfg).toEqual(mockUserConfig);
    expect(handler).toHaveBeenCalledWith('users');

    const orderCfg = await service.getConfig('orders');
    expect(orderCfg?.entity).toBe('orders');
  });

  it('caches resolved configs and deduplicates in-flight calls', async () => {
    let callCount = 0;
    const handler = jest.fn(() => {
      callCount++;
      return new Promise<EntityFormConfig>(resolve => setTimeout(() => resolve(mockUserConfig), 10));
    });

    TestBed.configureTestingModule({
      providers: [{ provide: CONFIG_SOURCE, useValue: handler }],
    });

    const service = TestBed.inject(ConfigSourceService);

    const p1 = service.getConfig('users');
    const p2 = service.getConfig('users');

    const [res1, res2] = await Promise.all([p1, p2]);

    expect(res1).toEqual(mockUserConfig);
    expect(res2).toEqual(mockUserConfig);
    expect(callCount).toBe(1);

    // Subsequent call hits cache
    const res3 = await service.getConfig('users');
    expect(res3).toEqual(mockUserConfig);
    expect(callCount).toBe(1);
  });
});

describe('ConfigSourceService — failure and cache invalidation', () => {
  const cfg = (entity: string): EntityFormConfig => ({
    entity,
    version: 1,
    tabs: [{ id: 'main', label: { en: 'Main' }, fields: [] }],
  });

  /**
   * A loader that throws must not take the caller down with it — the builder asks for a
   * source config on every keystroke in the referenced-field editor.
   */
  it('returns undefined and warns when the handler rejects', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [{ provide: CONFIG_SOURCE, useValue: () => Promise.reject(new Error('boom')) }],
    });
    const service = TestBed.inject(ConfigSourceService);

    await expect(service.getConfig('users')).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('failed to load config for entity "users"'),
      expect.any(Error),
    );
    warn.mockRestore();
  });

  it('does not cache a failed load, so a later attempt can succeed', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    let attempt = 0;
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        {
          provide: CONFIG_SOURCE,
          useValue: () => (++attempt === 1 ? Promise.reject(new Error('boom')) : cfg('users')),
        },
      ],
    });
    const service = TestBed.inject(ConfigSourceService);

    expect(await service.getConfig('users')).toBeUndefined();
    expect((await service.getConfig('users'))?.entity).toBe('users');
    warn.mockRestore();
  });

  it('clears one entity from the cache, leaving the rest', async () => {
    const handler = jest.fn((key: string) => cfg(key));
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [{ provide: CONFIG_SOURCE, useValue: handler }] });
    const service = TestBed.inject(ConfigSourceService);

    await service.getConfig('users');
    await service.getConfig('orders');
    expect(handler).toHaveBeenCalledTimes(2);

    // Cached: no further calls.
    await service.getConfig('users');
    expect(handler).toHaveBeenCalledTimes(2);

    service.clearCache('users');
    await service.getConfig('users');
    expect(handler).toHaveBeenCalledTimes(3);

    await service.getConfig('orders'); // still cached
    expect(handler).toHaveBeenCalledTimes(3);
  });

  it('clears every entity when called with no key', async () => {
    const handler = jest.fn((key: string) => cfg(key));
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [{ provide: CONFIG_SOURCE, useValue: handler }] });
    const service = TestBed.inject(ConfigSourceService);

    await service.getConfig('users');
    await service.getConfig('orders');
    expect(handler).toHaveBeenCalledTimes(2);

    service.clearCache();
    await service.getConfig('users');
    await service.getConfig('orders');
    expect(handler).toHaveBeenCalledTimes(4);
  });
});
