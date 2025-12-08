/**
 * Organizational Unit Service Interface
 *
 * Provides CRUD operations for managing organizational units (departments,
 * locations, campuses, etc.) within a provider organization's hierarchy.
 *
 * Security Model:
 * - All operations are scoped to the user's organization (via JWT scope_path)
 * - RLS policies enforce that users can only manage units within their hierarchy
 * - Production implementation uses Supabase RPC functions
 * - Mock implementation uses localStorage for development
 *
 * Permission Required: organization.create_ou
 *
 * @see documentation/architecture/authorization/rbac-architecture.md
 * @see dev/active/organization-units-context.md
 */

import type {
  OrganizationUnit,
  OrganizationUnitFilterOptions,
  CreateOrganizationUnitRequest,
  UpdateOrganizationUnitRequest,
  OrganizationUnitOperationResult,
} from '@/types/organization-unit.types';

export interface IOrganizationUnitService {
  /**
   * Retrieves all organizational units within the user's scope
   *
   * Returns a flat array of units. Use buildOrganizationUnitTree() to
   * convert to a hierarchical structure for tree display.
   *
   * @param filters - Optional filters for status, search, or parent
   * @returns Promise resolving to array of organizational units
   *
   * @example
   * // Get all active units
   * const units = await service.getUnits({ status: 'active' });
   *
   * @example
   * // Search by name
   * const results = await service.getUnits({ searchTerm: 'campus' });
   */
  getUnits(filters?: OrganizationUnitFilterOptions): Promise<OrganizationUnit[]>;

  /**
   * Retrieves a single organizational unit by ID
   *
   * @param unitId - Organizational unit UUID
   * @returns Promise resolving to unit or null if not found/no access
   *
   * @example
   * const unit = await service.getUnitById('123e4567-e89b-12d3-a456-426614174000');
   * if (unit) {
   *   console.log(unit.name, unit.path);
   * }
   */
  getUnitById(unitId: string): Promise<OrganizationUnit | null>;

  /**
   * Retrieves all descendants of a given unit (children, grandchildren, etc.)
   *
   * Useful for impact analysis before deactivation or for displaying
   * a subtree of the organization hierarchy.
   *
   * @param unitId - Parent unit UUID
   * @returns Promise resolving to array of descendant units
   *
   * @example
   * // Get all units under "Main Campus"
   * const descendants = await service.getDescendants(mainCampusId);
   * console.log(`Main Campus has ${descendants.length} sub-units`);
   */
  getDescendants(unitId: string): Promise<OrganizationUnit[]>;

  /**
   * Creates a new organizational unit
   *
   * The new unit is created within the user's organization hierarchy.
   * If parentId is null, the unit is created as a direct child of the
   * user's root organization.
   *
   * @param request - Unit creation parameters
   * @returns Promise resolving to operation result with created unit
   *
   * @example
   * // Create a new campus under the root org
   * const result = await service.createUnit({
   *   name: 'North Campus',
   *   displayName: 'North Campus Medical Center',
   *   parentId: null, // Direct child of root org
   *   timeZone: 'America/New_York',
   * });
   *
   * @example
   * // Create a department under an existing unit
   * const result = await service.createUnit({
   *   name: 'Behavioral Health',
   *   displayName: 'Behavioral Health Department',
   *   parentId: northCampusId,
   * });
   */
  createUnit(request: CreateOrganizationUnitRequest): Promise<OrganizationUnitOperationResult>;

  /**
   * Updates an existing organizational unit
   *
   * Only updates the fields provided in the request. Unchanged fields
   * retain their current values.
   *
   * @param request - Unit update parameters
   * @returns Promise resolving to operation result with updated unit
   *
   * @example
   * // Rename a unit
   * const result = await service.updateUnit({
   *   id: unitId,
   *   name: 'Updated Campus Name',
   *   displayName: 'Updated Campus Display Name',
   * });
   *
   * @example
   * // Change timezone only
   * const result = await service.updateUnit({
   *   id: unitId,
   *   timeZone: 'America/Chicago',
   * });
   */
  updateUnit(request: UpdateOrganizationUnitRequest): Promise<OrganizationUnitOperationResult>;

  /**
   * Deactivates an organizational unit
   *
   * Performs a soft delete by setting is_active=false and deleted_at=NOW().
   * The unit remains in the database for audit purposes but is hidden from
   * normal queries.
   *
   * Validation (Option A - Simple Blocking):
   * - Fails if the unit has any active child units
   * - Fails if any roles are scoped to this unit
   * - Returns detailed error with count of blocking items
   *
   * @param unitId - ID of the unit to deactivate
   * @returns Promise resolving to operation result
   *
   * @example
   * const result = await service.deactivateUnit(unitId);
   * if (!result.success) {
   *   if (result.errorDetails?.code === 'HAS_CHILDREN') {
   *     alert(`Cannot delete: ${result.errorDetails.count} child units exist`);
   *   } else if (result.errorDetails?.code === 'HAS_ROLES') {
   *     alert(`Cannot delete: ${result.errorDetails.count} roles assigned`);
   *   }
   * }
   */
  deactivateUnit(unitId: string): Promise<OrganizationUnitOperationResult>;
}
