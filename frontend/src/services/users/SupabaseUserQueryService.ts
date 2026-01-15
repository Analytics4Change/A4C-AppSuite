/**
 * Supabase User Query Service
 *
 * Production implementation of IUserQueryService using Supabase RPC functions
 * for reads. Follows CQRS pattern - all queries via api.* schema RPC functions.
 *
 * Architecture:
 * - CRITICAL: All user list queries via api.list_users() RPC
 * - RPC calls for complex lookups (email status, assignable roles)
 * - NEVER use direct table queries with PostgREST embedding
 * - All queries scoped to current org via RLS + JWT claims
 *
 * @see IUserQueryService for interface documentation
 */

import type { IUserQueryService } from './IUserQueryService';
import type {
  UserWithRoles,
  UserListItem,
  Invitation,
  EmailLookupResult,
  EmailLookupStatus,
  UserQueryOptions,
  PaginatedResult,
  RoleReference,
  UserDisplayStatus,
  UserAddress,
  UserPhone,
  UserOrgAccess,
  NotificationPreferences,
} from '@/types/user.types';
import { DEFAULT_NOTIFICATION_PREFERENCES } from '@/types/user.types';
import type { Role } from '@/types/role.types';
import { supabaseService } from '@/services/auth/supabase.service';
import { Logger } from '@/utils/logger';

const log = Logger.getLogger('api');

// ============================================================================
// JWT Claims Type
// ============================================================================

interface DecodedJWTClaims {
  org_id?: string;
  user_role?: string;
  permissions?: string[];
  sub?: string;
}

// ============================================================================
// Database Row Types (for untyped Supabase responses)
// ============================================================================

/** User row from users table */
interface DbUserRow {
  id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  name: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  last_login_at: string | null;
  current_organization_id: string | null;
  user_roles_projection?: DbUserRoleRow[];
}

/** User role row from user_roles_projection */
interface DbUserRoleRow {
  role_id: string;
  organization_id: string;
  scope_path: string | null;
  role_valid_from: string | null;
  role_valid_until: string | null;
  roles_projection?: DbRoleRow;
}

/** Role row from roles_projection */
interface DbRoleRow {
  id: string;
  name: string;
  description: string | null;
  organization_id: string | null;
  org_hierarchy_scope: string | null;
  is_active: boolean;
  created_at: string;
  updated_at?: string;
  permission_count?: number;
  user_count?: number;
}

/** Invitation row from invitations_projection */
interface DbInvitationRow {
  id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  organization_id: string;
  roles: Array<{ role_id: string; role_name: string }> | null;
  token: string | null;
  status: string;
  expires_at: string;
  access_start_date: string | null;
  access_expiration_date: string | null;
  notification_preferences: Record<string, unknown> | null;
  accepted_at: string | null;
  created_at: string;
  updated_at: string | null;
}

