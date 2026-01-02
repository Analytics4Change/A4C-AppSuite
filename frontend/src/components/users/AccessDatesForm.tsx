/**
 * Access Dates Form Component
 *
 * Form for configuring user access date windows per organization.
 * Controls when a user can access the organization (start date) and
 * when their access expires (expiration date).
 *
 * Features:
 * - Start date and expiration date pickers
 * - Validation (expiration must be after start)
 * - Clear dates option
 * - Visual indicators for current access status
 * - WCAG 2.1 Level AA compliant
 *
 * @see UpdateAccessDatesRequest for request structure
 * @see UserOrgAccess for data model
 */

import React, { useState, useCallback, useId, useMemo } from 'react';
import { cn } from '@/components/ui/utils';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import {
  Calendar,
  AlertCircle,
  Clock,
  CheckCircle2,
  XCircle,
  CalendarX2,
} from 'lucide-react';
import { validateAccessDates } from '@/types/user.types';
import { Logger } from '@/utils/logger';

const log = Logger.getLogger('component');

/**
 * Access date form data
 */
export interface AccessDatesFormData {
  accessStartDate: string | null;
  accessExpirationDate: string | null;
}

/**
 * Props for AccessDatesForm component
 */
export interface AccessDatesFormProps {
  /** Current access start date (YYYY-MM-DD or null) */
  accessStartDate: string | null;

  /** Current access expiration date (YYYY-MM-DD or null) */
  accessExpirationDate: string | null;

  /** Called when dates are saved */
  onSave: (data: AccessDatesFormData) => void;

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
 * Compute access status based on dates
 */
type AccessStatus = 'active' | 'not_started' | 'expired' | 'window_active';

function computeAccessStatus(
  startDate: string | null,
  expirationDate: string | null
): AccessStatus {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const hasStart = startDate !== null;
  const hasExpiration = expirationDate !== null;

  if (!hasStart && !hasExpiration) {
    return 'active'; // No restrictions
  }

  const start = hasStart ? new Date(startDate) : null;
  const end = hasExpiration ? new Date(expirationDate) : null;

  if (start && start > today) {
    return 'not_started';
  }

  if (end && end < today) {
    return 'expired';
  }

  return 'window_active';
}

/**
 * Get status display info
 */
function getStatusInfo(status: AccessStatus): {
  icon: React.ElementType;
  label: string;
  color: string;
  bgColor: string;
} {
  switch (status) {
    case 'active':
      return {
        icon: CheckCircle2,
        label: 'Access Active (No restrictions)',
        color: 'text-green-600',
        bgColor: 'bg-green-50',
      };
    case 'not_started':
      return {
        icon: Clock,
        label: 'Access Not Yet Started',
        color: 'text-amber-600',
        bgColor: 'bg-amber-50',
      };
    case 'expired':
      return {
        icon: XCircle,
        label: 'Access Expired',
        color: 'text-red-600',
        bgColor: 'bg-red-50',
      };
    case 'window_active':
      return {
        icon: Calendar,
        label: 'Access Active (Within window)',
        color: 'text-blue-600',
        bgColor: 'bg-blue-50',
      };
  }
}

/**
 * Format date for display
 */
function formatDateForDisplay(dateStr: string | null): string {
  if (!dateStr) return 'Not set';
  const date = new Date(dateStr);
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

/**
 * AccessDatesForm - Form for configuring access date windows
 *
 * @example
 * <AccessDatesForm
 *   accessStartDate={user.accessStartDate}
 *   accessExpirationDate={user.accessExpirationDate}
 *   onSave={(dates) => handleSave(dates)}
 * />
 */
export const AccessDatesForm: React.FC<AccessDatesFormProps> = ({
  accessStartDate,
  accessExpirationDate,
  onSave,
  onCancel,
  isSaving = false,
  inline = false,
  className,
}) => {
  const baseId = useId();

  // Local state for form
  const [localStart, setLocalStart] = useState<string>(accessStartDate || '');
  const [localExpiration, setLocalExpiration] = useState<string>(
    accessExpirationDate || ''
  );
  const [touched, setTouched] = useState<Set<string>>(new Set());

  log.debug('AccessDatesForm render', { accessStartDate, accessExpirationDate, isSaving });

  // Compute current access status
  const accessStatus = useMemo(
    () => computeAccessStatus(accessStartDate, accessExpirationDate),
    [accessStartDate, accessExpirationDate]
  );

  const statusInfo = getStatusInfo(accessStatus);
  const StatusIcon = statusInfo.icon;

  // Check for changes
  const isDirty =
    localStart !== (accessStartDate || '') ||
    localExpiration !== (accessExpirationDate || '');

  // Validate dates
  const validationErrors = useMemo(() => {
    return validateAccessDates(
      localStart || null,
      localExpiration || null
    );
  }, [localStart, localExpiration]);

  // Handlers
  const handleStartChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setLocalStart(e.target.value);
    },
    []
  );

