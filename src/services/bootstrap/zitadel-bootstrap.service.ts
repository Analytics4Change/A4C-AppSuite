/**
 * Zitadel Bootstrap Service
 * Syncs roles and permissions to Zitadel on application startup
 *
 * IMPORTANT: All operations are idempotent (safe to run multiple times)
 * - Implements "IF NOT EXISTS" logic for role creation
 * - Won't duplicate existing roles or permissions
 * - Safe to run as part of CI/CD pipeline or manual bootstrap
 */

import { PERMISSIONS, Permission } from '@/config/permissions.config';
import { BOOTSTRAP_ROLES, RoleDefinition, exportRoleForZitadel } from '@/config/roles.config';
import { Logger } from '@/utils/logger';

const log = Logger.getLogger('api');

interface ZitadelRole {
  key: string;
  displayName: string;
  group?: string;
}

interface BootstrapResult {
  success: boolean;
  rolesCreated: string[];
  rolesFailed: string[];
  errors: string[];
  warnings: string[];
}

export class ZitadelBootstrapService {
  private managementUrl: string;
  private projectId: string;
  private accessToken?: string;
  private serviceAccountKey?: string;
  private isDryRun: boolean;
  private initialAdminEmail: string;

  constructor(config?: {
    managementUrl?: string;
    projectId?: string;
    serviceAccountKey?: string;
    isDryRun?: boolean;
    initialAdminEmail?: string;
  }) {
    this.managementUrl = config?.managementUrl ||
      import.meta.env.VITE_ZITADEL_MANAGEMENT_URL ||
      'https://analytics4change-zdswvg.us1.zitadel.cloud';

    this.projectId = config?.projectId ||
      import.meta.env.VITE_ZITADEL_PROJECT_ID ||
      '339658577486583889';

    this.serviceAccountKey = config?.serviceAccountKey ||
      import.meta.env.VITE_ZITADEL_SERVICE_ACCOUNT_KEY;

    this.isDryRun = config?.isDryRun || false;

    this.initialAdminEmail = config?.initialAdminEmail ||
      import.meta.env.VITE_BOOTSTRAP_ADMIN_EMAIL ||
      'lars.tice@gmail.com';
  }

  /**
   * Main bootstrap method - syncs everything
   */
  async bootstrap(): Promise<BootstrapResult> {
    const result: BootstrapResult = {
      success: false,
      rolesCreated: [],
      rolesFailed: [],
      errors: [],
      warnings: []
    };

    try {
      log.info('Starting Zitadel bootstrap', {
        isDryRun: this.isDryRun,
        projectId: this.projectId
      });

      // Authenticate with service account if configured
      if (this.serviceAccountKey) {
        await this.authenticate();
      } else {
        result.warnings.push('No service account key configured - using current session');
      }

      // Sync permissions metadata
      await this.syncPermissions(result);

      // Sync roles
      await this.syncRoles(result);

      // Configure application to include roles in tokens
      await this.configureApplication(result);

      // Grant initial super admin role
      await this.grantInitialAdmin(result);

      result.success = result.errors.length === 0;

      log.info('Bootstrap completed', result);
      return result;
    } catch (error) {
      log.error('Bootstrap failed', error);
      result.errors.push(error instanceof Error ? error.message : 'Unknown error');
      return result;
    }
  }

  /**
   * Authenticate with service account
   */
  private async authenticate(): Promise<void> {
    if (!this.serviceAccountKey) {
      throw new Error('Service account key is required for authentication');
    }

    // In a real implementation, this would:
    // 1. Decode the service account JWT
    // 2. Use it to get an access token from Zitadel
    // 3. Store the access token for API calls

    // For now, we'll use a placeholder
    log.info('Authenticating with service account');

    // TODO: Implement actual service account authentication
    // This requires the Zitadel service account JWT flow
    this.accessToken = 'placeholder_token';
  }

  /**
   * Sync permissions as metadata (Zitadel doesn't have a permission entity)
   */
  private async syncPermissions(result: BootstrapResult): Promise<void> {
    log.info('Syncing permissions metadata');

    if (this.isDryRun) {
      const permissionCount = Object.keys(PERMISSIONS).length;
      result.warnings.push(`[DRY RUN] Would sync ${permissionCount} permissions as metadata`);
      return;
    }

    // In Zitadel, permissions are typically stored as:
    // 1. Custom claims on roles
    // 2. Metadata on the project
    // 3. Or handled entirely in the application

    // For our data-driven approach, we'll handle permissions in the application
    // and just ensure roles exist in Zitadel

    result.warnings.push('Permissions are managed in application, not synced to Zitadel');
  }

