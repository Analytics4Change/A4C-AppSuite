/**
 * Mock Organization Entity Service
 *
 * Development/testing implementation of IOrganizationEntityService.
 * Manages contacts, addresses, and phones in memory.
 */

import { Logger } from '@/utils/logger';
import type {
  OrganizationEntityResult,
  OrganizationContact,
  OrganizationAddress,
  OrganizationPhone,
  ContactData,
  AddressData,
  PhoneData,
} from '@/types/organization.types';
import type { IOrganizationEntityService } from './IOrganizationEntityService';

const log = Logger.getLogger('api');

const now = () => new Date().toISOString();

export class MockOrganizationEntityService implements IOrganizationEntityService {
  private contacts: OrganizationContact[] = [
    {
      id: 'mock-contact-1',
      label: 'Billing Contact',
      type: 'billing',
      first_name: 'Jane',
      last_name: 'Smith',
      email: 'jane.smith@abc-healthcare.com',
      title: 'CFO',
      department: 'Finance',
      is_primary: true,
      is_active: true,
      user_id: null,
      created_at: '2024-02-01T00:00:00Z',
      updated_at: '2024-02-01T00:00:00Z',
    },
    {
      id: 'mock-contact-2',
      label: 'Provider Admin',
      type: 'administrative',
      first_name: 'John',
      last_name: 'Doe',
      email: 'john.doe@abc-healthcare.com',
      title: 'Administrator',
      department: 'Operations',
      is_primary: false,
      is_active: true,
      user_id: null,
      created_at: '2024-02-01T00:00:00Z',
      updated_at: '2024-02-01T00:00:00Z',
    },
  ];

  private addresses: OrganizationAddress[] = [
    {
      id: 'mock-address-1',
      label: 'Headquarters',
      type: 'physical',
      street1: '123 Healthcare Blvd',
      street2: 'Suite 400',
      city: 'Los Angeles',
      state: 'CA',
      zip_code: '90001',
      country: 'US',
      is_primary: true,
      is_active: true,
      created_at: '2024-02-01T00:00:00Z',
      updated_at: '2024-02-01T00:00:00Z',
    },
  ];

  private phones: OrganizationPhone[] = [
    {
      id: 'mock-phone-1',
      label: 'Main Office',
      type: 'office',
      number: '(555) 123-4567',
      extension: null,
      country_code: '+1',
      is_primary: true,
      is_active: true,
      created_at: '2024-02-01T00:00:00Z',
      updated_at: '2024-02-01T00:00:00Z',
    },
  ];

  private async simulateDelay(): Promise<void> {
    if (import.meta.env.MODE === 'test') return;
    await new Promise((resolve) => setTimeout(resolve, Math.random() * 200 + 100));
  }

  // Contact CRUD
  async createContact(_orgId: string, data: ContactData): Promise<OrganizationEntityResult> {
    await this.simulateDelay();
    const contact: OrganizationContact = {
      id: `mock-contact-${Date.now()}`,
      ...data,
      title: data.title ?? null,
      department: data.department ?? null,
      is_primary: data.is_primary ?? false,
      is_active: true,
      user_id: null,
      created_at: now(),
      updated_at: now(),
    };
    this.contacts.push(contact);
    log.info('Mock: Contact created', { contact });
    return { success: true, contact };
  }

  async updateContact(
    contactId: string,
    data: Partial<ContactData>
  ): Promise<OrganizationEntityResult> {
    await this.simulateDelay();
    const idx = this.contacts.findIndex((c) => c.id === contactId);
    if (idx === -1) return { success: false, error: 'Contact not found' };
    this.contacts[idx] = { ...this.contacts[idx], ...data, updated_at: now() };
    log.info('Mock: Contact updated', { contactId, data });
    return { success: true, contact: this.contacts[idx] };
  }

  async deleteContact(contactId: string): Promise<OrganizationEntityResult> {
    await this.simulateDelay();
    const idx = this.contacts.findIndex((c) => c.id === contactId);
    if (idx === -1) return { success: false, error: 'Contact not found' };
    const [removed] = this.contacts.splice(idx, 1);
    log.info('Mock: Contact deleted', { contactId });
    return { success: true, contact: removed };
  }

  // Address CRUD
  async createAddress(_orgId: string, data: AddressData): Promise<OrganizationEntityResult> {
    await this.simulateDelay();
    const address: OrganizationAddress = {
      id: `mock-address-${Date.now()}`,
      ...data,
      street2: data.street2 ?? null,
      country: data.country ?? null,
      is_primary: data.is_primary ?? false,
      is_active: true,
      created_at: now(),
      updated_at: now(),
    };
    this.addresses.push(address);
    log.info('Mock: Address created', { address });
    return { success: true, address };
  }

  async updateAddress(
    addressId: string,
    data: Partial<AddressData>
  ): Promise<OrganizationEntityResult> {
    await this.simulateDelay();
    const idx = this.addresses.findIndex((a) => a.id === addressId);
    if (idx === -1) return { success: false, error: 'Address not found' };
    this.addresses[idx] = { ...this.addresses[idx], ...data, updated_at: now() };
    log.info('Mock: Address updated', { addressId, data });
    return { success: true, address: this.addresses[idx] };
  }

  async deleteAddress(addressId: string): Promise<OrganizationEntityResult> {
    await this.simulateDelay();
    const idx = this.addresses.findIndex((a) => a.id === addressId);
    if (idx === -1) return { success: false, error: 'Address not found' };
    const [removed] = this.addresses.splice(idx, 1);
    log.info('Mock: Address deleted', { addressId });
    return { success: true, address: removed };
  }

  // Phone CRUD
  async createPhone(_orgId: string, data: PhoneData): Promise<OrganizationEntityResult> {
    await this.simulateDelay();
    const phone: OrganizationPhone = {
      id: `mock-phone-${Date.now()}`,
      ...data,
      extension: data.extension ?? null,
      country_code: data.country_code ?? null,
      is_primary: data.is_primary ?? false,
      is_active: true,
      created_at: now(),
      updated_at: now(),
    };
    this.phones.push(phone);
    log.info('Mock: Phone created', { phone });
    return { success: true, phone };
  }

  async updatePhone(phoneId: string, data: Partial<PhoneData>): Promise<OrganizationEntityResult> {
    await this.simulateDelay();
    const idx = this.phones.findIndex((p) => p.id === phoneId);
    if (idx === -1) return { success: false, error: 'Phone not found' };
    this.phones[idx] = { ...this.phones[idx], ...data, updated_at: now() };
    log.info('Mock: Phone updated', { phoneId, data });
    return { success: true, phone: this.phones[idx] };
  }

  async deletePhone(phoneId: string): Promise<OrganizationEntityResult> {
    await this.simulateDelay();
    const idx = this.phones.findIndex((p) => p.id === phoneId);
    if (idx === -1) return { success: false, error: 'Phone not found' };
    const [removed] = this.phones.splice(idx, 1);
    log.info('Mock: Phone deleted', { phoneId });
    return { success: true, phone: removed };
  }

  /** Expose mock data for MockOrganizationQueryService.getOrganizationDetails */
  getContacts(): OrganizationContact[] {
    return this.contacts;
  }
  getAddresses(): OrganizationAddress[] {
    return this.addresses;
  }
  getPhones(): OrganizationPhone[] {
    return this.phones;
  }
}
