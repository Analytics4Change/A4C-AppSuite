/**
 * Address Card Component
 *
 * Displays a user address as a compact card with edit/remove actions.
 * Supports both global addresses and org-specific overrides.
 *
 * Features:
 * - Glass-morphism styling consistent with design system
 * - Visual distinction between global and org-override addresses
 * - Primary address indicator
 * - Edit and remove action buttons
 * - WCAG 2.1 Level AA compliant
 *
 * @see UserAddress type for data structure
 */

import React from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { MapPin, Edit2, Trash2, Star, Building2 } from 'lucide-react';
import type { UserAddress, AddressType } from '@/types/user.types';
import { Logger } from '@/utils/logger';

const log = Logger.getLogger('component');

/**
 * Props for AddressCard component
 */
export interface AddressCardProps {
  /** The address to display */
  address: UserAddress;

  /** Called when edit action is triggered */
  onEdit?: (addressId: string) => void;

  /** Called when remove action is triggered */
  onRemove?: (addressId: string) => void;

  /** Whether actions are currently loading */
  isLoading?: boolean;

  /** Whether to show action buttons */
  showActions?: boolean;
}

/**
 * Get display label for address type
 */
function getAddressTypeLabel(type: AddressType): string {
  switch (type) {
    case 'physical':
      return 'Physical';
    case 'mailing':
      return 'Mailing';
    case 'billing':
      return 'Billing';
    default:
      return type;
  }
}

/**
 * Get color classes for address type badge
 */
function getAddressTypeBadgeClasses(type: AddressType): string {
  switch (type) {
    case 'physical':
      return 'bg-blue-100 text-blue-800';
    case 'mailing':
      return 'bg-purple-100 text-purple-800';
    case 'billing':
      return 'bg-green-100 text-green-800';
    default:
      return 'bg-gray-100 text-gray-800';
  }
}

/**
 * Format address as multi-line string
 */
function formatAddress(address: UserAddress): string[] {
  const lines: string[] = [];

  lines.push(address.street1);
  if (address.street2) {
    lines.push(address.street2);
  }
  lines.push(`${address.city}, ${address.state} ${address.zipCode}`);
  if (address.country !== 'USA') {
    lines.push(address.country);
  }

  return lines;
}

/**
 * AddressCard - Displays a user address with optional actions
 *
 * @example
 * <AddressCard
 *   address={address}
 *   onEdit={(id) => handleEdit(id)}
 *   onRemove={(id) => handleRemove(id)}
 * />
 */
export const AddressCard: React.FC<AddressCardProps> = ({
  address,
  onEdit,
  onRemove,
  isLoading = false,
  showActions = true,
}) => {
  log.debug('AddressCard rendering', { addressId: address.id, label: address.label });

  const handleEditClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onEdit?.(address.id);
  };

  const handleRemoveClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onRemove?.(address.id);
  };

  const addressLines = formatAddress(address);
  const isOrgOverride = address.orgId !== null;

  return (
    <Card
      data-testid="address-card"
      className="transition-all duration-200 hover:shadow-md"
      style={{
        background: isOrgOverride
          ? 'rgba(255, 251, 235, 0.8)'
          : 'rgba(255, 255, 255, 0.8)',
        backdropFilter: 'blur(10px)',
        WebkitBackdropFilter: 'blur(10px)',
        border: '1px solid',
        borderColor: isOrgOverride
          ? 'rgba(251, 191, 36, 0.3)'
          : 'rgba(229, 231, 235, 0.8)',
      }}
    >
      <CardContent className="p-4">
        {/* Header with label and badges */}
        <div className="flex items-start justify-between mb-2">
          <div className="flex items-center gap-2">
            <MapPin
              className={`w-4 h-4 ${isOrgOverride ? 'text-amber-600' : 'text-gray-500'}`}
              aria-hidden="true"
            />
            <span className="font-medium text-gray-900">{address.label}</span>

            {/* Primary badge */}
            {address.isPrimary && (
              <span
                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium bg-yellow-100 text-yellow-800"
                title="Primary address"
              >
                <Star className="w-3 h-3" aria-hidden="true" />
                Primary
              </span>
            )}
          </div>

          {/* Type and scope badges */}
          <div className="flex items-center gap-1.5">
            {isOrgOverride && (
              <span
                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium bg-amber-100 text-amber-800"
                title="Organization-specific override"
              >
                <Building2 className="w-3 h-3" aria-hidden="true" />
                Override
              </span>
            )}
            <span
              className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium ${getAddressTypeBadgeClasses(address.type)}`}
            >
              {getAddressTypeLabel(address.type)}
            </span>
          </div>
        </div>

        {/* Address lines */}
        <div className="text-sm text-gray-600 space-y-0.5 ml-6">
          {addressLines.map((line, index) => (
            <p key={index}>{line}</p>
          ))}
        </div>

        {/* Inactive indicator */}
        {!address.isActive && (
          <div className="mt-2 ml-6">
            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-600">
              Inactive
            </span>
          </div>
        )}

        {/* Action buttons */}
        {showActions && (onEdit || onRemove) && (
          <div className="mt-3 pt-3 flex gap-2 border-t border-gray-100">
            {onEdit && (
              <Button
                size="sm"
                variant="ghost"
                onClick={handleEditClick}
                disabled={isLoading}
                aria-label={`Edit address ${address.label}`}
                className="text-gray-600 hover:text-blue-600 hover:bg-blue-50"
              >
                <Edit2 className="w-4 h-4 mr-1" aria-hidden="true" />
                Edit
              </Button>
            )}
            {onRemove && (
              <Button
                size="sm"
                variant="ghost"
                onClick={handleRemoveClick}
                disabled={isLoading}
                aria-label={`Remove address ${address.label}`}
                className="text-gray-600 hover:text-red-600 hover:bg-red-50"
              >
                <Trash2 className="w-4 h-4 mr-1" aria-hidden="true" />
                Remove
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
};

AddressCard.displayName = 'AddressCard';
