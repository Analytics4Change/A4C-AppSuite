/**
 * ScheduleAssignmentDialog Component
 *
 * Modal dialog for managing schedule template user assignments.
 * Shows ALL users with checkboxes reflecting current assignment state.
 * Allows adding AND removing assignments in a single operation,
 * with auto-transfer detection for users on another schedule.
 *
 * Composes shared sub-components from @/components/ui/assignment:
 * - ManageableUserList for the searchable checkbox list
 * - SyncResultDisplay for post-save result view
 * - AssignmentAlert for error alerts
 *
 * Schedule-specific behaviors:
 * - Users on another template show "On: Template Name" context
 * - Checking such a user shows amber "Transferring from: X" tag
 * - Result display includes "Transferred" section in amber
 *
 * Accessibility (WCAG 2.1 Level AA + WAI-ARIA APG Dialog Pattern):
 * - Uses role="dialog" for modal indication
 * - aria-modal="true" for assistive tech
 * - aria-labelledby/describedby for content association
 * - Focus trap: Tab/Shift+Tab contained within dialog
 * - Escape key: Closes dialog and returns focus
 * - Focus restoration: Returns focus to trigger element on close
 *
 * @see ScheduleAssignmentViewModel for state management
 * @see ManageableUserList for user selection UI
 * @see SyncResultDisplay for result display
 */

import React, { useEffect, useCallback, useRef, RefObject } from 'react';
import { observer } from 'mobx-react-lite';
import { Button } from '@/components/ui/button';
import { cn } from '@/components/ui/utils';
import { useKeyboardNavigation } from '@/hooks/useKeyboardNavigation';
import { Users, Calendar, CheckCircle, XCircle, Loader2, X, ArrowRightLeft } from 'lucide-react';
import { AssignmentAlert, ManageableUserList, SyncResultDisplay } from '@/components/ui/assignment';
import type { ScheduleAssignmentViewModel } from '@/viewModels/schedule/ScheduleAssignmentViewModel';
import type { ScheduleManageableUserState } from '@/types/bulk-assignment.types';
import type { BaseManageableUserState } from '@/types/assignment.types';
import { Logger } from '@/utils/logger';

const log = Logger.getLogger('component');

interface ScheduleAssignmentDialogProps {
  /** The ViewModel managing dialog state */
  viewModel: ScheduleAssignmentViewModel;
  /** Whether the dialog is open */
  isOpen: boolean;
  /** Callback when the dialog should close */
  onClose: () => void;
  /** Callback after successful save (e.g., to refresh template data) */
  onSuccess?: () => void;
}

/**
 * Render schedule-specific context per user.
 * - Users on a different template show "On: Template Name" or "Transferring from: X"
 */
const createRenderScheduleUserContext = (viewModel: ScheduleAssignmentViewModel) => {
  return (user: BaseManageableUserState): React.ReactNode => {
    const scheduleUser = user as ScheduleManageableUserState;
    if (!scheduleUser.currentScheduleId) return null;

    // Check if this user is being added (transfer scenario)
    const isBeingAdded = viewModel.usersToAdd.includes(scheduleUser.id);

    if (isBeingAdded) {
      return (
        <span className="text-xs px-1.5 py-0.5 bg-amber-200 text-amber-700 rounded inline-flex items-center gap-1">
          <ArrowRightLeft size={10} />
          Transferring from: {scheduleUser.currentScheduleName}
        </span>
      );
    }

    return <span className="text-xs text-gray-400">On: {scheduleUser.currentScheduleName}</span>;
  };
};

/**
 * Render transferred users section in result display.
 */
