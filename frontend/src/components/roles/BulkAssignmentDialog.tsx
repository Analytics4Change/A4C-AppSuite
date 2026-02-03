/**
 * BulkAssignmentDialog Component
 *
 * Modal dialog for bulk assigning users to a role.
 * Provides user selection, scope selection, and result display.
 *
 * Accessibility (WCAG 2.1 Level AA + WAI-ARIA APG Dialog Pattern):
 * - Uses role="dialog" for modal indication
 * - aria-modal="true" for assistive tech
 * - aria-labelledby/describedby for content association
 * - Focus trap: Tab/Shift+Tab contained within dialog
 * - Escape key: Closes dialog and returns focus
 * - Focus restoration: Returns focus to trigger element on close
 *
 * @see BulkRoleAssignmentViewModel for state management
 * @see UserSelectionList for user selection UI
 */

import React, { useEffect, useCallback, useRef, RefObject } from 'react';
import { observer } from 'mobx-react-lite';
import { Button } from '@/components/ui/button';
import { cn } from '@/components/ui/utils';
import { useKeyboardNavigation } from '@/hooks/useKeyboardNavigation';
import {
  Users,
  UserPlus,
  CheckCircle,
  AlertTriangle,
  XCircle,
  Loader2,
  RefreshCw,
  ArrowLeft,
  X,
} from 'lucide-react';
import { UserSelectionList } from './UserSelectionList';
import { BulkRoleAssignmentViewModel } from '@/viewModels/roles/BulkRoleAssignmentViewModel';
import { Logger } from '@/utils/logger';

const log = Logger.getLogger('component');

interface BulkAssignmentDialogProps {
  /** The ViewModel managing dialog state */
  viewModel: BulkRoleAssignmentViewModel;
  /** Whether the dialog is open */
  isOpen: boolean;
  /** Callback when the dialog should close */
  onClose: () => void;
  /** Callback after successful assignment (e.g., to refresh role data) */
  onSuccess?: () => void;
}

/**
 * Alert component for displaying messages
 */
const Alert: React.FC<{
  variant?: 'success' | 'warning' | 'error';
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}> = ({ variant = 'success', icon, title, children }) => {
  const variantStyles = {
    success: 'border-green-200 bg-green-50 text-green-800',
    warning: 'border-yellow-200 bg-yellow-50 text-yellow-800',
    error: 'border-red-200 bg-red-50 text-red-800',
  };

  return (
    <div className={cn('rounded-lg border p-4', variantStyles[variant])} role="alert">
      <div className="flex items-start gap-3">
        <div className="flex-shrink-0">{icon}</div>
        <div>
          <h4 className="font-medium">{title}</h4>
          <div className="mt-1 text-sm opacity-90">{children}</div>
        </div>
      </div>
    </div>
  );
};

/**
 * Result display component for after assignment
 */