  /**
   * Sync roles to Zitadel
   */
  private async syncRoles(result: BootstrapResult): Promise<void> {
    log.info('Syncing roles to Zitadel');

    for (const [key, role] of Object.entries(BOOTSTRAP_ROLES)) {
      try {
        await this.syncRole(role, result);
        result.rolesCreated.push(key);
      } catch (error) {
        log.error(`Failed to sync role ${key}`, error);
        result.rolesFailed.push(key);
        result.errors.push(`Role ${key}: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }
  }

  /**
   * Sync a single role (idempotent - safe to run multiple times)
   */
  private async syncRole(role: RoleDefinition, result: BootstrapResult): Promise<void> {
    const zitadelRole = exportRoleForZitadel(role);

    if (this.isDryRun) {
      const exists = await this.roleExists(zitadelRole.key);
      if (exists) {
        log.info(`[DRY RUN] Role already exists, would update: ${zitadelRole.key}`);
        result.warnings.push(`Role ${zitadelRole.key} already exists, would update`);
      } else {
        log.info(`[DRY RUN] Would create role: ${zitadelRole.key}`);
      }
      return;
    }

    // Check if role exists (implements "IF NOT EXISTS" logic)
    const exists = await this.roleExists(zitadelRole.key);

    if (exists) {
      // Role exists - update only if display name or group changed
      // This ensures idempotency
      log.info(`Role already exists, skipping: ${zitadelRole.key}`);
      result.warnings.push(`Role ${zitadelRole.key} already exists, skipped`);

      // Optional: Update if metadata changed
      // await this.updateRoleIfChanged(zitadelRole);
    } else {
      // Create new role
      await this.createRole(zitadelRole);
      log.info(`Created new role: ${zitadelRole.key}`);
    }
  }

  /**
   * Check if a role exists in Zitadel
   */
  private async roleExists(roleKey: string): Promise<boolean> {
    if (!this.accessToken) {
      // Without service account, assume roles don't exist
      return false;
    }

    try {
      const response = await fetch(
        `${this.managementUrl}/v1/projects/${this.projectId}/roles/_search`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${this.accessToken}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            query: {
              roleKeyQuery: {
                roleKey: roleKey
              }
            }
          })
        }
      );

      if (!response.ok) {
        // If we get a 404, role doesn't exist
        if (response.status === 404) return false;
        throw new Error(`Failed to check role: ${response.statusText}`);
      }

      const data = await response.json();
      return data.result && data.result.length > 0;
    } catch (error) {
      log.warn(`Could not check if role exists: ${roleKey}`, error);
      return false;
    }
  }

  /**
   * Create a role in Zitadel
   */
  private async createRole(role: ZitadelRole): Promise<void> {
    if (!this.accessToken) {
      log.warn(`Cannot create role without service account: ${role.key}`);
      return;
    }

    try {
      const response = await fetch(
        `${this.managementUrl}/v1/projects/${this.projectId}/roles`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${this.accessToken}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            roleKey: role.key,
            displayName: role.displayName,
            group: role.group
          })
        }
      );

      if (!response.ok) {
        throw new Error(`Failed to create role: ${response.statusText}`);
      }

      log.info(`Created role in Zitadel: ${role.key}`);
    } catch (error) {
      log.error(`Failed to create role ${role.key}`, error);
      throw error;
    }
  }

  /**
   * Update a role in Zitadel
   */
  private async updateRole(role: ZitadelRole): Promise<void> {
    if (!this.accessToken) {
      log.warn(`Cannot update role without service account: ${role.key}`);
      return;
    }

    try {
      const response = await fetch(
        `${this.managementUrl}/v1/projects/${this.projectId}/roles/${role.key}`,
        {
          method: 'PUT',
          headers: {
            'Authorization': `Bearer ${this.accessToken}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            displayName: role.displayName,
            group: role.group
          })
        }
      );

      if (!response.ok) {
        throw new Error(`Failed to update role: ${response.statusText}`);
      }