/** User address row from user_addresses */
interface DbUserAddressRow {
  id: string;
  user_id: string;
  org_id: string | null;
  label: string;
  type: string;
  street1: string;
  street2: string | null;
  city: string;
  state: string;
  zip_code: string;
  country: string;
  is_primary: boolean;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

/** User phone row from user_phones table (direct query) */
interface DbUserPhoneRow {
  id: string;
  user_id: string;
  org_id: string | null;
  label: string;
  type: string;
  country_code: string;
  number: string;
  extension: string | null;
  sms_capable: boolean;
  is_primary: boolean;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

/** User phone from api.get_user_phones RPC (camelCase keys) */
interface UserPhoneRow {
  id: string;
  label: string;
  type: string;
  number: string;
  extension: string | null;
  countryCode: string;
  smsCapable: boolean;
  isPrimary: boolean;
  isActive: boolean;
  isMirrored: boolean;
  source: string; // 'global' | 'org'
}

/** User org access row from user_organizations_projection (via api.get_user_org_access RPC) */
interface DbUserOrgAccessRow {
  user_id: string;
  org_id: string;
  access_start_date: string | null;
  access_expiration_date: string | null;
  notification_preferences: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

/** User org access list item from api.list_user_org_access RPC */
interface DbUserOrgAccessListItem extends DbUserOrgAccessRow {
  org_name: string;
  is_currently_active: boolean;
}

/** Email membership check result */
interface DbEmailMembershipResult {
  user_id: string;
  is_active: boolean;
  first_name: string | null;
  last_name: string | null;
  roles: RoleReference[] | null;
}

/** Pending invitation check result */
interface DbPendingInvitationResult {
  id: string;
  expires_at: string;
  first_name: string | null;
  last_name: string | null;
}

/** User exists check result */
interface DbUserExistsResult {
  user_id: string;
  first_name: string | null;
  last_name: string | null;
}

/** Simple role row for assignable roles query */
interface DbSimpleRoleRow {
  id: string;
  name: string;
}

/** Assignable role row from api.get_assignable_roles RPC */
interface DbAssignableRoleRow {
  role_id: string;
  role_name: string;
  org_hierarchy_scope: string | null;
  permission_count: number;
}

/**
 * Map database invitation status to display status
 */
function computeInvitationDisplayStatus(
  status: string,
  expiresAt: string
): UserDisplayStatus {
  if (status === 'accepted') return 'active';
  if (status === 'revoked') return 'deactivated';
  if (status === 'expired') return 'expired';
  if (status === 'pending') {
    const now = new Date();
    const expires = new Date(expiresAt);
    return expires < now ? 'expired' : 'pending';
  }
  return 'pending';
}

/**
 * Map database user status to display status
 */
function computeUserDisplayStatus(
  isActive: boolean
): Extract<UserDisplayStatus, 'active' | 'deactivated'> {
  return isActive ? 'active' : 'deactivated';
}

/**
 * Supabase User Query Service Implementation
 */
export class SupabaseUserQueryService implements IUserQueryService {
  /**
   * Get paginated list of users and invitations
   */
  async getUsersPaginated(
    options?: UserQueryOptions
  ): Promise<PaginatedResult<UserListItem>> {
    const client = supabaseService.getClient();

    // Get session from Supabase client (already authenticated)
    const { data: { session } } = await client.auth.getSession();
    if (!session) {
      log.error('No authenticated session for getUsersPaginated');
      return {
        items: [],
        totalCount: 0,
        page: 1,
        pageSize: 20,
        totalPages: 0,
        hasMore: false,
      };
    }

    // Decode JWT to get org_id
    const claims = this.decodeJWT(session.access_token);
    if (!claims.org_id) {
      log.error('No organization context for getUsersPaginated');
      return {
        items: [],
        totalCount: 0,
        page: 1,
        pageSize: 20,
        totalPages: 0,
        hasMore: false,
      };
    }

    const page = options?.pagination?.page ?? 1;
    const pageSize = options?.pagination?.pageSize ?? 20;
    const offset = (page - 1) * pageSize;

    try {
      const items: UserListItem[] = [];
      let totalCount = 0;

      // Fetch users with their roles via RPC (CQRS pattern)
      // CRITICAL: Always use api.list_users() RPC - NEVER direct table queries with PostgREST embedding
      if (!options?.filters?.invitationsOnly) {
        // Determine status filter for RPC
        let statusFilter: string | null = null;
        if (options?.filters?.status === 'active') {
          statusFilter = 'active';
        } else if (options?.filters?.status === 'deactivated') {
          statusFilter = 'deactivated';
        }

        // When combining with invitations, fetch all users (large page size)
        // When usersOnly, use actual pagination
        const usersOnly = options?.filters?.usersOnly ?? false;
        const rpcPageSize = usersOnly ? pageSize : 10000; // Large number when combining
        const rpcPage = usersOnly ? page : 1;

        // Use supabaseService.apiRpc() which handles 'api' schema type casting
        // Wrapped in try-catch to capture thrown exceptions (not just returned errors)
        type RpcUserRow = {
          id: string;
          email: string;
          first_name: string | null;
          last_name: string | null;
          name: string | null;
          is_active: boolean;
          created_at: string;
          updated_at: string;
          last_login_at: string | null;
          roles: Array<{ role_id: string; role_name: string }> | null;
          total_count: number;
        };
        let data: RpcUserRow[] | null = null;
        let usersError: { message: string; code?: string; details?: string; hint?: string } | null = null;

        try {
          const result = await supabaseService.apiRpc<RpcUserRow[]>('list_users', {
            p_org_id: claims.org_id,
            p_status: statusFilter,
            p_search_term: options?.filters?.searchTerm ?? null,
            p_sort_by: options?.sort?.sortBy ?? 'name',
            p_sort_desc: options?.sort?.sortOrder === 'desc',
            p_page: rpcPage,
            p_page_size: rpcPageSize,
          });
          data = result.data;
          usersError = result.error;
        } catch (rpcException) {
          // Supabase client threw an exception instead of returning { error }
          log.error('apiRpc THREW EXCEPTION', rpcException);
          const exMsg = rpcException instanceof Error ? rpcException.message : String(rpcException);
          throw new Error(`RPC call threw exception: ${exMsg}`);
        }

        // DEBUG: Log raw response to understand error propagation
        log.info('apiRpc list_users response', {
          hasData: !!data,
          dataLength: Array.isArray(data) ? data.length : 'not array',
          hasError: !!usersError,
          errorObject: usersError,
        });

        if (usersError) {
          // Include full Supabase error details for debugging
          const errorDetails = JSON.stringify({
            message: usersError.message,
            code: usersError.code,
            details: usersError.details,
            hint: usersError.hint,
          }, null, 2);
          log.error('Failed to fetch users via RPC', usersError);
          throw new Error(`Failed to fetch users: ${usersError.message}\n\nDetails: ${errorDetails}`);
        }

        if (data && Array.isArray(data)) {
          // Get total count from first row (all rows have same total_count)
          const rpcTotalCount = data.length > 0 ? data[0].total_count : 0;
          totalCount += rpcTotalCount;

          for (const user of data) {
            const roles: RoleReference[] = (user.roles ?? []).map((r) => ({
              roleId: r.role_id,
              roleName: r.role_name,
            }));

            items.push({
              id: user.id,
              email: user.email,
              firstName: user.first_name ?? null,
              lastName: user.last_name ?? null,
              displayStatus: computeUserDisplayStatus(user.is_active),
              roles,
              createdAt: new Date(user.created_at),
              expiresAt: null,
              isInvitation: false,
              invitationId: null,
            });
          }
        }
      }

      // Fetch invitations
      // Include invitations when: no filter, 'all', 'pending', or 'expired'
      if (
        !options?.filters?.usersOnly &&
        (!options?.filters?.status ||
          options.filters.status === 'all' ||
          options.filters.status === 'pending' ||
          options.filters.status === 'expired')
      ) {
        // Use RPC function for CQRS-compliant query (not direct table access)
        const { data: invData, error: invError } = await supabaseService.apiRpc<DbInvitationRow[]>(
          'list_invitations',
          {
            p_org_id: claims.org_id,
            p_status: ['pending', 'expired'],
            p_search_term: options?.filters?.searchTerm ?? null,
          }
        );

        if (invError) {
          log.error('Failed to fetch invitations', invError);
        } else if (invData) {
          const invitations = invData ?? [];
          totalCount += invitations.length;

          for (const inv of invitations) {
            const displayStatus = computeInvitationDisplayStatus(
              inv.status,
              inv.expires_at
            );

            // Skip if status filter doesn't match (but 'all' shows everything)
            if (
              options?.filters?.status &&
              options.filters.status !== 'all' &&
              displayStatus !== options.filters.status
            ) {
              continue;
            }

            const roles: RoleReference[] = Array.isArray(inv.roles)
              ? inv.roles.map((r) => ({
                  // Handle both camelCase (from JSONB) and snake_case (from projection)
                  roleId: r.role_id ?? (r as unknown as { roleId: string }).roleId,
                  roleName: r.role_name ?? (r as unknown as { roleName: string }).roleName,
                }))
              : [];

            items.push({
              id: inv.id,
              email: inv.email,
              firstName: inv.first_name ?? null,
              lastName: inv.last_name ?? null,
              displayStatus,
              roles,
              createdAt: new Date(inv.created_at),
              expiresAt: new Date(inv.expires_at),
              isInvitation: true,
              invitationId: inv.id,
            });
          }
        }
      }

      // Sort combined results
      items.sort((a, b) => {
        const sortBy = options?.sort?.sortBy ?? 'email';
        const desc = options?.sort?.sortOrder === 'desc';

        // Map sortBy to actual properties on UserListItem
        let aVal: string | number | Date | null;
        let bVal: string | number | Date | null;

        switch (sortBy) {
          case 'name':
            // Sort by lastName then firstName
            aVal = `${a.lastName ?? ''} ${a.firstName ?? ''}`.trim() || a.email;
            bVal = `${b.lastName ?? ''} ${b.firstName ?? ''}`.trim() || b.email;
            break;
          case 'email':
            aVal = a.email;
            bVal = b.email;
            break;
          case 'createdAt':
            aVal = a.createdAt.getTime();
            bVal = b.createdAt.getTime();
            break;
          case 'status':
            aVal = a.displayStatus;
            bVal = b.displayStatus;
            break;
          default:
            aVal = a.email;
            bVal = b.email;
        }

        if (aVal == null && bVal == null) return 0;
        if (aVal == null) return desc ? -1 : 1;
        if (bVal == null) return desc ? 1 : -1;

        if (aVal < bVal) return desc ? 1 : -1;
        if (aVal > bVal) return desc ? -1 : 1;
        return 0;
      });

      // Apply pagination to combined results
      const paginatedItems = items.slice(offset, offset + pageSize);
      const totalPages = Math.ceil(totalCount / pageSize);

      return {
        items: paginatedItems,
        totalCount,
        page,
        pageSize,
        totalPages,
        hasMore: page < totalPages,
      };
    } catch (error) {
      log.error('Error in getUsersPaginated', error);
      // Re-throw so error propagates to ViewModel and displays in UI
      throw error;
    }
  }

