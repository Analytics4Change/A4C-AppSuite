/**
 * Organization Units ViewModel
 *
 * Manages state and business logic for organizational unit tree display and CRUD operations.
 * Uses MobX for reactive state management and dependency injection for services.
 *
 * Features:
 * - Tree state management (selection, expansion)
 * - CRUD operations delegated to service
 * - Loading and error states
 * - Keyboard navigation support helpers
 *
 * Dependencies:
 * - IOrganizationUnitService: CRUD operations (MockOrganizationUnitService | SupabaseOrganizationUnitService)
 *
 * Usage:
 * ```typescript
 * const viewModel = new OrganizationUnitsViewModel();
 * await viewModel.loadUnits();
 *
 * // Or with injected service for testing:
 * const viewModel = new OrganizationUnitsViewModel(mockService);
 * ```
 *
 * @see IOrganizationUnitService
 * @see OrganizationUnitFormViewModel for form state
 */

import { makeAutoObservable, runInAction } from 'mobx';
import { Logger } from '@/utils/logger';
import type { IOrganizationUnitService } from '@/services/organization/IOrganizationUnitService';
import { getOrganizationUnitService } from '@/services/organization/OrganizationUnitServiceFactory';
import type {
  OrganizationUnit,
  OrganizationUnitNode,
  OrganizationUnitFilterOptions,
  CreateOrganizationUnitRequest,
  UpdateOrganizationUnitRequest,
  OrganizationUnitOperationResult,
} from '@/types/organization-unit.types';
import {
  buildOrganizationUnitTree,
  flattenOrganizationUnitTree,
} from '@/types/organization-unit.types';

const log = Logger.getLogger('viewmodel');

/**
 * Root path for the current user's organization scope.
 * In production, this comes from JWT claims (scope_path).
 * For mock mode, this matches the mock auth provider's scope_path.
 */
const DEFAULT_ROOT_PATH = 'root.provider.acme_healthcare';

/**
 * Organization Units ViewModel
 *
 * MVVM pattern with constructor injection for dependency inversion.
 * Manages tree state including selection, expansion, and CRUD operations.
 */
export class OrganizationUnitsViewModel {
  // ============================================
  // Observable State
  // ============================================

  /** Flat array of all organizational units from service */
  private rawUnits: OrganizationUnit[] = [];

  /** Currently selected unit ID (null if none selected) */
  selectedUnitId: string | null = null;

  /** Set of expanded node IDs */
  expandedNodeIds: Set<string> = new Set();

  /** Loading state for async operations */
  isLoading = false;

  /** Error message from last failed operation */
  error: string | null = null;

  /** Current filter options */
  filters: OrganizationUnitFilterOptions = { status: 'all' };

  /** Root path for the organization (from JWT claims in production) */
  private rootPath: string;

  // ============================================
  // Constructor
  // ============================================

  /**
   * Constructor with dependency injection
   *
   * @param service - Organization unit service (defaults to factory-created instance)
   * @param rootPath - Root path for tree building (defaults to mock path, use JWT claims in production)
   */
  constructor(
    private service: IOrganizationUnitService = getOrganizationUnitService(),
    rootPath: string = DEFAULT_ROOT_PATH
  ) {
    this.rootPath = rootPath;
    makeAutoObservable(this);

    log.debug('OrganizationUnitsViewModel initialized', { rootPath });
  }

  // ============================================
  // Computed Properties
  // ============================================

  /**
   * Tree structure built from raw units
   * Rebuilds automatically when rawUnits or expandedNodeIds change
   */
  get treeNodes(): OrganizationUnitNode[] {
    if (this.rawUnits.length === 0) {
      return [];
    }

    const tree = buildOrganizationUnitTree(this.rawUnits, this.rootPath);

    // Apply expansion state and selection state
    const applyState = (nodes: OrganizationUnitNode[]): void => {
      for (const node of nodes) {
        node.isExpanded = this.expandedNodeIds.has(node.id);
        node.isSelected = node.id === this.selectedUnitId;
        if (node.children.length > 0) {
          applyState(node.children);
        }
      }
    };

    applyState(tree);

    return tree;
  }

  /**
   * Flat list of visible nodes (respects expansion state)
   * Useful for keyboard navigation
   */
  get visibleNodes(): OrganizationUnitNode[] {
    return flattenOrganizationUnitTree(this.treeNodes, false);
  }

  /**
   * All nodes flattened (ignores expansion state)
   */
  get allNodes(): OrganizationUnitNode[] {
    return flattenOrganizationUnitTree(this.treeNodes, true);
  }

