/**
 * User Services Module
 *
 * Exports user management services following the CQRS pattern:
 * - Query services for reading user and invitation data
 * - Command services for write operations
 * - Factory functions for service instantiation
 *
 * Usage:
 * ```typescript
 * import {
 *   getUserQueryService,
 *   getUserCommandService,
 *   type IUserQueryService,
 *   type IUserCommandService,
 * } from '@/services/users';
 *
 * const queryService = getUserQueryService();
 * const users = await queryService.getUsersPaginated();
 *
 * const commandService = getUserCommandService();
 * await commandService.inviteUser(request);
 * ```
 *
 * @see IUserQueryService for query interface
 * @see IUserCommandService for command interface
 */

// Interfaces
export type { IUserQueryService } from './IUserQueryService';
export type { IUserCommandService } from './IUserCommandService';

// Mock implementations
export { MockUserQueryService } from './MockUserQueryService';
export { MockUserCommandService } from './MockUserCommandService';

// Supabase implementations
export { SupabaseUserQueryService } from './SupabaseUserQueryService';
export { SupabaseUserCommandService } from './SupabaseUserCommandService';

// Factory
export {
  getUserQueryService,
  getUserCommandService,
  createUserQueryService,
  createUserCommandService,
  resetUserServices,
  isMockUserService,
  getUserServiceType,
  getUserServiceModeDescription,
  logUserServiceConfig,
  type UserServiceType,
} from './UserServiceFactory';
