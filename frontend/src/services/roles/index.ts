/**
 * Role Service Exports
 *
 * Re-exports all role service components for convenient importing.
 *
 * @example
 * import { getRoleService, type IRoleService } from '@/services/roles';
 *
 * const service = getRoleService();
 * const roles = await service.getRoles({ status: 'active' });
 */

// Interface
export type { IRoleService } from './IRoleService';

// Implementations
export { SupabaseRoleService } from './SupabaseRoleService';
export { MockRoleService } from './MockRoleService';

// Factory (primary API)
export {
  getRoleService,
  createRoleService,
  resetRoleService,
  getRoleServiceType,
  isMockRoleService,
  getRoleServiceModeDescription,
  logRoleServiceConfig,
  type RoleServiceType,
} from './RoleServiceFactory';
