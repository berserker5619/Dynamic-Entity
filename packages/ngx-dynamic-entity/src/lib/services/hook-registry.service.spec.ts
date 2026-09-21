import { TestBed } from '@angular/core/testing';
import { HookRegistryService } from './hook-registry.service';
import { HOOK_REGISTRY } from '../tokens/injection-tokens';

describe('HookRegistryService', () => {
  let service: HookRegistryService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        HookRegistryService,
        {
          provide: HOOK_REGISTRY,
          useValue: new Map([['test:hook', (d: any) => ({ ...d, ran: true })]])
        }
      ]
    });
    service = TestBed.inject(HookRegistryService);
  });

  it('should run registered hook', async () => {
    const result = await service.run('test:hook', { val: 1 });
    expect(result.ran).toBe(true);
    expect(result.val).toBe(1);
  });

  it('should return data unchanged if no hook exists', async () => {
    const data = { val: 1 };
    const result = await service.run('missing', data);
    expect(result).toBe(data);
  });

  it('should check existence', () => {
    expect(service.has('test:hook')).toBe(true);
    expect(service.has('missing')).toBe(false);
  });
});
