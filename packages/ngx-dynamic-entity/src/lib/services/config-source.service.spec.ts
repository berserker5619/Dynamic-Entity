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
