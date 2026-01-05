/**
 * User Type Definitions
 *
 * Types for managing users and invitations within the user management system.
 * Supports multi-role invitations, user lifecycle management, and multi-organization
 * user scenarios.
 *
 * @see documentation/architecture/authorization/rbac-architecture.md
 * @see infrastructure/supabase/contracts/asyncapi/domains/user.yaml
 * @see infrastructure/supabase/contracts/asyncapi/domains/invitation.yaml
 */

import type { Role } from './role.types';

// ============================================================================
// NOTIFICATION PREFERENCES
// ============================================================================

/**
 * SMS notification settings
 *
 * Requires phone_id to reference a user phone that is SMS-capable.
 */
export interface SmsPreferences {
  /** Whether SMS notifications are enabled */
  enabled: boolean;

  /** UUID of the phone to use for SMS (from user_phones or user_org_phone_overrides) */
  phoneId: string | null;
}

/**
 * User notification preferences (stored per-org in user_org_access)
 *
 * Controls how users receive notifications within each organization.
 * Different preferences can be set for each organization the user belongs to.
 */
export interface NotificationPreferences {
  /** Whether to send email notifications */
  email: boolean;

  /** SMS notification settings */
  sms: SmsPreferences;

  /** Whether to send in-app notifications (future feature) */
  inApp: boolean;
}

/**
 * Default notification preferences for new users/invitations
 */
export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = {
  email: true,
  sms: { enabled: false, phoneId: null },
  inApp: false,
};

// ============================================================================
// USER-ORGANIZATION ACCESS
// ============================================================================

/**
 * User access record for a specific organization
 *
 * Stored in user_org_access junction table. Controls:
 * - When user can first access the org (access_start_date)
 * - When user access expires (access_expiration_date)
 * - Notification preferences for this org
 */
export interface UserOrgAccess {
  /** User UUID */
  userId: string;

  /** Organization UUID */
  orgId: string;

  /**
   * First date the user can access this org (NULL = immediate access)
   * Useful for pre-scheduling access for new hires or contractors.
   */
  accessStartDate: string | null;

  /**
   * Date when user access expires (NULL = no expiration)
   * JWT hook returns access_blocked: true after this date.
   */
  accessExpirationDate: string | null;

  /** Per-org notification preferences */
  notificationPreferences: NotificationPreferences;

  /** When this access record was created */
  createdAt: Date;

  /** When this access record was last updated */
  updatedAt: Date;
}

// ============================================================================
// ADDRESS TYPES
// ============================================================================

/**
 * Address types supported by the system
 */
export type AddressType = 'physical' | 'mailing' | 'billing';

/**
 * User address (global or org-specific override)
 *
 * Supports hybrid scope model:
 * - Global addresses (orgId = null) apply across all organizations
 * - Org-specific overrides (orgId set) apply only to that organization
 */
export interface UserAddress {
  /** Unique identifier */
  id: string;

  /** User UUID */
  userId: string;

  /**
   * Organization UUID for override, null for global address
   * If set, this address only applies when user is in this org context
   */
  orgId: string | null;

  /** Human-readable label (e.g., "Home", "Work") */
  label: string;

  /** Address type */
  type: AddressType;

  /** Street address line 1 */
  street1: string;

  /** Street address line 2 (optional) */
  street2: string | null;

  /** City */
  city: string;

  /** State/Province */
  state: string;

  /** ZIP/Postal code */
  zipCode: string;

  /** Country (defaults to "USA") */
  country: string;

  /** Whether this is the user's primary address (global addresses only) */
  isPrimary: boolean;

  /** Whether the address is active */
  isActive: boolean;

  /** When the address was created */
  createdAt: Date;

  /** When the address was last updated */
  updatedAt: Date;
}

// ============================================================================
// PHONE TYPES
// ============================================================================

/**
 * Phone types supported by the system
 */
