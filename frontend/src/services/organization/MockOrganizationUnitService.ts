/**
 * Mock Organizational Unit Service
 *
 * Development/testing implementation of IOrganizationUnitService.
 * Uses localStorage for persistence across page reloads during development.
 * Provides realistic mock data for a 3-level organizational hierarchy.
 *
 * Mock Hierarchy (8 units total):
 * - Acme Healthcare (ROOT - isRootOrganization: true, cannot be deleted)
 *   - Main Campus
 *     - Behavioral Health Wing
 *     - Emergency Department
 *     - Old Wing (inactive)
 *   - East Campus
 *     - Rehabilitation Center
 *   - Admin Building
 *
 * @see IOrganizationUnitService for interface documentation
 */

import { Logger } from '@/utils/logger';
import type {
  OrganizationUnit,
  OrganizationUnitFilterOptions,
  CreateOrganizationUnitRequest,
  UpdateOrganizationUnitRequest,
  OrganizationUnitOperationResult,
} from '@/types/organization-unit.types';
import type { IOrganizationUnitService } from './IOrganizationUnitService';

const log = Logger.getLogger('api');

/** localStorage key for persisting mock data */
const STORAGE_KEY = 'mock_organization_units';

/**
 * Root path for the mock provider organization.
 * This matches the mock auth provider's scope_path for provider_admin.
 */
const MOCK_ROOT_PATH = 'root.provider.acme_healthcare';

/**
 * Slugify a name for use in ltree path
 * Converts "Main Campus" to "main_campus"
 */
function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

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
 * Root organization ID - the bootstrapped organization
 * This org is created during organization bootstrap and cannot be deleted.
 */
const ROOT_ORG_ID = 'org-acme-healthcare';

/**
 * Initial mock data representing a 3-level hierarchy
 * Includes the root organization (from bootstrap) plus child organizational units.
 */
function getInitialMockData(): OrganizationUnit[] {
  const now = new Date();
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const lastWeek = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const lastMonth = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  return [
    // Root Organization - created during bootstrap, cannot be deleted
    {
      id: ROOT_ORG_ID,
      name: 'Acme Healthcare',
      displayName: 'Acme Healthcare Services',
      path: MOCK_ROOT_PATH,
      parentPath: null,  // Root has no parent
      parentId: null,
      timeZone: 'America/New_York',
      isActive: true,
      childCount: 3,  // Main Campus, East Campus, Admin Building
      isRootOrganization: true,
      createdAt: lastMonth,
      updatedAt: lastWeek,
    },

    // Level 1 - Direct children of root org
    {
      id: 'ou-main-campus',
      name: 'Main Campus',
      displayName: 'Main Campus Medical Center',
      path: `${MOCK_ROOT_PATH}.main_campus`,
      parentPath: MOCK_ROOT_PATH,
      parentId: ROOT_ORG_ID,  // Child of root org
      timeZone: 'America/New_York',
      isActive: true,
      childCount: 2,
      createdAt: lastWeek,
      updatedAt: lastWeek,
    },
    {
      id: 'ou-east-campus',
      name: 'East Campus',
      displayName: 'East Campus Facility',
      path: `${MOCK_ROOT_PATH}.east_campus`,
      parentPath: MOCK_ROOT_PATH,
      parentId: ROOT_ORG_ID,  // Child of root org
      timeZone: 'America/New_York',
      isActive: true,
      childCount: 1,
      createdAt: lastWeek,
      updatedAt: yesterday,
    },
    {
      id: 'ou-admin-building',
      name: 'Admin Building',
      displayName: 'Administrative Headquarters',
      path: `${MOCK_ROOT_PATH}.admin_building`,
      parentPath: MOCK_ROOT_PATH,
      parentId: ROOT_ORG_ID,  // Child of root org
      timeZone: 'America/New_York',
      isActive: true,
      childCount: 0,
      createdAt: yesterday,
      updatedAt: yesterday,
    },

    // Level 1 - Children of Main Campus
    {
      id: 'ou-behavioral-health',
      name: 'Behavioral Health Wing',
      displayName: 'Behavioral Health Department',
      path: `${MOCK_ROOT_PATH}.main_campus.behavioral_health_wing`,
      parentPath: `${MOCK_ROOT_PATH}.main_campus`,
      parentId: 'ou-main-campus',
      timeZone: 'America/New_York',
      isActive: true,
      childCount: 0,
      createdAt: lastWeek,
      updatedAt: lastWeek,
    },
    {
      id: 'ou-emergency-dept',
      name: 'Emergency Department',
      displayName: 'Emergency Department',
      path: `${MOCK_ROOT_PATH}.main_campus.emergency_department`,
      parentPath: `${MOCK_ROOT_PATH}.main_campus`,
      parentId: 'ou-main-campus',
      timeZone: 'America/New_York',
      isActive: true,
      childCount: 0,
      createdAt: lastWeek,
      updatedAt: now,
    },

    // Level 1 - Child of East Campus
    {
      id: 'ou-rehab-center',
      name: 'Rehabilitation Center',
      displayName: 'Physical Rehabilitation Center',
      path: `${MOCK_ROOT_PATH}.east_campus.rehabilitation_center`,
      parentPath: `${MOCK_ROOT_PATH}.east_campus`,
      parentId: 'ou-east-campus',
      timeZone: 'America/New_York',
      isActive: true,
      childCount: 0,
      createdAt: yesterday,
      updatedAt: yesterday,
    },

    // Inactive unit for testing
    {
      id: 'ou-old-wing',
      name: 'Old Wing',
      displayName: 'Old Wing (Closed)',
      path: `${MOCK_ROOT_PATH}.main_campus.old_wing`,
      parentPath: `${MOCK_ROOT_PATH}.main_campus`,
      parentId: 'ou-main-campus',
      timeZone: 'America/New_York',
      isActive: false,
      childCount: 0,
      createdAt: lastWeek,
      updatedAt: yesterday,
    },
  ];
}

