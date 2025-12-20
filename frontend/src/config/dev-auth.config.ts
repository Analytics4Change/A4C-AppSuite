/**
 * Development Authentication Configuration
 *
 * Defines test user profiles and mock session data for local development.
 * This configuration is used by DevAuthProvider to provide instant
 * authentication bypass during development.
 *
 * Environment variables can override these defaults for custom test scenarios.
 *
 * See .plans/supabase-auth-integration/frontend-auth-architecture.md
 */

import { Session, User, JWTClaims, UserRole, Permission, OrganizationType } from '@/types/auth.types';
import { getRolePermissions } from './roles.config';
import { PERMISSIONS } from './permissions.config';

/**
 * Permission catalog for development testing
 * Aligned to database permissions_projection table
 *
 * See: documentation/architecture/authorization/permissions-reference.md
 */
export const DEV_PERMISSIONS: Record<string, Permission[]> = {
  // Organization Management (global + org-scoped)
  organization: [
    'organization.create',
    'organization.create_sub',
    'organization.view_ou',
    'organization.create_ou',
    'organization.view',
    'organization.update',
    'organization.deactivate',
    'organization.delete',
  ],

  // Client Management (org-scoped)
  client: [
    'client.create',
    'client.view',
    'client.update',
    'client.delete',
    'client.transfer',
  ],

  // Medication Management (org-scoped)
  medication: [
    'medication.create',
    'medication.view',
    'medication.update',
    'medication.delete',
    'medication.create_template',
  ],

  // Role Management (global + org-scoped)
  role: [
    'global_roles.create',
    'cross_org.grant',
    'role.create',
    'role.assign',
    'role.view',
  ],

  // User Management (global + org-scoped)
  user: [
    'users.impersonate',
    'user.create',
    'user.view',
    'user.update',
  ],
};

/**
 * Get all permissions from the catalog
 * Note: This is kept for reference, but actual role permissions
 * should be retrieved via getRolePermissions() from roles.config.ts
 */
export function getAllPermissions(): Permission[] {
  return Object.values(DEV_PERMISSIONS).flat();
}

/**
 * Get permissions for a dev profile, including implicit org grants for provider_admin
 *
 * This is MOCK MODE ONLY - production gets permissions from JWT claims populated
 * by the Temporal workflow during organization bootstrap.
 *
 * In mock mode, provider_admin users get all organization-scoped permissions
 * to simulate the implicit "full control within their org" behavior that would
 * be granted via the Temporal workflow in production.
 *
 * See: documentation/architecture/authorization/provider-admin-permissions-architecture.md
 */
export function getDevProfilePermissions(role: UserRole): Permission[] {
  const basePermissions = getRolePermissions(role);

  // In mock mode, provider_admin gets all organization-scoped permissions
  // This simulates the implicit grant that would come from Temporal workflow in production
  if (role === 'provider_admin') {
    const orgPermissions = Object.values(PERMISSIONS)
      .filter(p => p.scope === 'organization')
      .map(p => p.id);
    return [...new Set([...basePermissions, ...orgPermissions])];
  }

  return basePermissions;
}

/**
 * Test user profile interface
 */
export interface DevUserProfile {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  org_id: string;
  org_type: OrganizationType;
  org_name: string;
  scope_path: string;
  permissions: Permission[];
  picture?: string;
}

/**
 * Default test user profile (provider_admin)
 *
 * Uses getDevProfilePermissions() to include implicit organization-scoped
 * permissions for provider_admin in mock mode. This simulates the behavior
 * that would come from Temporal workflow grants in production.
 *
 * Environment variables can override these values:
 * - VITE_DEV_USER_ID
 * - VITE_DEV_USER_EMAIL
 * - VITE_DEV_USER_NAME
 * - VITE_DEV_ORG_ID
 * - VITE_DEV_USER_ROLE
 * - VITE_DEV_PERMISSIONS (comma-separated)
 * - VITE_DEV_SCOPE_PATH
 */
export const DEFAULT_DEV_USER: DevUserProfile = {
  id: import.meta.env.VITE_DEV_USER_ID || 'dev-user-550e8400-e29b-41d4-a716-446655440000',
  email: import.meta.env.VITE_DEV_USER_EMAIL || 'dev@example.com',
  name: import.meta.env.VITE_DEV_USER_NAME || 'Dev User (Provider Admin)',
  role: (import.meta.env.VITE_DEV_USER_ROLE as UserRole) || 'provider_admin',
  org_id: import.meta.env.VITE_DEV_ORG_ID || 'dev-org-660e8400-e29b-41d4-a716-446655440000',
  org_type: 'provider',
  org_name: 'Development Organization',
  scope_path: import.meta.env.VITE_DEV_SCOPE_PATH || 'org_dev_organization',
  permissions: import.meta.env.VITE_DEV_PERMISSIONS
    ? import.meta.env.VITE_DEV_PERMISSIONS.split(',')
    : getDevProfilePermissions((import.meta.env.VITE_DEV_USER_ROLE as UserRole) || 'provider_admin'),
  picture: 'https://api.dicebear.com/7.x/avataaars/svg?seed=dev-user',
};