  /**
   * Currently selected unit (or null if none selected)
   */
  get selectedUnit(): OrganizationUnit | null {
    if (!this.selectedUnitId) return null;
    return this.rawUnits.find((u) => u.id === this.selectedUnitId) ?? null;
  }

  /**
   * Whether the selected unit can be deactivated
   * - Must have a selection
   * - Cannot be the root organization
   * - Cannot have children (enforced by service, but we can pre-check)
   */
  get canDeactivate(): boolean {
    const unit = this.selectedUnit;
    if (!unit) return false;
    if (unit.isRootOrganization) return false;
    if (!unit.isActive) return false; // Already inactive
    return true;
  }

  /**
   * Whether the selected unit can be reactivated
   * - Must have a selection
   * - Cannot be the root organization
   * - Must be currently inactive
   */
  get canReactivate(): boolean {
    const unit = this.selectedUnit;
    if (!unit) return false;
    if (unit.isRootOrganization) return false;
    if (unit.isActive) return false; // Already active
    return true;
  }

  /**
   * Whether the selected unit can be edited
   * - Must have a selection
   */
  get canEdit(): boolean {
    return this.selectedUnit !== null;
  }

  /**
   * Whether a new unit can be created
   * - Always true if not loading
   */
  get canCreate(): boolean {
    return !this.isLoading;
  }

  /**
   * Whether the selected unit can be deleted
   * - Must have a selection
   * - Cannot be the root organization
   * - Must be inactive (deactivated first)
   * - Cannot have active children (service enforces this too)
   */
  get canDelete(): boolean {
    const unit = this.selectedUnit;
    if (!unit) return false;
    if (unit.isRootOrganization) return false;
    if (unit.isActive) return false; // Must be deactivated first
    return true;
  }

  /**
   * Total number of units
   */
  get unitCount(): number {
    return this.rawUnits.length;
  }

  /**
   * Number of active units
   */
  get activeUnitCount(): number {
    return this.rawUnits.filter((u) => u.isActive).length;
  }

  // ============================================
  // Actions - Data Loading
  // ============================================