export type PhoneType = 'mobile' | 'office' | 'fax' | 'emergency';

/**
 * User phone (global or org-specific override)
 *
 * Supports hybrid scope model:
 * - Global phones (orgId = null) apply across all organizations
 * - Org-specific overrides (orgId set) apply only to that organization
 */
export interface UserPhone {
  /** Unique identifier */
  id: string;

  /** User UUID */
  userId: string;

  /**
   * Organization UUID for override, null for global phone
   * If set, this phone only applies when user is in this org context
   */
  orgId: string | null;

  /** Human-readable label (e.g., "Personal Cell", "Work") */
  label: string;

  /** Phone type */
  type: PhoneType;

  /** Phone number */
  number: string;

  /** Extension (optional) */
  extension: string | null;

  /** Country code (defaults to "+1") */
  countryCode: string;

  /** Whether this is the user's primary phone (global phones only) */
  isPrimary: boolean;

  /** Whether the phone is active */
  isActive: boolean;

  /** Whether this phone can receive SMS notifications */
  smsCapable: boolean;

  /** When the phone was created */
  createdAt: Date;

  /** When the phone was last updated */
  updatedAt: Date;
}

// ============================================================================
// CORE TYPES
// ============================================================================

/**
 * Display status for unified user/invitation list
 *
 * Computed status that combines user state and invitation state for UI display.
 * - pending: Invitation sent, awaiting acceptance (expires_at >= now)
 * - expired: Invitation expired without acceptance (expires_at < now)
 * - active: User account active and accessible
 * - deactivated: User account deactivated (banned)
 */
export type UserDisplayStatus = 'pending' | 'expired' | 'active' | 'deactivated';

/**
 * Role reference for invitations
 *
 * Lightweight role reference stored in invitations. Contains role_id for
 * the actual assignment and role_name as a denormalized snapshot for display.
 */
export interface RoleReference {
  /** UUID of the role */
  roleId: string;

  /** Denormalized role name for display (e.g., "Program Manager - Aspen") */
  roleName: string;
}

// ============================================================================
// USER INTERFACES
// ============================================================================

/**
 * Base user data from the users table
 *
 * Represents a user account within the system. Users can belong to multiple
 * organizations and have different roles in each.
 */
export interface User {
  /** Unique identifier (UUID, same as auth.users.id) */
  id: string;

  /** User's email address */
  email: string;

  /** User's first name */
  firstName: string | null;

  /** User's last name */
  lastName: string | null;

  /**
   * Full display name (legacy field, concatenated from first/last)
   * @deprecated Use firstName and lastName instead
   */
  name: string | null;

  /** Currently selected organization ID */
  currentOrganizationId: string | null;

  /** Whether the user account is active */
  isActive: boolean;

  /** When the user was created */
  createdAt: Date;

  /** When the user was last updated */
  updatedAt: Date;

  /** When the user last logged in */
  lastLoginAt: Date | null;
}

/**
 * User with role assignments for current organization
 *
 * Extended user type that includes role information within the
 * context of a specific organization.
 */
export interface UserWithRoles extends User {
  /** Roles assigned to this user in the current organization */
  roles: Role[];

  /** Computed display status */
  displayStatus: Extract<UserDisplayStatus, 'active' | 'deactivated'>;
}

/**
 * User as displayed in unified list (combines users and invitations)
 *
 * Unified type for the user list that can represent either an active user
 * or a pending/expired invitation.
 */
export interface UserListItem {
  /** Unique identifier (user.id for users, invitation.id for invitations) */
  id: string;

  /** Email address */
  email: string;

  /** First name */
  firstName: string | null;

  /** Last name */
  lastName: string | null;

  /** Computed display status */
  displayStatus: UserDisplayStatus;

  /** Role references (from invitation or user_roles_projection) */
  roles: RoleReference[];

  /** When this record was created */
  createdAt: Date;

  /** For invitations: when the invitation expires */
  expiresAt: Date | null;

