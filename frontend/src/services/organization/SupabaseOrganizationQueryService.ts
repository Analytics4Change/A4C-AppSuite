/**
 * Supabase Organization Query Service
 *
 * Production implementation of IOrganizationQueryService using Supabase.
 * Relies on RLS policies for access control:
 * - Super admins: See all organizations
 * - VAR partners: See organizations where referring_partner_id = their org_id
 * - Regular users: See only their own organization
 */

import { supabase } from '@/lib/supabase';
import { Logger } from '@/utils/logger';
import type { Organization, OrganizationFilterOptions } from '@/types/organization.types';
import type { IOrganizationQueryService } from './IOrganizationQueryService';

const log = Logger.getLogger('api');

/**
 * Database row type for organizations_projection table RPC results
 * MUST match: infrastructure/supabase/sql/02-tables/organizations/001-organizations_projection.sql
 * MUST match: infrastructure/supabase/sql/03-functions/api/004-organization-queries.sql
 */
interface OrganizationRow {
  id: string;
  name: string;
  display_name: string;
  slug: string;
  type: 'platform_owner' | 'provider' | 'provider_partner';
  path: string; // ltree path
  parent_path: string | null; // ltree parent path
  timezone: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export class SupabaseOrganizationQueryService implements IOrganizationQueryService {
  /**
   * Converts database row to Organization type
   */
  private mapRowToOrganization(row: OrganizationRow): Organization {
    return {
      id: row.id,
      name: row.name,
      display_name: row.display_name,
      type: row.type,
      // Map database columns to frontend expectations
      domain: '', // Not in database - frontend will need to derive or remove
      subdomain: row.slug, // Use slug as subdomain
      time_zone: row.timezone,
      is_active: row.is_active,
      parent_org_id: undefined, // Not directly available - would need to derive from parent_path
      path: row.path,
      partner_type: undefined, // Not in database - frontend will need to store elsewhere
      referring_partner_id: undefined, // Not in database - frontend will need to store elsewhere
      created_at: new Date(row.created_at),
      updated_at: new Date(row.updated_at),
    };
  }

  async getOrganizations(filters?: OrganizationFilterOptions): Promise<Organization[]> {
    try {
      log.debug('Fetching organizations with filters', { filters });

      // Use API schema RPC function instead of direct table query
      // This matches the established pattern for Temporal workflow activities
      const { data, error } = await supabase
        .schema('api')
        .rpc('get_organizations', {
          p_type: filters?.type && filters.type !== 'all' ? filters.type : null,
          p_is_active: filters?.status && filters.status !== 'all'
            ? filters.status === 'active'
            : null,
          p_search_term: filters?.searchTerm || null,
        });

      if (error) {
        log.error('Failed to fetch organizations', { error, filters });
        throw new Error(`Failed to fetch organizations: ${error.message}`);
      }

      if (!data) {
        log.warn('No organizations found', { filters });
        return [];
      }

      log.info(`Fetched ${data.length} organizations`, { filters });
      return data.map((row: OrganizationRow) => this.mapRowToOrganization(row));
    } catch (error) {
      log.error('Error in getOrganizations', { error, filters });
      throw error;
    }
  }

  async getOrganizationById(orgId: string): Promise<Organization | null> {
    try {
      log.debug('Fetching organization by ID', { orgId });

      // Use API schema RPC function instead of direct table query
      const { data, error } = await supabase
        .schema('api')
        .rpc('get_organization_by_id', {
          p_org_id: orgId,
        });

      if (error) {
        log.error('Failed to fetch organization by ID', { error, orgId });
        throw new Error(`Failed to fetch organization: ${error.message}`);
      }

      // RPC returns array, even with LIMIT 1
      if (!data || data.length === 0) {
        log.debug('Organization not found or access denied', { orgId });
        return null;
      }

      log.info('Fetched organization by ID', { orgId, name: data[0].name });
      return this.mapRowToOrganization(data[0]);
    } catch (error) {
      log.error('Error in getOrganizationById', { error, orgId });
      throw error;
    }
  }

  async getChildOrganizations(parentOrgId: string): Promise<Organization[]> {
    try {
      log.debug('Fetching child organizations', { parentOrgId });

      // Use API schema RPC function instead of direct table query
      const { data, error } = await supabase
        .schema('api')
        .rpc('get_child_organizations', {
          p_parent_org_id: parentOrgId,
        });

      if (error) {
        log.error('Failed to fetch child organizations', { error, parentOrgId });
        throw new Error(`Failed to fetch child organizations: ${error.message}`);
      }

      if (!data) {
        log.warn('No child organizations found', { parentOrgId });
        return [];
      }

      log.info(`Fetched ${data.length} child organizations`, { parentOrgId });
      return data.map((row: OrganizationRow) => this.mapRowToOrganization(row));
    } catch (error) {
      log.error('Error in getChildOrganizations', { error, parentOrgId });
      throw error;
    }
  }
}