  /**
   * Get user by ID with role assignments
   */
  async getUserById(userId: string): Promise<UserWithRoles | null> {
    const client = supabaseService.getClient();

    try {
      const { data, error } = await client
        .from('users')
        .select(
          `
          id, email, first_name, last_name, name, is_active, created_at, updated_at, last_login_at, current_organization_id,
          user_roles_projection (
            role_id,
            organization_id,
            scope_path,
            role_valid_from,
            role_valid_until,
            roles_projection (id, name, description, organization_id, org_hierarchy_scope, is_active, created_at, updated_at, permission_count, user_count)
          )
        `
        )
        .eq('id', userId)
        .single();

      if (error || !data) {
        log.error('Failed to fetch user by ID', error);
        return null;
      }

      const user = data as unknown as DbUserRow;
      const roles: Role[] =
        user.user_roles_projection?.map((urp) => ({
          id: urp.roles_projection?.id ?? urp.role_id,
          name: urp.roles_projection?.name ?? 'Unknown',
          description: urp.roles_projection?.description ?? '',
          organizationId: urp.roles_projection?.organization_id ?? null,
          orgHierarchyScope: urp.roles_projection?.org_hierarchy_scope ?? null,
          isActive: urp.roles_projection?.is_active ?? true,
          createdAt: urp.roles_projection?.created_at
            ? new Date(urp.roles_projection.created_at)
            : new Date(),
          updatedAt: urp.roles_projection?.updated_at
            ? new Date(urp.roles_projection.updated_at)
            : new Date(),
          permissionCount: urp.roles_projection?.permission_count ?? 0,
          userCount: urp.roles_projection?.user_count ?? 0,
        })) ?? [];

      return {
        id: user.id,
        email: user.email,
        firstName: user.first_name ?? null,
        lastName: user.last_name ?? null,
        name: user.name ?? null,
        currentOrganizationId: user.current_organization_id ?? null,
        isActive: user.is_active,
        createdAt: new Date(user.created_at),
        updatedAt: new Date(user.updated_at),
        lastLoginAt: user.last_login_at ? new Date(user.last_login_at) : null,
        roles,
        displayStatus: computeUserDisplayStatus(user.is_active),
      };
    } catch (error) {
      log.error('Error in getUserById', error);
      return null;
    }
  }

