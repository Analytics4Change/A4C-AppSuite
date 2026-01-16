/**
 * User Phones Section Component
 *
 * Manages user phone numbers with list display and add/edit functionality.
 * Orchestrates PhoneCard and UserPhoneForm components.
 *
 * Features:
 * - Lists user's phones (global + org-specific)
 * - Add new phone via form
 * - Edit existing phone
 * - Remove phone (soft delete)
 * - Mirrored phone indicator (from contact)
 * - WCAG 2.1 Level AA compliant
 *
 * @see UserPhone for data structure
 * @see PhoneCard for display component
 * @see UserPhoneForm for form component
 */

import React, { useState, useEffect, useCallback } from 'react';
import { observer } from 'mobx-react-lite';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { PhoneCard } from './PhoneCard';
import { UserPhoneForm, type PhoneFormData } from './UserPhoneForm';
import { getUserQueryService, getUserCommandService } from '@/services/users';
import { useAuth } from '@/contexts/AuthContext';
import type { UserPhone } from '@/types/user.types';
import { Phone, Plus, AlertCircle, Loader2 } from 'lucide-react';
import { Logger } from '@/utils/logger';

const log = Logger.getLogger('component');

/**
 * Props for UserPhonesSection
 */
export interface UserPhonesSectionProps {
  /** User ID to manage phones for */
  userId: string;

  /** Whether editing is allowed */
  editable?: boolean;

  /** Additional CSS classes */
  className?: string;

  /** Callback when phones are added, edited, or removed */
  onPhonesChange?: (phones: UserPhone[]) => void;
}

/**
 * Section mode: list (showing phones), add (showing form), edit (editing phone)
 */
type SectionMode = 'list' | 'add' | 'edit';

/**
 * UserPhonesSection - Manage user phone numbers
 */
