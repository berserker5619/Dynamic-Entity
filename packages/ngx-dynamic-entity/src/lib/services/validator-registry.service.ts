import { Injectable, inject } from '@angular/core';
import { ValidatorFn, Validators } from '@angular/forms';
import type { FieldValidators } from '@dynamic-entity/core';
import { VALIDATOR_REGISTRY } from '../tokens/injection-tokens';

/**
 * ValidatorRegistryService — resolves validator configs / key strings to Angular ValidatorFns.
 */
@Injectable({ providedIn: 'root' })
export class ValidatorRegistryService {
  private readonly consumerRegistry = inject(VALIDATOR_REGISTRY, { optional: true }) ?? new Map();

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

    return fnList;
  }
}
