/**
 * Notification Preferences Form Component
 *
 * Form for configuring user notification preferences per organization.
 * Supports email, SMS, and in-app notification channels.
 *
 * Features:
 * - Toggle switches for each notification channel
 * - SMS phone selection from available phones
 * - Real-time validation
 * - WCAG 2.1 Level AA compliant
 *
 * @see NotificationPreferences type for data structure
 * @see UpdateNotificationPreferencesRequest for update structure
 */

import React, { useState, useCallback, useId } from 'react';
import { cn } from '@/components/ui/utils';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Bell, Mail, MessageSquare, Smartphone, AlertCircle } from 'lucide-react';
import type { NotificationPreferences, UserPhone } from '@/types/user.types';
import { DEFAULT_NOTIFICATION_PREFERENCES } from '@/types/user.types';
import { Logger } from '@/utils/logger';

const log = Logger.getLogger('component');

/**
 * Props for NotificationPreferencesForm component
 */
export interface NotificationPreferencesFormProps {
  /** Current notification preferences */
  preferences: NotificationPreferences;

  /** Available phones for SMS selection (only SMS-capable phones) */
  availablePhones?: UserPhone[];

  /** Called when preferences are saved */
  onSave: (preferences: NotificationPreferences) => void;

  /** Called when form is cancelled (optional) */
  onCancel?: () => void;

  /** Whether the form is currently saving */
  isSaving?: boolean;

  /** Whether to show as inline form (no header/footer) */
  inline?: boolean;

  /** Additional CSS classes */
  className?: string;
}

/**
 * NotificationPreferencesForm - Form for configuring notification preferences
 *
 * @example
 * <NotificationPreferencesForm
 *   preferences={currentPrefs}
 *   availablePhones={smsCapablePhones}
 *   onSave={(prefs) => handleSave(prefs)}
 * />
 */
