/**
 * Supabase Client Service
 *
 * Production implementation using api.* schema RPC functions.
 * Follows CQRS pattern: all queries via api schema RPCs.
 */

import { supabaseService } from '@/services/auth/supabase.service';
import { throwIfPostgrestError } from '@/services/api/envelope';
import { Logger } from '@/utils/logger';
import type {
  Client,
  ClientListItem,
  ClientPhone,
  ClientEmail,
  ClientAddress,
  ClientInsurancePolicy,
  ClientFundingSource,
  ClientProjectionRow,
  ClientUpdateResult,
  ClientPhoneResult,
  ClientEmailResult,
  ClientAddressResult,
  ClientInsuranceResult,
  ClientFundingResult,
  ClientPlacementResult,
  ClientAssignmentResult,
  ClientVoidResult,
  RegisterClientParams,
  UpdateClientParams,
  AdmitClientParams,
  DischargeClientParams,
  AddPhoneParams,
  UpdatePhoneParams,
  AddEmailParams,
  UpdateEmailParams,
  AddAddressParams,
  UpdateAddressParams,
  AddInsuranceParams,
  UpdateInsuranceParams,
  ChangePlacementParams,
  AddFundingSourceParams,
  UpdateFundingSourceParams,
} from '@/types/client.types';
import type { IClientService } from './IClientService';

const log = Logger.getLogger('api');

export class SupabaseClientService implements IClientService {
  // ---------------------------------------------------------------------------
  // Queries (throw on failure — pre-migration listClients/getClient contract)
  // ---------------------------------------------------------------------------

  async listClients(status?: string, searchTerm?: string): Promise<ClientListItem[]> {
    log.debug('Listing clients', { status, searchTerm });

    const env = await supabaseService.apiRpcEnvelope<{ data?: ClientListItem[] }>('list_clients', {
      p_status: status ?? null,
      p_search_term: searchTerm ?? null,
    });

    throwIfPostgrestError(env, 'list clients');
    if (!env.success) throw new Error(env.error ?? 'Failed to list clients');
    return env.data ?? [];
  }

  async getClient(clientId: string): Promise<Client> {
    log.debug('Getting client', { clientId });

    const env = await supabaseService.apiRpcEnvelope<{ data?: Client }>('get_client', {
      p_client_id: clientId,
    });

    throwIfPostgrestError(env, 'get client');
    if (!env.success) throw new Error(env.error ?? 'Failed to get client');
    if (!env.data) throw new Error('Client not found');
    return env.data;
  }

  // ---------------------------------------------------------------------------
  // Lifecycle (return on failure)
  // ---------------------------------------------------------------------------

  async registerClient(params: RegisterClientParams): Promise<ClientUpdateResult> {
    log.debug('Registering client');

    const env = await supabaseService.apiRpcEnvelope<{
      client_id?: string;
      client?: ClientProjectionRow;
    }>('register_client', {
      p_client_data: JSON.stringify(params.client_data),
      p_reason: params.reason ?? 'Client registered',
      p_correlation_id: params.correlation_id ?? null,
    });

    if (!env.success) return { success: false, error: env.error };
    return { success: true, client_id: env.client_id, client: env.client };
  }

  async updateClient(clientId: string, params: UpdateClientParams): Promise<ClientUpdateResult> {
    log.debug('Updating client', { clientId });

    const env = await supabaseService.apiRpcEnvelope<{
      client_id?: string;
      client?: ClientProjectionRow;
    }>('update_client', {
      p_client_id: clientId,
      p_changes: JSON.stringify(params.changes),
      p_reason: params.reason ?? 'Client information updated',
    });

    if (!env.success) return { success: false, error: env.error };

    // Fallback: if RPC returned success without the projection row, refetch via getClient
    // to keep the consumer's optimistic-update path populated.
    let client = env.client;
    if (!client) {
      try {
        // getClient returns the read-model `Client` type; assign through unknown
        // because ClientUpdateResult.client is typed against ClientProjectionRow.
        // Preserves pre-migration behavior verbatim.
        client = (await this.getClient(clientId)) as unknown as ClientProjectionRow;
      } catch (err) {
        log.warn('Failed to refetch client after update fallback', { err });
      }
    }

    return { success: true, client_id: env.client_id, client };
  }

  async admitClient(clientId: string, params?: AdmitClientParams): Promise<ClientUpdateResult> {
    log.debug('Admitting client', { clientId });

    const env = await supabaseService.apiRpcEnvelope<{
      client_id?: string;
      client?: ClientProjectionRow;
    }>('admit_client', {
      p_client_id: clientId,
      p_admission_data: JSON.stringify(params?.admission_data ?? {}),
      p_reason: params?.reason ?? 'Client admitted',
    });

    if (!env.success) return { success: false, error: env.error };
    return { success: true, client_id: env.client_id, client: env.client };
  }

