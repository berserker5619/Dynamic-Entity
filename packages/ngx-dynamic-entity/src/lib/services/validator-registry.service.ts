import { Injectable, inject } from '@angular/core';
import { AsyncValidatorFn, ValidatorFn, Validators } from '@angular/forms';
import type { FieldValidators } from '@dynamic-entity/core';
import { ASYNC_VALIDATOR_REGISTRY, VALIDATOR_REGISTRY } from '../tokens/injection-tokens';

/**
 * ValidatorRegistryService — resolves validator configs / key strings to Angular ValidatorFns.
 */
@Injectable({ providedIn: 'root' })
export class ValidatorRegistryService {
  private readonly consumerRegistry = inject(VALIDATOR_REGISTRY, { optional: true }) ?? new Map();
  private readonly asyncRegistry = inject(ASYNC_VALIDATOR_REGISTRY, { optional: true }) ?? new Map();

  /**
   * Resolve a validator key string to a ValidatorFn.
   * Supports parameterized built-ins like 'min:0', 'maxLength:255'.
   */
  resolve(validatorKey: string): ValidatorFn | null {
    if (this.consumerRegistry.has(validatorKey)) {
      return this.consumerRegistry.get(validatorKey);
    }

    if (validatorKey === 'required') return Validators.required;
    if (validatorKey === 'email') return Validators.email;

    const [name, param] = validatorKey.split(':');
    const value = parseFloat(param);

    if (name === 'min' && !isNaN(value)) return Validators.min(value);
    if (name === 'max' && !isNaN(value)) return Validators.max(value);
    if (name === 'minLength' && !isNaN(value)) return Validators.minLength(value);
    if (name === 'maxLength' && !isNaN(value)) return Validators.maxLength(value);

    return null;
  }

  /** Resolve multiple validator keys into a ValidatorFn[] */
  resolveAll(validatorKeys: string[] = []): ValidatorFn[] {
    return validatorKeys.map(k => this.resolve(k)).filter((v): v is ValidatorFn => v !== null);
  }

  /** Resolve a FieldValidators object or string[] into ValidatorFn[] */
  resolveFromConfig(config?: FieldValidators | string[]): ValidatorFn[] {
    if (!config) return [];
    if (Array.isArray(config)) return this.resolveAll(config);

    const fnList: ValidatorFn[] = [];
    if (config.required) fnList.push(Validators.required);
    if (config.min !== undefined) fnList.push(Validators.min(config.min));
    if (config.max !== undefined) fnList.push(Validators.max(config.max));
    if (config.minLength !== undefined) fnList.push(Validators.minLength(config.minLength));
    if (config.maxLength !== undefined) fnList.push(Validators.maxLength(config.maxLength));
    if (config.pattern) fnList.push(Validators.pattern(config.pattern));
    if (config.email) fnList.push(Validators.email);

    // Named validators from the consumer registry. This branch previously hardcoded the
    // built-ins and consulted the registry only for the `string[]` form of this config, so
    // a validator the consumer had registered could not be named from a typed schema
    // without casting it to `any`.
    for (const key of config.custom ?? []) {
      const fn = this.resolve(key);
      if (fn) fnList.push(fn);
    }

    return fnList;
  }

  /**
   * Resolve the async validators a field names, in `validators.customAsync`.
   *
   * Async validators are deliberately a separate registry and a separate config key: Angular
   * attaches them through `setAsyncValidators`, runs them only once the synchronous ones
   * pass, and holds the control in `pending` until they settle. Mixing them into the
   * synchronous list would silently never run them.
   *
   * An unknown name is skipped rather than throwing, matching the synchronous behaviour.
   */
  resolveAsyncFromConfig(config?: FieldValidators | string[]): AsyncValidatorFn[] {
    if (!config || Array.isArray(config)) return [];

    const out: AsyncValidatorFn[] = [];
    for (const key of config.customAsync ?? []) {
      const fn = this.asyncRegistry.get(key);
      if (fn) out.push(fn);
    }
    return out;
  }
}
