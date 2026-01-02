/**
 * Mock User Query Service
 *
 * Development/testing implementation of IUserQueryService.
 * Uses localStorage for persistence across page reloads during development.
 * Provides realistic mock data for users and invitations.
 *
 * Mock Data:
 * - 6 sample users with varying roles and statuses
 * - 3 pending invitations (valid, expired, and recently sent)
 * - Simulated latency for UX testing
 *
 * @see IUserQueryService for interface documentation
 */

import { Logger } from '@/utils/logger';
import type {
  User,
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
import type { IUserQueryService } from './IUserQueryService';

const log = Logger.getLogger('api');

/** localStorage keys for persisting mock data */
const USERS_STORAGE_KEY = 'mock_users';
const INVITATIONS_STORAGE_KEY = 'mock_user_invitations';
const ADDRESSES_STORAGE_KEY = 'mock_user_addresses';
const PHONES_STORAGE_KEY = 'mock_user_phones';
const USER_ORG_ACCESS_STORAGE_KEY = 'mock_user_org_access';

/**
 * Generate a mock UUID
 */
function generateId(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Mock roles for user assignments
 */
const MOCK_ROLES: Role[] = [
  {
    id: 'role-org-admin',
    name: 'Organization Admin',
    description: 'Full administrative access',
    organizationId: 'org-acme-healthcare',
    orgHierarchyScope: 'root.provider.acme_healthcare',
    isActive: true,
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
    permissionCount: 18,
    userCount: 2,
  },
  {
    id: 'role-clinician',
    name: 'Clinician',
    description: 'Clinical staff with patient care responsibilities',
    organizationId: 'org-acme-healthcare',
    orgHierarchyScope: 'root.provider.acme_healthcare',
    isActive: true,
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
    permissionCount: 8,
    userCount: 15,
  },
  {
    id: 'role-med-viewer',
    name: 'Medication Viewer',
    description: 'Read-only access to medication records',
    organizationId: 'org-acme-healthcare',
    orgHierarchyScope: 'root.provider.acme_healthcare.main_campus',
    isActive: true,
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
    permissionCount: 3,
    userCount: 5,
  },
];

/**
 * Convert Role to RoleReference
 */
function roleToReference(role: Role): RoleReference {
  return {
    roleId: role.id,
    roleName: role.name,
  };
}

/**
 * Initial mock users
 */
function getInitialMockUsers(): User[] {
  const now = new Date();
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const lastWeek = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const lastMonth = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  return [
    {
      id: 'user-admin-001',
      email: 'admin@acme-healthcare.com',
      firstName: 'Sarah',
      lastName: 'Johnson',
      name: 'Sarah Johnson',
      currentOrganizationId: 'org-acme-healthcare',
      isActive: true,
      createdAt: lastMonth,
      updatedAt: lastWeek,
      lastLoginAt: yesterday,
    },
    {
      id: 'user-clinician-001',
      email: 'dr.smith@acme-healthcare.com',
      firstName: 'Michael',
      lastName: 'Smith',
      name: 'Michael Smith',
      currentOrganizationId: 'org-acme-healthcare',
      isActive: true,
      createdAt: lastMonth,
      updatedAt: lastMonth,
      lastLoginAt: now,
    },
    {
      id: 'user-clinician-002',
      email: 'nurse.chen@acme-healthcare.com',
      firstName: 'Emily',
      lastName: 'Chen',
      name: 'Emily Chen',
      currentOrganizationId: 'org-acme-healthcare',
      isActive: true,
      createdAt: lastWeek,
      updatedAt: lastWeek,
      lastLoginAt: yesterday,
    },
    {
      id: 'user-viewer-001',
      email: 'intern@acme-healthcare.com',
      firstName: 'James',
      lastName: 'Wilson',
      name: 'James Wilson',
      currentOrganizationId: 'org-acme-healthcare',
      isActive: true,
      createdAt: yesterday,
      updatedAt: yesterday,
      lastLoginAt: null,
    },
    {
      id: 'user-deactivated-001',
      email: 'former.employee@acme-healthcare.com',
      firstName: 'Robert',
      lastName: 'Brown',
      name: 'Robert Brown',
      currentOrganizationId: 'org-acme-healthcare',
      isActive: false,
      createdAt: lastMonth,
      updatedAt: lastWeek,
      lastLoginAt: lastMonth,
    },
    {
      id: 'user-multi-org-001',
      email: 'sally@dfs.utah.gov',
      firstName: 'Sally',
      lastName: 'Martinez',
      name: 'Sally Martinez',
      currentOrganizationId: 'org-acme-healthcare',
      isActive: true,
      createdAt: lastMonth,
      updatedAt: yesterday,
      lastLoginAt: yesterday,
    },
  ];
}

/**
 * Initial mock invitations
 */
function getInitialMockInvitations(): Invitation[] {
  const now = new Date();
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const nextWeek = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  const lastWeek = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const twoDaysAgo = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000);

  return [
    {
      id: 'inv-pending-001',
      invitationId: 'inv-pending-001',
      organizationId: 'org-acme-healthcare',
      email: 'newdoctor@hospital.com',
      firstName: 'Amanda',
      lastName: 'Lee',
      roles: [roleToReference(MOCK_ROLES[1])], // Clinician
      token: 'token-pending-001',
      expiresAt: nextWeek,
      status: 'pending',
      acceptedAt: null,
      accessStartDate: null,
      accessExpirationDate: null,
      notificationPreferences: DEFAULT_NOTIFICATION_PREFERENCES,
      createdAt: yesterday,
      updatedAt: yesterday,
    },
    {
      id: 'inv-pending-002',
      invitationId: 'inv-pending-002',
      organizationId: 'org-acme-healthcare',
      email: 'coordinator@clinic.com',
      firstName: 'David',
      lastName: 'Kim',
      roles: [roleToReference(MOCK_ROLES[0]), roleToReference(MOCK_ROLES[2])], // Admin + Viewer
      token: 'token-pending-002',
      expiresAt: new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000), // 3 days
      status: 'pending',
      acceptedAt: null,
      accessStartDate: null,
      accessExpirationDate: null,
      notificationPreferences: { email: true, sms: { enabled: false, phoneId: null }, inApp: false },
      createdAt: twoDaysAgo,
      updatedAt: twoDaysAgo,
    },
    {
      id: 'inv-expired-001',
      invitationId: 'inv-expired-001',
      organizationId: 'org-acme-healthcare',
      email: 'expired.invite@example.com',
      firstName: 'Chris',
      lastName: 'Taylor',
      roles: [roleToReference(MOCK_ROLES[2])], // Viewer
      token: 'token-expired-001',
      expiresAt: lastWeek,
      status: 'pending', // Still pending in DB, but expired by time
      acceptedAt: null,
      accessStartDate: null,
      accessExpirationDate: null,
      notificationPreferences: DEFAULT_NOTIFICATION_PREFERENCES,
      createdAt: new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000),
      updatedAt: new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000),
    },
  ];
}