  const handleExpirationChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setLocalExpiration(e.target.value);
    },
    []
  );

  const handleBlur = useCallback((field: string) => {
    setTouched((prev) => new Set(prev).add(field));
  }, []);

  const handleClearDates = useCallback(() => {
    setLocalStart('');
    setLocalExpiration('');
    setTouched(new Set());
  }, []);

  const handleSave = useCallback(() => {
    setTouched(new Set(['accessStartDate', 'accessExpirationDate']));

    if (!validationErrors) {
      onSave({
        accessStartDate: localStart || null,
        accessExpirationDate: localExpiration || null,
      });
    }
  }, [localStart, localExpiration, validationErrors, onSave]);

  const handleReset = useCallback(() => {
    setLocalStart(accessStartDate || '');
    setLocalExpiration(accessExpirationDate || '');
    setTouched(new Set());
    onCancel?.();
  }, [accessStartDate, accessExpirationDate, onCancel]);

  // Generate IDs
  const ids = {
    startDate: `${baseId}-start`,
    expirationDate: `${baseId}-expiration`,
  };

  const startError =
    touched.has('accessStartDate') && validationErrors?.accessStartDate;
  const expirationError =
    touched.has('accessExpirationDate') && validationErrors?.accessExpirationDate;

  return (
    <div className={cn('space-y-4', className)}>
      {/* Header (if not inline) */}
      {!inline && (
        <div className="flex items-center gap-2 pb-2 border-b border-gray-200">
          <Calendar className="w-5 h-5 text-gray-500" aria-hidden="true" />
          <h3 className="text-lg font-medium text-gray-900">Access Dates</h3>
        </div>
      )}

      {/* Current status indicator */}
      <div
        className={cn(
          'flex items-center gap-3 p-3 rounded-lg',
          statusInfo.bgColor
        )}
      >
        <StatusIcon className={cn('w-5 h-5', statusInfo.color)} aria-hidden="true" />
        <div>
          <p className={cn('text-sm font-medium', statusInfo.color)}>
            {statusInfo.label}
          </p>
          <p className="text-xs text-gray-600">
            {accessStartDate || accessExpirationDate ? (
              <>
                {accessStartDate && (
                  <span>Starts: {formatDateForDisplay(accessStartDate)}</span>
                )}
                {accessStartDate && accessExpirationDate && ' • '}
                {accessExpirationDate && (
                  <span>Expires: {formatDateForDisplay(accessExpirationDate)}</span>
                )}
              </>
            ) : (
              'No date restrictions set'
            )}
          </p>
        </div>
      </div>

      {/* Date inputs */}
      <div className="grid grid-cols-2 gap-4">
        {/* Start date */}
        <div className="space-y-1.5">
          <Label
            htmlFor={ids.startDate}
            className={cn(
              'text-sm font-medium',
              startError ? 'text-red-600' : 'text-gray-700'
            )}
          >
            Access Start Date
          </Label>
          <Input
            id={ids.startDate}
            type="date"
            value={localStart}
            onChange={handleStartChange}
            onBlur={() => handleBlur('accessStartDate')}
            disabled={isSaving}
            aria-invalid={!!startError}
            aria-describedby={startError ? `${ids.startDate}-error` : `${ids.startDate}-help`}
            className={cn(startError && 'border-red-500')}
          />
          {startError ? (
            <p
              id={`${ids.startDate}-error`}
              className="flex items-center gap-1 text-sm text-red-600"
              role="alert"
            >
              <AlertCircle className="h-3.5 w-3.5 flex-shrink-0" aria-hidden="true" />
              <span>{startError}</span>
            </p>
          ) : (
            <p id={`${ids.startDate}-help`} className="text-xs text-gray-500">
              User can access starting this date (leave empty for immediate access)
            </p>
          )}
        </div>

        {/* Expiration date */}
        <div className="space-y-1.5">
          <Label
            htmlFor={ids.expirationDate}
            className={cn(
              'text-sm font-medium',
              expirationError ? 'text-red-600' : 'text-gray-700'
            )}
          >
            Access Expiration Date
          </Label>
          <Input
            id={ids.expirationDate}
            type="date"
            value={localExpiration}
            onChange={handleExpirationChange}
            onBlur={() => handleBlur('accessExpirationDate')}
            disabled={isSaving}
            aria-invalid={!!expirationError}
            aria-describedby={
              expirationError
                ? `${ids.expirationDate}-error`
                : `${ids.expirationDate}-help`
            }
            className={cn(expirationError && 'border-red-500')}
          />
          {expirationError ? (
            <p
              id={`${ids.expirationDate}-error`}
              className="flex items-center gap-1 text-sm text-red-600"
              role="alert"
            >
              <AlertCircle className="h-3.5 w-3.5 flex-shrink-0" aria-hidden="true" />
              <span>{expirationError}</span>
            </p>
          ) : (
            <p id={`${ids.expirationDate}-help`} className="text-xs text-gray-500">
              Access is blocked after this date (leave empty for permanent access)
            </p>
          )}
        </div>
      </div>

      {/* Clear dates button */}
      {(localStart || localExpiration) && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={handleClearDates}
          disabled={isSaving}
          className="text-gray-600 hover:text-red-600"
        >
          <CalendarX2 className="w-4 h-4 mr-1" aria-hidden="true" />
          Clear Date Restrictions
        </Button>
      )}

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
            disabled={isSaving || !isDirty || !!validationErrors}
          >
            {isSaving ? 'Saving...' : 'Save Access Dates'}
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
            disabled={isSaving || !!validationErrors}
          >
            {isSaving ? 'Saving...' : 'Save Changes'}
          </Button>
        </div>
      )}
    </div>
  );
};

AccessDatesForm.displayName = 'AccessDatesForm';