export class MockOrganizationUnitService implements IOrganizationUnitService {
  private units: OrganizationUnit[];

  constructor() {
    this.units = this.loadFromStorage();
    log.info('MockOrganizationUnitService initialized', {
      unitCount: this.units.length,
      rootPath: MOCK_ROOT_PATH,
    });
  }

  /**
   * Load units from localStorage or initialize with mock data
   */
  private loadFromStorage(): OrganizationUnit[] {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        // Convert date strings back to Date objects
        return parsed.map((unit: OrganizationUnit) => ({
          ...unit,
          createdAt: new Date(unit.createdAt),
          updatedAt: new Date(unit.updatedAt),
        }));
      }
    } catch (error) {
      log.warn('Failed to load mock data from localStorage, using defaults', { error });
    }
    return getInitialMockData();
  }

  /**
   * Save units to localStorage
   */
  private saveToStorage(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.units));
    } catch (error) {
      log.error('Failed to save mock data to localStorage', { error });
    }
  }

  /**
   * Simulates network delay for realistic testing
   */
  private async simulateDelay(): Promise<void> {
    // Skip delay in test environment
    if (import.meta.env.MODE === 'test') {
      return;
    }
    // 100-300ms delay to simulate network latency
    const delay = Math.random() * 200 + 100;
    await new Promise((resolve) => setTimeout(resolve, delay));
  }

  /**
   * Update child counts after structural changes
   */
  private updateChildCounts(): void {
    for (const unit of this.units) {
      unit.childCount = this.units.filter(
        (u) => u.parentId === unit.id && u.isActive
      ).length;
    }
  }

  async getUnits(filters?: OrganizationUnitFilterOptions): Promise<OrganizationUnit[]> {
    await this.simulateDelay();

    log.debug('Mock: Fetching organizational units', { filters });

    let results = [...this.units];

    if (filters) {
      // Filter by status
      if (filters.status && filters.status !== 'all') {
        results = results.filter((unit) =>
          unit.isActive === (filters.status === 'active')
        );
      }

      // Filter by parent ID
      if (filters.parentId !== undefined) {
        results = results.filter((unit) => unit.parentId === filters.parentId);
      }

      // Filter by ancestor path
      if (filters.ancestorPath) {
        results = results.filter((unit) =>
          unit.path.startsWith(filters.ancestorPath + '.')
        );
      }

      // Search by name (case-insensitive)
      if (filters.searchTerm) {
        const searchLower = filters.searchTerm.toLowerCase();
        results = results.filter(
          (unit) =>
            unit.name.toLowerCase().includes(searchLower) ||
            unit.displayName.toLowerCase().includes(searchLower)
        );
      }
    }

    // Sort alphabetically by path (maintains hierarchy order)
    results.sort((a, b) => a.path.localeCompare(b.path));

    log.info(`Mock: Returning ${results.length} organizational units`, { filters });
    return results;
  }

  async getUnitById(unitId: string): Promise<OrganizationUnit | null> {
    await this.simulateDelay();

    log.debug('Mock: Fetching unit by ID', { unitId });

    const unit = this.units.find((u) => u.id === unitId);

    if (unit) {
      log.info('Mock: Found unit', { unitId, name: unit.name });
    } else {
      log.debug('Mock: Unit not found', { unitId });
    }

    return unit ?? null;
  }

  async getDescendants(unitId: string): Promise<OrganizationUnit[]> {
    await this.simulateDelay();

    log.debug('Mock: Fetching descendants', { unitId });

    const parent = this.units.find((u) => u.id === unitId);
    if (!parent) {
      log.debug('Mock: Parent not found', { unitId });
      return [];
    }

    // Find all units whose path starts with parent's path + '.'
    const descendants = this.units.filter(
      (unit) => unit.path.startsWith(parent.path + '.') && unit.id !== unitId
    );

    // Sort by path for consistent ordering
    descendants.sort((a, b) => a.path.localeCompare(b.path));

    log.info(`Mock: Returning ${descendants.length} descendants`, { unitId });
    return descendants;
  }

  async createUnit(
    request: CreateOrganizationUnitRequest
  ): Promise<OrganizationUnitOperationResult> {
    await this.simulateDelay();

    log.debug('Mock: Creating organizational unit', { request });

    // Determine parent path and ID
    let parentPath: string;
    let parentId: string;

    if (request.parentId) {
      const parent = this.units.find((u) => u.id === request.parentId);
      if (!parent) {
        return {
          success: false,
          error: 'Parent unit not found',
          errorDetails: {
            code: 'NOT_FOUND',
            message: `Parent unit with ID ${request.parentId} does not exist`,
          },
        };
      }
      parentPath = parent.path;
      parentId = request.parentId;
    } else {
      // No parent specified = create as direct child of root org
      parentPath = MOCK_ROOT_PATH;
      parentId = ROOT_ORG_ID;
    }

    // Generate path for new unit
    const slug = slugify(request.name);
    const newPath = `${parentPath}.${slug}`;

    // Check for duplicate path
    if (this.units.some((u) => u.path === newPath && u.isActive)) {
      return {
        success: false,
        error: 'A unit with this name already exists at this level',
        errorDetails: {
          code: 'UNKNOWN',
          message: `A unit named "${request.name}" already exists under the same parent`,
        },
      };
    }

    const now = new Date();
    const newUnit: OrganizationUnit = {
      id: generateId(),
      name: request.name,
      displayName: request.displayName,
      path: newPath,
      parentPath,
      parentId,
      timeZone: request.timeZone ?? 'America/New_York',
      isActive: true,
      childCount: 0,
      createdAt: now,
      updatedAt: now,
    };

    this.units.push(newUnit);
    this.updateChildCounts();
    this.saveToStorage();

    log.info('Mock: Created organizational unit', { id: newUnit.id, name: newUnit.name });

    return {
      success: true,
      unit: newUnit,
    };
  }

  async updateUnit(
    request: UpdateOrganizationUnitRequest
  ): Promise<OrganizationUnitOperationResult> {
    await this.simulateDelay();

    log.debug('Mock: Updating organizational unit', { request });

    const unitIndex = this.units.findIndex((u) => u.id === request.id);
    if (unitIndex === -1) {
      return {
        success: false,
        error: 'Unit not found',
        errorDetails: {
          code: 'NOT_FOUND',
          message: `Unit with ID ${request.id} does not exist`,
        },
      };
    }

    const unit = this.units[unitIndex];

    // Check if name change would create duplicate path
    if (request.name && request.name !== unit.name) {
      const slug = slugify(request.name);
      const newPath = unit.parentPath
        ? `${unit.parentPath}.${slug}`
        : `${MOCK_ROOT_PATH}.${slug}`;

      if (this.units.some((u) => u.path === newPath && u.id !== unit.id && u.isActive)) {
        return {
          success: false,
          error: 'A unit with this name already exists at this level',
          errorDetails: {
            code: 'UNKNOWN',
            message: `A unit named "${request.name}" already exists under the same parent`,
          },
        };
      }

      // Update path for this unit and all descendants
      const oldPath = unit.path;
      unit.path = newPath;

      for (const descendant of this.units) {
        if (descendant.path.startsWith(oldPath + '.')) {
          descendant.path = descendant.path.replace(oldPath, newPath);
          descendant.parentPath = descendant.parentPath?.replace(oldPath, newPath) ?? null;
        }
      }
    }

    // Apply updates (metadata only - use deactivateUnit/reactivateUnit for status)
    if (request.name !== undefined) unit.name = request.name;
    if (request.displayName !== undefined) unit.displayName = request.displayName;
    if (request.timeZone !== undefined) unit.timeZone = request.timeZone;
    unit.updatedAt = new Date();

    this.updateChildCounts();
    this.saveToStorage();

    log.info('Mock: Updated organizational unit', { id: unit.id, name: unit.name });

    return {
      success: true,
      unit,
    };
  }

  /**
   * Deactivates (freezes) an organizational unit
   * Sets is_active=false. The OU remains visible but roles are frozen.
   */
  async deactivateUnit(unitId: string): Promise<OrganizationUnitOperationResult> {
    await this.simulateDelay();

    log.debug('Mock: Deactivating organizational unit', { unitId });

    const unit = this.units.find((u) => u.id === unitId);
    if (!unit) {
      return {
        success: false,
        error: 'Unit not found',
        errorDetails: {
          code: 'NOT_FOUND',
          message: `Unit with ID ${unitId} does not exist`,
        },
      };
    }

    // Check if this is the root organization (cannot be deactivated by provider admin)
    if (unit.isRootOrganization) {
      return {
        success: false,
        error: 'Cannot deactivate: this is the root organization',
        errorDetails: {
          code: 'IS_ROOT_ORGANIZATION',
          message: 'The root organization cannot be deactivated. Contact platform administrators if you need to close this organization.',
        },
      };
    }

    // Check if already inactive
    if (!unit.isActive) {
      return {
        success: false,
        error: 'Unit is already deactivated',
        errorDetails: {
          code: 'ALREADY_INACTIVE',
          message: 'This unit is already deactivated.',
        },
      };
    }

    // Freeze the unit (roles frozen but visible)
    unit.isActive = false;
    unit.updatedAt = new Date();

    this.updateChildCounts();
    this.saveToStorage();

    log.info('Mock: Deactivated organizational unit', { id: unit.id, name: unit.name });

    return {
      success: true,
      unit,
    };
  }

  /**
   * Reactivates a previously deactivated organizational unit
   * Sets is_active=true. Roles can be assigned again.
   */
  async reactivateUnit(unitId: string): Promise<OrganizationUnitOperationResult> {
    await this.simulateDelay();

    log.debug('Mock: Reactivating organizational unit', { unitId });

    const unit = this.units.find((u) => u.id === unitId);
    if (!unit) {
      return {
        success: false,
        error: 'Unit not found',
        errorDetails: {
          code: 'NOT_FOUND',
          message: `Unit with ID ${unitId} does not exist`,
        },
      };
    }

    // Check if already active
    if (unit.isActive) {
      return {
        success: false,
        error: 'Unit is already active',
        errorDetails: {
          code: 'ALREADY_ACTIVE',
          message: 'This unit is already active.',
        },
      };
    }

    // Reactivate the unit
    unit.isActive = true;
    unit.updatedAt = new Date();

    this.updateChildCounts();
    this.saveToStorage();

    log.info('Mock: Reactivated organizational unit', { id: unit.id, name: unit.name });

    return {
      success: true,
      unit,
    };
  }

  /**
   * Soft-deletes an organizational unit
   * In a real implementation, this sets deleted_at and hides the unit.
   * For mock, we remove it from the list.
   */
  async deleteUnit(unitId: string): Promise<OrganizationUnitOperationResult> {
    await this.simulateDelay();

    log.debug('Mock: Deleting organizational unit', { unitId });

    const unitIndex = this.units.findIndex((u) => u.id === unitId);
    if (unitIndex === -1) {
      return {
        success: false,
        error: 'Unit not found',
        errorDetails: {
          code: 'NOT_FOUND',
          message: `Unit with ID ${unitId} does not exist`,
        },
      };
    }

    const unit = this.units[unitIndex];

    // Check if this is the root organization (cannot be deleted by provider admin)
    if (unit.isRootOrganization) {
      return {
        success: false,
        error: 'Cannot delete: this is the root organization',
        errorDetails: {
          code: 'IS_ROOT_ORGANIZATION',
          message: 'The root organization cannot be deleted. Contact platform administrators if you need to close this organization.',
        },
      };
    }

    // Check for children (active or inactive)
    const children = this.units.filter((u) => u.parentId === unitId);
    if (children.length > 0) {
      return {
        success: false,
        error: `Cannot delete: ${children.length} child units exist`,
        errorDetails: {
          code: 'HAS_CHILDREN',
          count: children.length,
          message: `This unit has ${children.length} child unit(s). Delete them first.`,
        },
      };
    }

    // Mock: Simulate role check (in production, this queries user_roles_projection)
    // For testing, we'll say units with "Main" in the name have roles assigned
    if (unit.name.includes('Main') && unit.id === 'ou-main-campus') {
      return {
        success: false,
        error: 'Cannot delete: roles are assigned to this unit',
        errorDetails: {
          code: 'HAS_ROLES',
          count: 3,
          message: 'This unit has 3 role(s) scoped to it. Reassign or remove them first.',
        },
      };
    }

    // Remove from list (simulating soft delete where unit becomes hidden)
    this.units.splice(unitIndex, 1);

    this.updateChildCounts();
    this.saveToStorage();

    log.info('Mock: Deleted organizational unit', { id: unit.id, name: unit.name });

    return {
      success: true,
      unit,
    };
  }

  /**
   * Reset mock data to initial state (useful for testing)
   */
  resetToDefaults(): void {
    this.units = getInitialMockData();
    this.saveToStorage();
    log.info('Mock: Reset organizational units to defaults');
  }

  /**
   * Clear all mock data (useful for testing)
   */
  clearAll(): void {
    this.units = [];
    this.saveToStorage();
    log.info('Mock: Cleared all organizational units');
  }
}