  /** Whether this is an invitation (true) or active user (false) */
  isInvitation: boolean;

  /** Original invitation ID if this is an invitation */
  invitationId: string | null;
}

// ============================================================================
// INVITATION INTERFACES
// ============================================================================

/**
 * Invitation status in the database
 */
export type InvitationStatus = 'pending' | 'accepted' | 'expired' | 'revoked';

/**
 * Pending invitation from invitations_projection
 */
export interface Invitation {
  /** Unique identifier (UUID) */
  id: string;

  /** Invitation UUID (same as id in most cases) */
  invitationId: string;

  /** Organization the user is being invited to */
  organizationId: string;

  /** Email address of the invited user */
  email: string;

  /** First name of the invited user */
  firstName: string | null;

  /** Last name of the invited user */
  lastName: string | null;

  /**
   * Roles to assign when invitation is accepted
   * Array of role references with ID and denormalized name
   */
  roles: RoleReference[];

  /** Secure invitation token */
  token: string;

  /** When the invitation expires */
  expiresAt: Date;

  /**
   * First date the invited user can access the org after accepting
   * NULL = immediate access after acceptance
   */
  accessStartDate: string | null;

  /**
   * Date when the invited user's access will expire
   * NULL = no expiration (permanent access)
   */
  accessExpirationDate: string | null;

  /** Initial notification preferences for the user */
  notificationPreferences: NotificationPreferences;

  /** Current status */
  status: InvitationStatus;

  /** When the invitation was accepted (if accepted) */
  acceptedAt: Date | null;

  /** When the invitation was created */
  createdAt: Date;

  /** When the invitation was last updated */
  updatedAt: Date;
}

// ============================================================================
// EMAIL LOOKUP TYPES
// ============================================================================

/**
 * Result of smart email lookup
 *
 * Used to determine what action to take when an admin enters an email
 * in the invitation form.
 */
export type EmailLookupStatus =
  | 'not_found'        // No matches anywhere - show full form
  | 'pending'          // Has pending invitation - offer resend
  | 'expired'          // Invitation expired - offer new invitation
  | 'active_member'    // Already active in this org - show view link
  | 'deactivated'      // Deactivated in this org - offer reactivate
  | 'other_org';       // Exists in system but not this org - offer add

/**
 * Full email lookup result with context
 */
export interface EmailLookupResult {
  /** Lookup status */
  status: EmailLookupStatus;

  /** User ID if user exists */
  userId: string | null;

  /** Invitation ID if pending invitation exists */
  invitationId: string | null;

  /** User's first name if available */
  firstName: string | null;

  /** User's last name if available */
  lastName: string | null;

  /** Invitation expiration if pending */
  expiresAt: Date | null;

  /** Current roles if active member */
  currentRoles: RoleReference[] | null;
}

// ============================================================================
// FORM AND REQUEST TYPES
// ============================================================================

/**
 * Form data for creating a new invitation
 */
export interface InviteUserFormData {
  /** Email address of the user to invite */
  email: string;

  /** First name */
  firstName: string;

  /** Last name */
  lastName: string;

  /** Role IDs to assign (must be subset of inviter's permissions) */
  roleIds: string[];

  /**
   * First date the user can access the org (optional)
   * Format: YYYY-MM-DD
   */
  accessStartDate?: string;

  /**
   * Date when user access expires (optional)
   * Format: YYYY-MM-DD
   */
  accessExpirationDate?: string;

  /** Initial notification preferences */
  notificationPreferences?: NotificationPreferences;
}

/**
 * Request payload for inviting a user
 */
export interface InviteUserRequest {
  /** Email address of the user to invite */
  email: string;

  /** First name */
  firstName: string;

  /** Last name */
  lastName: string;

  /**
   * Roles to assign when invitation is accepted
   * Each role must pass subset-only delegation check
   */
  roles: RoleReference[];