  /**
   * Get all pending invitations for current org
   */
  async getInvitations(): Promise<Invitation[]> {
    const client = supabaseService.getClient();

    // Get session from Supabase client
    const { data: { session } } = await client.auth.getSession();
    if (!session) {
      log.error('No authenticated session for getInvitations');
      return [];
    }

    const claims = this.decodeJWT(session.access_token);
    if (!claims.org_id) {
      log.error('No organization context for getInvitations');
      return [];
    }

    try {
      // Use RPC function for CQRS-compliant query (not direct table access)
      const { data, error } = await supabaseService.apiRpc<DbInvitationRow[]>(
        'list_invitations',
        {
          p_org_id: claims.org_id,
          p_status: ['pending', 'expired'],
          p_search_term: null,
        }
      );

      if (error) {
        log.error('Failed to fetch invitations', error);
        return [];
      }

      const invitations = data ?? [];
      return invitations.map((inv) => ({
        id: inv.id,
        invitationId: inv.id,
        email: inv.email,
        firstName: inv.first_name ?? null,
        lastName: inv.last_name ?? null,
        organizationId: inv.organization_id,
        roles: Array.isArray(inv.roles)
          ? inv.roles.map((r) => ({
              roleId: r.role_id,
              roleName: r.role_name,
            }))
          : [],
        token: inv.token ?? '',
        status: inv.status as 'pending' | 'accepted' | 'expired' | 'revoked',
        expiresAt: new Date(inv.expires_at),
        accessStartDate: inv.access_start_date ?? null,
        accessExpirationDate: inv.access_expiration_date ?? null,
        notificationPreferences:
          (inv.notification_preferences as unknown as typeof DEFAULT_NOTIFICATION_PREFERENCES) ??
          DEFAULT_NOTIFICATION_PREFERENCES,
        acceptedAt: inv.accepted_at ? new Date(inv.accepted_at) : null,
        createdAt: new Date(inv.created_at),
        updatedAt: new Date(inv.updated_at ?? inv.created_at),
      }));
    } catch (error) {
      log.error('Error in getInvitations', error);
      return [];
    }
  }