/**
 * Map user IDs to their role assignments
 */
function getInitialUserRoles(): Map<string, Role[]> {
  return new Map([
    ['user-admin-001', [MOCK_ROLES[0]]], // Org Admin
    ['user-clinician-001', [MOCK_ROLES[1]]], // Clinician
    ['user-clinician-002', [MOCK_ROLES[1]]], // Clinician
    ['user-viewer-001', [MOCK_ROLES[2]]], // Med Viewer
    ['user-deactivated-001', [MOCK_ROLES[1]]], // Was Clinician
    ['user-multi-org-001', [MOCK_ROLES[0], MOCK_ROLES[1]]], // Admin + Clinician
  ]);
}

/**
 * Mock organizations for multi-org scenario
 */
const MOCK_ORGANIZATIONS = [
  { id: 'org-acme-healthcare', name: 'Acme Healthcare', type: 'provider' },
  { id: 'org-alliance-utah', name: 'Alliance Utah', type: 'provider' },
  { id: 'org-live-for-life', name: 'Live for Life', type: 'provider' },
];

/**
 * Initial mock addresses
 */
function getInitialMockAddresses(): UserAddress[] {
  const now = new Date();
  return [
    {
      id: 'addr-admin-home',
      userId: 'user-admin-001',
      orgId: null,
      label: 'Home',
      type: 'physical',
      street1: '123 Main Street',
      street2: 'Apt 4B',
      city: 'Salt Lake City',
      state: 'UT',
      zipCode: '84101',
      country: 'USA',
      isPrimary: true,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'addr-clinician-home',
      userId: 'user-clinician-001',
      orgId: null,
      label: 'Home',
      type: 'physical',
      street1: '456 Elm Avenue',
      street2: null,
      city: 'Provo',
      state: 'UT',
      zipCode: '84604',
      country: 'USA',
      isPrimary: true,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'addr-clinician-work-override',
      userId: 'user-clinician-001',
      orgId: 'org-acme-healthcare',
      label: 'Work Location',
      type: 'mailing',
      street1: '789 Healthcare Drive',
      street2: 'Suite 200',
      city: 'Salt Lake City',
      state: 'UT',
      zipCode: '84111',
      country: 'USA',
      isPrimary: false,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    },
  ];
}

