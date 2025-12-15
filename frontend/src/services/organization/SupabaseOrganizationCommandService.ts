/**
 * Supabase Organization Command Service
 *
 * Production implementation of IOrganizationCommandService using Supabase.
 * All mutations emit domain events via api.emit_domain_event RPC.
 *
 * Pattern: CQRS - Commands emit events, triggers update projections.
 * Contract: infrastructure/supabase/contracts/asyncapi/domains/organization.yaml
 */

import { supabase } from '@/lib/supabase';
import { Logger } from '@/utils/logger';
import type { OrganizationUpdateData } from '@/types/organization.types';
import type { IOrganizationCommandService } from './IOrganizationCommandService';

const log = Logger.getLogger('api');

export class SupabaseOrganizationCommandService implements IOrganizationCommandService {
  /**
   * Updates an organization via domain event
   *
   * Emits organization.updated event with:
   * - updated_fields: Array of field names that changed
   * - previous_values: Not tracked by frontend (backend handles)
   * - reason: Audit trail for the change
   */
  async updateOrganization(
    orgId: string,
    data: OrganizationUpdateData,
    reason: string
  ): Promise<void> {
    try {
      log.debug('Updating organization via domain event', { orgId, data, reason });

      // Build event data matching AsyncAPI contract
      const updatedFields = Object.keys(data).filter(
        key => data[key as keyof OrganizationUpdateData] !== undefined
      );

      if (updatedFields.length === 0) {
        log.warn('No fields to update', { orgId });
        return;
      }

      const eventData = {
        ...data,
        updated_fields: updatedFields,
        reason,
      };

      // Generate event ID (UUID v4)
      const eventId = globalThis.crypto.randomUUID();

      // Emit domain event via RPC
      const { error } = await supabase.schema('api').rpc('emit_domain_event', {
        p_event_id: eventId,
        p_event_type: 'organization.updated',
        p_aggregate_type: 'organization',
        p_aggregate_id: orgId,
        p_event_data: eventData,
        p_event_metadata: {
          source: 'frontend',
          timestamp: new Date().toISOString(),
        },
      });

      if (error) {
        log.error('Failed to emit organization.updated event', { error, orgId, data });
        throw new Error(`Failed to update organization: ${error.message}`);
      }

      log.info('Organization updated via domain event', {
        orgId,
        eventId,
        updatedFields,
      });
    } catch (error) {
      log.error('Error in updateOrganization', { error, orgId, data });
      throw error;
    }
  }
}
