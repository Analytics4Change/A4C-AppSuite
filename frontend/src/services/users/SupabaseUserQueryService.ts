/**
 * Supabase User Query Service
 *
 * Production implementation of IUserQueryService using Supabase database
 * projections for reads. Queries are automatically scoped by JWT claims
 * via RLS policies.
 *
 * Architecture:
 * - Direct database queries to projection tables (users, invitations_projection, etc.)
 * - RPC calls for complex lookups (email status, assignable roles)
 * - All queries scoped to current org via RLS
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
} from '@/types/user.types';
import { DEFAULT_NOTIFICATION_PREFERENCES } from '@/types/user.types';
import type { Role } from '@/types/role.types';
import { supabaseService } from '@/services/auth/supabase.service';
import { Logger } from '@/utils/logger';

const log = Logger.getLogger('api');

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

/** User phone row from user_phones */
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
    const session = supabaseService.getCurrentSession();

    if (!session?.claims.org_id) {
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

      // Fetch users with their roles
      if (!options?.filters?.invitationsOnly) {
        let userQuery = client
          .from('users')
          .select(
            `
            id, email, first_name, last_name, name, is_active, created_at, updated_at, last_login_at,
            user_roles_projection!inner (
              role_id,
              roles_projection (id, name)
            )
          `,
            { count: 'exact' }
          )
          .eq('user_roles_projection.organization_id', session.claims.org_id);

        // Apply status filter
        if (options?.filters?.status === 'active') {
          userQuery = userQuery.eq('is_active', true);
        } else if (options?.filters?.status === 'deactivated') {
          userQuery = userQuery.eq('is_active', false);
        }

        // Apply search filter
        if (options?.filters?.searchTerm) {
          const term = `%${options.filters.searchTerm}%`;
          userQuery = userQuery.or(`email.ilike.${term},name.ilike.${term}`);
        }

        // Apply sorting
        const sortBy = options?.sort?.sortBy ?? 'name';
        const sortOrder = options?.sort?.sortOrder === 'desc';
        userQuery = userQuery.order(sortBy, { ascending: !sortOrder });

        // Apply pagination (only if not combining with invitations)
        if (options?.filters?.usersOnly) {
          userQuery = userQuery.range(offset, offset + pageSize - 1);
        }

        const { data, error: usersError, count } = await userQuery;

        if (usersError) {
          log.error('Failed to fetch users', usersError);
        } else if (data) {
          totalCount += count ?? 0;
          const users = data as unknown as DbUserRow[];

          for (const user of users) {
            const roles: RoleReference[] =
              user.user_roles_projection?.map((urp) => ({
                roleId: urp.role_id,
                roleName: urp.roles_projection?.name ?? 'Unknown',
              })) ?? [];

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
      if (
        !options?.filters?.usersOnly &&
        (!options?.filters?.status ||
          options.filters.status === 'pending' ||
          options.filters.status === 'expired')
      ) {
        let invQuery = client
          .from('invitations_projection')
          .select('*', { count: 'exact' })
          .eq('organization_id', session.claims.org_id)
          .in('status', ['pending', 'expired']);

        // Apply search filter
        if (options?.filters?.searchTerm) {
          const term = `%${options.filters.searchTerm}%`;
          invQuery = invQuery.ilike('email', term);
        }

        const { data: invData, error: invError, count: invCount } = await invQuery;

        if (invError) {
          log.error('Failed to fetch invitations', invError);
        } else if (invData) {
          totalCount += invCount ?? 0;
          const invitations = invData as unknown as DbInvitationRow[];

          for (const inv of invitations) {
            const displayStatus = computeInvitationDisplayStatus(
              inv.status,
              inv.expires_at
            );

            // Skip if status filter doesn't match
            if (
              options?.filters?.status &&
              displayStatus !== options.filters.status
            ) {
              continue;
            }

            const roles: RoleReference[] = Array.isArray(inv.roles)
              ? inv.roles.map((r) => ({
                  roleId: r.role_id,
                  roleName: r.role_name,
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
      return {
        items: [],
        totalCount: 0,
        page: 1,
        pageSize: 20,
        totalPages: 0,
        hasMore: false,
      };
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
    const session = supabaseService.getCurrentSession();

    if (!session?.claims.org_id) {
      log.error('No organization context for getInvitations');
      return [];
    }

    try {
      const { data, error } = await client
        .from('invitations_projection')
        .select('*')
        .eq('organization_id', session.claims.org_id)
        .in('status', ['pending', 'expired'])
        .order('created_at', { ascending: false });

      if (error) {
        log.error('Failed to fetch invitations', error);
        return [];
      }

      const invitations = (data ?? []) as unknown as DbInvitationRow[];
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
    const client = supabaseService.getClient();

    try {
      const { data: inv, error } = await client
        .from('invitations_projection')
        .select('*')
        .eq('id', invitationId)
        .single();

      if (error || !inv) {
        log.error('Failed to fetch invitation by ID', error);
        return null;
      }

      const invitation = inv as unknown as DbInvitationRow;

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
    const session = supabaseService.getCurrentSession();

    if (!session?.claims.org_id) {
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

    const orgId = session.claims.org_id;

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
   */
  async getAssignableRoles(): Promise<RoleReference[]> {
    const client = supabaseService.getClient();
    const session = supabaseService.getCurrentSession();

    if (!session?.claims.org_id) {
      return [];
    }

    try {
      // For now, return all active roles in the org
      // TODO: Implement api.get_assignable_roles RPC for subset-only filtering
      const { data: roles, error } = await client
        .from('roles_projection')
        .select('id, name')
        .eq('organization_id', session.claims.org_id)
        .eq('is_active', true)
        .order('name');

      if (error) {
        log.error('Failed to fetch assignable roles', error);
        return [];
      }

      const typedRoles = (roles ?? []) as unknown as DbSimpleRoleRow[];

      return typedRoles.map((r) => ({
        roleId: r.id,
        roleName: r.name,
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
    const session = supabaseService.getCurrentSession();

    if (!session?.user.id) {
      return [];
    }

    try {
      // Use RPC function instead of direct table access
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (client as any).schema('api').rpc(
        'list_user_org_access',
        { p_user_id: session.user.id }
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

  async getUserPhones(userId: string): Promise<UserPhone[]> {
    const client = supabaseService.getClient();

    try {
      const { data, error } = await client
        .from('user_phones')
        .select('*')
        .eq('user_id', userId)
        .eq('is_active', true)
        .order('is_primary', { ascending: false });

      if (error) {
        log.error('Failed to fetch user phones', error);
        return [];
      }

      const phones = (data ?? []) as unknown as DbUserPhoneRow[];

      return phones.map((phone) => ({
        id: phone.id,
        userId: phone.user_id,
        orgId: phone.org_id ?? null,
        label: phone.label,
        type: phone.type as UserPhone['type'],
        countryCode: phone.country_code,
        number: phone.number,
        extension: phone.extension ?? null,
        smsCapable: phone.sms_capable,
        isPrimary: phone.is_primary,
        isActive: phone.is_active,
        createdAt: new Date(phone.created_at),
        updatedAt: new Date(phone.updated_at),
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
    const client = supabaseService.getClient();

    try {
      // Use RPC function instead of direct table access
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (client as any).schema('api').rpc(
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
}
