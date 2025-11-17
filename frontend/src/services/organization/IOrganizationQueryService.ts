/**
 * Organization Query Service Interface
 *
 * Provides read-only access to organization data with filtering and hierarchy navigation.
 * Implements security through Supabase RLS policies:
 * - Super admins: See all organizations
 * - VAR partners: See organizations where referring_partner_id = their org_id
 * - Regular users: See only their own organization
 */

import type { Organization, OrganizationFilterOptions } from '@/types/organization.types';

export interface IOrganizationQueryService {
  /**
   * Retrieves organizations with optional filtering
   *
   * @param filters - Optional filters for type, status, partner type, and search
   * @returns Promise resolving to array of organizations matching filters
   *
   * @example
   * // Get all active VAR partners
   * const varPartners = await service.getOrganizations({
   *   type: 'provider_partner',
   *   partnerType: 'var',
   *   status: 'active'
   * });
   *
   * @example
   * // Search by name or subdomain
   * const results = await service.getOrganizations({
   *   searchTerm: 'healthcare'
   * });
   */
  getOrganizations(filters?: OrganizationFilterOptions): Promise<Organization[]>;

  /**
   * Retrieves a single organization by ID
   *
   * @param orgId - Organization UUID
   * @returns Promise resolving to organization or null if not found/no access
   *
   * @example
   * const org = await service.getOrganizationById('123e4567-e89b-12d3-a456-426614174000');
   * if (org) {
   *   console.log(org.name, org.type);
   * }
   */
  getOrganizationById(orgId: string): Promise<Organization | null>;

  /**
   * Retrieves child organizations for a given parent organization
   *
   * Used for hierarchical navigation (e.g., provider viewing their partner organizations)
   *
   * @param parentOrgId - Parent organization UUID
   * @returns Promise resolving to array of child organizations
   *
   * @example
   * // Get all partners for a provider
   * const partners = await service.getChildOrganizations(providerOrgId);
   */
  getChildOrganizations(parentOrgId: string): Promise<Organization[]>;
}
