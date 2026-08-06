import { Injectable, inject } from '@angular/core';
import type { EntityFormConfig, NestedFieldConfig, NestedTabConfig } from '@dynamic-entity/core';
import { shouldMaskField as coreShouldMaskField, resolveEffectiveMask as coreResolveEffectiveMask } from '@dynamic-entity/core';
import { MASKED_ROLES } from '../tokens/injection-tokens';

/**
 * RbacService — ALL permission checks and masking logic live here.
 */
@Injectable({ providedIn: 'root' })
export class RbacService {
  private readonly maskedRoles = inject(MASKED_ROLES, { optional: true }) ?? [];

  /**
   * Check if any of the user's roles satisfy the required roles.
   * hasPermission(roles, undefined) → true (no restriction).
   */
  hasPermission(userRoles: string[], requiredRoles?: string[]): boolean {
    if (!requiredRoles?.length) return true;
    return userRoles.some(r => requiredRoles.includes(r));
  }

  /** 3-level OR resolution */
  resolveEffectiveMask(formMask?: boolean, tabMask?: boolean, fieldMask?: boolean): boolean {
    return coreResolveEffectiveMask(formMask, tabMask, fieldMask);
  }

  /** Check if the user's roles include any masked role */
  isUserMaskedRole(userRoles: string[]): boolean {
    return this.maskedRoles.some(r => userRoles.includes(r));
  }

  /** Determine if a specific field should be masked for this user */
  shouldMaskField(field: NestedFieldConfig, tab: NestedTabConfig | undefined, config: EntityFormConfig, userRoles: string[]): boolean {
    return coreShouldMaskField(field, tab, config, userRoles, this.maskedRoles);
  }

  /** Get view/edit/delete permissions for a config */
  getPermissions(config: EntityFormConfig, userRoles: string[]) {
    return {
      canView: this.hasPermission(userRoles, config.permissions?.view),
      canEdit: this.hasPermission(userRoles, config.permissions?.edit),
      canDelete: this.hasPermission(userRoles, config.permissions?.delete),
    };
  }
}
