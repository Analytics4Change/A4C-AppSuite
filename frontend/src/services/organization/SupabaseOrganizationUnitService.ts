/**
 * Supabase Organization Unit Service
 *
 * Production implementation of IOrganizationUnitService using Supabase RPC functions.
 * Provides CRUD operations for organizational units within a provider's hierarchy.
 *
 * Security Model:
 * - All operations scoped to user's JWT scope_path claim
 * - RLS policies enforce additional database-level protection
 * - Required permission: organization.create_ou
 *
 * RPC Functions (api schema):
 * - get_organization_units: List all units within user's scope
 * - get_organization_unit_by_id: Get single unit by ID
 * - get_organization_unit_descendants: Get all descendants of a unit
 * - create_organization_unit: Create new sub-organization
 * - update_organization_unit: Update unit metadata (name, display_name, timezone)
 * - deactivate_organization_unit: Freeze unit (is_active=false, roles frozen)
 * - reactivate_organization_unit: Unfreeze unit (is_active=true)
 * - delete_organization_unit: Soft delete (deleted_at set, requires zero roles)
 *
 * @see infrastructure/supabase/sql/03-functions/api/005-organization-unit-crud.sql
 * @see documentation/architecture/data/multi-tenancy-architecture.md
 */

import { supabase } from '@/lib/supabase';
import { Logger } from '@/utils/logger';
import type { IOrganizationUnitService } from './IOrganizationUnitService';
import type {
  OrganizationUnit,
  OrganizationUnitFilterOptions,
  CreateOrganizationUnitRequest,
  UpdateOrganizationUnitRequest,
  OrganizationUnitOperationResult,
} from '@/types/organization-unit.types';

const log = Logger.getLogger('supabase-ou-service');

/**
 * Database row type for organization unit RPC results
 * MUST match: infrastructure/supabase/sql/03-functions/api/005-organization-unit-crud.sql
 */
interface OrganizationUnitRow {
  id: string;
  name: string;
  display_name: string | null;
  path: string;
  parent_path: string | null;
  parent_id: string | null;
  timezone: string;
  is_active: boolean;
  child_count: number;
  is_root_organization: boolean;
  created_at: string;
  updated_at: string;
}

/**
 * JSONB response type for mutation operations
 */
interface MutationResponse {
  success: boolean;
  unit?: {
    id: string;
    name: string;
    displayName: string;
    path: string;
    parentPath: string | null;
    parentId: string | null;
    timeZone: string;
    isActive: boolean;
    childCount: number;
    isRootOrganization: boolean;
    createdAt: string;
    updatedAt: string;
  };
  deletedUnit?: MutationResponse['unit']; // backward-compat: old RPC key before migration fix
  error?: string;
  errorDetails?: {
    code: string;
    count?: number;
    message: string;
  };
}

export class SupabaseOrganizationUnitService implements IOrganizationUnitService {
  constructor() {
    log.info('SupabaseOrganizationUnitService initialized');
  }

  /**
   * Converts database row to OrganizationUnit type
   */
  private mapRowToUnit(row: OrganizationUnitRow): OrganizationUnit {
    return {
      id: row.id,
      name: row.name,
      displayName: row.display_name ?? row.name,
      path: row.path,
      parentPath: row.parent_path,
      parentId: row.parent_id,
      timeZone: row.timezone,
      isActive: row.is_active,
      childCount: Number(row.child_count) || 0,
      isRootOrganization: row.is_root_organization,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    };
  }

  /**
   * Converts mutation response unit to OrganizationUnit type
   */
  private mapResponseToUnit(unit: MutationResponse['unit']): OrganizationUnit {
    if (!unit) {
      throw new Error('Unit data missing from response');
    }
    return {
      id: unit.id,
      name: unit.name,
      displayName: unit.displayName,
      path: unit.path,
      parentPath: unit.parentPath,
      parentId: unit.parentId,
      timeZone: unit.timeZone,
      isActive: unit.isActive,
      childCount: unit.childCount || 0,
      isRootOrganization: unit.isRootOrganization,
      createdAt: new Date(unit.createdAt),
      updatedAt: new Date(unit.updatedAt),
    };
  }

