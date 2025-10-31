/**
 * Shared Authentication Type Definitions
 *
 * These types define the authentication system's contracts and are used
 * across all authentication providers (mock, Supabase, etc.) to ensure
 * consistent type safety.
 */

/**
 * User roles supported by the system
 * Includes both canonical roles (from CANONICAL_ROLES) and custom organization roles
 *
 * Canonical roles (system-defined):
 * - super_admin: Platform-wide access (all organizations)
 * - partner_onboarder: Can create and manage new provider organizations
 * - provider_admin: Organization owner with full control
 *
 * Custom organization roles (created by provider_admin):
 * - partner_admin: Provider Partner admin (custom role)
 * - facility_admin: Facility-scoped admin (future)
 * - program_manager: Program-scoped manager (future)
 * - clinician: Clinical user
 * - nurse: Nursing staff
 * - caregiver: Caregiver role
 * - viewer: Read-only access
 *
 * See .plans/rbac-permissions/architecture.md for complete role definitions
 */
export type UserRole =
  | 'super_admin'           // Canonical: Platform-wide access
  | 'partner_onboarder'     // Canonical: Create/manage provider organizations
  | 'provider_admin'        // Canonical: Organization owner
  | 'partner_admin'         // Custom: Provider Partner admin
  | 'facility_admin'        // Custom: Facility-scoped admin (future)
  | 'program_manager'       // Custom: Program-scoped manager (future)
  | 'clinician'             // Custom: Clinical user
  | 'nurse'                 // Custom: Nursing staff
  | 'caregiver'             // Custom: Caregiver role
  | 'viewer';               // Custom: Read-only access

/**
 * Permission strings following the applet.action pattern
 * See .plans/rbac-permissions/architecture.md for complete catalog
 */
export type Permission = string;

/**
 * JWT Custom Claims Structure
 * Added to JWT tokens via Supabase Auth custom claims hook
 * See .plans/supabase-auth-integration/custom-claims-setup.md
 */
export interface JWTClaims {
  /** User ID (standard Supabase claim) */
  sub: string;

  /** User email (standard Supabase claim) */
  email: string;

  /** Email verification status */
  email_verified?: boolean;

  /** Authentication assurance level */
  aal?: string;

  /** Session ID */
  session_id?: string;

  /** Organization ID - primary tenant identifier for RLS */
  org_id: string;

  /** User's role within the organization */
  user_role: UserRole;

  /** Array of permission strings (e.g., ["medication.create", "client.view"]) */
  permissions: Permission[];

  /** Hierarchical ltree path for organizational scope
   * Example: "org_acme_healthcare.facility_a.unit_1"
   * See .plans/rbac-permissions/architecture.md for scope_path explanation
   */
  scope_path: string;

  /** Token issued at timestamp */
  iat?: number;

  /** Token expiration timestamp */
  exp?: number;
}

/**
 * User metadata from auth provider
 */
export interface UserMetadata {
  name?: string;
  avatar_url?: string;
  picture?: string;
  [key: string]: any;
}

/**
 * Authenticated user information
 */
export interface User {
  /** Unique user identifier */
  id: string;

  /** User's email address */
  email: string;

  /** User's display name */
  name?: string;

  /** User's avatar/picture URL */
  picture?: string;

  /** Auth provider used (google, github, etc.) */
  provider?: 'google' | 'github' | 'facebook' | 'apple' | 'email' | 'mock';

  /** User metadata from provider */
  user_metadata?: UserMetadata;

  /** Email verification status */
  email_confirmed_at?: string;

  /** Account creation timestamp */
  created_at?: string;
}

/**
 * Authentication session
 * Contains access token and user information
 */
export interface Session {
  /** JWT access token */
  access_token: string;

  /** Refresh token for obtaining new access tokens */
  refresh_token?: string;

  /** Token type (typically "Bearer") */
  token_type?: string;

  /** Token expiration time in seconds */
  expires_in?: number;

  /** Token expiration timestamp */
  expires_at?: number;

  /** Authenticated user information */
  user: User;

  /** Decoded JWT claims (includes custom claims) */
  claims: JWTClaims;
}

/**
 * Authentication state for React context
 */
export interface AuthState {
  /** Whether user is authenticated */
  isAuthenticated: boolean;

  /** Current user (null if not authenticated) */
  user: User | null;

  /** Current session (null if not authenticated) */
  session: Session | null;

  /** Loading state during auth operations */
  loading: boolean;

  /** Error state from auth operations */
  error: Error | null;
}

/**
 * Login credentials for email/password auth
 */
export interface LoginCredentials {
  email: string;
  password: string;
}

/**
 * OAuth provider types supported by Supabase
 */
export type OAuthProvider = 'google' | 'github' | 'facebook' | 'apple';

/**
 * OAuth login options
 */
export interface OAuthOptions {
  /** URL to redirect to after successful authentication */
  redirectTo?: string;

  /** OAuth scopes to request */
  scopes?: string;

  /** Additional query parameters */
  queryParams?: Record<string, string>;
}

/**
 * Organization context for multi-tenant operations
 */
export interface OrganizationContext {
  /** Current organization ID */
  org_id: string;

  /** Organization name */
  name?: string;

  /** Organization type */
  type?: 'provider' | 'partner' | 'platform';

  /** Hierarchical scope path */
  scope_path: string;
}

/**
 * Permission check result
 */
export interface PermissionCheckResult {
  /** Whether user has the permission */
  hasPermission: boolean;

  /** Reason if permission denied (for debugging) */
  reason?: string;
}