  /** Custom expiration in days (default: 7) */
  expirationDays?: number;

  /**
   * First date the user can access the org (optional)
   * Format: YYYY-MM-DD
   */
  accessStartDate?: string;

  /**
   * Date when user access expires (optional)
   * Format: YYYY-MM-DD
   */
  accessExpirationDate?: string;

  /** Initial notification preferences */
  notificationPreferences?: NotificationPreferences;
}

/**
 * Request payload for updating user profile
 */
export interface UpdateUserRequest {
  /** User ID to update */
  userId: string;

  /** Updated first name (optional) */
  firstName?: string;

  /** Updated last name (optional) */
  lastName?: string;
}

/**
 * Request payload for assigning roles to a user
 */
export interface AssignRolesRequest {
  /** User ID */
  userId: string;

  /** Role IDs to add */
  roleIdsToAdd: string[];

  /** Role IDs to remove */
  roleIdsToRemove: string[];
}

/**
 * Request payload for updating user access dates
 */
export interface UpdateAccessDatesRequest {
  /** User ID */
  userId: string;

  /** Organization ID */
  orgId: string;

  /** New access start date (null to clear) */
  accessStartDate: string | null;

  /** New access expiration date (null to clear) */
  accessExpirationDate: string | null;
}

/**
 * Request payload for updating notification preferences
 */
export interface UpdateNotificationPreferencesRequest {
  /** User ID */
  userId: string;

  /** Organization ID */
  orgId: string;

  /** New notification preferences */
  notificationPreferences: NotificationPreferences;
}

/**
 * Request payload for adding a user address
 */
export interface AddUserAddressRequest {
  /** User ID */
  userId: string;

  /**
   * Organization ID for override (null for global address)
   */
  orgId: string | null;

  /** Address label */
  label: string;

  /** Address type */
  type: AddressType;

  /** Street address line 1 */
  street1: string;

  /** Street address line 2 */
  street2?: string;

  /** City */
  city: string;

  /** State */
  state: string;

  /** ZIP code */
  zipCode: string;

  /** Country (defaults to USA) */
  country?: string;

  /** Whether this is the primary address */
  isPrimary?: boolean;
}

/**
 * Request payload for updating a user address
 */
export interface UpdateUserAddressRequest {
  /** Address ID */
  addressId: string;

  /** Fields to update (partial) */
  updates: Partial<Omit<AddUserAddressRequest, 'userId' | 'orgId'>>;
}

/**
 * Request payload for removing a user address
 */
export interface RemoveUserAddressRequest {
  /** Address ID */
  addressId: string;

  /** Whether to hard delete (true) or soft delete/deactivate (false) */
  hardDelete?: boolean;
}

/**
 * Request payload for adding a user phone
 */
export interface AddUserPhoneRequest {
  /** User ID */
  userId: string;

  /**
   * Organization ID for override (null for global phone)
   */
  orgId: string | null;

  /** Phone label */
  label: string;

  /** Phone type */
  type: PhoneType;

  /** Phone number */
  number: string;

  /** Extension */
  extension?: string;

  /** Country code (defaults to +1) */
  countryCode?: string;

  /** Whether this is the primary phone */
  isPrimary?: boolean;

  /** Whether this phone can receive SMS */
  smsCapable?: boolean;
}

/**
 * Request payload for updating a user phone
 */
export interface UpdateUserPhoneRequest {
  /** Phone ID */
  phoneId: string;

  /** Fields to update (partial) */
  updates: Partial<Omit<AddUserPhoneRequest, 'userId' | 'orgId'>>;
}

/**
 * Request payload for removing a user phone
 */
export interface RemoveUserPhoneRequest {
  /** Phone ID */
  phoneId: string;

  /** Whether to hard delete (true) or soft delete/deactivate (false) */
  hardDelete?: boolean;
}

// ============================================================================
// OPERATION RESULTS
// ============================================================================

/**
 * Error codes for user operations
 */
