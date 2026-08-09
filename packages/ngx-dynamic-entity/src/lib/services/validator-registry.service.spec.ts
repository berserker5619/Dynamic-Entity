import { TestBed } from '@angular/core/testing';
import { ValidatorRegistryService } from './validator-registry.service';
import { VALIDATOR_REGISTRY } from '../tokens/injection-tokens';
import { FormControl, Validators } from '@angular/forms';

describe('ValidatorRegistryService', () => {
  let service: ValidatorRegistryService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        ValidatorRegistryService,
        {
          provide: VALIDATOR_REGISTRY,
          useValue: new Map([['custom', () => ({ custom: true })]])
        }
      ]
    });
    service = TestBed.inject(ValidatorRegistryService);
  });

  it('should resolve built-in required validator', () => {
    const v = service.resolve('required');
    expect(v).toBe(Validators.required);
  });

  it('should resolve parameterized built-in minLength', () => {
    const v = service.resolve('minLength:5');
    expect(v).toBeDefined();
    // Test the validator function
    const result = v!({ value: 'abc' } as any);
    expect(result?.['minlength']).toBeDefined();
  });

  it('should resolve consumer-provided custom validator', () => {
    const v = service.resolve('custom');
    expect(v).toBeDefined();
    expect(v!({} as any)).toEqual({ custom: true });
  });

  it('should return null for unknown validator', () => {
    expect(service.resolve('unknown')).toBeNull();
  });

  it('should resolve multiple validators', () => {
    const vs = service.resolveAll(['required', 'custom', 'unknown']);
    expect(vs.length).toBe(2);
  });

  it('should resolve min and max validators', () => {
    expect(service.resolve('min:10')).toBeDefined();
    expect(service.resolve('max:100')).toBeDefined();
  });

  it('should resolve maxLength validator', () => {
    expect(service.resolve('maxLength:10')).toBeDefined();
  });

  it('should return null for invalid parameters', () => {
    expect(service.resolve('min:abc')).toBeNull();
    expect(service.resolve('minLength:')).toBeNull();
  });

  it('lets a consumer validator shadow a built-in key', () => {
    TestBed.resetTestingModule();
    const shadow = () => ({ shadowed: true });
    TestBed.configureTestingModule({
      providers: [
        ValidatorRegistryService,
        { provide: VALIDATOR_REGISTRY, useValue: new Map([['required', shadow]]) },
      ],
    });

    expect(TestBed.inject(ValidatorRegistryService).resolve('required')).toBe(shadow);
  });

  it('resolveAll defaults to an empty list', () => {
    expect(service.resolveAll()).toEqual([]);
  });

  /**
   * `resolveFromConfig` is the path DynamicFormComponent actually builds controls with —
   * every branch here is a validator a config author can declare.
   */
  describe('resolveFromConfig', () => {
    const errorsFor = (config: Parameters<ValidatorRegistryService['resolveFromConfig']>[0], value: unknown) => {
      const control = new FormControl(value, service.resolveFromConfig(config));
      return control.errors ?? {};
    };

    it('returns [] for a missing config', () => {
      expect(service.resolveFromConfig()).toEqual([]);
      expect(service.resolveFromConfig(undefined)).toEqual([]);
    });

    it('delegates a string[] config to resolveAll', () => {
      expect(service.resolveFromConfig(['required', 'unknown']).length).toBe(1);
    });

    it('applies required', () => {
      expect(errorsFor({ required: true }, '')['required']).toBe(true);
      expect(errorsFor({ required: true }, 'x')['required']).toBeUndefined();
    });

    it('applies min and max', () => {
      expect(errorsFor({ min: 10 }, 5)['min']).toBeDefined();
      expect(errorsFor({ max: 100 }, 500)['max']).toBeDefined();
      expect(errorsFor({ min: 10, max: 100 }, 50)).toEqual({});
    });

    it('treats a zero bound as a real bound, not as absent', () => {
      expect(errorsFor({ min: 0 }, -1)['min']).toBeDefined();
      expect(errorsFor({ max: 0 }, 1)['max']).toBeDefined();
    });

    it('applies minLength and maxLength', () => {
      expect(errorsFor({ minLength: 3 }, 'ab')['minlength']).toBeDefined();
      expect(errorsFor({ maxLength: 3 }, 'abcd')['maxlength']).toBeDefined();
    });

    it('applies pattern', () => {
      expect(errorsFor({ pattern: '^\\d+$' }, 'abc')['pattern']).toBeDefined();
      expect(errorsFor({ pattern: '^\\d+$' }, '123')).toEqual({});
    });

    it('combines every declared validator', () => {
      expect(service.resolveFromConfig({
        required: true,
        min: 1,
        max: 9,
        minLength: 1,
        maxLength: 9,
        pattern: '.*',
      }).length).toBe(6);
    });

    it('returns [] for an empty config object', () => {
      expect(service.resolveFromConfig({})).toEqual([]);
    });
  });
});
