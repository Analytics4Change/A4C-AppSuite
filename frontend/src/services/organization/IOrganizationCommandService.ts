/**
 * Organization Command Service Interface
 *
 * Provides write operations for organization data via dedicated RPC functions.
 * All mutations call backend RPCs which emit domain events and return read-back results.
 *
 * Security: Operations require appropriate permissions checked server-side via JWT claims.
 * Pattern: CQRS — RPCs emit events, handlers update projections, RPCs read back results.
 */

import type {
  OrganizationUpdateData,
  OrganizationOperationResult,
} from '@/types/organization.types';

export interface IOrganizationCommandService {
  /**
   * Updates an organization's editable fields via api.update_organization RPC.
   * Platform owners can edit all fields including `name`.
   * Non-platform-owners get `name` stripped server-side.
   */
  updateOrganization(
    orgId: string,
    data: OrganizationUpdateData,
    reason?: string
  ): Promise<OrganizationOperationResult>;

  /**
   * Deactivates an organization (platform owner only).
   * Sets is_active=false, JWT hook will block users on next token refresh (~1hr).
   */
  deactivateOrganization(orgId: string, reason?: string): Promise<OrganizationOperationResult>;

  /**
   * Reactivates a deactivated organization (platform owner only).
   * Clears deactivated_at/deactivation_reason, restores user access.
   */
  reactivateOrganization(orgId: string): Promise<OrganizationOperationResult>;

  /**
   * Deletes a deactivated organization (platform owner only).
   * Org must be deactivated first. Sets deleted_at/deletion_reason.
   * Temporal workflow handles async cleanup (DNS, users, invitations).
   */
  deleteOrganization(orgId: string, reason?: string): Promise<OrganizationOperationResult>;
}