const TransferredSection: React.FC<{
  viewModel: ScheduleAssignmentViewModel;
}> = observer(({ viewModel }) => {
  if (!viewModel.result || viewModel.result.transferred.length === 0) return null;

  return (
    <div className="bg-amber-50 rounded-lg p-4">
      <h4 className="text-sm font-medium text-amber-800 mb-2">
        Transferred ({viewModel.result.transferred.length})
      </h4>
      <ul className="text-sm text-amber-700 space-y-1 max-h-24 overflow-y-auto">
        {viewModel.result.transferred.map((transfer) => {
          const user = viewModel.users.find((u) => u.id === transfer.userId);
          return (
            <li key={transfer.userId} className="flex items-center gap-2">
              <ArrowRightLeft size={14} />
              <span>
                {user?.displayName || transfer.userId}
                <span className="text-amber-600 text-xs ml-1">
                  (from {transfer.fromTemplateName})
                </span>
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
});

TransferredSection.displayName = 'TransferredSection';

export const ScheduleAssignmentDialog: React.FC<ScheduleAssignmentDialogProps> = observer(
  ({ viewModel, isOpen, onClose, onSuccess }) => {
    const dialogRef = useRef<HTMLDivElement | null>(null);
    const closeButtonRef = useRef<HTMLButtonElement | null>(null);

    log.debug('ScheduleAssignmentDialog rendering', {
      isOpen,
      state: viewModel.state,
      hasChanges: viewModel.hasChanges,
      toAdd: viewModel.usersToAdd.length,
      toRemove: viewModel.usersToRemove.length,
      toTransfer: viewModel.usersToTransfer.length,
    });

    // Focus trap and keyboard navigation
    useKeyboardNavigation({
      containerRef: dialogRef as RefObject<HTMLElement>,
      enabled: isOpen,
      trapFocus: true,
      restoreFocus: true,
      onEscape: onClose,
      wrapAround: true,
      initialFocusRef: closeButtonRef as RefObject<HTMLElement>,
    });

    // Load users when dialog opens
    useEffect(() => {
      if (isOpen && viewModel.state === 'idle') {
        viewModel.open();
      }
    }, [isOpen, viewModel]);

    // Handle close
    const handleClose = useCallback(() => {
      viewModel.close();
      onClose();
    }, [viewModel, onClose]);

    // Handle save
    const handleSave = useCallback(async () => {
      try {
        const result = await viewModel.saveChanges();
        const totalSuccess = result.added.successful.length + result.removed.successful.length;
        if (totalSuccess > 0) {
          onSuccess?.();
        }
      } catch (err) {
        log.error('Save failed', err);
      }
    }, [viewModel, onSuccess]);

    // Handle back to managing
    const handleBack = useCallback(() => {
      viewModel.backToManaging();
    }, [viewModel]);

    // Handle search
    const handleSearchChange = useCallback(
      (term: string) => {
        viewModel.setSearchTerm(term);
      },
      [viewModel]
    );

    // Create render function for user context (stable reference per render)
    const renderUserContext = createRenderScheduleUserContext(viewModel);

    if (!isOpen) return null;

    const isSaving = viewModel.isSaving;
    const isCompleted = viewModel.state === 'completed';
    const isLoading = viewModel.state === 'loading';

    // Get initial assigned IDs for highlighting changes
    const initialAssignedIds = new Set(
      viewModel.users.filter((u) => viewModel['initialAssignedUserIds'].has(u.id)).map((u) => u.id)
    );

    return (
      <div
        ref={dialogRef}
        className="fixed inset-0 z-50 flex items-center justify-center"
        role="dialog"
        aria-modal="true"
        aria-labelledby="schedule-assign-title"
        aria-describedby="schedule-assign-description"
        data-focus-context="modal"
      >
        {/* Backdrop */}
        <div className="absolute inset-0 bg-black/50" onClick={handleClose} aria-hidden="true" />

        {/* Dialog Panel */}
        <div className="relative bg-white rounded-lg shadow-xl max-w-2xl w-full mx-4 flex flex-col max-h-[80vh]">
          {/* Header */}
          <div className="flex items-start justify-between p-6 border-b border-gray-200">
            <div>
              <h2
                id="schedule-assign-title"
                className="text-lg font-semibold text-gray-900 flex items-center gap-2"
              >
                <Calendar size={20} className="text-blue-600" />
                Manage Schedule Assignments: {viewModel.template.name}
              </h2>
              <p id="schedule-assign-description" className="mt-1 text-sm text-gray-500">
                Check/uncheck users to assign or remove from this schedule template. Users on
                another template will be automatically transferred.
              </p>
            </div>
            <button
              ref={closeButtonRef}
              onClick={handleClose}
              className="text-gray-400 hover:text-gray-600 p-1"
              aria-label="Close dialog"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Error Alert */}
          {viewModel.error && (
            <div className="px-6 pt-4">
              <AssignmentAlert
                variant="error"
                icon={<XCircle className="h-5 w-5 text-red-600" />}
                title="Error"
              >
                {viewModel.error}
              </AssignmentAlert>
            </div>
          )}

          {/* Main Content */}
          <div className="flex-1 overflow-y-auto p-6">
            {isLoading ? (
              <div className="h-[400px] flex items-center justify-center">
                <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
                <span className="ml-2 text-gray-600">Loading users...</span>
              </div>
            ) : isCompleted ? (
              <div className="h-[400px]">
                <SyncResultDisplay
                  result={viewModel.result!}
                  users={viewModel.users}
                  correlationId={viewModel.correlationId}
                  isCompleteSuccess={viewModel.isCompleteSuccess}
                  isPartialSuccess={viewModel.isPartialSuccess}
                  onClose={handleClose}
                  onBack={handleBack}
                  extraSections={<TransferredSection viewModel={viewModel} />}
                />
              </div>
            ) : (
              <div className="h-[400px]">
                <ManageableUserList
                  users={viewModel.filteredUsers}
                  initialAssignedIds={initialAssignedIds}
                  onToggleUser={(id) => viewModel.toggleUser(id)}
                  searchTerm={viewModel.searchTerm}
                  onSearchChange={handleSearchChange}
                  isLoading={viewModel.isLoading}
                  hasMore={viewModel.hasMore}
                  onLoadMore={() => viewModel.loadMore()}
                  renderUserContext={renderUserContext}
                />
              </div>
            )}
          </div>

          {/* Footer (only in managing mode) */}
          {!isCompleted && !isLoading && (
            <div className="flex items-center justify-between p-6 border-t border-gray-200">
              {/* Changes Summary */}
              <span className="text-sm text-gray-500 flex items-center gap-2">
                <Users size={16} />
                {viewModel.hasChanges ? (
                  <span
                    className={cn(
                      viewModel.usersToAdd.length > 0 && 'text-green-600',
                      viewModel.usersToRemove.length > 0 &&
                        viewModel.usersToAdd.length === 0 &&
                        'text-red-600'
                    )}
                  >
                    {viewModel.changesSummary}
                  </span>
                ) : (
                  <span className="text-gray-400">No changes</span>
                )}
              </span>
              <div className="flex gap-2">
                <Button variant="outline" onClick={handleClose} disabled={isSaving}>
                  Cancel
                </Button>
                <Button
                  onClick={handleSave}
                  disabled={!viewModel.canSave || isSaving}
                  aria-label={`Save changes: ${viewModel.changesSummary}`}
                >
                  {isSaving ? (
                    <>
                      <Loader2 className="animate-spin mr-2 h-4 w-4" />
                      Saving...
                    </>
                  ) : (
                    <>
                      <CheckCircle size={16} className="mr-2" />
                      Save Changes
                    </>
                  )}
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }
);

ScheduleAssignmentDialog.displayName = 'ScheduleAssignmentDialog';