/**
 * Initial mock phones
 */
function getInitialMockPhones(): UserPhone[] {
  const now = new Date();
  return [
    {
      id: 'phone-admin-mobile',
      userId: 'user-admin-001',
      orgId: null,
      label: 'Mobile',
      type: 'mobile',
      number: '555-123-4567',
      extension: null,
      countryCode: '+1',
      isPrimary: true,
      isActive: true,
      smsCapable: true,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'phone-admin-office',
      userId: 'user-admin-001',
      orgId: null,
      label: 'Office',
      type: 'office',
      number: '555-234-5678',
      extension: '101',
      countryCode: '+1',
      isPrimary: false,
      isActive: true,
      smsCapable: false,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'phone-clinician-mobile',
      userId: 'user-clinician-001',
      orgId: null,
      label: 'Mobile',
      type: 'mobile',
      number: '555-345-6789',
      extension: null,
      countryCode: '+1',
      isPrimary: true,
      isActive: true,
      smsCapable: true,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'phone-clinician-work-override',
      userId: 'user-clinician-001',
      orgId: 'org-acme-healthcare',
      label: 'Work Line',
      type: 'office',
      number: '555-456-7890',
      extension: '215',
      countryCode: '+1',
      isPrimary: false,
      isActive: true,
      smsCapable: false,
      createdAt: now,
      updatedAt: now,
    },
  ];
}

/**
 * Initial mock user org access records
 */
function getInitialMockUserOrgAccess(): UserOrgAccess[] {
  const now = new Date();
  const threeMonthsFromNow = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000);
  const oneMonthFromNow = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  const lastMonth = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  return [
    {
      userId: 'user-admin-001',
      orgId: 'org-acme-healthcare',
      accessStartDate: null, // No restrictions
      accessExpirationDate: null, // No expiration
      notificationPreferences: { email: true, sms: { enabled: true, phoneId: 'phone-admin-mobile' }, inApp: false },
      createdAt: lastMonth,
      updatedAt: now,
    },
    {
      userId: 'user-clinician-001',
      orgId: 'org-acme-healthcare',
      accessStartDate: null,
      accessExpirationDate: null,
      notificationPreferences: { email: true, sms: { enabled: false, phoneId: null }, inApp: false },
      createdAt: lastMonth,
      updatedAt: now,
    },
    {
      userId: 'user-clinician-002',
      orgId: 'org-acme-healthcare',
      accessStartDate: null,
      accessExpirationDate: null,
      notificationPreferences: DEFAULT_NOTIFICATION_PREFERENCES,
      createdAt: lastMonth,
      updatedAt: now,
    },
    {
      userId: 'user-viewer-001',
      orgId: 'org-acme-healthcare',
      accessStartDate: null,
      accessExpirationDate: threeMonthsFromNow.toISOString().split('T')[0], // Internship ending
      notificationPreferences: { email: true, sms: { enabled: false, phoneId: null }, inApp: false },
      createdAt: now,
      updatedAt: now,
    },
    {
      userId: 'user-multi-org-001',
      orgId: 'org-acme-healthcare',
      accessStartDate: null,
      accessExpirationDate: oneMonthFromNow.toISOString().split('T')[0], // Contract ending soon
      notificationPreferences: { email: true, sms: { enabled: true, phoneId: null }, inApp: true },
      createdAt: lastMonth,
      updatedAt: now,
    },
  ];
}

