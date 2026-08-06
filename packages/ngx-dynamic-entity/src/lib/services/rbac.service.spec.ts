import { TestBed } from '@angular/core/testing';
import { RbacService } from './rbac.service';
import { MASKED_ROLES } from '../tokens/injection-tokens';
import type { EntityFormConfig, NestedFieldConfig } from '@dynamic-entity/core';

describe('RbacService', () => {
  let service: RbacService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        RbacService,
        { provide: MASKED_ROLES, useValue: ['IT_SUPPORT', 'AUDITOR'] }
      ]
    });
    service = TestBed.inject(RbacService);
  });

  it('should resolve effective mask with 3-level OR logic', () => {
    expect(service.resolveEffectiveMask(true, false, false)).toBe(true);
    expect(service.resolveEffectiveMask(false, true, false)).toBe(true);
    expect(service.resolveEffectiveMask(false, false, true)).toBe(true);
    expect(service.resolveEffectiveMask(false, false, false)).toBe(false);
  });

  it('should correctly identify masked roles', () => {
    expect(service.isUserMaskedRole(['admin', 'IT_SUPPORT'])).toBe(true);
    expect(service.isUserMaskedRole(['viewer'])).toBe(false);
  });

  it('should only mask fields if user has masked role', () => {
    const config = { entity: 'test', tabs: [], maskData: true } as EntityFormConfig;
    const field = { id: 'test', type: 'text', label: { en: 'Test' } } as NestedFieldConfig;
    
    expect(service.shouldMaskField(field, undefined, config, ['admin'])).toBe(false);
    expect(service.shouldMaskField(field, undefined, config, ['IT_SUPPORT'])).toBe(true);
  });

  it('should return correct permission object', () => {
    const config = {
      entity: 'test',
      tabs: [],
      permissions: {
        view: [],
        edit: ['admin'],
        delete: ['admin', 'super']
      }
    } as EntityFormConfig;

    const adminPerms = service.getPermissions(config, ['admin']);
    expect(adminPerms.canView).toBe(true);
    expect(adminPerms.canEdit).toBe(true);
    expect(adminPerms.canDelete).toBe(true);

    const viewerPerms = service.getPermissions(config, ['viewer']);
    expect(viewerPerms.canView).toBe(true);
    expect(viewerPerms.canEdit).toBe(false);
    expect(viewerPerms.canDelete).toBe(false);
  });
});