export type UserOperationErrorCode =
  | 'NOT_FOUND'
  | 'ALREADY_EXISTS'
  | 'ALREADY_MEMBER'
  | 'ALREADY_ACTIVE'
  | 'ALREADY_INACTIVE'
  | 'INVITATION_EXPIRED'
  | 'INVITATION_REVOKED'
  | 'SUBSET_ONLY_VIOLATION'
  | 'SCOPE_VIOLATION'
  | 'NO_ORG_CONTEXT'
  | 'VALIDATION_ERROR'
  | 'PERMISSION_DENIED'
  | 'EMAIL_SEND_FAILED'
  | 'FORBIDDEN'
  | 'INVALID_DATES'
  | 'UNKNOWN';

/**
 * Result from user operations
 */
export interface UserOperationResult {
  /** Whether the operation succeeded */
  success: boolean;

  /** The resulting user (if applicable) */
  user?: User;

  /** The resulting invitation (if applicable) */
  invitation?: Invitation;

  /** Error message (if failed) */
  error?: string;

  /** Detailed error information (if failed) */
  errorDetails?: {
    /** Error code for programmatic handling */
    code: UserOperationErrorCode;

    /** Human-readable message */
    message: string;

    /** Additional context */
    context?: Record<string, unknown>;
  };
}

// ============================================================================
// QUERY AND FILTER TYPES
// ============================================================================

/**
 * Filter options for querying users
 */
export interface UserFilterOptions {
  /** Filter by display status */
  status?: UserDisplayStatus | 'all';

  /** Filter by role ID */
  roleId?: string;

  /** Search by name or email (case-insensitive) */
  searchTerm?: string;

  /** Include only invitations */
  invitationsOnly?: boolean;

  /** Include only active users */
  usersOnly?: boolean;
}

/**
 * Sorting options for user queries
 */
export interface UserSortOptions {
  /** Field to sort by */
  sortBy: 'name' | 'email' | 'createdAt' | 'lastLoginAt' | 'status';

  /** Sort direction */
  sortOrder: 'asc' | 'desc';
}

/**
 * Pagination options
 */
export interface PaginationOptions {
  /** Page number (1-indexed) */
  page: number;

  /** Items per page */
  pageSize: number;
}

/**
 * Combined query options
 */
export interface UserQueryOptions {
  /** Filter options */
  filters?: UserFilterOptions;

  /** Sort options */
  sort?: UserSortOptions;

  /** Pagination options */
  pagination?: PaginationOptions;
}

/**
 * Paginated result wrapper
 */
export interface PaginatedResult<T> {
  /** Items for current page */
  items: T[];

  /** Total count of all matching items */
  totalCount: number;

  /** Current page number */
  page: number;

  /** Items per page */
  pageSize: number;

  /** Total number of pages */
  totalPages: number;

  /** Whether there are more pages */
  hasMore: boolean;
}

// ============================================================================
// VALIDATION
// ============================================================================

/**
 * Validation rules for user form fields
 */
export const USER_VALIDATION = {
  email: {
    pattern: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
    maxLength: 255,
    message: 'Please enter a valid email address',
  },
  firstName: {
    minLength: 1,
    maxLength: 100,
    message: 'First name is required and must be 100 characters or less',
  },
  lastName: {
    minLength: 1,
    maxLength: 100,
    message: 'Last name is required and must be 100 characters or less',
  },
  roles: {
    minCount: 1,
    message: 'At least one role must be selected',
  },
};

/**
 * Validate an email address
 *
 * @param email - Email to validate
 * @returns Error message or null if valid
 */
export function validateEmail(email: string): string | null {
  const trimmed = email.trim();
  if (trimmed.length === 0) {
    return 'Email is required';
  }
  if (trimmed.length > USER_VALIDATION.email.maxLength) {
    return `Email must be ${USER_VALIDATION.email.maxLength} characters or less`;
  }
  if (!USER_VALIDATION.email.pattern.test(trimmed)) {
    return USER_VALIDATION.email.message;
  }
  return null;
}