export class MockUserQueryService implements IUserQueryService {
  private users: User[];
  private invitations: Invitation[];
  private userRoles: Map<string, Role[]>;
  private addresses: UserAddress[];
  private phones: UserPhone[];
  private userOrgAccess: UserOrgAccess[];

  constructor() {
    const loaded = this.loadFromStorage();
    this.users = loaded.users;
    this.invitations = loaded.invitations;
    this.userRoles = loaded.userRoles;
    this.addresses = loaded.addresses;
    this.phones = loaded.phones;
    this.userOrgAccess = loaded.userOrgAccess;
    log.info('MockUserQueryService initialized', {
      userCount: this.users.length,
      invitationCount: this.invitations.length,
      addressCount: this.addresses.length,
      phoneCount: this.phones.length,
    });
  }

  /**
   * Load data from localStorage or initialize with defaults
   */
  private loadFromStorage(): {
    users: User[];
    invitations: Invitation[];
    userRoles: Map<string, Role[]>;
    addresses: UserAddress[];
    phones: UserPhone[];
    userOrgAccess: UserOrgAccess[];
  } {
    try {
      const usersJson = localStorage.getItem(USERS_STORAGE_KEY);
      const invitationsJson = localStorage.getItem(INVITATIONS_STORAGE_KEY);
      const addressesJson = localStorage.getItem(ADDRESSES_STORAGE_KEY);
      const phonesJson = localStorage.getItem(PHONES_STORAGE_KEY);
      const userOrgAccessJson = localStorage.getItem(USER_ORG_ACCESS_STORAGE_KEY);

      if (usersJson && invitationsJson) {
        const users = JSON.parse(usersJson).map((u: User) => ({
          ...u,
          createdAt: new Date(u.createdAt),
          updatedAt: new Date(u.updatedAt),
          lastLoginAt: u.lastLoginAt ? new Date(u.lastLoginAt) : null,
        }));

        const invitations = JSON.parse(invitationsJson).map((i: Invitation) => ({
          ...i,
          expiresAt: new Date(i.expiresAt),
          createdAt: new Date(i.createdAt),
          updatedAt: new Date(i.updatedAt),
          acceptedAt: i.acceptedAt ? new Date(i.acceptedAt) : null,
        }));

        const addresses = addressesJson
          ? JSON.parse(addressesJson).map((a: UserAddress) => ({
              ...a,
              createdAt: new Date(a.createdAt),
              updatedAt: new Date(a.updatedAt),
            }))
          : getInitialMockAddresses();

        const phones = phonesJson
          ? JSON.parse(phonesJson).map((p: UserPhone) => ({
              ...p,
              createdAt: new Date(p.createdAt),
              updatedAt: new Date(p.updatedAt),
            }))
          : getInitialMockPhones();

        const userOrgAccess = userOrgAccessJson
          ? JSON.parse(userOrgAccessJson).map((a: UserOrgAccess) => ({
              ...a,
              createdAt: new Date(a.createdAt),
              updatedAt: new Date(a.updatedAt),
            }))
          : getInitialMockUserOrgAccess();

        return { users, invitations, userRoles: getInitialUserRoles(), addresses, phones, userOrgAccess };
      }
    } catch (error) {
      log.warn('Failed to load mock users from localStorage, using defaults', { error });
    }

    return {
      users: getInitialMockUsers(),
      invitations: getInitialMockInvitations(),
      userRoles: getInitialUserRoles(),
      addresses: getInitialMockAddresses(),
      phones: getInitialMockPhones(),
      userOrgAccess: getInitialMockUserOrgAccess(),
    };
  }

