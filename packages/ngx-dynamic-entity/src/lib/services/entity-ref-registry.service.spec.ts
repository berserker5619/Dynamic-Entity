import { TestBed } from '@angular/core/testing';
import { EntityRefRegistryService } from './entity-ref-registry.service';
import { ENTITY_REF_REGISTRY } from '../tokens/injection-tokens';

describe('EntityRefRegistryService', () => {
  let service: EntityRefRegistryService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        EntityRefRegistryService,
        {
          provide: ENTITY_REF_REGISTRY,
          useValue: new Map([['loader1', () => Promise.resolve([])]])
        }
      ]
    });
    service = TestBed.inject(EntityRefRegistryService);
  });

  it('should resolve registered loaders', () => {
    expect(service.resolve('loader1')).toBeDefined();
    expect(service.has('loader1')).toBe(true);
  });

  it('should return null for unknown loaders', () => {
    expect(service.resolve('missing')).toBeNull();
    expect(service.has('missing')).toBe(false);
  });
});