/**
 * Validate a first name
 *
 * @param firstName - First name to validate
 * @returns Error message or null if valid
 */
export function validateFirstName(firstName: string): string | null {
  const trimmed = firstName.trim();
  if (trimmed.length === 0) {
    return 'First name is required';
  }
  if (trimmed.length > USER_VALIDATION.firstName.maxLength) {
    return `First name must be ${USER_VALIDATION.firstName.maxLength} characters or less`;
  }
  return null;
}

/**
 * Validate a last name
 *
 * @param lastName - Last name to validate
 * @returns Error message or null if valid
 */
export function validateLastName(lastName: string): string | null {
  const trimmed = lastName.trim();
  if (trimmed.length === 0) {
    return 'Last name is required';
  }
  if (trimmed.length > USER_VALIDATION.lastName.maxLength) {
    return `Last name must be ${USER_VALIDATION.lastName.maxLength} characters or less`;
  }
  return null;
}

/**
 * Validate role selection
 *
 * @param roleIds - Array of selected role IDs
 * @returns Error message or null if valid
 */
export function validateRoles(roleIds: string[]): string | null {
  if (roleIds.length < USER_VALIDATION.roles.minCount) {
    return USER_VALIDATION.roles.message;
  }
  return null;
}

/**
 * Validate access dates (start date must be before or equal to expiration date)
 *
 * @param accessStartDate - Start date (YYYY-MM-DD format, optional)
 * @param accessExpirationDate - Expiration date (YYYY-MM-DD format, optional)
 * @returns Object with field-specific errors, or null if valid
 */
export function validateAccessDates(
  accessStartDate?: string | null,
  accessExpirationDate?: string | null
): { accessStartDate?: string; accessExpirationDate?: string } | null {
  const errors: { accessStartDate?: string; accessExpirationDate?: string } =
    {};

  // Validate date formats if provided
  const datePattern = /^\d{4}-\d{2}-\d{2}$/;

  if (accessStartDate && !datePattern.test(accessStartDate)) {
    errors.accessStartDate = 'Access start date must be in YYYY-MM-DD format';
  }

  if (accessExpirationDate && !datePattern.test(accessExpirationDate)) {
    errors.accessExpirationDate =
      'Access expiration date must be in YYYY-MM-DD format';
  }

  // If both dates provided and valid format, check ordering
  if (
    accessStartDate &&
    accessExpirationDate &&
    !errors.accessStartDate &&
    !errors.accessExpirationDate
  ) {
    const start = new Date(accessStartDate);
    const end = new Date(accessExpirationDate);

    if (start > end) {
      errors.accessExpirationDate =
        'Access expiration date must be after start date';
    }
  }

  return Object.keys(errors).length > 0 ? errors : null;
}

/**
 * Validate a phone number
 *
 * @param phoneNumber - Phone number to validate
 * @returns Error message or null if valid
 */
export function validatePhoneNumber(phoneNumber: string): string | null {
  const trimmed = phoneNumber.trim();
  if (trimmed.length === 0) {
    return 'Phone number is required';
  }
  // Basic phone validation - allows digits, spaces, dashes, parentheses, plus
  const phonePattern = /^[+]?[\d\s()-]{7,20}$/;
  if (!phonePattern.test(trimmed)) {
    return 'Please enter a valid phone number';
  }
  return null;
}

/**
 * Validate entire invite user form
 *
 * @param formData - Form data to validate
 * @returns Object with field-specific errors, or null if all valid
 */