  /**
   * Get invitation by ID
   */
  async getInvitationById(invitationId: string): Promise<Invitation | null> {
    try {
      // Use RPC function for CQRS-compliant query (not direct table access)
      const { data, error } = await supabaseService.apiRpc<DbInvitationRow[]>(
        'get_invitation_by_id',
        {
          p_invitation_id: invitationId,
        }
      );

      if (error) {
        log.error('Failed to fetch invitation by ID', error);
        return null;
      }

      // RPC returns array, get first row
      const rows = data ?? [];
      if (rows.length === 0) {
        return null;
      }

      const invitation = rows[0];

      return {
        id: invitation.id,
        invitationId: invitation.id,
        email: invitation.email,
        firstName: invitation.first_name ?? null,
        lastName: invitation.last_name ?? null,
        organizationId: invitation.organization_id,
        roles: Array.isArray(invitation.roles)
          ? invitation.roles.map((r) => ({
              roleId: r.role_id,
              roleName: r.role_name,
            }))
          : [],
        token: invitation.token ?? '',
        status: invitation.status as 'pending' | 'accepted' | 'expired' | 'revoked',
        expiresAt: new Date(invitation.expires_at),
        accessStartDate: invitation.access_start_date ?? null,
        accessExpirationDate: invitation.access_expiration_date ?? null,
        notificationPreferences:
          (invitation.notification_preferences as unknown as typeof DEFAULT_NOTIFICATION_PREFERENCES) ??
          DEFAULT_NOTIFICATION_PREFERENCES,
        acceptedAt: invitation.accepted_at ? new Date(invitation.accepted_at) : null,
        createdAt: new Date(invitation.created_at),
        updatedAt: new Date(invitation.updated_at ?? invitation.created_at),
      };
    } catch (error) {
      log.error('Error in getInvitationById', error);
      return null;
    }
  }