  async dischargeClient(
    clientId: string,
    params: DischargeClientParams
  ): Promise<ClientUpdateResult> {
    log.debug('Discharging client', { clientId });

    const dischargeData: Record<string, unknown> = {
      discharge_date: params.discharge_date,
      discharge_outcome: params.discharge_outcome,
      discharge_reason: params.discharge_reason,
    };
    if (params.discharge_diagnosis) dischargeData.discharge_diagnosis = params.discharge_diagnosis;
    if (params.discharge_placement) dischargeData.discharge_placement = params.discharge_placement;

    const env = await supabaseService.apiRpcEnvelope<{
      client_id?: string;
      client?: ClientProjectionRow;
    }>('discharge_client', {
      p_client_id: clientId,
      p_discharge_data: JSON.stringify(dischargeData),
      p_reason: params.reason ?? 'Client discharged',
    });

    if (!env.success) return { success: false, error: env.error };
    return { success: true, client_id: env.client_id, client: env.client };
  }

  // ---------------------------------------------------------------------------
  // Phone
  // ---------------------------------------------------------------------------

  async addClientPhone(clientId: string, params: AddPhoneParams): Promise<ClientPhoneResult> {
    const env = await supabaseService.apiRpcEnvelope<{ phone_id?: string; phone?: ClientPhone }>(
      'add_client_phone',
      {
        p_client_id: clientId,
        p_phone_number: params.phone_number,
        p_phone_type: params.phone_type ?? 'mobile',
        p_is_primary: params.is_primary ?? false,
        p_reason: params.reason ?? 'Phone added',
        p_correlation_id: params.correlation_id ?? null,
      }
    );

    if (!env.success) return { success: false, error: env.error };
    return { success: true, phone_id: env.phone_id, phone: env.phone };
  }

  async updateClientPhone(
    clientId: string,
    phoneId: string,
    params: UpdatePhoneParams
  ): Promise<ClientPhoneResult> {
    const env = await supabaseService.apiRpcEnvelope<{ phone_id?: string; phone?: ClientPhone }>(
      'update_client_phone',
      {
        p_client_id: clientId,
        p_phone_id: phoneId,
        p_phone_number: params.phone_number ?? null,
        p_phone_type: params.phone_type ?? null,
        p_is_primary: params.is_primary ?? null,
        p_reason: params.reason ?? 'Phone updated',
      }
    );

    if (!env.success) return { success: false, error: env.error };
    return { success: true, phone_id: env.phone_id, phone: env.phone };
  }

  async removeClientPhone(
    clientId: string,
    phoneId: string,
    reason?: string
  ): Promise<ClientVoidResult> {
    const env = await supabaseService.apiRpcEnvelope('remove_client_phone', {
      p_client_id: clientId,
      p_phone_id: phoneId,
      p_reason: reason ?? 'Phone removed',
    });

    if (!env.success) return { success: false, error: env.error };
    return { success: true };
  }

  // ---------------------------------------------------------------------------
  // Email
  // ---------------------------------------------------------------------------

  async addClientEmail(clientId: string, params: AddEmailParams): Promise<ClientEmailResult> {
    const env = await supabaseService.apiRpcEnvelope<{ email_id?: string; email?: ClientEmail }>(
      'add_client_email',
      {
        p_client_id: clientId,
        p_email: params.email,
        p_email_type: params.email_type ?? 'personal',
        p_is_primary: params.is_primary ?? false,
        p_reason: params.reason ?? 'Email added',
        p_correlation_id: params.correlation_id ?? null,
      }
    );

    if (!env.success) return { success: false, error: env.error };
    return { success: true, email_id: env.email_id, email: env.email };
  }

  async updateClientEmail(
    clientId: string,
    emailId: string,
    params: UpdateEmailParams
  ): Promise<ClientEmailResult> {
    const env = await supabaseService.apiRpcEnvelope<{ email_id?: string; email?: ClientEmail }>(
      'update_client_email',
      {
        p_client_id: clientId,
        p_email_id: emailId,
        p_email: params.email ?? null,
        p_email_type: params.email_type ?? null,
        p_is_primary: params.is_primary ?? null,
        p_reason: params.reason ?? 'Email updated',
      }
    );

    if (!env.success) return { success: false, error: env.error };
    return { success: true, email_id: env.email_id, email: env.email };
  }

  async removeClientEmail(
    clientId: string,
    emailId: string,
    reason?: string
  ): Promise<ClientVoidResult> {
    const env = await supabaseService.apiRpcEnvelope('remove_client_email', {
      p_client_id: clientId,
      p_email_id: emailId,
      p_reason: reason ?? 'Email removed',
    });

    if (!env.success) return { success: false, error: env.error };
    return { success: true };
  }

