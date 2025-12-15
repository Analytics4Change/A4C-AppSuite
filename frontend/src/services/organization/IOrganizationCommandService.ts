/**
 * Organization Command Service Interface
 *
 * Provides write operations for organization data using event-driven pattern.
 * All mutations emit domain events that PostgreSQL triggers process to update projections.
 *
 * Security: Operations require appropriate permissions checked via JWT claims.
 * Pattern: CQRS - Commands emit events, never write directly to projection tables.
 */

import type { OrganizationUpdateData } from '@/types/organization.types';

export interface IOrganizationCommandService {
  /**
   * Updates an organization's editable fields via domain event
   *
   * Emits `organization.updated` event which is processed by:
   * - infrastructure/supabase/sql/03-functions/event-processing/002-process-organization-events.sql
   *
   * @param orgId - Organization UUID to update
   * @param data - Fields to update (name, display_name, timezone)
   * @param reason - Audit reason for the change
   * @returns Promise that resolves when event is emitted
   * @throws Error if event emission fails
   *
   * @example
   * await commandService.updateOrganization(
   *   'c8e1ed15-5b2d-49d5-a190-db7461469cfb',
   *   { name: 'New Name', timezone: 'America/Chicago' },
   *   'Admin updated organization settings'
   * );
   */
  updateOrganization(orgId: string, data: OrganizationUpdateData, reason: string): Promise<void>;
}
