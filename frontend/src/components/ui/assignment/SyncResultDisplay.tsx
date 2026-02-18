/**
 * SyncResultDisplay Component
 *
 * Domain-agnostic result display for assignment sync operations.
 * Shows success/partial/failure status with user-level detail
 * for additions, removals, and failures.
 *
 * Extension points:
 * - extraSections: Inject domain-specific result sections (e.g., transferred users for schedules)
 * - footerNote: Inject domain-specific notes (e.g., JWT refresh note for roles)
 *
 * Accessibility:
 * - Uses AssignmentAlert with role="alert" for status announcements
 * - Keyboard-accessible action buttons
 * - Scrollable content regions with proper overflow handling
 *
 * @see AssignmentAlert for status alert rendering
 * @see BaseSyncResult for result data shape
 */

import React from 'react';
import { Button } from '@/components/ui/button';
import { CheckCircle, AlertTriangle, XCircle, ArrowLeft } from 'lucide-react';
import { AssignmentAlert } from './AssignmentAlert';
import type { BaseSyncResult, BaseManageableUserState } from '@/types/assignment.types';

interface SyncResultDisplayProps {
  result: BaseSyncResult;
  users: BaseManageableUserState[];
  correlationId: string | null;
  isCompleteSuccess: boolean;
  isPartialSuccess: boolean;
  onClose: () => void;
  onBack: () => void;
  /** Additional result sections (e.g., transferred users for schedules) */
  extraSections?: React.ReactNode;
  /** Footer note below results (e.g., JWT refresh note for roles) */
  footerNote?: React.ReactNode;
}

export const SyncResultDisplay: React.FC<SyncResultDisplayProps> = ({
  result,
  users,
  correlationId,
  isCompleteSuccess,
  isPartialSuccess,
  onClose,
  onBack,
  extraSections,
  footerNote,
}) => {
  const totalChanges = result.added.successful.length + result.removed.successful.length;
  const totalFailed = result.added.failed.length + result.removed.failed.length;

  return (
    <div className="flex flex-col h-full">
      {/* Scrollable Content */}
      <div className="flex-1 overflow-y-auto space-y-4 min-h-0">
        {/* Success Alert */}
        {isCompleteSuccess && totalChanges > 0 && (
          <AssignmentAlert
            variant="success"
            icon={<CheckCircle className="h-5 w-5 text-green-600" />}
            title="Changes Saved Successfully"
          >
            {result.added.successful.length > 0 && (
              <span>{result.added.successful.length} user(s) assigned. </span>
            )}
            {result.removed.successful.length > 0 && (
              <span>{result.removed.successful.length} user(s) removed. </span>
            )}
          </AssignmentAlert>
        )}

        {/* Partial Success Alert */}
        {isPartialSuccess && (
          <AssignmentAlert
            variant="warning"
            icon={<AlertTriangle className="h-5 w-5 text-yellow-600" />}
            title="Partial Success"
          >
            {totalChanges} changes succeeded, {totalFailed} failed.
          </AssignmentAlert>
        )}

        {/* Complete Failure Alert */}
        {totalChanges === 0 && totalFailed > 0 && (
          <AssignmentAlert
            variant="error"
            icon={<XCircle className="h-5 w-5 text-red-600" />}
            title="Save Failed"
          >
            All operations failed. Please try again.
          </AssignmentAlert>
        )}

        {/* Added Users */}
        {result.added.successful.length > 0 && (
          <div className="bg-green-50 rounded-lg p-4">
            <h4 className="text-sm font-medium text-green-800 mb-2">
              Added ({result.added.successful.length})
            </h4>
            <ul className="text-sm text-green-700 space-y-1 max-h-24 overflow-y-auto">
              {users
                .filter((u) => result.added.successful.includes(u.id))
                .map((user) => (
                  <li key={user.id} className="flex items-center gap-2">
                    <CheckCircle size={14} />
                    <span>{user.displayName}</span>
                  </li>
                ))}
            </ul>
          </div>
        )}

        {/* Removed Users */}
        {result.removed.successful.length > 0 && (
          <div className="bg-amber-50 rounded-lg p-4">
            <h4 className="text-sm font-medium text-amber-800 mb-2">
              Removed ({result.removed.successful.length})
            </h4>
            <ul className="text-sm text-amber-700 space-y-1 max-h-24 overflow-y-auto">
              {users
                .filter((u) => result.removed.successful.includes(u.id))
                .map((user) => (
                  <li key={user.id} className="flex items-center gap-2">
                    <CheckCircle size={14} />
                    <span>{user.displayName}</span>
                  </li>
                ))}
            </ul>
          </div>
        )}

        {/* Extra sections (e.g., transferred users for schedules) */}
        {extraSections}

        {/* Failed Operations */}
        {(result.added.failed.length > 0 || result.removed.failed.length > 0) && (
          <div className="bg-red-50 rounded-lg p-4">
            <h4 className="text-sm font-medium text-red-800 mb-2">Failed ({totalFailed})</h4>
            <ul className="text-sm text-red-700 space-y-1 max-h-24 overflow-y-auto">
              {[...result.added.failed, ...result.removed.failed].map((failure) => {
                const user = users.find((u) => u.id === failure.userId);
                return (
                  <li key={failure.userId} className="flex items-start gap-2">
                    <XCircle size={14} className="mt-0.5 flex-shrink-0" />
                    <div>
                      <span className="font-medium">{user?.displayName || failure.userId}</span>
                      <span className="text-red-600 block text-xs">{failure.reason}</span>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        {/* Correlation ID for support */}
        {correlationId && (
          <div className="text-xs text-gray-400 text-center pt-2">Reference: {correlationId}</div>
        )}

        {/* Footer note (domain-specific) */}
        {footerNote}
      </div>

      {/* Action Buttons - Always visible at bottom */}
      <div className="flex gap-2 pt-4 mt-4 border-t border-gray-200 flex-shrink-0">
        <Button variant="outline" onClick={onBack} className="flex-1">
          <ArrowLeft size={16} className="mr-2" />
          Make More Changes
        </Button>
        <Button onClick={onClose} className="flex-1">
          Done
        </Button>
      </div>
    </div>
  );
};

SyncResultDisplay.displayName = 'SyncResultDisplay';
