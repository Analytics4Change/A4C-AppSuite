import { UserManager, UserManagerSettings, User as OidcUser } from 'oidc-client-ts';
import { Logger } from '@/utils/logger';

const log = Logger.getLogger('api');

export interface ZitadelUser {
  id: string;
  email: string;
  name: string;
  picture?: string;
  organizationId: string;
  organizations: Organization[];
  roles: string[];
  permissions: string[];
  accessToken: string;
  refreshToken?: string;
  idToken: string;
}

export interface Organization {
  id: string;
  name: string;
  type: 'healthcare_facility' | 'var' | 'admin';
  metadata?: Record<string, any>;
}

class ZitadelService {
  private userManager: UserManager;
  private readonly settings: UserManagerSettings;

  constructor() {
    const instanceUrl = import.meta.env.VITE_ZITADEL_INSTANCE_URL || '';
    const clientId = import.meta.env.VITE_ZITADEL_CLIENT_ID || '';
    const redirectUri = import.meta.env.VITE_AUTH_REDIRECT_URI || `${window.location.origin}/auth/callback`;
    const postLogoutUri = import.meta.env.VITE_AUTH_POST_LOGOUT_URI || window.location.origin;

    this.settings = {
      authority: instanceUrl,
      client_id: clientId,
      redirect_uri: redirectUri,
      post_logout_redirect_uri: postLogoutUri,
      response_type: 'code',
      scope: 'openid profile email offline_access urn:zitadel:iam:org:project:id:zitadel:aud',
      automaticSilentRenew: true, // Enabled - uses refresh token grant (no iframe)
      useRefreshTokens: true, // Use refresh_token grant instead of iframe-based renewal
      loadUserInfo: true,
      // PKCE is automatically enabled for public clients
    };

    this.userManager = new UserManager(this.settings);

    // Set up event handlers
    this.setupEventHandlers();
  }

  private setupEventHandlers(): void {
    this.userManager.events.addUserLoaded((user) => {
      log.info('User loaded', { userId: user.profile.sub });
    });

    this.userManager.events.addUserUnloaded(() => {
      log.info('User unloaded');
    });

    this.userManager.events.addAccessTokenExpiring(() => {
      log.warn('Access token expiring');
    });

    this.userManager.events.addAccessTokenExpired(() => {
      log.warn('Access token expired - attempting renewal with refresh token');
      // Attempt silent renewal using refresh token
      this.renewToken().catch((error) => {
        log.error('Refresh token renewal failed - redirecting to login', error);
        // If refresh fails, redirect to login
        this.userManager.removeUser();
        window.location.href = '/login';
      });
    });

    this.userManager.events.addSilentRenewError((error) => {
      log.error('Silent renew error', error);
    });
  }

  async login(): Promise<void> {
    try {
      await this.userManager.signinRedirect();
    } catch (error) {
      log.error('Login redirect failed', error);
      throw error;
    }
  }

  async handleCallback(): Promise<ZitadelUser | null> {
    try {
      console.log('[Zitadel] Starting callback handling...');
      console.log('[Zitadel] URL:', window.location.href);
      
      const oidcUser = await this.userManager.signinRedirectCallback();
      console.log('[Zitadel] OIDC User received:', oidcUser);
      
      const transformedUser = this.transformUser(oidcUser);
      console.log('[Zitadel] Transformed user:', transformedUser);
      
      return transformedUser;
    } catch (error) {
      console.error('[Zitadel] Callback handling failed:', error);
      log.error('Callback handling failed', error);
      throw error;
    }
  }

  async logout(): Promise<void> {
    try {
      await this.userManager.signoutRedirect();
    } catch (error) {
      log.error('Logout redirect failed', error);
      throw error;
    }
  }

  async getUser(): Promise<ZitadelUser | null> {
    try {
      const oidcUser = await this.userManager.getUser();
      if (!oidcUser) return null;
      return this.transformUser(oidcUser);
    } catch (error) {
      log.error('Failed to get user', error);
      return null;
    }
  }

  async renewToken(): Promise<void> {
    try {
      // Uses refresh_token grant (no iframe needed)
      await this.userManager.signinSilent();
      log.info('Token renewed successfully via refresh token');
    } catch (error) {
      log.error('Token renewal failed', error);
      throw error;
    }
  }

  async removeUser(): Promise<void> {
    await this.userManager.removeUser();
  }

  private transformUser(oidcUser: OidcUser): ZitadelUser {
    const profile = oidcUser.profile as any;

    // Debug log the entire profile to see what claims are available
    console.log('[Zitadel] Full OIDC Profile:', profile);
    console.log('[Zitadel] Profile keys:', Object.keys(profile));

    const roles = this.parseRoles(profile);
    console.log('[Zitadel] Parsed roles:', roles);

    return {
      id: profile.sub,
      email: profile.email || '',
      name: profile.name || profile.preferred_username || '',
      picture: profile.picture,
      organizationId: profile['urn:zitadel:iam:org:id'] || profile.org_id || '',
      organizations: this.parseOrganizations(profile),
      roles: roles,
      permissions: this.parsePermissions(profile),
      accessToken: oidcUser.access_token,
      refreshToken: oidcUser.refresh_token,
      idToken: oidcUser.id_token || '',
    };
  }