export function validateInviteUserForm(
  formData: InviteUserFormData
): Record<string, string> | null {
  const errors: Record<string, string> = {};

  const emailError = validateEmail(formData.email);
  if (emailError) errors.email = emailError;

  const firstNameError = validateFirstName(formData.firstName);
  if (firstNameError) errors.firstName = firstNameError;

  const lastNameError = validateLastName(formData.lastName);
  if (lastNameError) errors.lastName = lastNameError;

  const rolesError = validateRoles(formData.roleIds);
  if (rolesError) errors.roleIds = rolesError;

  // Validate access dates if provided
  const accessDateErrors = validateAccessDates(
    formData.accessStartDate,
    formData.accessExpirationDate
  );
  if (accessDateErrors) {
    Object.assign(errors, accessDateErrors);
  }

  return Object.keys(errors).length > 0 ? errors : null;
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Get display name from user or invitation
 *
 * @param item - User or invitation with name fields
 * @returns Formatted display name or email fallback
 */
export function getDisplayName(item: {
  firstName: string | null;
  lastName: string | null;
  email: string;
}): string {
  if (item.firstName && item.lastName) {
    return `${item.firstName} ${item.lastName}`;
  }
  if (item.firstName) {
    return item.firstName;
  }
  if (item.lastName) {
    return item.lastName;
  }
  return item.email;
}

/**
 * Compute display status for an invitation
 *
 * Checks expiration date to determine if invitation is still pending or expired.
 *
 * @param invitation - Invitation to check
 * @returns Computed display status
 */
export function computeInvitationDisplayStatus(
  invitation: Invitation
): UserDisplayStatus {
  if (invitation.status === 'accepted') {
    return 'active';
  }
  if (invitation.status === 'revoked') {
    return 'expired'; // Treat revoked as expired for display
  }
  if (invitation.status === 'expired') {
    return 'expired';
  }
  // Status is 'pending' - check expiration
  if (new Date(invitation.expiresAt) < new Date()) {
    return 'expired';
  }
  return 'pending';
}

/**
 * Convert invitation to UserListItem
 *
 * @param invitation - Invitation to convert
 * @returns UserListItem for unified display
 */
export function invitationToListItem(invitation: Invitation): UserListItem {
  return {
    id: invitation.id,
    email: invitation.email,
    firstName: invitation.firstName,
    lastName: invitation.lastName,
    displayStatus: computeInvitationDisplayStatus(invitation),
    roles: invitation.roles,
    createdAt: invitation.createdAt,
    expiresAt: invitation.expiresAt,
    isInvitation: true,
    invitationId: invitation.invitationId,
  };
}

/**
 * Convert user with roles to UserListItem
 *
 * @param user - User with roles to convert
 * @returns UserListItem for unified display
 */
export function userToListItem(user: UserWithRoles): UserListItem {
  return {
    id: user.id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    displayStatus: user.isActive ? 'active' : 'deactivated',
    roles: user.roles.map((r) => ({ roleId: r.id, roleName: r.name })),
    createdAt: user.createdAt,
    expiresAt: null,
    isInvitation: false,
    invitationId: null,
  };
}

/**
 * Get days until invitation expires
 *
 * @param expiresAt - Expiration date
 * @returns Number of days (negative if expired)
 */
export function getDaysUntilExpiration(expiresAt: Date): number {
  const now = new Date();
  const expiration = new Date(expiresAt);
  const diffMs = expiration.getTime() - now.getTime();
  return Math.ceil(diffMs / (1000 * 60 * 60 * 24));
}

/**
 * Get human-readable expiration text
 *
 * @param expiresAt - Expiration date
 * @returns Human-readable text (e.g., "Expires in 3 days", "Expired 2 days ago")
 */
export function getExpirationText(expiresAt: Date): string {
  const days = getDaysUntilExpiration(expiresAt);
  if (days > 1) {
    return `Expires in ${days} days`;
  }
  if (days === 1) {
    return 'Expires tomorrow';
  }
  if (days === 0) {
    return 'Expires today';
  }
  if (days === -1) {
    return 'Expired yesterday';
  }
  return `Expired ${Math.abs(days)} days ago`;
}
