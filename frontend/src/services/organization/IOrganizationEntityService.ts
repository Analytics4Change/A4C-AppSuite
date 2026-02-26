/**
 * Organization Entity Service Interface
 *
 * Provides CRUD operations for organization child entities:
 * contacts, addresses, and phones. Each operation calls a dedicated
 * backend RPC that handles permission checks and event emission.
 */

import type {
  OrganizationEntityResult,
  ContactData,
  AddressData,
  PhoneData,
} from '@/types/organization.types';

export interface IOrganizationEntityService {
  // Contact CRUD
  createContact(orgId: string, data: ContactData): Promise<OrganizationEntityResult>;
  updateContact(contactId: string, data: Partial<ContactData>): Promise<OrganizationEntityResult>;
  deleteContact(contactId: string, reason?: string): Promise<OrganizationEntityResult>;

  // Address CRUD
  createAddress(orgId: string, data: AddressData): Promise<OrganizationEntityResult>;
  updateAddress(addressId: string, data: Partial<AddressData>): Promise<OrganizationEntityResult>;
  deleteAddress(addressId: string, reason?: string): Promise<OrganizationEntityResult>;

  // Phone CRUD
  createPhone(orgId: string, data: PhoneData): Promise<OrganizationEntityResult>;
  updatePhone(phoneId: string, data: Partial<PhoneData>): Promise<OrganizationEntityResult>;
  deletePhone(phoneId: string, reason?: string): Promise<OrganizationEntityResult>;
}