export const NotificationPreferencesForm: React.FC<NotificationPreferencesFormProps> = ({
  preferences,
  availablePhones = [],
  onSave,
  onCancel,
  isSaving = false,
  inline = false,
  className,
}) => {
  const baseId = useId();

  // Local state for form
  const [localPrefs, setLocalPrefs] = useState<NotificationPreferences>(() => ({
    email: preferences.email ?? DEFAULT_NOTIFICATION_PREFERENCES.email,
    sms: {
      enabled: preferences.sms?.enabled ?? DEFAULT_NOTIFICATION_PREFERENCES.sms.enabled,
      phoneId: preferences.sms?.phoneId ?? DEFAULT_NOTIFICATION_PREFERENCES.sms.phoneId,
    },
    inApp: preferences.inApp ?? DEFAULT_NOTIFICATION_PREFERENCES.inApp,
  }));

  const [isDirty, setIsDirty] = useState(false);

  log.debug('NotificationPreferencesForm render', { preferences, isSaving });

  // SMS-capable phones only
  const smsCapablePhones = availablePhones.filter((p) => p.smsCapable && p.isActive);

  // Handler for email toggle
  const handleEmailChange = useCallback((enabled: boolean) => {
    setLocalPrefs((prev) => ({ ...prev, email: enabled }));
    setIsDirty(true);
  }, []);

  // Handler for in-app toggle
  const handleInAppChange = useCallback((enabled: boolean) => {
    setLocalPrefs((prev) => ({ ...prev, inApp: enabled }));
    setIsDirty(true);
  }, []);

  // Handler for SMS toggle
  const handleSmsEnabledChange = useCallback(
    (enabled: boolean) => {
      setLocalPrefs((prev) => ({
        ...prev,
        sms: {
          enabled,
          // Auto-select first available phone if enabling and none selected
          phoneId:
            enabled && !prev.sms.phoneId && smsCapablePhones.length > 0
              ? smsCapablePhones[0].id
              : prev.sms.phoneId,
        },
      }));
      setIsDirty(true);
    },
    [smsCapablePhones]
  );

  // Handler for SMS phone selection
  const handleSmsPhoneChange = useCallback((phoneId: string | null) => {
    setLocalPrefs((prev) => ({
      ...prev,
      sms: { ...prev.sms, phoneId },
    }));
    setIsDirty(true);
  }, []);

  // Save handler
  const handleSave = useCallback(() => {
    onSave(localPrefs);
    setIsDirty(false);
  }, [localPrefs, onSave]);

  // Reset handler
  const handleReset = useCallback(() => {
    setLocalPrefs({
      email: preferences.email ?? DEFAULT_NOTIFICATION_PREFERENCES.email,
      sms: {
        enabled: preferences.sms?.enabled ?? DEFAULT_NOTIFICATION_PREFERENCES.sms.enabled,
        phoneId: preferences.sms?.phoneId ?? DEFAULT_NOTIFICATION_PREFERENCES.sms.phoneId,
      },
      inApp: preferences.inApp ?? DEFAULT_NOTIFICATION_PREFERENCES.inApp,
    });
    setIsDirty(false);
    onCancel?.();
  }, [preferences, onCancel]);

  // Generate IDs
  const ids = {
    email: `${baseId}-email`,
    sms: `${baseId}-sms`,
    smsPhone: `${baseId}-sms-phone`,
    inApp: `${baseId}-in-app`,
  };

  // Validation: SMS enabled but no phone selected
  const smsError =
    localPrefs.sms.enabled && !localPrefs.sms.phoneId && smsCapablePhones.length === 0
      ? 'No SMS-capable phones available. Add an SMS-capable phone first.'
      : localPrefs.sms.enabled && !localPrefs.sms.phoneId
        ? 'Please select a phone for SMS notifications'
        : null;

  return (
    <div className={cn('space-y-4', className)}>
      {/* Header (if not inline) */}
      {!inline && (
        <div className="flex items-center gap-2 pb-2 border-b border-gray-200">
          <Bell className="w-5 h-5 text-gray-500" aria-hidden="true" />
          <h3 className="text-lg font-medium text-gray-900">Notification Preferences</h3>
        </div>
      )}

      {/* Email notifications */}
      <div className="flex items-center justify-between py-2">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-blue-50">
            <Mail className="w-5 h-5 text-blue-600" aria-hidden="true" />
          </div>
          <div>
            <Label htmlFor={ids.email} className="text-sm font-medium text-gray-900">
              Email Notifications
            </Label>
            <p className="text-xs text-gray-500">
              Receive notifications via email
            </p>
          </div>
        </div>
        <Checkbox
          id={ids.email}
          checked={localPrefs.email}
          onCheckedChange={handleEmailChange}
          disabled={isSaving}
          aria-describedby={`${ids.email}-desc`}
          className="h-5 w-5"
        />
      </div>

      {/* SMS notifications */}
      <div className="space-y-3 py-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-green-50">
              <MessageSquare className="w-5 h-5 text-green-600" aria-hidden="true" />
            </div>
            <div>
              <Label htmlFor={ids.sms} className="text-sm font-medium text-gray-900">
                SMS Notifications
              </Label>
              <p className="text-xs text-gray-500">
                Receive notifications via text message
              </p>
            </div>
          </div>
          <Checkbox
            id={ids.sms}
            checked={localPrefs.sms.enabled}
            onCheckedChange={handleSmsEnabledChange}
            disabled={isSaving}
            aria-describedby={`${ids.sms}-desc`}
            className="h-5 w-5"
          />
        </div>

        {/* SMS phone selector (shown when SMS is enabled) */}
        {localPrefs.sms.enabled && (
          <div className="ml-12 space-y-2">
            <Label
              htmlFor={ids.smsPhone}
              className="text-sm text-gray-700"
            >
              Select phone for SMS
            </Label>
            {smsCapablePhones.length > 0 ? (
              <select
                id={ids.smsPhone}
                value={localPrefs.sms.phoneId || ''}
                onChange={(e) => handleSmsPhoneChange(e.target.value || null)}
                disabled={isSaving}
                className={cn(
                  'flex h-10 w-full max-w-xs rounded-md border bg-white px-3 py-2 text-sm',
                  'focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500',
                  'disabled:cursor-not-allowed disabled:opacity-50',
                  smsError ? 'border-red-500' : 'border-gray-300'
                )}
                aria-invalid={!!smsError}
                aria-describedby={smsError ? `${ids.smsPhone}-error` : undefined}
              >
                <option value="">Select a phone...</option>
                {smsCapablePhones.map((phone) => (
                  <option key={phone.id} value={phone.id}>
                    {phone.label} - {phone.number}
                  </option>
                ))}
              </select>
            ) : (
              <div className="flex items-center gap-2 text-amber-600 text-sm">
                <Smartphone className="w-4 h-4" aria-hidden="true" />
                <span>No SMS-capable phones available</span>
              </div>
            )}
            {smsError && (
              <p
                id={`${ids.smsPhone}-error`}
                className="flex items-center gap-1 text-sm text-red-600"
                role="alert"
              >
                <AlertCircle className="h-3.5 w-3.5 flex-shrink-0" aria-hidden="true" />
                <span>{smsError}</span>
              </p>
            )}
          </div>
        )}
      </div>

      {/* In-app notifications */}
      <div className="flex items-center justify-between py-2">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-purple-50">
            <Bell className="w-5 h-5 text-purple-600" aria-hidden="true" />
          </div>
          <div>
            <Label htmlFor={ids.inApp} className="text-sm font-medium text-gray-900">
              In-App Notifications
            </Label>
            <p className="text-xs text-gray-500">
              Show notifications within the application
            </p>
          </div>
        </div>
        <Checkbox
          id={ids.inApp}
          checked={localPrefs.inApp}
          onCheckedChange={handleInAppChange}
          disabled={isSaving}
          aria-describedby={`${ids.inApp}-desc`}
          className="h-5 w-5"
        />
      </div>

      {/* Action buttons (if not inline) */}
      {!inline && (
        <div className="flex justify-end gap-3 pt-4 border-t border-gray-200">
          {onCancel && (
            <Button
              type="button"
              variant="outline"
              onClick={handleReset}
              disabled={isSaving}
            >
              Cancel
            </Button>
          )}
          <Button
            type="button"
            onClick={handleSave}
            disabled={isSaving || !isDirty || !!smsError}
          >
            {isSaving ? 'Saving...' : 'Save Preferences'}
          </Button>
        </div>
      )}

      {/* Inline save button */}
      {inline && isDirty && (
        <div className="pt-2">
          <Button
            type="button"
            size="sm"
            onClick={handleSave}
            disabled={isSaving || !!smsError}
          >
            {isSaving ? 'Saving...' : 'Save Changes'}
          </Button>
        </div>
      )}
    </div>
  );
};

NotificationPreferencesForm.displayName = 'NotificationPreferencesForm';