  // ---------------------------------------------------------------------------
  // Address
  // ---------------------------------------------------------------------------

  async addClientAddress(clientId: string, params: AddAddressParams): Promise<ClientAddressResult> {
    const env = await supabaseService.apiRpcEnvelope<{
      address_id?: string;
      address?: ClientAddress;
    }>('add_client_address', {
      p_client_id: clientId,
      p_street1: params.street1,
      p_city: params.city,
      p_state: params.state,
      p_zip: params.zip,
      p_address_type: params.address_type ?? 'home',
      p_street2: params.street2 ?? null,
      p_country: params.country ?? 'US',
      p_is_primary: params.is_primary ?? false,
      p_reason: params.reason ?? 'Address added',
      p_correlation_id: params.correlation_id ?? null,
    });

    if (!env.success) return { success: false, error: env.error };
    return { success: true, address_id: env.address_id, address: env.address };
  }

  async updateClientAddress(
    clientId: string,
    addressId: string,
    params: UpdateAddressParams
  ): Promise<ClientAddressResult> {
    const env = await supabaseService.apiRpcEnvelope<{
      address_id?: string;
      address?: ClientAddress;
    }>('update_client_address', {
      p_client_id: clientId,
      p_address_id: addressId,
      p_address_type: params.address_type ?? null,
      p_street1: params.street1 ?? null,
      p_street2: params.street2 ?? null,
      p_city: params.city ?? null,
      p_state: params.state ?? null,
      p_zip: params.zip ?? null,
      p_country: params.country ?? null,
      p_is_primary: params.is_primary ?? null,
      p_reason: params.reason ?? 'Address updated',
    });

    if (!env.success) return { success: false, error: env.error };
    return { success: true, address_id: env.address_id, address: env.address };
  }

  async removeClientAddress(
    clientId: string,
    addressId: string,
    reason?: string
  ): Promise<ClientVoidResult> {
    const env = await supabaseService.apiRpcEnvelope('remove_client_address', {
      p_client_id: clientId,
      p_address_id: addressId,
      p_reason: reason ?? 'Address removed',
    });

    if (!env.success) return { success: false, error: env.error };
    return { success: true };
  }

  // ---------------------------------------------------------------------------
  // Insurance
  // ---------------------------------------------------------------------------

  async addClientInsurance(
    clientId: string,
    params: AddInsuranceParams
  ): Promise<ClientInsuranceResult> {
    const env = await supabaseService.apiRpcEnvelope<{
      policy_id?: string;
      policy?: ClientInsurancePolicy;
    }>('add_client_insurance', {
      p_client_id: clientId,
      p_policy_type: params.policy_type,
      p_payer_name: params.payer_name,
      p_policy_number: params.policy_number ?? null,
      p_group_number: params.group_number ?? null,
      p_subscriber_name: params.subscriber_name ?? null,
      p_subscriber_relation: params.subscriber_relation ?? null,
      p_coverage_start_date: params.coverage_start_date ?? null,
      p_coverage_end_date: params.coverage_end_date ?? null,
      p_reason: params.reason ?? 'Insurance added',
      p_correlation_id: params.correlation_id ?? null,
    });

    if (!env.success) return { success: false, error: env.error };
    return { success: true, policy_id: env.policy_id, policy: env.policy };
  }

  async updateClientInsurance(
    clientId: string,
    policyId: string,
    params: UpdateInsuranceParams
  ): Promise<ClientInsuranceResult> {
    const env = await supabaseService.apiRpcEnvelope<{
      policy_id?: string;
      policy?: ClientInsurancePolicy;
    }>('update_client_insurance', {
      p_client_id: clientId,
      p_policy_id: policyId,
      p_payer_name: params.payer_name ?? null,
      p_policy_number: params.policy_number ?? null,
      p_group_number: params.group_number ?? null,
      p_subscriber_name: params.subscriber_name ?? null,
      p_subscriber_relation: params.subscriber_relation ?? null,
      p_coverage_start_date: params.coverage_start_date ?? null,
      p_coverage_end_date: params.coverage_end_date ?? null,
      p_reason: params.reason ?? 'Insurance updated',
    });

    if (!env.success) return { success: false, error: env.error };
    return { success: true, policy_id: env.policy_id, policy: env.policy };
  }

  async removeClientInsurance(
    clientId: string,
    policyId: string,
    reason?: string
  ): Promise<ClientVoidResult> {
    const env = await supabaseService.apiRpcEnvelope('remove_client_insurance', {
      p_client_id: clientId,
      p_policy_id: policyId,
      p_reason: reason ?? 'Insurance removed',
    });

    if (!env.success) return { success: false, error: env.error };
    return { success: true };
  }

  // ---------------------------------------------------------------------------
  // Placement
  // ---------------------------------------------------------------------------