  /**
   * Save data to localStorage
   */
  saveToStorage(): void {
    try {
      localStorage.setItem(USERS_STORAGE_KEY, JSON.stringify(this.users));
      localStorage.setItem(INVITATIONS_STORAGE_KEY, JSON.stringify(this.invitations));
      localStorage.setItem(ADDRESSES_STORAGE_KEY, JSON.stringify(this.addresses));
      localStorage.setItem(PHONES_STORAGE_KEY, JSON.stringify(this.phones));
      localStorage.setItem(USER_ORG_ACCESS_STORAGE_KEY, JSON.stringify(this.userOrgAccess));
    } catch (error) {
      log.error('Failed to save mock users to localStorage', { error });
    }
  }

  /**
   * Simulate network delay
   */
  private async simulateDelay(): Promise<void> {
    if (import.meta.env.MODE === 'test') return;
    const delay = Math.random() * 200 + 100;
    await new Promise((resolve) => setTimeout(resolve, delay));
  }

  /**
   * Compute display status for invitation
   */
  private computeInvitationStatus(invitation: Invitation): UserDisplayStatus {
    if (invitation.status === 'accepted') return 'active';
    if (invitation.status === 'revoked') return 'expired';
    if (invitation.status === 'expired') return 'expired';
    if (new Date(invitation.expiresAt) < new Date()) return 'expired';
    return 'pending';
  }

  /**
   * Convert User to UserWithRoles
   */
  private toUserWithRoles(user: User): UserWithRoles {
    const roles = this.userRoles.get(user.id) || [];
    return {
      ...user,
      roles,
      displayStatus: user.isActive ? 'active' : 'deactivated',
    };
  }

  /**
   * Convert User to UserListItem
   */
  private userToListItem(user: User): UserListItem {
    const roles = this.userRoles.get(user.id) || [];
    return {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      displayStatus: user.isActive ? 'active' : 'deactivated',
      roles: roles.map(roleToReference),
      createdAt: user.createdAt,
      expiresAt: null,
      isInvitation: false,
      invitationId: null,
    };
  }

  /**
   * Convert Invitation to UserListItem
   */
  private invitationToListItem(invitation: Invitation): UserListItem {
    return {
      id: invitation.id,
      email: invitation.email,
      firstName: invitation.firstName,
      lastName: invitation.lastName,
      displayStatus: this.computeInvitationStatus(invitation),
      roles: invitation.roles,
      createdAt: invitation.createdAt,
      expiresAt: invitation.expiresAt,
      isInvitation: true,
      invitationId: invitation.invitationId,
    };
  }

