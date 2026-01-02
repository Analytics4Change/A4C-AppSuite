/**
 * Phone Card Component
 *
 * Displays a user phone number as a compact card with edit/remove actions.
 * Supports both global phones and org-specific overrides.
 *
 * Features:
 * - Glass-morphism styling consistent with design system
 * - Visual distinction between global and org-override phones
 * - Primary phone indicator
 * - SMS capability indicator
 * - Edit and remove action buttons
 * - WCAG 2.1 Level AA compliant
 *
 * @see UserPhone type for data structure
 */

import React from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Phone, Edit2, Trash2, Star, Building2, MessageSquare } from 'lucide-react';
import type { UserPhone, PhoneType } from '@/types/user.types';
import { Logger } from '@/utils/logger';

const log = Logger.getLogger('component');

/**
 * Props for PhoneCard component
 */
export interface PhoneCardProps {
  /** The phone to display */
  phone: UserPhone;

  /** Called when edit action is triggered */
  onEdit?: (phoneId: string) => void;

  /** Called when remove action is triggered */
  onRemove?: (phoneId: string) => void;

  /** Whether actions are currently loading */
  isLoading?: boolean;

  /** Whether to show action buttons */
  showActions?: boolean;
}

/**
 * Get display label for phone type
 */
function getPhoneTypeLabel(type: PhoneType): string {
  switch (type) {
    case 'mobile':
      return 'Mobile';
    case 'office':
      return 'Office';
    case 'fax':
      return 'Fax';
    case 'emergency':
      return 'Emergency';
    default:
      return type;
  }
}

/**
 * Get color classes for phone type badge
 */
function getPhoneTypeBadgeClasses(type: PhoneType): string {
  switch (type) {
    case 'mobile':
      return 'bg-blue-100 text-blue-800';
    case 'office':
      return 'bg-gray-100 text-gray-800';
    case 'fax':
      return 'bg-purple-100 text-purple-800';
    case 'emergency':
      return 'bg-red-100 text-red-800';
    default:
      return 'bg-gray-100 text-gray-800';
  }
}

/**
 * Format phone number for display
 */
function formatPhoneNumber(phone: UserPhone): string {
  let formatted = '';

  // Add country code if not default
  if (phone.countryCode && phone.countryCode !== '+1') {
    formatted = `${phone.countryCode} `;
  }

  formatted += phone.number;

  // Add extension if present
  if (phone.extension) {
    formatted += ` ext. ${phone.extension}`;
  }

  return formatted;
}

/**
 * PhoneCard - Displays a user phone with optional actions
 *
 * @example
 * <PhoneCard
 *   phone={phone}
 *   onEdit={(id) => handleEdit(id)}
 *   onRemove={(id) => handleRemove(id)}
 * />
 */
export const PhoneCard: React.FC<PhoneCardProps> = ({
  phone,
  onEdit,
  onRemove,
  isLoading = false,
  showActions = true,
}) => {
  log.debug('PhoneCard rendering', { phoneId: phone.id, label: phone.label });

  const handleEditClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onEdit?.(phone.id);
  };

  const handleRemoveClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onRemove?.(phone.id);
  };

  const formattedNumber = formatPhoneNumber(phone);
  const isOrgOverride = phone.orgId !== null;

  return (
    <Card
      data-testid="phone-card"
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
            <Phone
              className={`w-4 h-4 ${isOrgOverride ? 'text-amber-600' : 'text-gray-500'}`}
              aria-hidden="true"
            />
            <span className="font-medium text-gray-900">{phone.label}</span>

            {/* Primary badge */}
            {phone.isPrimary && (
              <span
                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium bg-yellow-100 text-yellow-800"
                title="Primary phone"
              >
                <Star className="w-3 h-3" aria-hidden="true" />
                Primary
              </span>
            )}

            {/* SMS capable badge */}
            {phone.smsCapable && (
              <span
                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium bg-green-100 text-green-800"
                title="Can receive SMS notifications"
              >
                <MessageSquare className="w-3 h-3" aria-hidden="true" />
                SMS
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
              className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium ${getPhoneTypeBadgeClasses(phone.type)}`}
            >
              {getPhoneTypeLabel(phone.type)}
            </span>
          </div>
        </div>

        {/* Phone number */}
        <div className="text-sm text-gray-600 ml-6">
          <p className="font-mono">{formattedNumber}</p>
        </div>

        {/* Inactive indicator */}
        {!phone.isActive && (
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
                aria-label={`Edit phone ${phone.label}`}
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
                aria-label={`Remove phone ${phone.label}`}
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

PhoneCard.displayName = 'PhoneCard';