  /**
   * Maps error details from RPC response to operation result format
   */
  private mapErrorDetails(
    errorDetails?: MutationResponse['errorDetails']
  ): OrganizationUnitOperationResult['errorDetails'] {
    if (!errorDetails) return undefined;

    const codeMap: Record<string, OrganizationUnitOperationResult['errorDetails']> = {
      HAS_CHILDREN: {
        code: 'HAS_CHILDREN',
        count: errorDetails.count,
        message: errorDetails.message,
      },
      HAS_ROLES: {
        code: 'HAS_ROLES',
        count: errorDetails.count,
        message: errorDetails.message,
      },
      NOT_FOUND: {
        code: 'NOT_FOUND',
        message: errorDetails.message,
      },
      IS_ROOT_ORGANIZATION: {
        code: 'IS_ROOT_ORGANIZATION',
        message: errorDetails.message,
      },
      ALREADY_ACTIVE: {
        code: 'ALREADY_ACTIVE',
        message: errorDetails.message,
      },
      ALREADY_INACTIVE: {
        code: 'ALREADY_INACTIVE',
        message: errorDetails.message,
      },
      DUPLICATE_NAME: {
        code: 'UNKNOWN',
        message: errorDetails.message,
      },
    };

    return (
      codeMap[errorDetails.code] || {
        code: 'UNKNOWN',
        message: errorDetails.message,
      }
    );
  }

  /**
   * Retrieves all organizational units within the user's scope
   */
  async getUnits(filters?: OrganizationUnitFilterOptions): Promise<OrganizationUnit[]> {
    log.debug('getUnits called', { filters });

    try {
      const { data, error } = await supabase.schema('api').rpc('get_organization_units', {
        p_status: filters?.status || 'all',
        p_search_term: filters?.searchTerm || null,
      });

      if (error) {
        log.error('Error fetching organization units', error);
        throw new Error(`Failed to fetch organization units: ${error.message}`);
      }

      const rows = (data as OrganizationUnitRow[]) || [];
      log.debug(`Fetched ${rows.length} organization units`);

      return rows.map((row) => this.mapRowToUnit(row));
    } catch (err) {
      log.error('Exception in getUnits', err);
      throw err;
    }
  }

  /**
   * Retrieves a single organizational unit by ID
   */
  async getUnitById(unitId: string): Promise<OrganizationUnit | null> {
    log.debug('getUnitById called', { unitId });

    try {
      const { data, error } = await supabase.schema('api').rpc('get_organization_unit_by_id', {
        p_unit_id: unitId,
      });

      if (error) {
        log.error('Error fetching organization unit by ID', error);
        throw new Error(`Failed to fetch organization unit: ${error.message}`);
      }

      const rows = (data as OrganizationUnitRow[]) || [];

      if (rows.length === 0) {
        log.debug('Organization unit not found', { unitId });
        return null;
      }

      return this.mapRowToUnit(rows[0]);
    } catch (err) {
      log.error('Exception in getUnitById', err);
      throw err;
    }
  }

  /**
   * Retrieves all descendants of a given unit
   */
  async getDescendants(unitId: string): Promise<OrganizationUnit[]> {
    log.debug('getDescendants called', { unitId });

    try {
      const { data, error } = await supabase
        .schema('api')
        .rpc('get_organization_unit_descendants', {
          p_unit_id: unitId,
        });

      if (error) {
        log.error('Error fetching unit descendants', error);
        throw new Error(`Failed to fetch descendants: ${error.message}`);
      }

      const rows = (data as OrganizationUnitRow[]) || [];
      log.debug(`Fetched ${rows.length} descendants`);

      return rows.map((row) => this.mapRowToUnit(row));
    } catch (err) {
      log.error('Exception in getDescendants', err);
      throw err;
    }
  }

