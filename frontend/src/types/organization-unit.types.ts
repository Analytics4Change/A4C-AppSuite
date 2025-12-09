/**
 * Organizational Unit Type Definitions
 *
 * Types for managing organizational units (departments, locations, campuses, etc.)
 * within a provider organization's hierarchy.
 *
 * Organizational units are sub-organizations that exist within a provider's
 * scope. They inherit the parent organization's subdomain and type, but have
 * their own ltree path for hierarchical scoping.
 *
 * @see documentation/architecture/data/multi-tenancy-architecture.md
 * @see documentation/architecture/data/organization-management-architecture.md
 */

/**
 * Base organizational unit data from database projection
 *
 * Represents a single organizational unit within a provider's hierarchy.
 * Maps to organizations_projection table where nlevel(path) > 2.
 */
export interface OrganizationUnit {
  /** Unique identifier (UUID) */
  id: string;

  /** Unit name (e.g., "Main Campus", "Behavioral Health Wing") */
  name: string;

  /** Human-readable display name */
  displayName: string;

  /**
   * Ltree path representing position in hierarchy
   * Example: "root.provider.acme_healthcare.main_campus.east_wing"
   */
  path: string;

  /**
   * Parent ltree path (null for direct children of root org)
   * Example: "root.provider.acme_healthcare.main_campus"
   */
  parentPath: string | null;

  /**
   * Parent organization unit ID (null for direct children of root org)
   * Note: This is the immediate parent OU, not the root organization
   */
  parentId: string | null;

  /** Unit's timezone (inherited from parent if not specified) */
  timeZone: string;

  /** Whether the unit is currently active */
  isActive: boolean;

  /** Number of direct child units */
  childCount: number;

  /**
   * Derived field indicating this is the root organization.
   * True when parentPath is null and path depth is 2 (e.g., 'root.provider').
   * Root organizations are created during bootstrap and cannot be deleted by provider admins.
   * This field is computed by the service layer, not stored in the database.
   */
  isRootOrganization?: boolean;

  /** When the unit was created */
  createdAt: Date;

  /** When the unit was last updated */
  updatedAt: Date;
}

/**
 * Extended organizational unit with tree display state
 *
 * Used by the OrganizationTree component to track expansion state
 * and render the hierarchical tree view.
 */
export interface OrganizationUnitNode extends OrganizationUnit {
  /** Child nodes in the hierarchy */
  children: OrganizationUnitNode[];

  /** Depth level in tree (0 = root org, 1 = direct children, 2 = grandchildren, etc.) */
  depth: number;

  /** Whether this node is expanded in the tree view */
  isExpanded?: boolean;

  /** Whether this node is currently selected */
  isSelected?: boolean;

  /** Whether this node has any descendants (not just direct children) */
  hasDescendants: boolean;
}

/**
 * Request payload for creating a new organizational unit
 */
export interface CreateOrganizationUnitRequest {
  /**
   * Name for the new unit
   * Will be slugified for the ltree path segment
   */
  name: string;

  /** Human-readable display name */
  displayName: string;

  /**
   * Parent unit ID (null = direct child of user's root organization)
   *
   * When null, the unit is created as a direct child of the provider admin's
   * root organization (determined from JWT scope_path claim).
   */
  parentId: string | null;

  /**
   * Unit's timezone
   * If not specified, inherits from parent
   */
  timeZone?: string;
}

/**
 * Request payload for updating an existing organizational unit
 */
export interface UpdateOrganizationUnitRequest {
  /** ID of the unit to update */
  id: string;

  /** Updated name (optional) */
  name?: string;

  /** Updated display name (optional) */
  displayName?: string;

  /** Updated timezone (optional) */
  timeZone?: string;

  /** Updated active status (optional) */
  isActive?: boolean;
}

/**
 * Request payload for deactivating an organizational unit
 */
export interface DeactivateOrganizationUnitRequest {
  /** ID of the unit to deactivate */
  id: string;
}

/**
 * Result from organizational unit operations
 */
export interface OrganizationUnitOperationResult {
  /** Whether the operation succeeded */
  success: boolean;

  /** The resulting unit (if successful) */
  unit?: OrganizationUnit;

  /** Error message (if failed) */
  error?: string;