  /**
   * Smart email lookup using RPC functions
   */
  async checkEmailStatus(email: string): Promise<EmailLookupResult> {
    const client = supabaseService.getClient();

    // Get session from Supabase client
    const { data: { session } } = await client.auth.getSession();
    if (!session) {
      return {
        status: 'not_found',
        userId: null,
        invitationId: null,
        firstName: null,
        lastName: null,
        expiresAt: null,
        currentRoles: null,
      };
    }

    const claims = this.decodeJWT(session.access_token);
    if (!claims.org_id) {
      return {
        status: 'not_found',
        userId: null,
        invitationId: null,
        firstName: null,
        lastName: null,
        expiresAt: null,
        currentRoles: null,
      };
    }

    const orgId = claims.org_id;

    try {
      // Check if user has membership in this org
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: membershipData, error: membershipError } = await (client.rpc as any)(
        'check_user_org_membership',
        {
          p_email: email,
          p_org_id: orgId,
        }
      );

      const membership = membershipData as DbEmailMembershipResult[] | null;

      if (!membershipError && membership && membership.length > 0) {
        const member = membership[0];
        return {
          status: member.is_active ? 'active_member' : 'deactivated',
          userId: member.user_id,
          invitationId: null,
          firstName: member.first_name ?? null,
          lastName: member.last_name ?? null,
          expiresAt: null,
          currentRoles: member.roles ?? null,
        };
      }

      // Check for pending invitation
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: pendingData, error: pendingError } = await (client.rpc as any)(
        'check_pending_invitation',
        {
          p_email: email,
          p_org_id: orgId,
        }
      );

      const pending = pendingData as DbPendingInvitationResult[] | null;

      if (!pendingError && pending && pending.length > 0) {
        const inv = pending[0];
        const expiresAt = new Date(inv.expires_at);
        const isExpired = expiresAt < new Date();

        return {
          status: isExpired ? 'expired' : 'pending',
          userId: null,
          invitationId: inv.id,
          firstName: inv.first_name ?? null,
          lastName: inv.last_name ?? null,
          expiresAt,
          currentRoles: null,
        };
      }

      // Check if user exists in system (other org)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: existsData, error: existsError } = await (client.rpc as any)(
        'check_user_exists',
        {
          p_email: email,
        }
      );

      const exists = existsData as DbUserExistsResult[] | null;

      if (!existsError && exists && exists.length > 0) {
        return {
          status: 'other_org',
          userId: exists[0].user_id,
          invitationId: null,
          firstName: exists[0].first_name ?? null,
          lastName: exists[0].last_name ?? null,
          expiresAt: null,
          currentRoles: null,
        };
      }

      // User not found
      return {
        status: 'not_found',
        userId: null,
        invitationId: null,
        firstName: null,
        lastName: null,
        expiresAt: null,
        currentRoles: null,
      };
    } catch (error) {
      log.error('Error in checkEmailStatus', error);
      return {
        status: 'not_found',
        userId: null,
        invitationId: null,
        firstName: null,
        lastName: null,
        expiresAt: null,
        currentRoles: null,
      };
    }
  }

  /**
   * Get roles that the current user can assign
   *
   * Enforces two constraints via api.get_assignable_roles RPC:
   * 1. Permission subset: Role's permissions must be subset of inviter's permissions
   * 2. Scope hierarchy: Role's scope must be contained by inviter's scope (ltree)
   *
   * This prevents privilege escalation during user invitation.
   */
  async getAssignableRoles(): Promise<RoleReference[]> {
    const client = supabaseService.getClient();

    // Get session from Supabase client (already authenticated)
    const { data: { session } } = await client.auth.getSession();
    if (!session) {
      log.error('No authenticated session for getAssignableRoles');
      return [];
    }

    // Decode JWT to get org_id
    const claims = this.decodeJWT(session.access_token);
    if (!claims.org_id) {
      log.error('No organization context for getAssignableRoles');
      return [];
    }

    try {
      // Call api.get_assignable_roles RPC which filters by:
      // 1. Permission subset (role permissions ⊆ user permissions)
      // 2. Scope hierarchy (role scope <@ user scope via ltree)
      const { data, error } = await supabaseService.apiRpc<DbAssignableRoleRow[]>(
        'get_assignable_roles',
        {
          p_org_id: claims.org_id,
        }
      );

      if (error) {
        log.error('Failed to fetch assignable roles via RPC', error);
        return [];
      }

      const assignableRoles = (data ?? []) as DbAssignableRoleRow[];

      return assignableRoles.map((r) => ({
        roleId: r.role_id,
        roleName: r.role_name,
        orgHierarchyScope: r.org_hierarchy_scope ?? undefined,
        permissionCount: r.permission_count,
      }));
    } catch (error) {
      log.error('Error in getAssignableRoles', error);
      return [];
    }
  }

