import { TestBed } from '@angular/core/testing';
import { ConfigSourceService } from './config-source.service';
import { EntityRefRegistryService } from './entity-ref-registry.service';
import { FileUploadService } from './file-upload.service';
import { ValidatorRegistryService } from './validator-registry.service';
import { CONFIG_SOURCE } from '../tokens/injection-tokens';

/**
 * The services when the thing they depend on is not there.
 *
 * Every registry in this library is optional: a consumer opts into upload handling, entity
 * references, validators and config loading one token at a time. The branch taken when a
 * token is absent is therefore the *common* path for most consumers, not an edge — and it
 * was the one carrying no coverage.
 */
describe('services without their optional token', () => {
  afterEach(() => TestBed.resetTestingModule());

  describe('EntityRefRegistryService', () => {
    it('resolves nothing rather than throwing when no loaders are registered', () => {
      TestBed.configureTestingModule({});
      const service = TestBed.inject(EntityRefRegistryService);

      // An app with no entity-ref loaders is a normal app, not a misconfigured one.
      expect(service.has('companies')).toBe(false);
      expect(service.resolve('companies')).toBeNull();
    });
  });

  describe('FileUploadService', () => {
    it('reports no handler when none is provided', () => {
      TestBed.configureTestingModule({});
      expect(TestBed.inject(FileUploadService).hasHandler).toBe(false);
    });

    /**
     * jsdom defines no `URL.revokeObjectURL`, which is exactly why the service feature-tests
     * it before calling. Installing a stand-in lets the other two branches be reached.
     */
    function withRevoke(run: (revoke: jest.Mock) => void): void {
      const target = URL as unknown as Record<string, unknown>;
      const had = 'revokeObjectURL' in target;
      const original = target['revokeObjectURL'];
      const revoke = jest.fn();
      target['revokeObjectURL'] = revoke;
      try {
        run(revoke);
      } finally {
        if (had) target['revokeObjectURL'] = original;
        else delete target['revokeObjectURL'];
      }
    }

    it('ignores a revoke for a value that is not an object URL', () => {
      TestBed.configureTestingModule({});
      const service = TestBed.inject(FileUploadService);

      withRevoke(revoke => {
        // Only URLs this service minted may be revoked. Revoking a plain http URL is
        // meaningless, and revoking null throws in some browsers.
        service.revokePreviewUrl(null);
        service.revokePreviewUrl('https://example.com/a.png');
        expect(revoke).not.toHaveBeenCalled();
      });
    });

    it('revokes a blob URL it recognises', () => {
      TestBed.configureTestingModule({});
      const service = TestBed.inject(FileUploadService);

      withRevoke(revoke => {
        service.revokePreviewUrl('blob:http://localhost/abc');
        expect(revoke).toHaveBeenCalledWith('blob:http://localhost/abc');
      });
    });

    it('does not throw where the browser has no revokeObjectURL at all', () => {
      TestBed.configureTestingModule({});
      const service = TestBed.inject(FileUploadService);
      // jsdom's default state, and older browsers'. The feature test is the point.
      expect(() => service.revokePreviewUrl('blob:http://localhost/abc')).not.toThrow();
    });

    it('returns no preview url for an absent file reference', () => {
      TestBed.configureTestingModule({});
      const service = TestBed.inject(FileUploadService);
      expect(service.previewUrlFor(null)).toBeNull();
      expect(service.previewUrlFor(undefined)).toBeNull();
    });
  });

  describe('ValidatorRegistryService', () => {
    it('resolves the built-in keys without any consumer registry', () => {
      TestBed.configureTestingModule({});
      const service = TestBed.inject(ValidatorRegistryService);

      // `required` and `email` are built in; everything else has to be registered.
      expect(service.resolve('required')).not.toBeNull();
      expect(service.resolve('email')).not.toBeNull();
      expect(service.resolve('nobodyRegisteredThis')).toBeNull();
    });

    it('skips a named async validator that was never registered', () => {
      TestBed.configureTestingModule({});
      const service = TestBed.inject(ValidatorRegistryService);

      // A config naming a validator the app did not provide must not crash the form; the
      // field simply is not checked, which `validateConfig` reports separately.
      expect(service.resolveAsyncFromConfig({ customAsync: ['missing'] })).toEqual([]);
    });

    it('returns nothing for an absent validator config', () => {
      TestBed.configureTestingModule({});
      const service = TestBed.inject(ValidatorRegistryService);
      expect(service.resolveFromConfig(undefined)).toEqual([]);
      expect(service.resolveAsyncFromConfig(undefined)).toEqual([]);
    });
  });

  describe('ConfigSourceService', () => {
    it('resolves undefined when no CONFIG_SOURCE is provided', async () => {
      TestBed.configureTestingModule({});
      await expect(TestBed.inject(ConfigSourceService).getConfig('clients')).resolves.toBeUndefined();
    });

    it('does not cache a miss, so a later successful load is not shadowed', async () => {
      let call = 0;
      TestBed.configureTestingModule({
        providers: [
          {
            provide: CONFIG_SOURCE,
            useValue: (key: string) =>
              // First ask fails, second succeeds — an API that was briefly unavailable.
              ++call === 1 ? undefined : { entity: key, tabs: [] },
          },
        ],
      });
      const service = TestBed.inject(ConfigSourceService);

      await expect(service.getConfig('clients')).resolves.toBeUndefined();
      // Caching the miss would make the entity permanently unavailable for the session.
      await expect(service.getConfig('clients')).resolves.toEqual({ entity: 'clients', tabs: [] });
    });

    it('clears one entity without discarding the rest of the cache', async () => {
      const loaded: string[] = [];
      TestBed.configureTestingModule({
        providers: [
          {
            provide: CONFIG_SOURCE,
            useValue: (key: string) => {
              loaded.push(key);
              return { entity: key, tabs: [] };
            },
          },
        ],
      });
      const service = TestBed.inject(ConfigSourceService);

      await service.getConfig('clients');
      await service.getConfig('orders');
      service.clearCache('clients');

      await service.getConfig('clients');
      await service.getConfig('orders');
      // `clients` is fetched twice, `orders` once: clearing is per entity, as the builder
      // relies on when it saves one config and leaves the others alone.
      expect(loaded).toEqual(['clients', 'orders', 'clients']);
    });
  });
});
