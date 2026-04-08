/**
 * Contact Info Section — Step 2 of client intake form.
 *
 * Sub-entity collections: phones, emails, addresses.
 * Each collection has add/remove with type selection and is_primary toggle.
 */

import React from 'react';
import { observer } from 'mobx-react-lite';
import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { IntakeSectionProps } from './types';
import {
  PHONE_TYPE_LABELS,
  EMAIL_TYPE_LABELS,
  ADDRESS_TYPE_LABELS,
  type PhoneType,
  type EmailType,
  type AddressType,
} from '@/types/client.types';

const PHONE_TYPE_OPTIONS = Object.entries(PHONE_TYPE_LABELS) as [PhoneType, string][];
const EMAIL_TYPE_OPTIONS = Object.entries(EMAIL_TYPE_LABELS) as [EmailType, string][];
const ADDRESS_TYPE_OPTIONS = Object.entries(ADDRESS_TYPE_LABELS) as [AddressType, string][];

export const ContactInfoSection: React.FC<IntakeSectionProps> = observer(({ viewModel }) => {
  const vm = viewModel;

  // Check if contact sub-entity sections are visible via field definitions
  const isPhoneVisible = vm.visibleFieldKeys.has('client_phones');
  const isEmailVisible = vm.visibleFieldKeys.has('client_emails');
  const isAddressVisible = vm.visibleFieldKeys.has('client_addresses');

  if (!isPhoneVisible && !isEmailVisible && !isAddressVisible) {
    return (
      <div className="text-center py-8 text-gray-500" data-testid="intake-section-contact_info">
        <p>Contact information fields are not enabled for this organization.</p>
      </div>
    );
  }

  return (
    <div className="space-y-8" data-testid="intake-section-contact_info">
      <div>
        <h3 className="text-lg font-semibold text-gray-900">Contact Information</h3>
        <p className="text-sm text-gray-500 mt-1">
          Phone numbers, email addresses, and mailing addresses
        </p>
      </div>

      {/* Phone Numbers */}
      {isPhoneVisible && (
        <div className="space-y-3" data-testid="intake-phones">
          <div className="flex items-center justify-between">
            <Label className="text-sm font-medium text-gray-700">Phone Numbers</Label>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="text-blue-600 hover:text-blue-700"
              onClick={() =>
                vm.addPhone({
                  phone_number: '',
                  phone_type: 'mobile',
                  is_primary: vm.phones.length === 0,
                })
              }
              data-testid="add-phone-btn"
            >
              <Plus size={16} className="mr-1" /> Add Phone
            </Button>
          </div>
          {vm.phones.map((phone, i) => (
            <div key={i} className="flex items-start gap-3 p-3 border rounded-lg bg-gray-50/50">
              <div className="flex-1 grid grid-cols-1 sm:grid-cols-3 gap-3">
                <Input
                  value={phone.phone_number}
                  onChange={(e) => vm.updatePhone(i, { phone_number: e.target.value })}
                  placeholder="(555) 123-4567"
                  data-testid={`phone-number-${i}`}
                />
                <select
                  value={phone.phone_type}
                  onChange={(e) => vm.updatePhone(i, { phone_type: e.target.value as PhoneType })}
                  className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm"
                  data-testid={`phone-type-${i}`}
                >
                  {PHONE_TYPE_OPTIONS.map(([val, lbl]) => (
                    <option key={val} value={val}>
                      {lbl}
                    </option>
                  ))}
                </select>
                <label className="flex items-center gap-2 text-sm text-gray-600">
                  <input
                    type="checkbox"
                    checked={phone.is_primary}
                    onChange={(e) => vm.updatePhone(i, { is_primary: e.target.checked })}
                    className="h-4 w-4 rounded border-gray-300 text-blue-600"
                    data-testid={`phone-primary-${i}`}
                  />
                  Primary
                </label>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="text-red-500 hover:text-red-700"
                onClick={() => vm.removePhone(i)}
                aria-label={`Remove phone ${i + 1}`}
                data-testid={`remove-phone-${i}`}
              >
                <Trash2 size={16} />
              </Button>
            </div>
          ))}
        </div>
      )}

      {/* Email Addresses */}
      {isEmailVisible && (
        <div className="space-y-3" data-testid="intake-emails">
          <div className="flex items-center justify-between">
            <Label className="text-sm font-medium text-gray-700">Email Addresses</Label>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="text-blue-600 hover:text-blue-700"
              onClick={() =>
                vm.addEmail({
                  email: '',
                  email_type: 'personal',
                  is_primary: vm.emails.length === 0,
                })
              }
              data-testid="add-email-btn"
            >
              <Plus size={16} className="mr-1" /> Add Email
            </Button>
          </div>
          {vm.emails.map((email, i) => (
            <div key={i} className="flex items-start gap-3 p-3 border rounded-lg bg-gray-50/50">
              <div className="flex-1 grid grid-cols-1 sm:grid-cols-3 gap-3">
                <Input
                  value={email.email}
                  onChange={(e) => vm.updateEmail(i, { email: e.target.value })}
                  placeholder="email@example.com"
                  type="email"
                  data-testid={`email-address-${i}`}
                />
                <select
                  value={email.email_type}
                  onChange={(e) => vm.updateEmail(i, { email_type: e.target.value as EmailType })}
                  className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm"
                  data-testid={`email-type-${i}`}
                >
                  {EMAIL_TYPE_OPTIONS.map(([val, lbl]) => (
                    <option key={val} value={val}>
                      {lbl}
                    </option>
                  ))}
                </select>
                <label className="flex items-center gap-2 text-sm text-gray-600">
                  <input
                    type="checkbox"
                    checked={email.is_primary}
                    onChange={(e) => vm.updateEmail(i, { is_primary: e.target.checked })}
                    className="h-4 w-4 rounded border-gray-300 text-blue-600"
                    data-testid={`email-primary-${i}`}
                  />
                  Primary
                </label>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="text-red-500 hover:text-red-700"
                onClick={() => vm.removeEmail(i)}
                aria-label={`Remove email ${i + 1}`}
                data-testid={`remove-email-${i}`}
              >
                <Trash2 size={16} />
              </Button>
            </div>
          ))}
        </div>
      )}

      {/* Addresses */}
      {isAddressVisible && (
        <div className="space-y-3" data-testid="intake-addresses">
          <div className="flex items-center justify-between">
            <Label className="text-sm font-medium text-gray-700">Addresses</Label>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="text-blue-600 hover:text-blue-700"
              onClick={() =>
                vm.addAddress({
                  address_type: 'home',
                  street1: '',
                  street2: '',
                  city: '',
                  state: '',
                  zip: '',
                  country: 'US',
                  is_primary: vm.addresses.length === 0,
                })
              }
              data-testid="add-address-btn"
            >
              <Plus size={16} className="mr-1" /> Add Address
            </Button>
          </div>
          {vm.addresses.map((addr, i) => (
            <div key={i} className="p-4 border rounded-lg bg-gray-50/50 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <select
                    value={addr.address_type}
                    onChange={(e) =>
                      vm.updateAddress(i, { address_type: e.target.value as AddressType })
                    }
                    className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm"
                    data-testid={`address-type-${i}`}
                  >
                    {ADDRESS_TYPE_OPTIONS.map(([val, lbl]) => (
                      <option key={val} value={val}>
                        {lbl}
                      </option>
                    ))}
                  </select>
                  <label className="flex items-center gap-2 text-sm text-gray-600">
                    <input
                      type="checkbox"
                      checked={addr.is_primary}
                      onChange={(e) => vm.updateAddress(i, { is_primary: e.target.checked })}
                      className="h-4 w-4 rounded border-gray-300 text-blue-600"
                      data-testid={`address-primary-${i}`}
                    />
                    Primary
                  </label>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="text-red-500 hover:text-red-700"
                  onClick={() => vm.removeAddress(i)}
                  aria-label={`Remove address ${i + 1}`}
                  data-testid={`remove-address-${i}`}
                >
                  <Trash2 size={16} />
                </Button>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Input
                  value={addr.street1}
                  onChange={(e) => vm.updateAddress(i, { street1: e.target.value })}
                  placeholder="Street Address"
                  data-testid={`address-street1-${i}`}
                />
                <Input
                  value={addr.street2}
                  onChange={(e) => vm.updateAddress(i, { street2: e.target.value })}
                  placeholder="Apt, Suite, Unit (optional)"
                  data-testid={`address-street2-${i}`}
                />
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <Input
                  value={addr.city}
                  onChange={(e) => vm.updateAddress(i, { city: e.target.value })}
                  placeholder="City"
                  data-testid={`address-city-${i}`}
                />
                <Input
                  value={addr.state}
                  onChange={(e) => vm.updateAddress(i, { state: e.target.value })}
                  placeholder="State"
                  data-testid={`address-state-${i}`}
                />
                <Input
                  value={addr.zip}
                  onChange={(e) => vm.updateAddress(i, { zip: e.target.value })}
                  placeholder="ZIP"
                  data-testid={`address-zip-${i}`}
                />
                <Input
                  value={addr.country}
                  onChange={(e) => vm.updateAddress(i, { country: e.target.value })}
                  placeholder="Country"
                  data-testid={`address-country-${i}`}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
});