  /**
   * Get organizations the current user has access to
   *
   * Uses api.list_user_org_access RPC to fetch user's organization access
   * with active status calculated server-side.
   */
  async getUserOrganizations(): Promise<
    Array<{ id: string; name: string; type: string }>
  > {
    const client = supabaseService.getClient();

    // Get session from Supabase client (already authenticated)
    const { data: { session } } = await client.auth.getSession();
    if (!session) {
      log.error('No authenticated session for getUserOrganizations');
      return [];
    }

    // Decode JWT to get user_id (sub claim)
    const claims = this.decodeJWT(session.access_token);
    if (!claims.sub) {
      log.error('No user ID in session for getUserOrganizations');
      return [];
    }

    try {
      // Use RPC function instead of direct table access
      const { data, error } = await supabaseService.apiRpc<DbUserOrgAccessListItem[]>(
        'list_user_org_access',
        { p_user_id: claims.sub }
      );

      if (error) {
        log.error('Failed to fetch user organizations via RPC', error);
        return [];
      }

      const accessList = (data ?? []) as DbUserOrgAccessListItem[];

      // Filter to only active organizations and fetch org details
      // Note: The RPC returns org_name directly, but we need org_type
      // For now, do a secondary query for type. TODO: Add org_type to RPC
      const orgIds = accessList
        .filter((uoa) => uoa.is_currently_active)
        .map((uoa) => uoa.org_id);

      if (orgIds.length === 0) {
        return [];
      }

      const { data: orgs, error: orgsError } = await client
        .from('organizations_projection')
        .select('id, name, type')
        .in('id', orgIds);

      if (orgsError) {
        log.error('Failed to fetch organization details', orgsError);
        return [];
      }

      return (orgs ?? []).map((org: { id: string; name: string; type: string }) => ({
        id: org.id,
        name: org.name,
        type: org.type,
      }));
    } catch (error) {
      log.error('Error in getUserOrganizations', error);
      return [];
    }
  }

  // ============================================================================
  // Extended Data Collection Methods
  // ============================================================================

  async getUserAddresses(userId: string): Promise<UserAddress[]> {
    const client = supabaseService.getClient();

    try {
      const { data, error } = await client
        .from('user_addresses')
        .select('*')
        .eq('user_id', userId)
        .eq('is_active', true)
        .order('is_primary', { ascending: false });

      if (error) {
        log.error('Failed to fetch user addresses', error);
        return [];
      }

      const addresses = (data ?? []) as unknown as DbUserAddressRow[];

      return addresses.map((addr) => ({
        id: addr.id,
        userId: addr.user_id,
        orgId: addr.org_id ?? null,
        label: addr.label,
        type: addr.type as UserAddress['type'],
        street1: addr.street1,
        street2: addr.street2 ?? null,
        city: addr.city,
        state: addr.state,
        zipCode: addr.zip_code,
        country: addr.country,
        isPrimary: addr.is_primary,
        isActive: addr.is_active,
        createdAt: new Date(addr.created_at),
        updatedAt: new Date(addr.updated_at),
      }));
    } catch (error) {
      log.error('Error in getUserAddresses', error);
      return [];
    }
  }

  /**
   * Get user's phones using the api.get_user_phones RPC
   *
   * Returns both global phones (user_phones table) and org-specific phones
   * (user_org_phone_overrides table) for the current organization.
   */
  async getUserPhones(userId: string): Promise<UserPhone[]> {
    const client = supabaseService.getClient();

    try {
      // Get organization ID from JWT claims
      const {
        data: { session },
      } = await client.auth.getSession();
      if (!session) {
        log.error('No authenticated session');
        return [];
      }

      const claims = this.decodeJWT(session.access_token);
      const orgId = claims.org_id;

      // Use the RPC that returns both global and org-specific phones
      const { data, error } = await supabaseService.apiRpc<UserPhoneRow[]>(
        'get_user_phones',
        {
          p_user_id: userId,
          p_organization_id: orgId ?? null,
        }
      );

      if (error) {
        log.error('Failed to fetch user phones via RPC', error);
        return [];
      }

      // Map RPC response to UserPhone type
      return (data ?? []).map((phone: UserPhoneRow) => ({
        id: phone.id,
        userId: userId,
        orgId: phone.source === 'org' ? (orgId ?? null) : null,
        label: phone.label,
        type: phone.type as UserPhone['type'],
        countryCode: phone.countryCode ?? '+1',
        number: phone.number,
        extension: phone.extension ?? null,
        smsCapable: phone.smsCapable ?? false,
        isPrimary: phone.isPrimary ?? false,
        isActive: phone.isActive ?? true,
        isMirrored: phone.isMirrored ?? false,
        source: phone.source as 'global' | 'org',
        createdAt: new Date(),
        updatedAt: new Date(),
      }));
    } catch (error) {
      log.error('Error in getUserPhones', error);
      return [];
    }
  }