export const UserPhonesSection: React.FC<UserPhonesSectionProps> = observer(
  ({ userId, editable = true, className, onPhonesChange }) => {
    const { session } = useAuth();
    const organizationId = session?.claims?.org_id ?? '';

    const [phones, setPhones] = useState<UserPhone[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [mode, setMode] = useState<SectionMode>('list');
    const [editingPhone, setEditingPhone] = useState<UserPhone | null>(null);
    const [phoneToRemove, setPhoneToRemove] = useState<UserPhone | null>(null);

    const queryService = getUserQueryService();
    const commandService = getUserCommandService();

    // Load phones
    const loadPhones = useCallback(async () => {
      setIsLoading(true);
      setError(null);
      try {
        const result = await queryService.getUserPhones(userId);
        setPhones(result);
        // Notify parent of phone changes (for SMS notification preferences sync)
        onPhonesChange?.(result);
      } catch (err) {
        log.error('Failed to load phones', err);
        setError('Failed to load phone numbers');
      } finally {
        setIsLoading(false);
      }
    }, [userId, queryService, onPhonesChange]);

    useEffect(() => {
      loadPhones();
    }, [loadPhones]);

    // Handle add phone
    const handleAddPhone = useCallback(
      async (formData: PhoneFormData) => {
        setIsSubmitting(true);
        setError(null);
        try {
          const result = await commandService.addUserPhone({
            userId,
            orgId: formData.isOrgOverride ? organizationId : null,
            label: formData.label,
            type: formData.type,
            number: formData.number,
            extension: formData.extension || undefined,
            countryCode: formData.countryCode,
            isPrimary: formData.isPrimary,
            smsCapable: formData.smsCapable,
          });

          if (result.success) {
            await loadPhones();
            setMode('list');
          } else {
            setError(result.error || 'Failed to add phone');
          }
        } catch (err) {
          log.error('Error adding phone', err);
          setError('Failed to add phone');
        } finally {
          setIsSubmitting(false);
        }
      },
      [userId, organizationId, commandService, loadPhones]
    );

    // Handle edit phone
    const handleEditPhone = useCallback(
      async (formData: PhoneFormData) => {
        if (!editingPhone) return;

        setIsSubmitting(true);
        setError(null);
        try {
          const result = await commandService.updateUserPhone({
            phoneId: editingPhone.id,
            orgId: editingPhone.orgId,
            updates: {
              label: formData.label,
              type: formData.type,
              number: formData.number,
              extension: formData.extension || undefined,
              countryCode: formData.countryCode,
              isPrimary: formData.isPrimary,
              smsCapable: formData.smsCapable,
            },
          });

          if (result.success) {
            await loadPhones();
            setMode('list');
            setEditingPhone(null);
          } else {
            setError(result.error || 'Failed to update phone');
          }
        } catch (err) {
          log.error('Error updating phone', err);
          setError('Failed to update phone');
        } finally {
          setIsSubmitting(false);
        }
      },
      [editingPhone, commandService, loadPhones]
    );

    // Handle remove phone
    const handleRemovePhone = useCallback(async () => {
      if (!phoneToRemove) return;

      setIsSubmitting(true);
      setError(null);
      try {
        const result = await commandService.removeUserPhone({
          phoneId: phoneToRemove.id,
          orgId: phoneToRemove.orgId,
          hardDelete: false, // Soft delete by default
        });

        if (result.success) {
          await loadPhones();
          setPhoneToRemove(null);
        } else {
          setError(result.error || 'Failed to remove phone');
        }
      } catch (err) {
        log.error('Error removing phone', err);
        setError('Failed to remove phone');
      } finally {
        setIsSubmitting(false);
      }
    }, [phoneToRemove, commandService, loadPhones]);

    // Start editing
    const handleEditClick = useCallback(
      (phoneId: string) => {
        const phone = phones.find((p) => p.id === phoneId);
        if (phone) {
          setEditingPhone(phone);
          setMode('edit');
        }
      },
      [phones]
    );

    // Start remove
    const handleRemoveClick = useCallback(
      (phoneId: string) => {
        const phone = phones.find((p) => p.id === phoneId);
        if (phone) {
          setPhoneToRemove(phone);
        }
      },
      [phones]
    );

    // Cancel form
    const handleCancel = useCallback(() => {
      setMode('list');
      setEditingPhone(null);
      setError(null);
    }, []);

    // Separate global and org phones for display
    const globalPhones = phones.filter((p) => p.source === 'global' || !p.orgId);
    const orgPhones = phones.filter((p) => p.source === 'org' || p.orgId);

    return (
      <Card className={className}>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2 text-base">
              <Phone className="w-4 h-4" aria-hidden="true" />
              Phone Numbers
            </CardTitle>
            {editable && mode === 'list' && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => setMode('add')}
                className="h-8"
              >
                <Plus className="w-4 h-4 mr-1" aria-hidden="true" />
                Add Phone
              </Button>
            )}
          </div>
        </CardHeader>

        <CardContent className="pt-0">
          {/* Error display */}
          {error && (
            <div
              className="mb-4 p-3 rounded-md bg-red-50 border border-red-200 flex items-center gap-2 text-sm text-red-700"
              role="alert"
            >
              <AlertCircle className="w-4 h-4 flex-shrink-0" aria-hidden="true" />
              {error}
            </div>
          )}

          {/* Loading state */}
          {isLoading && (
            <div className="flex items-center justify-center py-8 text-gray-500">
              <Loader2 className="w-5 h-5 animate-spin mr-2" aria-hidden="true" />
              Loading phones...
            </div>
          )}

          {/* List mode */}
          {!isLoading && mode === 'list' && (
            <div className="space-y-4">
              {phones.length === 0 ? (
                <p className="text-sm text-gray-500 text-center py-4">
                  No phone numbers added yet.
                </p>
              ) : (
                <>
                  {/* Global phones */}
                  {globalPhones.length > 0 && (
                    <div className="space-y-2">
                      {orgPhones.length > 0 && (
                        <h4 className="text-xs font-medium text-gray-500 uppercase tracking-wide">
                          Global Phones
                        </h4>
                      )}
                      {globalPhones.map((phone) => (
                        <PhoneCard
                          key={phone.id}
                          phone={phone}
                          onEdit={editable ? handleEditClick : undefined}
                          onRemove={editable ? handleRemoveClick : undefined}
                          isLoading={isSubmitting}
                          showActions={editable}
                        />
                      ))}
                    </div>
                  )}

                  {/* Org-specific phones */}
                  {orgPhones.length > 0 && (
                    <div className="space-y-2">
                      <h4 className="text-xs font-medium text-gray-500 uppercase tracking-wide">
                        Organization-Specific
                      </h4>
                      {orgPhones.map((phone) => (
                        <PhoneCard
                          key={phone.id}
                          phone={phone}
                          onEdit={editable ? handleEditClick : undefined}
                          onRemove={editable ? handleRemoveClick : undefined}
                          isLoading={isSubmitting}
                          showActions={editable}
                        />
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {/* Add mode */}
          {mode === 'add' && (
            <UserPhoneForm
              onSubmit={handleAddPhone}
              onCancel={handleCancel}
              isSubmitting={isSubmitting}
              isEditMode={false}
              allowOrgOverride={true}
            />
          )}

          {/* Edit mode */}
          {mode === 'edit' && editingPhone && (
            <UserPhoneForm
              initialData={editingPhone}
              onSubmit={handleEditPhone}
              onCancel={handleCancel}
              isSubmitting={isSubmitting}
              isEditMode={true}
              allowOrgOverride={false}
            />
          )}

          {/* Remove confirmation dialog */}
          <ConfirmDialog
            isOpen={phoneToRemove !== null}
            onCancel={() => setPhoneToRemove(null)}
            title="Remove Phone"
            message={`Are you sure you want to remove "${phoneToRemove?.label}"? This phone will be deactivated and can be restored later.`}
            confirmLabel="Remove"
            cancelLabel="Cancel"
            variant="danger"
            onConfirm={handleRemovePhone}
            isLoading={isSubmitting}
          />
        </CardContent>
      </Card>
    );
  }
);

UserPhonesSection.displayName = 'UserPhonesSection';
