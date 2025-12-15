/**
 * Mock Organization Query Service
 *
 * Development/testing implementation of IOrganizationQueryService.
 * Provides realistic mock data for all organization types and partner relationships.
 */

import { Logger } from '@/utils/logger';
import type {
  Organization,
  OrganizationFilterOptions,
  OrganizationQueryOptions,
  PaginatedResult,
} from '@/types/organization.types';
import type { IOrganizationQueryService } from './IOrganizationQueryService';

const log = Logger.getLogger('api');

/**
 * Mock organization data representing different types and relationships
 */
const MOCK_ORGANIZATIONS: Organization[] = [
  // Platform owner (A4C)
  {
    id: 'a4c-platform-id',
    name: 'Analytics4Change',
    display_name: 'A4C Platform',
    type: 'platform_owner',
    domain: 'analytics4change.com',
    subdomain: 'platform',
    time_zone: 'America/New_York',
    is_active: true,
    path: 'a4c-platform-id',
    created_at: new Date('2024-01-01'),
    updated_at: new Date('2024-01-01'),
  },

  // Provider organizations
  {
    id: 'provider-abc-healthcare-id',
    name: 'ABC Healthcare Partners',
    display_name: 'ABC Healthcare',
    type: 'provider',
    domain: 'abc-healthcare.analytics4change.com',
    subdomain: 'abc-healthcare',
    time_zone: 'America/Los_Angeles',
    is_active: true,
    parent_org_id: 'a4c-platform-id',
    path: 'a4c-platform-id.provider-abc-healthcare-id',
    created_at: new Date('2024-02-01'),
    updated_at: new Date('2024-02-01'),
  },
  {
    id: 'provider-xyz-medical-id',
    name: 'XYZ Medical Group',
    display_name: 'XYZ Medical',
    type: 'provider',
    domain: 'xyz-medical.analytics4change.com',
    subdomain: 'xyz-medical',
    time_zone: 'America/Chicago',
    is_active: true,
    parent_org_id: 'a4c-platform-id',
    path: 'a4c-platform-id.provider-xyz-medical-id',
    created_at: new Date('2024-02-15'),
    updated_at: new Date('2024-02-15'),
  },
  {
    id: 'provider-summit-health-id',
    name: 'Summit Health Systems',
    display_name: 'Summit Health',
    type: 'provider',
    domain: 'summit-health.analytics4change.com',
    subdomain: 'summit-health',
    time_zone: 'America/Denver',
    is_active: false,
    parent_org_id: 'a4c-platform-id',
    path: 'a4c-platform-id.provider-summit-health-id',
    created_at: new Date('2024-01-20'),
    updated_at: new Date('2024-03-10'),
  },

  // VAR partner organizations
  {
    id: 'var-partner-techsolutions-id',
    name: 'TechSolutions VAR',
    display_name: 'TechSolutions',
    type: 'provider_partner',
    domain: 'techsolutions.analytics4change.com',
    subdomain: 'techsolutions',
    time_zone: 'America/New_York',
    is_active: true,
    parent_org_id: 'a4c-platform-id',
    path: 'a4c-platform-id.var-partner-techsolutions-id',
    partner_type: 'var',
    created_at: new Date('2024-03-01'),
    updated_at: new Date('2024-03-01'),
  },
  {
    id: 'var-partner-healthit-id',
    name: 'HealthIT Consultants',
    display_name: 'HealthIT',
    type: 'provider_partner',
    domain: 'healthit.analytics4change.com',
    subdomain: 'healthit',
    time_zone: 'America/Los_Angeles',
    is_active: true,
    parent_org_id: 'a4c-platform-id',
    path: 'a4c-platform-id.var-partner-healthit-id',
    partner_type: 'var',
    created_at: new Date('2024-03-15'),
    updated_at: new Date('2024-03-15'),
  },

  // Family partner organizations
  {
    id: 'family-partner-sunrise-id',
    name: 'Sunrise Family Services',
    display_name: 'Sunrise Family',
    type: 'provider_partner',
    domain: 'sunrise-family.analytics4change.com',
    subdomain: 'sunrise-family',
    time_zone: 'America/New_York',
    is_active: true,
    parent_org_id: 'provider-abc-healthcare-id',
    path: 'a4c-platform-id.provider-abc-healthcare-id.family-partner-sunrise-id',
    partner_type: 'family',
    created_at: new Date('2024-04-01'),
    updated_at: new Date('2024-04-01'),
  },

  // Court partner organizations
  {
    id: 'court-partner-county-id',
    name: 'County Court Monitoring',
    display_name: 'County Court',
    type: 'provider_partner',
    domain: 'county-court.analytics4change.com',
    subdomain: 'county-court',
    time_zone: 'America/Chicago',
    is_active: true,
    parent_org_id: 'provider-xyz-medical-id',
    path: 'a4c-platform-id.provider-xyz-medical-id.court-partner-county-id',
    partner_type: 'court',
    created_at: new Date('2024-04-15'),
    updated_at: new Date('2024-04-15'),
  },

  // Providers referred by VAR partners
  {
    id: 'provider-newclinic-id',
    name: 'New Clinic Network',
    display_name: 'New Clinic',
    type: 'provider',
    domain: 'newclinic.analytics4change.com',
    subdomain: 'newclinic',
    time_zone: 'America/New_York',
    is_active: true,
    parent_org_id: 'a4c-platform-id',
    path: 'a4c-platform-id.provider-newclinic-id',
    referring_partner_id: 'var-partner-techsolutions-id', // Referred by TechSolutions
    created_at: new Date('2024-05-01'),
    updated_at: new Date('2024-05-01'),
  },
  {
    id: 'provider-citycare-id',
    name: 'City Care Physicians',
    display_name: 'City Care',
    type: 'provider',
    domain: 'citycare.analytics4change.com',
    subdomain: 'citycare',
    time_zone: 'America/Los_Angeles',
    is_active: true,
    parent_org_id: 'a4c-platform-id',
    path: 'a4c-platform-id.provider-citycare-id',
    referring_partner_id: 'var-partner-healthit-id', // Referred by HealthIT
    created_at: new Date('2024-05-15'),
    updated_at: new Date('2024-05-15'),
  },
];