  private parseOrganizations(profile: any): Organization[] {
    // Zitadel may provide organization data in various claims
    const orgs = profile['urn:zitadel:iam:orgs'] || profile.orgs || [];

    if (Array.isArray(orgs)) {
      return orgs.map((org: any) => ({
        id: org.id || org,
        name: org.name || '',
        type: this.determineOrgType(org),
        metadata: org.metadata || {},
      }));
    }

    // If only single org, create array with current org
    if (profile['urn:zitadel:iam:org:id']) {
      return [{
        id: profile['urn:zitadel:iam:org:id'],
        name: profile['urn:zitadel:iam:org:name'] || '',
        type: 'healthcare_facility',
        metadata: {},
      }];
    }

    return [];
  }

  private parseRoles(profile: any): string[] {
    // Debug: Log all potential role claims
    console.log('[Zitadel] Checking role claims:');
    console.log('  - urn:zitadel:iam:org:project:roles:', profile['urn:zitadel:iam:org:project:roles']);
    console.log('  - roles:', profile.roles);
    console.log('  - https://claims.zitadel.com/roles:', profile['https://claims.zitadel.com/roles']);
    console.log('  - urn:zitadel:iam:org:project:339658577486583889:roles:', profile['urn:zitadel:iam:org:project:339658577486583889:roles']);

    // Check for project-specific roles (using your Project ID)
    const projectRolesKey = 'urn:zitadel:iam:org:project:339658577486583889:roles';

    // Zitadel provides roles in various formats
    const roles = profile['urn:zitadel:iam:org:project:roles'] ||
                  profile[projectRolesKey] ||
                  profile.roles ||
                  profile['https://claims.zitadel.com/roles'] ||
                  [];

    if (typeof roles === 'object' && !Array.isArray(roles)) {
      // Roles might be an object with role names as keys
      const roleNames = Object.keys(roles);
      console.log('[Zitadel] Roles found as object keys:', roleNames);
      return roleNames;
    }

    const result = Array.isArray(roles) ? roles : [];
    console.log('[Zitadel] Final parsed roles:', result);
    return result;
  }

  private parsePermissions(profile: any): string[] {
    // Extract permissions from roles or dedicated claim
    const permissions = profile.permissions ||
                       profile['urn:zitadel:iam:permissions'] ||
                       [];

    return Array.isArray(permissions) ? permissions : [];
  }

  private determineOrgType(org: any): 'healthcare_facility' | 'var' | 'admin' {
    // Determine organization type based on metadata or naming convention
    if (org.type) return org.type;
    if (org.metadata?.type) return org.metadata.type;

    // Default to healthcare_facility for now
    return 'healthcare_facility';
  }

  // Check if user has specific role
  hasRole(user: ZitadelUser, role: string): boolean {
    return user.roles.includes(role);
  }

  // Check if user has specific permission
  hasPermission(user: ZitadelUser, permission: string): boolean {
    return user.permissions.includes(permission);
  }

  /**
   * Check if the current user has Zitadel manager roles (ORG_OWNER, IAM_OWNER)
   * These roles are not included in OIDC tokens and must be fetched via Management API
   */
  async checkUserManagementRoles(): Promise<{
    isOrgOwner: boolean;
    isIAMOwner: boolean;
    memberships: any[];
  }> {
    try {
      const user = await this.getUser();
      if (!user) {
        return { isOrgOwner: false, isIAMOwner: false, memberships: [] };
      }

      // Call Zitadel Management API to get user memberships
      const managementUrl = import.meta.env.VITE_ZITADEL_MANAGEMENT_URL ||
                           import.meta.env.VITE_ZITADEL_INSTANCE_URL?.replace('https://', 'https://api.');

      if (!managementUrl) {
        log.warn('Zitadel Management API URL not configured');
        return { isOrgOwner: false, isIAMOwner: false, memberships: [] };
      }

      const response = await fetch(`${managementUrl}/v1/users/${user.id}/memberships`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${user.accessToken}`,
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        log.warn('Failed to fetch user memberships', { status: response.status });
        return { isOrgOwner: false, isIAMOwner: false, memberships: [] };
      }

      const data = await response.json();
      const memberships = data.result || [];

      // Check for manager roles in memberships
      const isOrgOwner = memberships.some((m: any) =>
        m.roles?.includes('ORG_OWNER') ||
        m.roles?.includes('org_owner')
      );

      const isIAMOwner = memberships.some((m: any) =>
        m.roles?.includes('IAM_OWNER') ||
        m.roles?.includes('iam_owner') ||
        m.type === 'TYPE_IAM'
      );

      log.info('User management roles checked', {
        userId: user.id,
        isOrgOwner,
        isIAMOwner,
        membershipCount: memberships.length
      });

      return { isOrgOwner, isIAMOwner, memberships };
    } catch (error) {
      log.error('Error checking management roles', error);
      return { isOrgOwner: false, isIAMOwner: false, memberships: [] };
    }
  }

  // Switch organization context (for users with access to multiple orgs)
  async switchOrganization(orgId: string): Promise<void> {
    // This would typically involve calling Zitadel API to switch context
    // For now, we'll store the selected org and use it in API calls
    sessionStorage.setItem('selected_org_id', orgId);
    log.info('Switched organization', { orgId });
  }
}

export const zitadelService = new ZitadelService();