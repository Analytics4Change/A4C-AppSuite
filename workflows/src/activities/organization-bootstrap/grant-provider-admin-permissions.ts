/**
 * GrantProviderAdminPermissionsActivity
 *
 * Creates a provider_admin role for the organization and grants the 16 canonical permissions.
 * This activity is called during organization bootstrap to ensure the initial admin user
 * has the correct permissions.
 *
 * Canonical provider_admin Permissions (16 total):
 * - Organization (4): view_ou, create_ou, view, update
 * - Client (4): create, view, update, delete
 * - Medication (2): create, view
 * - Role (3): create, assign, view
 * - User (3): create, view, update
 *
 * Idempotency:
 * - Check if provider_admin role exists for this org
 * - If exists, check if all permissions are granted
 * - Only emit events for missing permissions
 *
 * Events Emitted:
 * - role.created: When provider_admin role is created
 * - role.permission.granted: For each permission granted (16 max)
 *
 * See: documentation/architecture/authorization/permissions-reference.md
 */

import { v4 as uuidv4 } from 'uuid';
import { getSupabaseClient, emitEvent, buildTags, getLogger } from '@shared/utils';

const log = getLogger('GrantProviderAdminPermissions');

/**
 * Canonical provider_admin permissions
 * These 16 permissions are granted to every provider_admin role
 * Aligned to database permissions_projection table
 */
export const PROVIDER_ADMIN_PERMISSIONS = [
  // Organization (4) - OUs and org management within hierarchy
  'organization.view_ou',
  'organization.create_ou',
  'organization.view',
  'organization.update',
  // Client (4) - aligned to DB naming
  'client.create',
  'client.view',
  'client.update',
  'client.delete',
  // Medication (2)
  'medication.create',
  'medication.view',
  // Role (3) - within org
  'role.create',
  'role.assign',
  'role.view',
  // User (3)
  'user.create',
  'user.view',
  'user.update',
] as const;

export interface GrantProviderAdminPermissionsParams {
  /** Organization ID */
  orgId: string;
}

export interface GrantProviderAdminPermissionsResult {
  /** Role ID (UUID) */
  roleId: string;
  /** Number of permissions granted (0 if all already existed) */
  permissionsGranted: number;
  /** Whether role already existed */
  roleAlreadyExisted: boolean;
}

/**
 * Grant provider_admin permissions activity
 * Creates role and grants 16 canonical permissions
 *
 * @param params - Parameters including orgId
 * @returns Result with roleId and permissions granted count
 */
export async function grantProviderAdminPermissions(
  params: GrantProviderAdminPermissionsParams
): Promise<GrantProviderAdminPermissionsResult> {
  log.info('Starting provider_admin permission grant', { orgId: params.orgId });

  const supabase = getSupabaseClient();
  const tags = buildTags();

  // Check if provider_admin role already exists for this org
  let roleId: string;
  let roleAlreadyExisted = false;

  const { data: existingRole, error: roleQueryError } = await supabase
    .from('roles_projection')
    .select('id')
    .eq('name', 'provider_admin')
    .eq('org_id', params.orgId)
    .maybeSingle();

  if (roleQueryError) {
    throw new Error(`Failed to query existing role: ${roleQueryError.message}`);
  }

  if (existingRole) {
    roleId = existingRole.id;
    roleAlreadyExisted = true;
    log.info('provider_admin role already exists', { roleId, orgId: params.orgId });
  } else {
    // Create provider_admin role via event
    roleId = uuidv4();

    await emitEvent({
      event_type: 'role.created',
      aggregate_type: 'role',
      aggregate_id: roleId,
      event_data: {
        name: 'provider_admin',
        display_name: 'Provider Administrator',
        description: 'Organization owner with full control within the organization',
        org_id: params.orgId,
        scope: 'organization',
        is_system_role: true
      },
      tags
    });

    log.info('Created provider_admin role', { roleId, orgId: params.orgId });
  }

  // Get existing permissions for this role
  const { data: existingPermissions, error: permQueryError } = await supabase
    .from('role_permissions_projection')
    .select('permission_id, permissions_projection!inner(name)')
    .eq('role_id', roleId);

  if (permQueryError) {
    throw new Error(`Failed to query existing permissions: ${permQueryError.message}`);
  }

  // Build set of already-granted permission names
  // Note: permissions_projection is returned as an object (not array) when using !inner join
  const grantedPermissionNames = new Set(
    existingPermissions?.map(p => {
      const perm = p.permissions_projection as unknown as { name: string };
      return perm.name;
    }) || []
  );

  // Get all permission IDs from the projection
  const { data: allPermissions, error: allPermError } = await supabase
    .from('permissions_projection')
    .select('id, name')
    .in('name', PROVIDER_ADMIN_PERMISSIONS);

  if (allPermError) {
    throw new Error(`Failed to query permissions: ${allPermError.message}`);
  }

  // Build lookup map: permission name -> permission ID
  const permissionLookup = new Map<string, string>();
  allPermissions?.forEach(p => {
    permissionLookup.set(p.name, p.id);
  });

  // Grant missing permissions
  let permissionsGranted = 0;

  for (const permName of PROVIDER_ADMIN_PERMISSIONS) {
    // Skip if already granted
    if (grantedPermissionNames.has(permName)) {
      log.debug('Permission already granted', { roleId, permission: permName });
      continue;
    }

    const permId = permissionLookup.get(permName);
    if (!permId) {
      log.warn('Permission not found in database, skipping', { permission: permName });
      continue;
    }

    // Emit role.permission.granted event
    await emitEvent({
      event_type: 'role.permission.granted',
      aggregate_type: 'role',
      aggregate_id: roleId,
      event_data: {
        permission_id: permId,
        permission_name: permName
      },
      tags
    });

    permissionsGranted++;
    log.debug('Granted permission', { roleId, permission: permName });
  }

  log.info('Completed provider_admin permission grant', {
    orgId: params.orgId,
    roleId,
    roleAlreadyExisted,
    permissionsGranted,
    totalPermissions: PROVIDER_ADMIN_PERMISSIONS.length
  });

  return {
    roleId,
    permissionsGranted,
    roleAlreadyExisted
  };
}
