/**
 * GrantProviderAdminPermissionsActivity
 *
 * Creates a provider_admin role for the organization and grants the 23 canonical permissions.
 * This activity is called during organization bootstrap to ensure the initial admin user
 * has the correct permissions.
 *
 * Canonical provider_admin Permissions (23 total):
 * - Organization (4): view_ou, create_ou, view, update
 * - Client (4): create, view, update, delete
 * - Medication (5): create, view, update, delete, administer
 * - Role (4): create, view, update, delete
 * - User (6): create, view, update, delete, role_assign, role_revoke
 *
 * Idempotency:
 * - Check if provider_admin role exists for this org
 * - If exists, check if all permissions are granted
 * - Only emit events for missing permissions
 *
 * Events Emitted:
 * - role.created: When provider_admin role is created
 * - role.permission.granted: For each permission granted (23 max)
 *
 * See: documentation/architecture/authorization/permissions-reference.md
 */

import { v4 as uuidv4 } from 'uuid';
import { getSupabaseClient, emitEvent, buildTags, getLogger } from '@shared/utils';

const log = getLogger('GrantProviderAdminPermissions');

/**
 * Reference: Canonical provider_admin permissions (23 total)
 *
 * Note: The source of truth is the role_permission_templates table in the database.
 * This constant is kept for documentation reference only.
 *
 * See: infrastructure/supabase/sql/99-seeds/012-role-permission-templates.sql
 */
export const PROVIDER_ADMIN_PERMISSIONS = [
  // Organization (4) - OUs and org management within hierarchy
  'organization.view_ou',
  'organization.create_ou',
  'organization.view',
  'organization.update',
  // Client (4)
  'client.create',
  'client.view',
  'client.update',
  'client.delete',
  // Medication (5) - includes administer
  'medication.create',
  'medication.view',
  'medication.update',
  'medication.delete',
  'medication.administer',
  // Role (4) - full CRUD within org
  'role.create',
  'role.view',
  'role.update',
  'role.delete',
  // User (6) - includes role assignment and delete
  'user.create',
  'user.view',
  'user.update',
  'user.delete',
  'user.role_assign',
  'user.role_revoke',
] as const;

/**
 * Query permission templates from the database for a given role type.
 * Uses api.get_role_permission_templates RPC to access the role_permission_templates table.
 *
 * @param roleName - The role type name (e.g., 'provider_admin', 'partner_admin')
 * @returns Array of permission names from the database templates
 * @throws Error if query fails or no templates are found (required for role bootstrap)
 */
async function getTemplatePermissions(roleName: string): Promise<string[]> {
  const supabase = getSupabaseClient();

  const { data, error } = await supabase
    .schema('api')
    .rpc('get_role_permission_templates', { p_role_name: roleName });

  if (error) {
    throw new Error(`Failed to fetch permission templates for ${roleName}: ${error.message}`);
  }

  if (!data || data.length === 0) {
    throw new Error(`No permission templates found for role: ${roleName}. ` +
      `Ensure role_permission_templates table is seeded with templates for this role type.`);
  }

  log.info('Loaded permission templates from database', { roleName, count: data.length });
  return (data as Array<{ permission_name: string }>).map(row => row.permission_name);
}

export interface GrantProviderAdminPermissionsParams {
  /** Organization ID */
  orgId: string;
  /** Scope path for the role (e.g., subdomain like 'acme-health') */
  scopePath: string;
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
 * Creates role and grants 23 canonical permissions
 *
 * @param params - Parameters including orgId
 * @returns Result with roleId and permissions granted count
 */
export async function grantProviderAdminPermissions(
  params: GrantProviderAdminPermissionsParams
): Promise<GrantProviderAdminPermissionsResult> {
  log.info('Starting provider_admin permission grant', { orgId: params.orgId, scopePath: params.scopePath });

  const supabase = getSupabaseClient();
  const tags = buildTags();

  // Load permission templates from database (falls back to PROVIDER_ADMIN_PERMISSIONS if not found)
  const templatePermissions = await getTemplatePermissions('provider_admin');

  // Check if provider_admin role already exists for this org (via RPC)
  let roleId: string;
  let roleAlreadyExisted = false;

  const { data: existingRoleId, error: roleQueryError } = await supabase
    .schema('api')
    .rpc('get_role_by_name_and_org', {
      p_role_name: 'provider_admin',
      p_organization_id: params.orgId
    });

  if (roleQueryError) {
    throw new Error(`Failed to query existing role: ${roleQueryError.message}`);
  }

  if (existingRoleId) {
    roleId = existingRoleId;
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
        organization_id: params.orgId,
        org_hierarchy_scope: params.scopePath,
        scope: 'organization',
        is_system_role: true
      },
      tags
    });

    log.info('Created provider_admin role', { roleId, orgId: params.orgId });
  }

  // Get existing permissions for this role (via RPC)
  const { data: existingPermNames, error: permQueryError } = await supabase
    .schema('api')
    .rpc('get_role_permission_names', { p_role_id: roleId });

  if (permQueryError) {
    throw new Error(`Failed to query existing permissions: ${permQueryError.message}`);
  }

  // Build set of already-granted permission names
  const grantedPermissionNames = new Set<string>(existingPermNames || []);

  // Get all permission IDs from the projection (via RPC)
  const { data: allPermissions, error: allPermError } = await supabase
    .schema('api')
    .rpc('get_permission_ids_by_names', { p_names: templatePermissions });

  if (allPermError) {
    throw new Error(`Failed to query permissions: ${allPermError.message}`);
  }

  // Build lookup map: permission name -> permission ID
  const permissionLookup = new Map<string, string>();
  (allPermissions as Array<{ id: string; name: string }> | null)?.forEach(p => {
    permissionLookup.set(p.name, p.id);
  });

  // Grant missing permissions
  let permissionsGranted = 0;

  for (const permName of templatePermissions) {
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
    totalPermissions: templatePermissions.length
  });

  return {
    roleId,
    permissionsGranted,
    roleAlreadyExisted
  };
}