  async changeClientPlacement(
    clientId: string,
    params: ChangePlacementParams
  ): Promise<ClientPlacementResult> {
    const env = await supabaseService.apiRpcEnvelope<{ placement_id?: string }>(
      'change_client_placement',
      {
        p_client_id: clientId,
        p_placement_arrangement: params.placement_arrangement,
        p_start_date: params.start_date,
        p_reason: params.reason ?? 'Placement changed',
        p_correlation_id: params.correlation_id ?? null,
        p_organization_unit_id: params.organization_unit_id ?? null,
      }
    );

    if (!env.success) return { success: false, error: env.error };
    return { success: true, placement_id: env.placement_id };
  }

  async endClientPlacement(
    clientId: string,
    endDate?: string,
    reasonText?: string
  ): Promise<ClientPlacementResult> {
    const env = await supabaseService.apiRpcEnvelope<{ placement_id?: string }>(
      'end_client_placement',
      {
        p_client_id: clientId,
        p_end_date: endDate ?? null,
        p_reason_text: reasonText ?? null,
        p_reason: 'Placement ended',
      }
    );

    if (!env.success) return { success: false, error: env.error };
    return { success: true, placement_id: env.placement_id };
  }

  // ---------------------------------------------------------------------------
  // Funding Source
  // ---------------------------------------------------------------------------

  async addClientFundingSource(
    clientId: string,
    params: AddFundingSourceParams
  ): Promise<ClientFundingResult> {
    const env = await supabaseService.apiRpcEnvelope<{
      funding_source_id?: string;
      funding_source?: ClientFundingSource;
    }>('add_client_funding_source', {
      p_client_id: clientId,
      p_source_type: params.source_type,
      p_source_name: params.source_name,
      p_reference_number: params.reference_number ?? null,
      p_start_date: params.start_date ?? null,
      p_end_date: params.end_date ?? null,
      p_custom_fields: JSON.stringify(params.custom_fields ?? {}),
      p_reason: params.reason ?? 'Funding source added',
      p_correlation_id: params.correlation_id ?? null,
    });

    if (!env.success) return { success: false, error: env.error };
    return {
      success: true,
      funding_source_id: env.funding_source_id,
      funding_source: env.funding_source,
    };
  }

  async updateClientFundingSource(
    clientId: string,
    sourceId: string,
    params: UpdateFundingSourceParams
  ): Promise<ClientFundingResult> {
    const env = await supabaseService.apiRpcEnvelope<{
      funding_source_id?: string;
      funding_source?: ClientFundingSource;
    }>('update_client_funding_source', {
      p_client_id: clientId,
      p_funding_source_id: sourceId,
      p_source_type: params.source_type ?? null,
      p_source_name: params.source_name ?? null,
      p_reference_number: params.reference_number ?? null,
      p_start_date: params.start_date ?? null,
      p_end_date: params.end_date ?? null,
      p_custom_fields: params.custom_fields ? JSON.stringify(params.custom_fields) : null,
      p_reason: params.reason ?? 'Funding source updated',
    });

    if (!env.success) return { success: false, error: env.error };
    return {
      success: true,
      funding_source_id: env.funding_source_id,
      funding_source: env.funding_source,
    };
  }

  async removeClientFundingSource(
    clientId: string,
    sourceId: string,
    reason?: string
  ): Promise<ClientVoidResult> {
    const env = await supabaseService.apiRpcEnvelope('remove_client_funding_source', {
      p_client_id: clientId,
      p_funding_source_id: sourceId,
      p_reason: reason ?? 'Funding source removed',
    });

    if (!env.success) return { success: false, error: env.error };
    return { success: true };
  }

  // ---------------------------------------------------------------------------
  // Contact Assignment
  // ---------------------------------------------------------------------------

  async assignClientContact(
    clientId: string,
    contactId: string,
    designation: string,
    reason?: string
  ): Promise<ClientAssignmentResult> {
    const env = await supabaseService.apiRpcEnvelope<{ assignment_id?: string }>(
      'assign_client_contact',
      {
        p_client_id: clientId,
        p_contact_id: contactId,
        p_designation: designation,
        p_reason: reason ?? 'Contact assigned',
      }
    );

    if (!env.success) return { success: false, error: env.error };
    return { success: true, assignment_id: env.assignment_id };
  }

  async unassignClientContact(
    clientId: string,
    contactId: string,
    designation: string,
    reason?: string
  ): Promise<ClientAssignmentResult> {
    const env = await supabaseService.apiRpcEnvelope<{ assignment_id?: string }>(
      'unassign_client_contact',
      {
        p_client_id: clientId,
        p_contact_id: contactId,
        p_designation: designation,
        p_reason: reason ?? 'Contact unassigned',
      }
    );

    if (!env.success) return { success: false, error: env.error };
    return { success: true, assignment_id: env.assignment_id };
  }
}