  /** Detailed error information (if failed) */
  errorDetails?: {
    /** Error code for programmatic handling */
    code: 'HAS_CHILDREN' | 'HAS_ROLES' | 'NOT_FOUND' | 'PERMISSION_DENIED' | 'IS_ROOT_ORGANIZATION' | 'UNKNOWN';
    /** Count of blocking items (children, roles, etc.) */
    count?: number;
    /** Human-readable message */
    message: string;
  };
}

/**
 * Filter options for querying organizational units
 */
export interface OrganizationUnitFilterOptions {
  /** Filter by active/inactive status */
  status?: 'active' | 'inactive' | 'all';

  /** Search by name or display name (case-insensitive) */
  searchTerm?: string;

  /** Only return units at or below this path */
  ancestorPath?: string;

  /** Only return units with this parent ID (null = root children) */
  parentId?: string | null;
}

/**
 * Utility type for tree building
 */
export type OrganizationUnitMap = Map<string, OrganizationUnitNode>;

/**
 * Helper function to convert flat units to tree structure
 *
 * The tree is built with the root organization at depth 0, its direct children
 * at depth 1, and so on. The root organization (isRootOrganization: true) becomes
 * the single top-level node in the returned array.
 *
 * @param units - Flat array of organizational units (including root org)
 * @param rootPath - The root organization's path (from JWT scope_path)
 * @returns Tree structure with root org as the single top-level node
 */
export function buildOrganizationUnitTree(
  units: OrganizationUnit[],
  rootPath: string
): OrganizationUnitNode[] {
  const nodeMap: OrganizationUnitMap = new Map();
  const rootNodes: OrganizationUnitNode[] = [];

  // Create nodes with initial state
  for (const unit of units) {
    const node: OrganizationUnitNode = {
      ...unit,
      children: [],
      depth: calculateDepth(unit.path, rootPath),
      isExpanded: unit.isRootOrganization ? true : false, // Root org expanded by default
      isSelected: false,
      hasDescendants: unit.childCount > 0,
    };
    nodeMap.set(unit.id, node);
  }

  // Build tree by assigning children to parents
  for (const node of nodeMap.values()) {
    if (node.parentId && nodeMap.has(node.parentId)) {
      const parent = nodeMap.get(node.parentId)!;
      parent.children.push(node);
      parent.hasDescendants = true;
    } else {
      // Root organization (parentId is null) or orphaned node
      rootNodes.push(node);
    }
  }

  // Sort children at each level alphabetically (but keep root org first if multiple roots)
  // Deactivated OUs are moved to the bottom of each hierarchy level
  const sortChildren = (nodes: OrganizationUnitNode[]): void => {
    nodes.sort((a, b) => {
      // Root org always comes first
      if (a.isRootOrganization && !b.isRootOrganization) return -1;
      if (!a.isRootOrganization && b.isRootOrganization) return 1;

      // Active OUs come before inactive OUs
      if (a.isActive && !b.isActive) return -1;
      if (!a.isActive && b.isActive) return 1;

      // Within active or inactive groups, sort alphabetically by display name
      return a.displayName.localeCompare(b.displayName);
    });
    for (const node of nodes) {
      if (node.children.length > 0) {
        sortChildren(node.children);
      }
    }
  };

  sortChildren(rootNodes);

  return rootNodes;
}

/**
 * Calculate depth of a unit relative to root path
 *
 * Depth calculation:
 * - Root org (path === rootPath): depth 0
 * - Direct children of root: depth 1
 * - Grandchildren: depth 2
 * - etc.
 */
function calculateDepth(unitPath: string, rootPath: string): number {
  const rootSegments = rootPath.split('.').length;
  const unitSegments = unitPath.split('.').length;
  // Root org has same segments as rootPath, so depth = 0
  // Direct children have 1 more segment, so depth = 1
  return unitSegments - rootSegments;
}

/**
 * Flatten a tree structure back to an array
 *
 * @param nodes - Tree nodes
 * @param includeCollapsed - Whether to include children of collapsed nodes
 * @returns Flat array in tree order (pre-order traversal)
 */
export function flattenOrganizationUnitTree(
  nodes: OrganizationUnitNode[],
  includeCollapsed = true
): OrganizationUnitNode[] {
  const result: OrganizationUnitNode[] = [];

  const traverse = (nodeList: OrganizationUnitNode[]): void => {
    for (const node of nodeList) {
      result.push(node);
      if (node.children.length > 0 && (includeCollapsed || node.isExpanded)) {
        traverse(node.children);
      }
    }
  };

  traverse(nodes);
  return result;
}