  /**
   * Get user's organization access configuration
   *
   * Uses api.get_user_org_access RPC instead of direct table access.
   */
  async getUserOrgAccess(
    userId: string,
    orgId: string
  ): Promise<UserOrgAccess | null> {
    try {
      // Use RPC function instead of direct table access
      const { data, error } = await supabaseService.apiRpc<DbUserOrgAccessRow[]>(
        'get_user_org_access',
        {
          p_user_id: userId,
          p_org_id: orgId,
        }
      );

      if (error) {
        log.error('Failed to fetch user org access via RPC', error);
        return null;
      }

      // RPC returns array, get first row
      const accessRows = data as DbUserOrgAccessRow[] | null;
      if (!accessRows || accessRows.length === 0) {
        return null;
      }

      const access = accessRows[0];

      return {
        userId: access.user_id,
        orgId: access.org_id,
        accessStartDate: access.access_start_date ?? null,
        accessExpirationDate: access.access_expiration_date ?? null,
        notificationPreferences:
          (access.notification_preferences as unknown as typeof DEFAULT_NOTIFICATION_PREFERENCES) ??
          DEFAULT_NOTIFICATION_PREFERENCES,
        createdAt: new Date(access.created_at),
        updatedAt: new Date(access.updated_at),
      };
    } catch (error) {
      log.error('Error in getUserOrgAccess', error);
      return null;
    }
  }

  /**
   * Get user's notification preferences for the current organization
   *
   * Uses api.get_user_notification_preferences RPC to read from the
   * normalized notification preferences projection table.
   */
  async getUserNotificationPreferences(userId: string): Promise<NotificationPreferences> {
    const client = supabaseService.getClient();

    try {
      // Get organization ID from JWT claims
      const {
        data: { session },
      } = await client.auth.getSession();
      if (!session) {
        log.error('No authenticated session for getUserNotificationPreferences');
        return DEFAULT_NOTIFICATION_PREFERENCES;
      }

      const claims = this.decodeJWT(session.access_token);
      const orgId = claims.org_id;

      if (!orgId) {
        log.error('No organization context for getUserNotificationPreferences');
        return DEFAULT_NOTIFICATION_PREFERENCES;
      }

      // Use RPC to get notification preferences from normalized table
      const { data, error } = await supabaseService.apiRpc<NotificationPreferences>(
        'get_user_notification_preferences',
        {
          p_user_id: userId,
          p_organization_id: orgId,
        }
      );

      if (error) {
        log.error('Failed to fetch notification preferences via RPC', error);
        return DEFAULT_NOTIFICATION_PREFERENCES;
      }

      // RPC returns properly structured preferences or defaults
      return data ?? DEFAULT_NOTIFICATION_PREFERENCES;
    } catch (error) {
      log.error('Error in getUserNotificationPreferences', error);
      return DEFAULT_NOTIFICATION_PREFERENCES;
    }
  }

  // ============================================================================
  // Private Helper Methods
  // ============================================================================

  /**
   * Decode JWT token to extract claims
   * Uses same approach as SupabaseAuthProvider.decodeJWT()
   */
  private decodeJWT(token: string): DecodedJWTClaims {
    try {
      const payload = token.split('.')[1];
      const decoded = JSON.parse(globalThis.atob(payload));
      return {
        org_id: decoded.org_id,
        user_role: decoded.user_role,
        permissions: decoded.permissions || [],
        sub: decoded.sub,
      };
    } catch {
      return {};
    }
  }
}