      log.info(`Updated role in Zitadel: ${role.key}`);
    } catch (error) {
      log.error(`Failed to update role ${role.key}`, error);
      throw error;
    }
  }

  /**
   * Configure application to include roles in ID tokens
   */
  private async configureApplication(result: BootstrapResult): Promise<void> {
    log.info('Configuring application for role assertions');

    if (this.isDryRun) {
      result.warnings.push('[DRY RUN] Would configure application to assert roles in tokens');
      return;
    }

    if (!this.accessToken) {
      result.warnings.push('Cannot configure application without service account');
      return;
    }

    // This would update the application settings in Zitadel to:
    // 1. Assert roles on authentication
    // 2. Include roles in ID token
    // 3. Include organization context

    // The exact API call depends on the Zitadel version and configuration
    result.warnings.push('Application configuration must be done manually in Zitadel console');
  }

  /**
   * Grant initial super admin role to configured user
   */
  private async grantInitialAdmin(result: BootstrapResult): Promise<void> {
    log.info(`Granting super_admin role to ${this.initialAdminEmail}`);

    if (this.isDryRun) {
      result.warnings.push(`[DRY RUN] Would grant super_admin to ${this.initialAdminEmail}`);
      return;
    }

    if (!this.accessToken) {
      result.warnings.push(`Cannot grant role without service account - manually grant super_admin to ${this.initialAdminEmail}`);
      return;
    }

    try {
      // First, find the user by email
      const userId = await this.findUserByEmail(this.initialAdminEmail);

      if (!userId) {
        result.warnings.push(`User ${this.initialAdminEmail} not found - create user first`);
        return;
      }

      // Grant the super_admin role
      await this.grantRoleToUser(userId, 'super_admin');

      result.warnings.push(`Granted super_admin role to ${this.initialAdminEmail}`);
    } catch (error) {
      log.error('Failed to grant initial admin role', error);
      result.errors.push(`Failed to grant admin role: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Find user by email
   */
  private async findUserByEmail(email: string): Promise<string | null> {
    // This would search for the user in Zitadel
    // For now, return null to indicate manual action needed
    log.info(`Would search for user: ${email}`);
    return null;
  }

  /**
   * Grant a role to a user
   */
  private async grantRoleToUser(userId: string, roleKey: string): Promise<void> {
    // This would create a user grant in Zitadel
    log.info(`Would grant role ${roleKey} to user ${userId}`);
  }

  /**
   * Run bootstrap in dry-run mode
   */
  async dryRun(): Promise<BootstrapResult> {
    this.isDryRun = true;
    return this.bootstrap();
  }

  /**
   * Get bootstrap status
   */
  async getStatus(): Promise<{
    rolesConfigured: number;
    rolesSynced: string[];
    rolesNotSynced: string[];
    permissionsConfigured: number;
  }> {
    const rolesSynced: string[] = [];
    const rolesNotSynced: string[] = [];

    for (const roleKey of Object.keys(BOOTSTRAP_ROLES)) {
      const exists = await this.roleExists(roleKey);
      if (exists) {
        rolesSynced.push(roleKey);
      } else {
        rolesNotSynced.push(roleKey);
      }
    }

    return {
      rolesConfigured: Object.keys(BOOTSTRAP_ROLES).length,
      rolesSynced,
      rolesNotSynced,
      permissionsConfigured: Object.keys(PERMISSIONS).length
    };
  }
}

// Singleton instance
let bootstrapInstance: ZitadelBootstrapService | null = null;

/**
 * Get bootstrap service instance
 */
export function getBootstrapService(config?: {
  managementUrl?: string;
  projectId?: string;
  serviceAccountKey?: string;
  isDryRun?: boolean;
  initialAdminEmail?: string;
}): ZitadelBootstrapService {
  if (!bootstrapInstance) {
    bootstrapInstance = new ZitadelBootstrapService(config);
  }
  return bootstrapInstance;
}

/**
 * Run bootstrap on application startup (if configured)
 */
export async function autoBootstrap(): Promise<void> {
  const autoBootstrap = import.meta.env.VITE_AUTO_BOOTSTRAP_ROLES === 'true';

  if (!autoBootstrap) {
    log.info('Auto-bootstrap is disabled');
    return;
  }

  log.info('Running auto-bootstrap');
  const service = getBootstrapService();
  const result = await service.bootstrap();

  if (!result.success) {
    log.error('Auto-bootstrap failed', result.errors);
  } else {
    log.info('Auto-bootstrap completed successfully');
  }
}