  /**
   * Load all organizational units
   *
   * @param filters - Optional filters to apply
   */
  async loadUnits(filters?: OrganizationUnitFilterOptions): Promise<void> {
    log.debug('Loading organizational units', { filters });

    runInAction(() => {
      this.isLoading = true;
      this.error = null;
      if (filters) {
        this.filters = filters;
      }
    });

    try {
      const units = await this.service.getUnits(this.filters);

      runInAction(() => {
        this.rawUnits = units;
        this.isLoading = false;

        // Auto-expand root organization if present
        const rootOrg = units.find((u) => u.isRootOrganization);
        if (rootOrg && !this.expandedNodeIds.has(rootOrg.id)) {
          this.expandedNodeIds.add(rootOrg.id);
        }

        log.info('Loaded organizational units', { count: units.length });
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to load units';

      runInAction(() => {
        this.isLoading = false;
        this.error = errorMessage;
      });

      log.error('Failed to load organizational units', error);
    }
  }

  /**
   * Refresh units (reload with current filters)
   */
  async refresh(): Promise<void> {
    await this.loadUnits();
  }

  // ============================================
  // Actions - Selection
  // ============================================

  /**
   * Select a unit by ID
   *
   * @param unitId - ID of unit to select (null to clear selection)
   */
  selectNode(unitId: string | null): void {
    runInAction(() => {
      this.selectedUnitId = unitId;
      log.debug('Selected unit', { unitId });
    });
  }

  /**
   * Clear the current selection
   */
  clearSelection(): void {
    this.selectNode(null);
  }

  // ============================================
  // Actions - Expansion
  // ============================================

  /**
   * Toggle expansion state of a node
   *
   * @param unitId - ID of unit to toggle
   */
  toggleNode(unitId: string): void {
    runInAction(() => {
      if (this.expandedNodeIds.has(unitId)) {
        this.expandedNodeIds.delete(unitId);
      } else {
        this.expandedNodeIds.add(unitId);
      }
      // Create new Set to trigger MobX reactivity
      this.expandedNodeIds = new Set(this.expandedNodeIds);
      log.debug('Toggled node expansion', { unitId, expanded: this.expandedNodeIds.has(unitId) });
    });
  }

  /**
   * Expand a specific node
   *
   * @param unitId - ID of unit to expand
   */
  expandNode(unitId: string): void {
    runInAction(() => {
      this.expandedNodeIds.add(unitId);
      this.expandedNodeIds = new Set(this.expandedNodeIds);
    });
  }

  /**
   * Collapse a specific node
   *
   * @param unitId - ID of unit to collapse
   */
  collapseNode(unitId: string): void {
    runInAction(() => {
      this.expandedNodeIds.delete(unitId);
      this.expandedNodeIds = new Set(this.expandedNodeIds);
    });
  }

  /**
   * Expand all nodes
   */
  expandAll(): void {
    runInAction(() => {
      this.expandedNodeIds = new Set(this.rawUnits.map((u) => u.id));
      log.debug('Expanded all nodes');
    });
  }

  /**
   * Collapse all nodes (except root)
   */
  collapseAll(): void {
    runInAction(() => {
      // Keep root expanded
      const rootOrg = this.rawUnits.find((u) => u.isRootOrganization);
      this.expandedNodeIds = rootOrg ? new Set([rootOrg.id]) : new Set();
      log.debug('Collapsed all nodes');
    });
  }

  /**
   * Expand to reveal a specific node (expand the node itself and all ancestors)
   *
   * @param unitId - ID of unit to reveal
   */
  expandToNode(unitId: string): void {
    const unit = this.rawUnits.find((u) => u.id === unitId);
    if (!unit) return;

    runInAction(() => {
      // Expand the target node itself
      this.expandedNodeIds.add(unitId);

      // Find and expand all ancestors
      let currentId: string | null = unit.parentId;
      while (currentId) {
        this.expandedNodeIds.add(currentId);
        const parent = this.rawUnits.find((u) => u.id === currentId);
        currentId = parent?.parentId ?? null;
      }
      this.expandedNodeIds = new Set(this.expandedNodeIds);
      log.debug('Expanded path to node', { unitId });
    });
  }

  // ============================================
  // Actions - CRUD Operations
  // ============================================

  /**
   * Create a new organizational unit
   *
   * @param request - Creation request with name, displayName, parentId, timeZone
   * @returns Operation result with created unit or error
   */
  async createUnit(
    request: CreateOrganizationUnitRequest
  ): Promise<OrganizationUnitOperationResult> {
    log.debug('Creating organizational unit', { request });

    runInAction(() => {
      this.isLoading = true;
      this.error = null;
    });

    try {
      const result = await this.service.createUnit(request);

      if (result.success && result.unit) {
        runInAction(() => {
          // Add new unit to raw data
          this.rawUnits = [...this.rawUnits, result.unit!];
          // Update parent's child count
          this.updateChildCounts();
          // Expand parent to show new unit
          if (request.parentId) {
            this.expandNode(request.parentId);
          }
          // Select the new unit
          this.selectedUnitId = result.unit!.id;
          this.isLoading = false;
        });
        log.info('Created organizational unit', { id: result.unit.id });
      } else {
        runInAction(() => {
          this.error = result.error ?? 'Failed to create unit';
          this.isLoading = false;
        });
        log.warn('Failed to create unit', { error: result.error });
      }

      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to create unit';

      runInAction(() => {
        this.error = errorMessage;
        this.isLoading = false;
      });

      log.error('Error creating unit', error);

      return {
        success: false,
        error: errorMessage,
        errorDetails: {
          code: 'UNKNOWN',
          message: errorMessage,
        },
      };
    }
  }

  /**
   * Update an existing organizational unit
   *
   * @param request - Update request with id and fields to update
   * @returns Operation result with updated unit or error
   */
  async updateUnit(
    request: UpdateOrganizationUnitRequest
  ): Promise<OrganizationUnitOperationResult> {
    log.debug('Updating organizational unit', { request });

    runInAction(() => {
      this.isLoading = true;
      this.error = null;
    });

    try {
      const result = await this.service.updateUnit(request);

      if (result.success && result.unit) {
        runInAction(() => {
          // Replace updated unit in raw data
          const index = this.rawUnits.findIndex((u) => u.id === request.id);
          if (index !== -1) {
            this.rawUnits = [
              ...this.rawUnits.slice(0, index),
              result.unit!,
              ...this.rawUnits.slice(index + 1),
            ];
          }
          this.isLoading = false;
        });
        log.info('Updated organizational unit', { id: result.unit.id });
      } else {
        runInAction(() => {
          this.error = result.error ?? 'Failed to update unit';
          this.isLoading = false;
        });
        log.warn('Failed to update unit', { error: result.error });
      }

      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to update unit';

      runInAction(() => {
        this.error = errorMessage;
        this.isLoading = false;
      });

      log.error('Error updating unit', error);

      return {
        success: false,
        error: errorMessage,
        errorDetails: {
          code: 'UNKNOWN',
          message: errorMessage,
        },
      };
    }
  }

  /**
   * Deactivate an organizational unit
   *
   * @param unitId - ID of unit to deactivate
   * @returns Operation result or error
   */
  async deactivateUnit(unitId: string): Promise<OrganizationUnitOperationResult> {
    log.debug('Deactivating organizational unit', { unitId });

    runInAction(() => {
      this.isLoading = true;
      this.error = null;
    });

    try {
      const result = await this.service.deactivateUnit(unitId);

      if (result.success && result.unit) {
        // Reload full tree to capture cascade deactivation of descendants
        await this.loadUnits();

        runInAction(() => {
          // Clear selection if deactivated unit was selected
          if (this.selectedUnitId === unitId) {
            this.selectedUnitId = null;
          }
          this.isLoading = false;
        });
        log.info('Deactivated organizational unit', { id: result.unit.id });
      } else {
        runInAction(() => {
          this.error = result.error ?? 'Failed to deactivate unit';
          this.isLoading = false;
        });
        log.warn('Failed to deactivate unit', { error: result.error, errorDetails: result.errorDetails });
      }

      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to deactivate unit';

      runInAction(() => {
        this.error = errorMessage;
        this.isLoading = false;
      });

      log.error('Error deactivating unit', error);

      return {
        success: false,
        error: errorMessage,
        errorDetails: {
          code: 'UNKNOWN',
          message: errorMessage,
        },
      };
    }
  }

  /**
   * Reactivate an organizational unit
   *
   * Cascade behavior: Reactivating a parent OU also reactivates all its inactive descendants.
   * This mirrors the cascade deactivation behavior.
   *
   * @param unitId - ID of unit to reactivate
   * @returns Operation result or error
   */
  async reactivateUnit(unitId: string): Promise<OrganizationUnitOperationResult> {
    log.debug('Reactivating organizational unit', { unitId });

    runInAction(() => {
      this.isLoading = true;
      this.error = null;
    });

    try {
      const result = await this.service.reactivateUnit(unitId);

      if (result.success && result.unit) {
        // Reload full tree to capture cascade reactivation of descendants
        await this.loadUnits();

        runInAction(() => {
          this.isLoading = false;
        });
        log.info('Reactivated organizational unit', { id: result.unit.id });
      } else {
        runInAction(() => {
          this.error = result.error ?? 'Failed to reactivate unit';
          this.isLoading = false;
        });
        log.warn('Failed to reactivate unit', { error: result.error, errorDetails: result.errorDetails });
      }

      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to reactivate unit';

      runInAction(() => {
        this.error = errorMessage;
        this.isLoading = false;
      });

      log.error('Error reactivating unit', error);

      return {
        success: false,
        error: errorMessage,
        errorDetails: {
          code: 'UNKNOWN',
          message: errorMessage,
        },
      };
    }
  }

  /**
   * Delete an organizational unit (soft delete)
   *
   * Prerequisites:
   * - Unit must be deactivated first (is_active = false)
   * - Unit must have no active children
   * - Unit must have no role assignments
   *
   * After successful deletion:
   * - Reloads the tree
   * - Selects the parent unit
   *
   * @param unitId - ID of unit to delete
   * @returns Operation result or error
   */
  async deleteUnit(unitId: string): Promise<OrganizationUnitOperationResult> {
    log.debug('Deleting organizational unit', { unitId });

    // Store parent ID before deletion for selection after
    const unitToDelete = this.rawUnits.find((u) => u.id === unitId);
    const parentId = unitToDelete?.parentId ?? null;

    runInAction(() => {
      this.isLoading = true;
      this.error = null;
    });

    try {
      const result = await this.service.deleteUnit(unitId);

      if (result.success) {
        // Reload the tree to get fresh data
        await this.loadUnits();

        runInAction(() => {
          // Select parent unit after deletion
          if (parentId && this.rawUnits.find((u) => u.id === parentId)) {
            this.selectedUnitId = parentId;
            // Ensure parent is visible (expanded)
            this.expandToNode(parentId);
          } else {
            // Fallback: select root organization
            const rootOrg = this.rawUnits.find((u) => u.isRootOrganization);
            this.selectedUnitId = rootOrg?.id ?? null;
          }
          this.isLoading = false;
        });
        log.info('Deleted organizational unit', { id: unitId, selectedParent: parentId });
      } else {
        runInAction(() => {
          this.error = result.error ?? 'Failed to delete unit';
          this.isLoading = false;
        });
        log.warn('Failed to delete unit', { error: result.error, errorDetails: result.errorDetails });
      }

      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to delete unit';

      runInAction(() => {
        this.error = errorMessage;
        this.isLoading = false;
      });

      log.error('Error deleting unit', error);

      return {
        success: false,
        error: errorMessage,
        errorDetails: {
          code: 'UNKNOWN',
          message: errorMessage,
        },
      };
    }
  }

  // ============================================
  // Actions - Keyboard Navigation Helpers
  // ============================================

  /**
   * Move selection to the next visible node
   * Called when Arrow Down is pressed
   */
  moveSelectionDown(): void {
    const visible = this.visibleNodes;
    if (visible.length === 0) return;

    const currentIndex = this.selectedUnitId
      ? visible.findIndex((n) => n.id === this.selectedUnitId)
      : -1;

    const nextIndex = currentIndex < visible.length - 1 ? currentIndex + 1 : 0;
    this.selectNode(visible[nextIndex].id);
  }

  /**
   * Move selection to the previous visible node
   * Called when Arrow Up is pressed
   */
  moveSelectionUp(): void {
    const visible = this.visibleNodes;
    if (visible.length === 0) return;

    const currentIndex = this.selectedUnitId
      ? visible.findIndex((n) => n.id === this.selectedUnitId)
      : 0;

    const prevIndex = currentIndex > 0 ? currentIndex - 1 : visible.length - 1;
    this.selectNode(visible[prevIndex].id);
  }

  /**
   * Handle Arrow Right key
   * - If collapsed and has children: expand
   * - If expanded or no children: move to first child (if any)
   */
  handleArrowRight(): void {
    if (!this.selectedUnitId) return;

    const node = this.allNodes.find((n) => n.id === this.selectedUnitId);
    if (!node) return;

    if (node.hasDescendants && !this.expandedNodeIds.has(node.id)) {
      // Expand the node
      this.expandNode(node.id);
    } else if (node.children.length > 0) {
      // Move to first child
      this.selectNode(node.children[0].id);
    }
  }

  /**
   * Handle Arrow Left key
   * - If expanded: collapse
   * - If collapsed: move to parent
   */
  handleArrowLeft(): void {
    if (!this.selectedUnitId) return;

    const node = this.allNodes.find((n) => n.id === this.selectedUnitId);
    if (!node) return;

    if (this.expandedNodeIds.has(node.id)) {
      // Collapse the node
      this.collapseNode(node.id);
    } else if (node.parentId) {
      // Move to parent
      this.selectNode(node.parentId);
    }
  }

  /**
   * Select the first visible node
   * Called when Home key is pressed
   */
  selectFirst(): void {
    const visible = this.visibleNodes;
    if (visible.length > 0) {
      this.selectNode(visible[0].id);
    }
  }

  /**
   * Select the last visible node
   * Called when End key is pressed
   */
  selectLast(): void {
    const visible = this.visibleNodes;
    if (visible.length > 0) {
      this.selectNode(visible[visible.length - 1].id);
    }
  }

  // ============================================
  // Private Helpers
  // ============================================

  /**
   * Update child counts after structural changes
   */
  private updateChildCounts(): void {
    runInAction(() => {
      for (const unit of this.rawUnits) {
        unit.childCount = this.rawUnits.filter(
          (u) => u.parentId === unit.id && u.isActive
        ).length;
      }
      // Trigger reactivity
      this.rawUnits = [...this.rawUnits];
    });
  }

  // ============================================
  // Utility Methods
  // ============================================

  /**
   * Clear error state
   */
  clearError(): void {
    runInAction(() => {
      this.error = null;
    });
  }

  /**
   * Get a unit by ID from loaded data
   *
   * @param unitId - Unit ID to find
   * @returns Unit or null if not found
   */
  getUnitById(unitId: string): OrganizationUnit | null {
    return this.rawUnits.find((u) => u.id === unitId) ?? null;
  }

  /**
   * Get potential parent units for create/move operations
   * Returns all active units that can serve as parents
   *
   * @param excludeId - Optional unit ID to exclude (e.g., can't be parent of itself)
   */
  getAvailableParents(excludeId?: string): OrganizationUnit[] {
    return this.rawUnits.filter((u) => {
      if (!u.isActive) return false;
      if (excludeId && u.id === excludeId) return false;
      // In a move scenario, also exclude descendants (to prevent circular refs)
      // For now, this is handled by the service
      return true;
    });
  }
}