  async getUsersPaginated(options?: UserQueryOptions): Promise<PaginatedResult<UserListItem>> {
    await this.simulateDelay();
    log.debug('Mock: Fetching users paginated', { options });

    // Combine users and invitations into unified list
    let items: UserListItem[] = [
      ...this.users.map((u) => this.userToListItem(u)),
      ...this.invitations
        .filter((i) => i.status === 'pending')
        .map((i) => this.invitationToListItem(i)),
    ];

    // Apply filters
    if (options?.filters) {
      const { status, roleId, searchTerm, invitationsOnly, usersOnly } = options.filters;

      if (status && status !== 'all') {
        items = items.filter((item) => item.displayStatus === status);
      }

      if (roleId) {
        items = items.filter((item) => item.roles.some((r) => r.roleId === roleId));
      }

      if (searchTerm) {
        const searchLower = searchTerm.toLowerCase();
        items = items.filter(
          (item) =>
            item.email.toLowerCase().includes(searchLower) ||
            (item.firstName?.toLowerCase() || '').includes(searchLower) ||
            (item.lastName?.toLowerCase() || '').includes(searchLower)
        );
      }

      if (invitationsOnly) {
        items = items.filter((item) => item.isInvitation);
      }

      if (usersOnly) {
        items = items.filter((item) => !item.isInvitation);
      }
    }

    // Apply sorting
    const sortBy = options?.sort?.sortBy || 'name';
    const sortOrder = options?.sort?.sortOrder || 'asc';

    items.sort((a, b) => {
      let comparison = 0;

      switch (sortBy) {
        case 'name':
          const nameA = `${a.firstName || ''} ${a.lastName || ''}`.trim() || a.email;
          const nameB = `${b.firstName || ''} ${b.lastName || ''}`.trim() || b.email;
          comparison = nameA.localeCompare(nameB);
          break;
        case 'email':
          comparison = a.email.localeCompare(b.email);
          break;
        case 'createdAt':
          comparison = a.createdAt.getTime() - b.createdAt.getTime();
          break;
        case 'status':
          const statusOrder: Record<UserDisplayStatus, number> = {
            pending: 0,
            active: 1,
            deactivated: 2,
            expired: 3,
          };
          comparison = statusOrder[a.displayStatus] - statusOrder[b.displayStatus];
          break;
        default:
          comparison = 0;
      }

      return sortOrder === 'desc' ? -comparison : comparison;
    });

    // Apply pagination
    const page = options?.pagination?.page || 1;
    const pageSize = options?.pagination?.pageSize || 20;
    const totalCount = items.length;
    const totalPages = Math.ceil(totalCount / pageSize);
    const startIndex = (page - 1) * pageSize;
    const paginatedItems = items.slice(startIndex, startIndex + pageSize);

    log.info(`Mock: Returning ${paginatedItems.length} of ${totalCount} users/invitations`);

    return {
      items: paginatedItems,
      totalCount,
      page,
      pageSize,
      totalPages,
      hasMore: page < totalPages,
    };
  }

  async getUserById(userId: string): Promise<UserWithRoles | null> {
    await this.simulateDelay();
    log.debug('Mock: Fetching user by ID', { userId });

    const user = this.users.find((u) => u.id === userId);
    if (!user) {
      log.debug('Mock: User not found', { userId });
      return null;
    }

    log.info('Mock: Found user', { userId, email: user.email });
    return this.toUserWithRoles(user);
  }

  async getInvitations(): Promise<Invitation[]> {
    await this.simulateDelay();
    log.debug('Mock: Fetching invitations');

    const pendingInvitations = this.invitations.filter((i) => i.status === 'pending');
    log.info(`Mock: Returning ${pendingInvitations.length} invitations`);
    return pendingInvitations;
  }

  async getInvitationById(invitationId: string): Promise<Invitation | null> {
    await this.simulateDelay();
    log.debug('Mock: Fetching invitation by ID', { invitationId });

    const invitation = this.invitations.find((i) => i.id === invitationId);
    if (!invitation) {
      log.debug('Mock: Invitation not found', { invitationId });
      return null;
    }

    log.info('Mock: Found invitation', { invitationId, email: invitation.email });
    return invitation;
  }

