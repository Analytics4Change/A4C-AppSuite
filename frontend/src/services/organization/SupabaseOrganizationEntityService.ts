/**
 * Supabase Organization Entity Service
 *
 * Production implementation of IOrganizationEntityService.
 * Each method calls a dedicated RPC for contact/address/phone CRUD.
 */

import { supabase } from '@/lib/supabase';
import { Logger } from '@/utils/logger';
import type {
  OrganizationEntityResult,
  ContactData,
  AddressData,
  PhoneData,
} from '@/types/organization.types';
import type { IOrganizationEntityService } from './IOrganizationEntityService';

const log = Logger.getLogger('api');

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

  private async callEntityRpc(
    rpcName: string,
    params: Record<string, unknown>
  ): Promise<OrganizationEntityResult> {
    try {
      log.debug(`Calling ${rpcName}`, params);

      const { data: result, error } = await supabase.schema('api').rpc(rpcName, params);

      if (error) {
        log.error(`Failed to call ${rpcName}`, { error, params });
        return { success: false, error: error.message };
      }

      if (!result?.success) {
        log.warn(`${rpcName} returned failure`, { result });
        return { success: false, error: result?.error ?? 'Operation failed' };
      }

      log.info(`${rpcName} succeeded`, { result });
      return {
        success: true,
        contact: result.contact,
        address: result.address,
        phone: result.phone,
      };
    } catch (error) {
      log.error(`Error in ${rpcName}`, { error, params });
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }
}