export class MockOrganizationQueryService implements IOrganizationQueryService {
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
    await new Promise(resolve => setTimeout(resolve, delay));
  }

  async getOrganizations(filters?: OrganizationFilterOptions): Promise<Organization[]> {
    await this.simulateDelay();

    log.debug('Mock: Fetching organizations with filters', { filters });

    let results = [...MOCK_ORGANIZATIONS];

    // Apply filters if provided
    if (filters) {
      // Filter by organization type
      if (filters.type && filters.type !== 'all') {
        results = results.filter(org => org.type === filters.type);
      }

      // Filter by active/inactive status
      if (filters.status && filters.status !== 'all') {
        results = results.filter(org =>
          org.is_active === (filters.status === 'active')
        );
      }

      // Filter by partner type
      if (filters.partnerType) {
        results = results.filter(org => org.partner_type === filters.partnerType);
      }

      // Search by name or subdomain (case-insensitive)
      if (filters.searchTerm) {
        const searchLower = filters.searchTerm.toLowerCase();
        results = results.filter(org =>
          org.name.toLowerCase().includes(searchLower) ||
          org.subdomain.toLowerCase().includes(searchLower)
        );
      }
    }

    // Sort alphabetically by name
    results.sort((a, b) => a.name.localeCompare(b.name));

    log.info(`Mock: Returning ${results.length} organizations`, { filters });
    return results;
  }

  async getOrganizationById(orgId: string): Promise<Organization | null> {
    await this.simulateDelay();

    log.debug('Mock: Fetching organization by ID', { orgId });

    const org = MOCK_ORGANIZATIONS.find(o => o.id === orgId);

    if (org) {
      log.info('Mock: Found organization by ID', { orgId, name: org.name });
    } else {
      log.debug('Mock: Organization not found', { orgId });
    }

    return org ?? null;
  }

  async getChildOrganizations(parentOrgId: string): Promise<Organization[]> {
    await this.simulateDelay();

    log.debug('Mock: Fetching child organizations', { parentOrgId });

    const children = MOCK_ORGANIZATIONS.filter(org => org.parent_org_id === parentOrgId);

    // Sort alphabetically by name
    children.sort((a, b) => a.name.localeCompare(b.name));

    log.info(`Mock: Returning ${children.length} child organizations`, { parentOrgId });
    return children;
  }

  async getOrganizationsPaginated(
    options?: OrganizationQueryOptions
  ): Promise<PaginatedResult<Organization>> {
    await this.simulateDelay();

    const page = options?.page ?? 1;
    const pageSize = options?.pageSize ?? 20;
    const sortBy = options?.sortBy ?? 'name';
    const sortOrder = options?.sortOrder ?? 'asc';

    log.debug('Mock: Fetching paginated organizations', { options });

    let results = [...MOCK_ORGANIZATIONS];

    // Apply filters
    if (options?.type && options.type !== 'all') {
      results = results.filter(org => org.type === options.type);
    }

    if (options?.status && options.status !== 'all') {
      results = results.filter(org => org.is_active === (options.status === 'active'));
    }

    if (options?.searchTerm) {
      const searchLower = options.searchTerm.toLowerCase();
      results = results.filter(
        org =>
          org.name.toLowerCase().includes(searchLower) ||
          org.subdomain.toLowerCase().includes(searchLower) ||
          (org.display_name && org.display_name.toLowerCase().includes(searchLower))
      );
    }

    // Apply sorting
    results.sort((a, b) => {
      let aVal: string | Date;
      let bVal: string | Date;

      switch (sortBy) {
        case 'type':
          aVal = a.type;
          bVal = b.type;
          break;
        case 'created_at':
          aVal = a.created_at;
          bVal = b.created_at;
          break;
        case 'updated_at':
          aVal = a.updated_at;
          bVal = b.updated_at;
          break;
        default:
          aVal = a.name;
          bVal = b.name;
      }

      if (aVal instanceof Date && bVal instanceof Date) {
        return sortOrder === 'asc' ? aVal.getTime() - bVal.getTime() : bVal.getTime() - aVal.getTime();
      }

      const comparison = String(aVal).localeCompare(String(bVal));
      return sortOrder === 'asc' ? comparison : -comparison;
    });

    const totalCount = results.length;
    const totalPages = Math.ceil(totalCount / pageSize);

    // Apply pagination
    const startIndex = (page - 1) * pageSize;
    const paginatedResults = results.slice(startIndex, startIndex + pageSize);

    log.info(`Mock: Returning page ${page} of ${totalPages} (${totalCount} total)`, { options });

    return {
      data: paginatedResults,
      totalCount,
      page,
      pageSize,
      totalPages,
    };
  }
}