  async checkEmailStatus(email: string): Promise<EmailLookupResult> {
    await this.simulateDelay();
    log.debug('Mock: Checking email status', { email });

    const emailLower = email.toLowerCase();

    // Check pending invitations first
    const pendingInvitation = this.invitations.find(
      (i) => i.email.toLowerCase() === emailLower && i.status === 'pending'
    );

    if (pendingInvitation) {
      const isExpired = new Date(pendingInvitation.expiresAt) < new Date();
      const status: EmailLookupStatus = isExpired ? 'expired' : 'pending';

      log.info('Mock: Email has invitation', { email, status });
      return {
        status,
        userId: null,
        invitationId: pendingInvitation.id,
        firstName: pendingInvitation.firstName,
        lastName: pendingInvitation.lastName,
        expiresAt: pendingInvitation.expiresAt,
        currentRoles: null,
      };
    }

    // Check existing users in current org
    const userInOrg = this.users.find(
      (u) =>
        u.email.toLowerCase() === emailLower &&
        u.currentOrganizationId === 'org-acme-healthcare'
    );

    if (userInOrg) {
      const roles = this.userRoles.get(userInOrg.id) || [];
      const status: EmailLookupStatus = userInOrg.isActive ? 'active_member' : 'deactivated';

      log.info('Mock: Email is member of org', { email, status, isActive: userInOrg.isActive });
      return {
        status,
        userId: userInOrg.id,
        invitationId: null,
        firstName: userInOrg.firstName,
        lastName: userInOrg.lastName,
        expiresAt: null,
        currentRoles: roles.map(roleToReference),
      };
    }

    // Check if user exists in another org (Sally scenario)
    // For mock, we simulate this with specific email patterns
    if (emailLower.includes('otherorg') || emailLower.endsWith('.gov')) {
      log.info('Mock: Email exists in other org', { email });
      return {
        status: 'other_org',
        userId: 'user-other-org-001',
        invitationId: null,
        firstName: 'External',
        lastName: 'User',
        expiresAt: null,
        currentRoles: null,
      };
    }

    log.info('Mock: Email not found', { email });
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

  async getAssignableRoles(): Promise<RoleReference[]> {
    await this.simulateDelay();
    log.debug('Mock: Fetching assignable roles');

    // Return all active mock roles as assignable (mock user has all permissions)
    const assignableRoles = MOCK_ROLES.filter((r) => r.isActive).map(roleToReference);

    log.info(`Mock: Returning ${assignableRoles.length} assignable roles`);
    return assignableRoles;
  }

  async getUserOrganizations(): Promise<Array<{ id: string; name: string; type: string }>> {
    await this.simulateDelay();
    log.debug('Mock: Fetching user organizations');

    // For mock, return first org for most users, multiple for multi-org user
    log.info(`Mock: Returning ${MOCK_ORGANIZATIONS.length} organizations`);
    return MOCK_ORGANIZATIONS;
  }

  // ============================================================================
  // Extended Data Collection Query Methods (Phase 0A)
  // ============================================================================

  async getUserAddresses(userId: string): Promise<UserAddress[]> {
    await this.simulateDelay();
    log.debug('Mock: Fetching user addresses', { userId });

    // Return both global addresses (orgId === null) and org-specific overrides for current org
    const addresses = this.addresses.filter(
      (a) => a.userId === userId && a.isActive && (a.orgId === null || a.orgId === 'org-acme-healthcare')
    );

    log.info(`Mock: Returning ${addresses.length} addresses for user`, { userId });
    return addresses;
  }

  async getUserPhones(userId: string): Promise<UserPhone[]> {
    await this.simulateDelay();
    log.debug('Mock: Fetching user phones', { userId });

    // Return both global phones (orgId === null) and org-specific overrides for current org
    const phones = this.phones.filter(
      (p) => p.userId === userId && p.isActive && (p.orgId === null || p.orgId === 'org-acme-healthcare')
    );

    log.info(`Mock: Returning ${phones.length} phones for user`, { userId });
    return phones;
  }

  async getUserOrgAccess(userId: string, orgId: string): Promise<UserOrgAccess | null> {
    await this.simulateDelay();
    log.debug('Mock: Fetching user org access', { userId, orgId });

    const access = this.userOrgAccess.find((a) => a.userId === userId && a.orgId === orgId);

    if (access) {
      log.info('Mock: Found user org access', { userId, orgId, hasExpiration: !!access.accessExpirationDate });
    } else {
      log.debug('Mock: User org access not found', { userId, orgId });
    }

    return access || null;
  }

  // ============================================================================
  // Internal Helper Methods (used by MockUserCommandService)
  // ============================================================================

  /**
   * Add a user (used by MockUserCommandService)
   */
  addUser(user: User, roles: Role[]): void {
    this.users.push(user);
    this.userRoles.set(user.id, roles);
    this.saveToStorage();
  }

  /**
   * Update a user (used by MockUserCommandService)
   */
  updateUser(userId: string, updates: Partial<User>): void {
    const userIndex = this.users.findIndex((u) => u.id === userId);
    if (userIndex !== -1) {
      this.users[userIndex] = { ...this.users[userIndex], ...updates };
      this.saveToStorage();
    }
  }

  /**
   * Add an invitation (used by MockUserCommandService)
   */
  addInvitation(invitation: Invitation): void {
    this.invitations.push(invitation);
    this.saveToStorage();
  }

  /**
   * Update an invitation (used by MockUserCommandService)
   */
  updateInvitation(invitationId: string, updates: Partial<Invitation>): void {
    const invIndex = this.invitations.findIndex((i) => i.id === invitationId);
    if (invIndex !== -1) {
      this.invitations[invIndex] = { ...this.invitations[invIndex], ...updates };
      this.saveToStorage();
    }
  }

  /**
   * Get user roles (used by MockUserCommandService)
   */
  getUserRoles(userId: string): Role[] {
    return this.userRoles.get(userId) || [];
  }

  /**
   * Set user roles (used by MockUserCommandService)
   */
  setUserRoles(userId: string, roles: Role[]): void {
    this.userRoles.set(userId, roles);
  }

  // ============================================================================
  // Extended Data Helper Methods (used by MockUserCommandService)
  // ============================================================================

  /**
   * Add an address (used by MockUserCommandService)
   */
  addAddress(address: UserAddress): void {
    this.addresses.push(address);
    this.saveToStorage();
  }

  /**
   * Update an address (used by MockUserCommandService)
   */
  updateAddress(addressId: string, updates: Partial<UserAddress>): void {
    const index = this.addresses.findIndex((a) => a.id === addressId);
    if (index !== -1) {
      this.addresses[index] = { ...this.addresses[index], ...updates };
      this.saveToStorage();
    }
  }

  /**
   * Get an address by ID (used by MockUserCommandService)
   */
  getAddressById(addressId: string): UserAddress | undefined {
    return this.addresses.find((a) => a.id === addressId);
  }

  /**
   * Add a phone (used by MockUserCommandService)
   */
  addPhone(phone: UserPhone): void {
    this.phones.push(phone);
    this.saveToStorage();
  }

  /**
   * Update a phone (used by MockUserCommandService)
   */
  updatePhone(phoneId: string, updates: Partial<UserPhone>): void {
    const index = this.phones.findIndex((p) => p.id === phoneId);
    if (index !== -1) {
      this.phones[index] = { ...this.phones[index], ...updates };
      this.saveToStorage();
    }
  }

  /**
   * Get a phone by ID (used by MockUserCommandService)
   */
  getPhoneById(phoneId: string): UserPhone | undefined {
    return this.phones.find((p) => p.id === phoneId);
  }

  /**
   * Update user org access (used by MockUserCommandService)
   */
  updateUserOrgAccess(userId: string, orgId: string, updates: Partial<UserOrgAccess>): void {
    const index = this.userOrgAccess.findIndex((a) => a.userId === userId && a.orgId === orgId);
    if (index !== -1) {
      this.userOrgAccess[index] = { ...this.userOrgAccess[index], ...updates };
      this.saveToStorage();
    } else {
      // Create new record if doesn't exist
      this.userOrgAccess.push({
        userId,
        orgId,
        accessStartDate: null,
        accessExpirationDate: null,
        notificationPreferences: DEFAULT_NOTIFICATION_PREFERENCES,
        createdAt: new Date(),
        updatedAt: new Date(),
        ...updates,
      });
      this.saveToStorage();
    }
  }

  /**
   * Reset mock data to initial state (useful for testing)
   */
  resetToDefaults(): void {
    this.users = getInitialMockUsers();
    this.invitations = getInitialMockInvitations();
    this.userRoles = getInitialUserRoles();
    this.addresses = getInitialMockAddresses();
    this.phones = getInitialMockPhones();
    this.userOrgAccess = getInitialMockUserOrgAccess();
    this.saveToStorage();
    log.info('Mock: Reset users to defaults');
  }

  /**
   * Clear all mock data
   */
  clearAll(): void {
    this.users = [];
    this.invitations = [];
    this.userRoles = new Map();
    this.addresses = [];
    this.phones = [];
    this.userOrgAccess = [];
    this.saveToStorage();
    log.info('Mock: Cleared all users');
  }
}
