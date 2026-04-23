/**
 * Supabase Client Service
 *
 * Production implementation using api.* schema RPC functions.
 * Follows CQRS pattern: all queries via api schema RPCs.
 */

import { supabase } from '@/lib/supabase';
import { Logger } from '@/utils/logger';
import type {
  Client,
  ClientListItem,
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

function parseResponse(data: unknown): unknown {
  return typeof data === 'string' ? JSON.parse(data) : data;
}

export class SupabaseClientService implements IClientService {
  // ---------------------------------------------------------------------------
  // Queries
  // ---------------------------------------------------------------------------

  async listClients(status?: string, searchTerm?: string): Promise<ClientListItem[]> {
    log.debug('Listing clients', { status, searchTerm });

    const { data, error } = await supabase.schema('api').rpc('list_clients', {
      p_status: status ?? null,
      p_search_term: searchTerm ?? null,
    });

    if (error) {
      log.error('Failed to list clients', { error });
      throw new Error(`Failed to list clients: ${error.message}`);
    }

    const result = parseResponse(data) as {
      success: boolean;
      data?: ClientListItem[];
      error?: string;
    };
    if (!result.success) throw new Error(result.error ?? 'Failed to list clients');
    return result.data ?? [];
  }

  async getClient(clientId: string): Promise<Client> {
    log.debug('Getting client', { clientId });

    const { data, error } = await supabase.schema('api').rpc('get_client', {
      p_client_id: clientId,
    });

    if (error) {
      log.error('Failed to get client', { error });
      throw new Error(`Failed to get client: ${error.message}`);
    }

    const result = parseResponse(data) as { success: boolean; data?: Client; error?: string };
    if (!result.success) throw new Error(result.error ?? 'Failed to get client');
    if (!result.data) throw new Error('Client not found');
    return result.data;
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  async registerClient(params: RegisterClientParams): Promise<ClientUpdateResult> {
    log.debug('Registering client');

    const { data, error } = await supabase.schema('api').rpc('register_client', {
      p_client_data: JSON.stringify(params.client_data),
      p_reason: params.reason ?? 'Client registered',
      p_correlation_id: params.correlation_id ?? null,
    });

    if (error) {
      log.error('Failed to register client', { error });
      return { success: false, error: error.message };
    }

    return parseResponse(data) as ClientUpdateResult;
  }

  async updateClient(clientId: string, params: UpdateClientParams): Promise<ClientUpdateResult> {
    log.debug('Updating client', { clientId });

    const { data, error } = await supabase.schema('api').rpc('update_client', {
      p_client_id: clientId,
      p_changes: JSON.stringify(params.changes),
      p_reason: params.reason ?? 'Client information updated',
    });

    if (error) {
      log.error('Failed to update client', { error });
      return { success: false, error: error.message };
    }

    const result = parseResponse(data) as ClientUpdateResult;

    if (result.success && !result.client) {
      try {
        result.client = await this.getClient(clientId);
      } catch (err) {
        log.warn('Failed to refetch client after update fallback', { err });
      }
    }

    return result;
  }

  async admitClient(clientId: string, params?: AdmitClientParams): Promise<ClientUpdateResult> {
    log.debug('Admitting client', { clientId });

    const { data, error } = await supabase.schema('api').rpc('admit_client', {
      p_client_id: clientId,
      p_admission_data: JSON.stringify(params?.admission_data ?? {}),
      p_reason: params?.reason ?? 'Client admitted',
    });

    if (error) {
      log.error('Failed to admit client', { error });
      return { success: false, error: error.message };
    }

    return parseResponse(data) as ClientUpdateResult;
  }

  async dischargeClient(clientId: string, params: DischargeClientParams): Promise<ClientUpdateResult> {
    log.debug('Discharging client', { clientId });

    const dischargeData: Record<string, unknown> = {
      discharge_date: params.discharge_date,
      discharge_outcome: params.discharge_outcome,
      discharge_reason: params.discharge_reason,
    };
    if (params.discharge_diagnosis) dischargeData.discharge_diagnosis = params.discharge_diagnosis;
    if (params.discharge_placement) dischargeData.discharge_placement = params.discharge_placement;

    const { data, error } = await supabase.schema('api').rpc('discharge_client', {
      p_client_id: clientId,
      p_discharge_data: JSON.stringify(dischargeData),
      p_reason: params.reason ?? 'Client discharged',
    });

    if (error) {
      log.error('Failed to discharge client', { error });
      return { success: false, error: error.message };
    }

    return parseResponse(data) as ClientUpdateResult;
  }

  // ---------------------------------------------------------------------------
  // Phone
  // ---------------------------------------------------------------------------

  async addClientPhone(clientId: string, params: AddPhoneParams): Promise<ClientPhoneResult> {
    const { data, error } = await supabase.schema('api').rpc('add_client_phone', {
      p_client_id: clientId,
      p_phone_number: params.phone_number,
      p_phone_type: params.phone_type ?? 'mobile',
      p_is_primary: params.is_primary ?? false,
      p_reason: params.reason ?? 'Phone added',
      p_correlation_id: params.correlation_id ?? null,
    });

    if (error) return { success: false, error: error.message };
    return parseResponse(data) as ClientPhoneResult;
  }

  async updateClientPhone(
    clientId: string,
    phoneId: string,
    params: UpdatePhoneParams
  ): Promise<ClientPhoneResult> {
    const { data, error } = await supabase.schema('api').rpc('update_client_phone', {
      p_client_id: clientId,
      p_phone_id: phoneId,
      p_phone_number: params.phone_number ?? null,
      p_phone_type: params.phone_type ?? null,
      p_is_primary: params.is_primary ?? null,
      p_reason: params.reason ?? 'Phone updated',
    });

    if (error) return { success: false, error: error.message };
    return parseResponse(data) as ClientPhoneResult;
  }

  async removeClientPhone(
    clientId: string,
    phoneId: string,
    reason?: string
  ): Promise<ClientVoidResult> {
    const { data, error } = await supabase.schema('api').rpc('remove_client_phone', {
      p_client_id: clientId,
      p_phone_id: phoneId,
      p_reason: reason ?? 'Phone removed',
    });

    if (error) return { success: false, error: error.message };
    return parseResponse(data) as ClientVoidResult;
  }

  // ---------------------------------------------------------------------------
  // Email
  // ---------------------------------------------------------------------------

  async addClientEmail(clientId: string, params: AddEmailParams): Promise<ClientEmailResult> {
    const { data, error } = await supabase.schema('api').rpc('add_client_email', {
      p_client_id: clientId,
      p_email: params.email,
      p_email_type: params.email_type ?? 'personal',
      p_is_primary: params.is_primary ?? false,
      p_reason: params.reason ?? 'Email added',
      p_correlation_id: params.correlation_id ?? null,
    });

    if (error) return { success: false, error: error.message };
    return parseResponse(data) as ClientEmailResult;
  }

  async updateClientEmail(
    clientId: string,
    emailId: string,
    params: UpdateEmailParams
  ): Promise<ClientEmailResult> {
    const { data, error } = await supabase.schema('api').rpc('update_client_email', {
      p_client_id: clientId,
      p_email_id: emailId,
      p_email: params.email ?? null,
      p_email_type: params.email_type ?? null,
      p_is_primary: params.is_primary ?? null,
      p_reason: params.reason ?? 'Email updated',
    });

    if (error) return { success: false, error: error.message };
    return parseResponse(data) as ClientEmailResult;
  }

  async removeClientEmail(
    clientId: string,
    emailId: string,
    reason?: string
  ): Promise<ClientVoidResult> {
    const { data, error } = await supabase.schema('api').rpc('remove_client_email', {
      p_client_id: clientId,
      p_email_id: emailId,
      p_reason: reason ?? 'Email removed',
    });

    if (error) return { success: false, error: error.message };
    return parseResponse(data) as ClientVoidResult;
  }

  // ---------------------------------------------------------------------------
  // Address
  // ---------------------------------------------------------------------------

  async addClientAddress(clientId: string, params: AddAddressParams): Promise<ClientAddressResult> {
    const { data, error } = await supabase.schema('api').rpc('add_client_address', {
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

    if (error) return { success: false, error: error.message };
    return parseResponse(data) as ClientAddressResult;
  }

  async updateClientAddress(
    clientId: string,
    addressId: string,
    params: UpdateAddressParams
  ): Promise<ClientAddressResult> {
    const { data, error } = await supabase.schema('api').rpc('update_client_address', {
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

    if (error) return { success: false, error: error.message };
    return parseResponse(data) as ClientAddressResult;
  }

  async removeClientAddress(
    clientId: string,
    addressId: string,
    reason?: string
  ): Promise<ClientVoidResult> {
    const { data, error } = await supabase.schema('api').rpc('remove_client_address', {
      p_client_id: clientId,
      p_address_id: addressId,
      p_reason: reason ?? 'Address removed',
    });

    if (error) return { success: false, error: error.message };
    return parseResponse(data) as ClientVoidResult;
  }

  // ---------------------------------------------------------------------------
  // Insurance
  // ---------------------------------------------------------------------------

  async addClientInsurance(clientId: string, params: AddInsuranceParams): Promise<ClientInsuranceResult> {
    const { data, error } = await supabase.schema('api').rpc('add_client_insurance', {
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

    if (error) return { success: false, error: error.message };
    return parseResponse(data) as ClientInsuranceResult;
  }

  async updateClientInsurance(
    clientId: string,
    policyId: string,
    params: UpdateInsuranceParams
  ): Promise<ClientInsuranceResult> {
    const { data, error } = await supabase.schema('api').rpc('update_client_insurance', {
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

    if (error) return { success: false, error: error.message };
    return parseResponse(data) as ClientInsuranceResult;
  }

  async removeClientInsurance(
    clientId: string,
    policyId: string,
    reason?: string
  ): Promise<ClientVoidResult> {
    const { data, error } = await supabase.schema('api').rpc('remove_client_insurance', {
      p_client_id: clientId,
      p_policy_id: policyId,
      p_reason: reason ?? 'Insurance removed',
    });

    if (error) return { success: false, error: error.message };
    return parseResponse(data) as ClientVoidResult;
  }

  // ---------------------------------------------------------------------------
  // Placement
  // ---------------------------------------------------------------------------

  async changeClientPlacement(
    clientId: string,
    params: ChangePlacementParams
  ): Promise<ClientPlacementResult> {
    const { data, error } = await supabase.schema('api').rpc('change_client_placement', {
      p_client_id: clientId,
      p_placement_arrangement: params.placement_arrangement,
      p_start_date: params.start_date,
      p_reason: params.reason ?? 'Placement changed',
      p_correlation_id: params.correlation_id ?? null,
      p_organization_unit_id: params.organization_unit_id ?? null,
    });

    if (error) return { success: false, error: error.message };
    return parseResponse(data) as ClientPlacementResult;
  }

  async endClientPlacement(
    clientId: string,
    endDate?: string,
    reasonText?: string
  ): Promise<ClientPlacementResult> {
    const { data, error } = await supabase.schema('api').rpc('end_client_placement', {
      p_client_id: clientId,
      p_end_date: endDate ?? null,
      p_reason_text: reasonText ?? null,
      p_reason: 'Placement ended',
    });

    if (error) return { success: false, error: error.message };
    return parseResponse(data) as ClientPlacementResult;
  }

  // ---------------------------------------------------------------------------
  // Funding Source
  // ---------------------------------------------------------------------------

  async addClientFundingSource(
    clientId: string,
    params: AddFundingSourceParams
  ): Promise<ClientFundingResult> {
    const { data, error } = await supabase.schema('api').rpc('add_client_funding_source', {
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

    if (error) return { success: false, error: error.message };
    return parseResponse(data) as ClientFundingResult;
  }

  async updateClientFundingSource(
    clientId: string,
    sourceId: string,
    params: UpdateFundingSourceParams
  ): Promise<ClientFundingResult> {
    const { data, error } = await supabase.schema('api').rpc('update_client_funding_source', {
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

    if (error) return { success: false, error: error.message };
    return parseResponse(data) as ClientFundingResult;
  }

  async removeClientFundingSource(
    clientId: string,
    sourceId: string,
    reason?: string
  ): Promise<ClientVoidResult> {
    const { data, error } = await supabase.schema('api').rpc('remove_client_funding_source', {
      p_client_id: clientId,
      p_funding_source_id: sourceId,
      p_reason: reason ?? 'Funding source removed',
    });

    if (error) return { success: false, error: error.message };
    return parseResponse(data) as ClientVoidResult;
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
    const { data, error } = await supabase.schema('api').rpc('assign_client_contact', {
      p_client_id: clientId,
      p_contact_id: contactId,
      p_designation: designation,
      p_reason: reason ?? 'Contact assigned',
    });

    if (error) return { success: false, error: error.message };
    return parseResponse(data) as ClientAssignmentResult;
  }

  async unassignClientContact(
    clientId: string,
    contactId: string,
    designation: string,
    reason?: string
  ): Promise<ClientAssignmentResult> {
    const { data, error } = await supabase.schema('api').rpc('unassign_client_contact', {
      p_client_id: clientId,
      p_contact_id: contactId,
      p_designation: designation,
      p_reason: reason ?? 'Contact unassigned',
    });

    if (error) return { success: false, error: error.message };
    return parseResponse(data) as ClientAssignmentResult;
  }
}