/**
 * Additional test user profiles for canonical roles
 * Only includes system-defined roles from CANONICAL_ROLES
 * Custom organization roles should be tested via real database queries
 *
 * Note: Uses getDevProfilePermissions() to include implicit org permissions
 * for provider_admin in mock mode.
 */
export const DEV_USER_PROFILES: Record<string, DevUserProfile> = {
  provider_admin: DEFAULT_DEV_USER,

  super_admin: {
    id: 'dev-super-admin-770e8400-e29b-41d4-a716-446655440000',
    email: 'super.admin@example.com',
    name: 'Dev Super Admin',
    role: 'super_admin',
    org_id: '*', // Wildcard indicates all orgs
    org_type: 'platform_owner',
    org_name: 'Platform (All Organizations)',
    scope_path: '*', // Global scope
    permissions: getDevProfilePermissions('super_admin'),
    picture: 'https://api.dicebear.com/7.x/avataaars/svg?seed=super-admin',
  },

  partner_admin: {
    id: 'dev-partner-admin-990e8400-e29b-41d4-a716-446655440000',
    email: 'partner.admin@example.com',
    name: 'Dev Partner Admin',
    role: 'partner_admin',
    org_id: 'dev-partner-org-770e8400-e29b-41d4-a716-446655440000',
    org_type: 'provider_partner',
    org_name: 'Development Partner Organization',
    scope_path: 'org_dev_partner_organization',
    permissions: getDevProfilePermissions('partner_admin'),
    picture: 'https://api.dicebear.com/7.x/avataaars/svg?seed=partner-admin',
  },
};

/**
 * Create a mock User object from a dev profile
 */
export function createMockUser(profile: DevUserProfile): User {
  return {
    id: profile.id,
    email: profile.email,
    name: profile.name,
    picture: profile.picture,
    provider: 'mock',
    user_metadata: {
      name: profile.name,
      avatar_url: profile.picture,
    },
    email_confirmed_at: new Date().toISOString(),
    created_at: new Date().toISOString(),
  };
}

/**
 * Create mock JWT claims from a dev profile
 */
export function createMockJWTClaims(profile: DevUserProfile): JWTClaims {
  const now = Math.floor(Date.now() / 1000);
  const expiresIn = 3600; // 1 hour

  return {
    sub: profile.id,
    email: profile.email,
    email_verified: true,
    aal: 'aal1',
    session_id: `mock-session-${Date.now()}`,
    org_id: profile.org_id,
    org_type: profile.org_type,
    user_role: profile.role,
    permissions: profile.permissions,
    scope_path: profile.scope_path,
    iat: now,
    exp: now + expiresIn,
  };
}

/**
 * Create a complete mock session from a dev profile
 */
export function createMockSession(profile: DevUserProfile): Session {
  const user = createMockUser(profile);
  const claims = createMockJWTClaims(profile);

  // Create a simple mock JWT token (not cryptographically valid, just for dev)
  const header = globalThis.btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = globalThis.btoa(JSON.stringify(claims));
  const signature = 'mock-signature';
  const mockToken = `${header}.${payload}.${signature}`;

  return {
    access_token: mockToken,
    refresh_token: 'mock-refresh-token',
    token_type: 'Bearer',
    expires_in: 3600,
    expires_at: claims.exp,
    user,
    claims,
  };
}

/**
 * Get the active dev user profile based on environment or default
 */
export function getActiveDevProfile(): DevUserProfile {
  // Check if a specific profile is requested via environment
  const profileName = import.meta.env.VITE_DEV_PROFILE;
  if (profileName && DEV_USER_PROFILES[profileName]) {
    return DEV_USER_PROFILES[profileName];
  }

  // Use default profile
  return DEFAULT_DEV_USER;
}

/**
 * Development auth configuration
 */
export interface DevAuthConfig {
  /** Active user profile */
  profile: DevUserProfile;

  /** Simulated login delay (ms) */
  loginDelay?: number;

  /** Auto-login on provider initialization */
  autoLogin?: boolean;

  /** Enable debug logging */
  debug?: boolean;
}

/**
 * Get development auth configuration
 */
export function getDevAuthConfig(): DevAuthConfig {
  return {
    profile: getActiveDevProfile(),
    loginDelay: 0, // Instant login by default
    autoLogin: true, // Auto-login for convenience
    debug: import.meta.env.DEV, // Enable debug logging in dev mode
  };
}
