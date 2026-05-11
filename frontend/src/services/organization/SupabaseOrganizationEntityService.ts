/**
 * Supabase Organization Entity Service
 *
 * Production implementation of IOrganizationEntityService.
 * Each method calls a dedicated RPC for contact/address/phone CRUD.
 */

import { supabaseService } from '@/services/auth/supabase.service';
import { Logger } from '@/utils/logger';
import type { EnvelopeRpcs } from '@/services/api/rpc-registry.generated';
import type {
  OrganizationEntityResult,
  ContactData,
  AddressData,
  PhoneData,
} from '@/types/organization.types';
import type { IOrganizationEntityService } from './IOrganizationEntityService';

const log = Logger.getLogger('api');

/**
 * Envelope shape returned by every `api.{create,update,delete}_organization_{contact,address,phone}` RPC.
 *
 * `apiRpcEnvelope<T>` spreads success-path fields onto `{success: true}` (intersection-type contract).
 * On failure, returns `{success: false, error: string, ...}` with `error` already masked.
 */
type OrganizationEntityRpcSuccess = {
  contact?: unknown;
  address?: unknown;
  phone?: unknown;
};

export class SupabaseOrganizationEntityService implements IOrganizationEntityService {
  // ---------------------------------------------------------------------------
  // Contact CRUD
  // ---------------------------------------------------------------------------

  async createContact(orgId: string, data: ContactData): Promise<OrganizationEntityResult> {
    return this.callEntityRpc('create_organization_contact', { p_org_id: orgId, p_data: data });
  }

  async updateContact(
    contactId: string,
    data: Partial<ContactData>
  ): Promise<OrganizationEntityResult> {
    return this.callEntityRpc('update_organization_contact', {
      p_contact_id: contactId,
      p_data: data,
    });
  }

  async deleteContact(contactId: string, reason?: string): Promise<OrganizationEntityResult> {
    return this.callEntityRpc('delete_organization_contact', {
      p_contact_id: contactId,
      p_reason: reason ?? null,
    });
  }

  // ---------------------------------------------------------------------------
  // Address CRUD
  // ---------------------------------------------------------------------------

  async createAddress(orgId: string, data: AddressData): Promise<OrganizationEntityResult> {
    return this.callEntityRpc('create_organization_address', { p_org_id: orgId, p_data: data });
  }

  async updateAddress(
    addressId: string,
    data: Partial<AddressData>
  ): Promise<OrganizationEntityResult> {
    return this.callEntityRpc('update_organization_address', {
      p_address_id: addressId,
      p_data: data,
    });
  }

  async deleteAddress(addressId: string, reason?: string): Promise<OrganizationEntityResult> {
    return this.callEntityRpc('delete_organization_address', {
      p_address_id: addressId,
      p_reason: reason ?? null,
    });
  }

  // ---------------------------------------------------------------------------
  // Phone CRUD
  // ---------------------------------------------------------------------------

  async createPhone(orgId: string, data: PhoneData): Promise<OrganizationEntityResult> {
    return this.callEntityRpc('create_organization_phone', { p_org_id: orgId, p_data: data });
  }

  async updatePhone(phoneId: string, data: Partial<PhoneData>): Promise<OrganizationEntityResult> {
    return this.callEntityRpc('update_organization_phone', {
      p_phone_id: phoneId,
      p_data: data,
    });
  }

  async deletePhone(phoneId: string, reason?: string): Promise<OrganizationEntityResult> {
    return this.callEntityRpc('delete_organization_phone', {
      p_phone_id: phoneId,
      p_reason: reason ?? null,
    });
  }

  // ---------------------------------------------------------------------------
  // Shared RPC caller
  // ---------------------------------------------------------------------------

  // rpcName is narrowed to EnvelopeRpcs — calling with a name not in the registry
  // is a TypeScript compile error at the caller.
  private async callEntityRpc(
    rpcName: EnvelopeRpcs,
    params: Record<string, unknown>
  ): Promise<OrganizationEntityResult> {
    try {
      log.debug(`Calling ${rpcName}`, params);

      const env = await supabaseService.apiRpcEnvelope<OrganizationEntityRpcSuccess>(
        rpcName,
        params
      );

      if (!env.success) {
        log.warn(`${rpcName} returned failure`, { error: env.error });
        return { success: false, error: env.error };
      }

      log.info(`${rpcName} succeeded`);
      return {
        success: true,
        contact: env.contact as OrganizationEntityResult['contact'],
        address: env.address as OrganizationEntityResult['address'],
        phone: env.phone as OrganizationEntityResult['phone'],
      };
    } catch (error) {
      log.error(`Error in ${rpcName}`, { error, params });
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }
}