  /**
   * Creates a new organizational unit
   */
  async createUnit(
    request: CreateOrganizationUnitRequest
  ): Promise<OrganizationUnitOperationResult> {
    log.debug('createUnit called', { request });

    try {
      const { data, error } = await supabase.schema('api').rpc('create_organization_unit', {
        p_parent_id: request.parentId,
        p_name: request.name,
        p_display_name: request.displayName,
        p_timezone: request.timeZone || null,
      });

      if (error) {
        log.error('Error creating organization unit', error);
        return {
          success: false,
          error: error.message,
          errorDetails: {
            code: 'UNKNOWN',
            message: error.message,
          },
        };
      }

      const response = data as MutationResponse;

      if (!response.success) {
        log.warn('Create unit failed', { response });
        return {
          success: false,
          error: response.error,
          errorDetails: this.mapErrorDetails(response.errorDetails),
        };
      }

      // Defense-in-depth: if handler failed, RPC may return success with empty unit
      if (!response.unit?.id) {
        log.error('Create returned success but no unit data', { response });
        return {
          success: false,
          error: response.error || 'Organization unit creation failed — no data returned',
          errorDetails: {
            code: 'UNKNOWN',
            message: 'Server returned success but no unit data',
          },
        };
      }

      log.info('Organization unit created', { unitId: response.unit.id });
      return {
        success: true,
        unit: this.mapResponseToUnit(response.unit),
      };
    } catch (err) {
      log.error('Exception in createUnit', err);
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Unknown error',
        errorDetails: {
          code: 'UNKNOWN',
          message: err instanceof Error ? err.message : 'Unknown error',
        },
      };
    }
  }

  /**
   * Updates an existing organizational unit (metadata only)
   *
   * Note: Active status is not updated via this method.
   * Use deactivateUnit() to freeze, reactivateUnit() to unfreeze.
   */
  async updateUnit(
    request: UpdateOrganizationUnitRequest
  ): Promise<OrganizationUnitOperationResult> {
    log.debug('updateUnit called', { request });

    try {
      const { data, error } = await supabase.schema('api').rpc('update_organization_unit', {
        p_unit_id: request.id,
        p_name: request.name || null,
        p_display_name: request.displayName || null,
        p_timezone: request.timeZone || null,
      });

      if (error) {
        log.error('Error updating organization unit', error);
        return {
          success: false,
          error: error.message,
          errorDetails: {
            code: 'UNKNOWN',
            message: error.message,
          },
        };
      }

      const response = data as MutationResponse;

      if (!response.success) {
        log.warn('Update unit failed', { response });
        return {
          success: false,
          error: response.error,
          errorDetails: this.mapErrorDetails(response.errorDetails),
        };
      }

      // Defense-in-depth: if handler failed, RPC may return success with empty unit
      if (!response.unit?.id) {
        log.error('Update returned success but no unit data', { response });
        return {
          success: false,
          error: response.error || 'Organization unit update failed — no data returned',
          errorDetails: {
            code: 'UNKNOWN',
            message: 'Server returned success but no unit data',
          },
        };
      }

      log.info('Organization unit updated', { unitId: request.id });
      return {
        success: true,
        unit: this.mapResponseToUnit(response.unit),
      };
    } catch (err) {
      log.error('Exception in updateUnit', err);
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Unknown error',
        errorDetails: {
          code: 'UNKNOWN',
          message: err instanceof Error ? err.message : 'Unknown error',
        },
      };
    }
  }

  /**
   * Deactivates (freezes) an organizational unit
   *
   * Sets is_active=false. The OU remains visible but roles are frozen.
   * Use reactivateUnit() to unfreeze.
   */
  async deactivateUnit(unitId: string): Promise<OrganizationUnitOperationResult> {
    log.debug('deactivateUnit called', { unitId });

    try {
      const { data, error } = await supabase.schema('api').rpc('deactivate_organization_unit', {
        p_unit_id: unitId,
      });

      if (error) {
        log.error('Error deactivating organization unit', error);
        return {
          success: false,
          error: error.message,
          errorDetails: {
            code: 'UNKNOWN',
            message: error.message,
          },
        };
      }

      const response = data as MutationResponse;

      if (!response.success) {
        log.warn('Deactivate unit failed', { response });
        return {
          success: false,
          error: response.error,
          errorDetails: this.mapErrorDetails(response.errorDetails),
        };
      }

      // Defense-in-depth: if handler failed, RPC may return success with empty unit
      if (!response.unit?.id) {
        log.error('Deactivate returned success but no unit data', { response });
        return {
          success: false,
          error: response.error || 'Organization unit deactivation failed — no data returned',
          errorDetails: {
            code: 'UNKNOWN',
            message: 'Server returned success but no unit data',
          },
        };
      }

      log.info('Organization unit deactivated', { unitId });
      return {
        success: true,
        unit: this.mapResponseToUnit(response.unit),
      };
    } catch (err) {
      log.error('Exception in deactivateUnit', err);
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Unknown error',
        errorDetails: {
          code: 'UNKNOWN',
          message: err instanceof Error ? err.message : 'Unknown error',
        },
      };
    }
  }

  /**
   * Reactivates a previously deactivated organizational unit
   *
   * Sets is_active=true. Roles can be assigned again.
   */
  async reactivateUnit(unitId: string): Promise<OrganizationUnitOperationResult> {
    log.debug('reactivateUnit called', { unitId });

    try {
      const { data, error } = await supabase.schema('api').rpc('reactivate_organization_unit', {
        p_unit_id: unitId,
      });

      if (error) {
        log.error('Error reactivating organization unit', error);
        return {
          success: false,
          error: error.message,
          errorDetails: {
            code: 'UNKNOWN',
            message: error.message,
          },
        };
      }

      const response = data as MutationResponse;

      if (!response.success) {
        log.warn('Reactivate unit failed', { response });
        return {
          success: false,
          error: response.error,
          errorDetails: this.mapErrorDetails(response.errorDetails),
        };
      }

      // Defense-in-depth: if handler failed, RPC may return success with empty unit
      if (!response.unit?.id) {
        log.error('Reactivate returned success but no unit data', { response });
        return {
          success: false,
          error: response.error || 'Organization unit reactivation failed — no data returned',
          errorDetails: {
            code: 'UNKNOWN',
            message: 'Server returned success but no unit data',
          },
        };
      }

      log.info('Organization unit reactivated', { unitId });
      return {
        success: true,
        unit: this.mapResponseToUnit(response.unit),
      };
    } catch (err) {
      log.error('Exception in reactivateUnit', err);
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Unknown error',
        errorDetails: {
          code: 'UNKNOWN',
          message: err instanceof Error ? err.message : 'Unknown error',
        },
      };
    }
  }

  /**
   * Soft-deletes an organizational unit
   *
   * Sets deleted_at timestamp. Unit becomes hidden from queries.
   * Requires the unit to have no role assignments.
   */
  async deleteUnit(unitId: string): Promise<OrganizationUnitOperationResult> {
    log.debug('deleteUnit called', { unitId });

    try {
      const { data, error } = await supabase.schema('api').rpc('delete_organization_unit', {
        p_unit_id: unitId,
      });

      if (error) {
        log.error('Error deleting organization unit', error);
        return {
          success: false,
          error: error.message,
          errorDetails: {
            code: 'UNKNOWN',
            message: error.message,
          },
        };
      }

      const response = data as MutationResponse;

      if (!response.success) {
        log.warn('Delete unit failed', { response });
        return {
          success: false,
          error: response.error,
          errorDetails: this.mapErrorDetails(response.errorDetails),
        };
      }

      // Defense-in-depth: if handler failed, RPC may return success with empty unit
      // Backward-compat: old RPC returned 'deletedUnit', new RPC returns 'unit'
      const unitData = response.unit || response.deletedUnit;
      if (!unitData?.id) {
        log.error('Delete returned success but no unit data', { response });
        return {
          success: false,
          error: response.error || 'Organization unit deletion failed — no data returned',
          errorDetails: {
            code: 'UNKNOWN',
            message: 'Server returned success but no unit data',
          },
        };
      }

      log.info('Organization unit deleted', { unitId });
      return {
        success: true,
        unit: this.mapResponseToUnit(unitData),
      };
    } catch (err) {
      log.error('Exception in deleteUnit', err);
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Unknown error',
        errorDetails: {
          code: 'UNKNOWN',
          message: err instanceof Error ? err.message : 'Unknown error',
        },
      };
    }
  }
}