const AssignmentResult: React.FC<{
  viewModel: BulkRoleAssignmentViewModel;
  onClose: () => void;
  onRetry: () => void;
  onBack: () => void;
}> = observer(({ viewModel, onClose, onRetry, onBack }) => {
  const { result, correlationId, isCompleteSuccess, isPartialSuccess, isCompleteFail } = viewModel;

  if (!result) return null;

  return (
    <div className="space-y-4">
      {/* Success Alert */}
      {isCompleteSuccess && (
        <Alert
          variant="success"
          icon={<CheckCircle className="h-5 w-5 text-green-600" />}
          title="Assignment Complete"
        >
          Successfully assigned {result.totalSucceeded} user
          {result.totalSucceeded !== 1 ? 's' : ''} to {viewModel.role.name}.
        </Alert>
      )}

      {/* Partial Success Alert */}
      {isPartialSuccess && (
        <Alert
          variant="warning"
          icon={<AlertTriangle className="h-5 w-5 text-yellow-600" />}
          title="Partial Success"
        >
          {result.totalSucceeded} of {result.totalRequested} user
          {result.totalRequested !== 1 ? 's' : ''} assigned successfully.
          {result.totalFailed} failed.
        </Alert>
      )}

      {/* Complete Failure Alert */}
      {isCompleteFail && (
        <Alert
          variant="error"
          icon={<XCircle className="h-5 w-5 text-red-600" />}
          title="Assignment Failed"
        >
          Failed to assign users. Please try again.
        </Alert>
      )}

      {/* Successful Users */}
      {result.successful.length > 0 && (
        <div className="bg-green-50 rounded-lg p-4">
          <h4 className="text-sm font-medium text-green-800 mb-2">
            Successfully Assigned ({result.successful.length})
          </h4>
          <ul className="text-sm text-green-700 space-y-1 max-h-32 overflow-y-auto">
            {viewModel.users
              .filter((u) => result.successful.includes(u.id))
              .map((user) => (
                <li key={user.id} className="flex items-center gap-2">
                  <CheckCircle size={14} />
                  <span>{user.displayName}</span>
                </li>
              ))}
          </ul>
        </div>
      )}

      {/* Failed Users */}
      {result.failed.length > 0 && (
        <div className="bg-red-50 rounded-lg p-4">
          <h4 className="text-sm font-medium text-red-800 mb-2">
            Failed ({result.failed.length})
          </h4>
          <ul className="text-sm text-red-700 space-y-1 max-h-32 overflow-y-auto">
            {result.failed.map((failure) => {
              const user = viewModel.users.find((u) => u.id === failure.userId);
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
        <div className="text-xs text-gray-400 text-center pt-2">
          Reference: {correlationId}
        </div>
      )}

      {/* Note about JWT refresh */}
      <div className="text-sm text-gray-500 bg-gray-50 p-3 rounded-lg">
        <strong>Note:</strong> Users must log out and back in to see their new permissions
        in effect.
      </div>

      {/* Action Buttons */}
      <div className="flex gap-2 pt-2">
        {result.failed.length > 0 && (
          <Button variant="outline" onClick={onRetry} className="flex-1">
            <RefreshCw size={16} className="mr-2" />
            Retry Failed
          </Button>
        )}
        <Button variant="outline" onClick={onBack} className="flex-1">
          <ArrowLeft size={16} className="mr-2" />
          Assign More
        </Button>
        <Button onClick={onClose} className="flex-1">
          Done
        </Button>
      </div>
    </div>
  );
});

AssignmentResult.displayName = 'AssignmentResult';

/**
 * BulkAssignmentDialog - Modal for bulk role assignment
 *
 * @example
 * const viewModel = new BulkRoleAssignmentViewModel(
 *   roleService,
 *   { id: 'role-uuid', name: 'Clinician' },
 *   'acme.pediatrics'
 * );
 *
 * <BulkAssignmentDialog
 *   viewModel={viewModel}
 *   isOpen={showDialog}
 *   onClose={() => setShowDialog(false)}
 *   onSuccess={() => reloadRoleData()}
 * />
 */
export const BulkAssignmentDialog: React.FC<BulkAssignmentDialogProps> = observer(
  ({ viewModel, isOpen, onClose, onSuccess }) => {
    const dialogRef = useRef<HTMLDivElement | null>(null);
    const closeButtonRef = useRef<HTMLButtonElement | null>(null);

    log.debug('BulkAssignmentDialog rendering', {
      isOpen,
      state: viewModel.state,
      selectedCount: viewModel.selectedCount,
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

    // Handle assignment
    const handleAssign = useCallback(async () => {
      try {
        const result = await viewModel.assignRole();
        if (result.totalSucceeded > 0) {
          onSuccess?.();
        }
      } catch (err) {
        log.error('Assignment failed', err);
      }
    }, [viewModel, onSuccess]);

    // Handle retry failed
    const handleRetry = useCallback(async () => {
      try {
        const result = await viewModel.retryFailed();
        if (result && result.totalSucceeded > 0) {
          onSuccess?.();
        }
      } catch (err) {
        log.error('Retry failed', err);
      }
    }, [viewModel, onSuccess]);

    // Handle back to selecting
    const handleBack = useCallback(() => {
      viewModel.backToSelecting();
    }, [viewModel]);

    // Handle search with debounce
    const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const handleSearchChange = useCallback(
      (term: string) => {
        viewModel.setSearchTerm(term);
        // Clear previous timeout
        if (searchTimeoutRef.current) {
          clearTimeout(searchTimeoutRef.current);
        }
        // Debounced refresh - wait 300ms after typing stops
        searchTimeoutRef.current = setTimeout(() => {
          viewModel.refresh();
        }, 300);
      },
      [viewModel]
    );

    // Cleanup timeout on unmount
    useEffect(() => {
      return () => {
        if (searchTimeoutRef.current) {
          clearTimeout(searchTimeoutRef.current);
        }
      };
    }, []);

    if (!isOpen) return null;

    const isProcessing = viewModel.isProcessing;
    const isCompleted = viewModel.state === 'completed';

    return (
      <div
        ref={dialogRef}
        className="fixed inset-0 z-50 flex items-center justify-center"
        role="dialog"
        aria-modal="true"
        aria-labelledby="bulk-assign-title"
        aria-describedby="bulk-assign-description"
        data-focus-context="modal"
      >
        {/* Backdrop */}
        <div
          className="absolute inset-0 bg-black/50"
          onClick={handleClose}
          aria-hidden="true"
        />

        {/* Dialog Panel */}
        <div className="relative bg-white rounded-lg shadow-xl max-w-2xl w-full mx-4 flex flex-col max-h-[80vh]">
          {/* Header */}
          <div className="flex items-start justify-between p-6 border-b border-gray-200">
            <div>
              <h2
                id="bulk-assign-title"
                className="text-lg font-semibold text-gray-900 flex items-center gap-2"
              >
                <UserPlus size={20} className="text-blue-600" />
                Assign Users to Role: {viewModel.role.name}
              </h2>
              <p id="bulk-assign-description" className="mt-1 text-sm text-gray-500">
                Select users to assign to this role at scope: {viewModel.scopePath || '(root)'}
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
              <Alert
                variant="error"
                icon={<XCircle className="h-5 w-5 text-red-600" />}
                title="Error"
              >
                {viewModel.error}
              </Alert>
            </div>
          )}

          {/* Main Content */}
          <div className="flex-1 overflow-hidden p-6">
            {isCompleted ? (
              <AssignmentResult
                viewModel={viewModel}
                onClose={handleClose}
                onRetry={handleRetry}
                onBack={handleBack}
              />
            ) : (
              <div className="h-[400px]">
                <UserSelectionList
                  users={viewModel.filteredUsers}
                  selectedUserIds={viewModel.selectedUserIds}
                  onToggleUser={(id) => viewModel.toggleUser(id)}
                  onSelectAll={() => viewModel.selectAll()}
                  onDeselectAll={() => viewModel.deselectAll()}
                  allSelected={viewModel.allEligibleSelected}
                  someSelected={viewModel.someEligibleSelected}
                  searchTerm={viewModel.searchTerm}
                  onSearchChange={handleSearchChange}
                  eligibleCount={viewModel.eligibleCount}
                  isLoading={viewModel.isLoading}
                  hasMore={viewModel.hasMore}
                  onLoadMore={() => viewModel.loadMore()}
                />
              </div>
            )}
          </div>

          {/* Footer (only in selection mode) */}
          {!isCompleted && (
            <div className="flex items-center justify-between p-6 border-t border-gray-200">
              <span className="text-sm text-gray-500 flex items-center gap-1">
                <Users size={16} />
                {viewModel.selectedCount} user{viewModel.selectedCount !== 1 ? 's' : ''} selected
              </span>
              <div className="flex gap-2">
                <Button variant="outline" onClick={handleClose} disabled={isProcessing}>
                  Cancel
                </Button>
                <Button
                  onClick={handleAssign}
                  disabled={!viewModel.canAssign || isProcessing}
                  aria-label={`Assign ${viewModel.selectedCount} users to ${viewModel.role.name}`}
                >
                  {isProcessing ? (
                    <>
                      <Loader2 className="animate-spin mr-2 h-4 w-4" />
                      Assigning...
                    </>
                  ) : (
                    <>
                      <UserPlus size={16} className="mr-2" />
                      Assign {viewModel.selectedCount} User
                      {viewModel.selectedCount !== 1 ? 's' : ''}
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

BulkAssignmentDialog.displayName = 'BulkAssignmentDialog';
