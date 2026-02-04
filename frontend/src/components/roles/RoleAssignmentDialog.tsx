/**
 * RoleAssignmentDialog Component
 *
 * Modal dialog for unified role assignment management.
 * Shows ALL users with checkboxes reflecting current assignment state.
 * Allows both adding AND removing assignments in a single operation.
 *
 * Accessibility (WCAG 2.1 Level AA + WAI-ARIA APG Dialog Pattern):
 * - Uses role="dialog" for modal indication
 * - aria-modal="true" for assistive tech
 * - aria-labelledby/describedby for content association
 * - Focus trap: Tab/Shift+Tab contained within dialog
 * - Escape key: Closes dialog and returns focus
 * - Focus restoration: Returns focus to trigger element on close
 *
 * @see RoleAssignmentViewModel for state management
 * @see UserSelectionList for user selection UI (reused from bulk assignment)
 */

import React, { useEffect, useCallback, useRef, RefObject } from 'react';
import { observer } from 'mobx-react-lite';
import { Button } from '@/components/ui/button';
import { cn } from '@/components/ui/utils';
import { useKeyboardNavigation } from '@/hooks/useKeyboardNavigation';
import {
  Users,
  Settings,
  CheckCircle,
  AlertTriangle,
  XCircle,
  Loader2,
  ArrowLeft,
  X,
  Plus,
  Minus,
} from 'lucide-react';
import { RoleAssignmentViewModel, ManageableUserState } from '@/viewModels/roles/RoleAssignmentViewModel';
import { Logger } from '@/utils/logger';

const log = Logger.getLogger('component');

interface RoleAssignmentDialogProps {
  /** The ViewModel managing dialog state */
  viewModel: RoleAssignmentViewModel;
  /** Whether the dialog is open */
  isOpen: boolean;
  /** Callback when the dialog should close */
  onClose: () => void;
  /** Callback after successful save (e.g., to refresh role data) */
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
 * User selection list for role management
 * Shows all users with checkboxes reflecting assignment status
 */
const ManageableUserList: React.FC<{
  users: ManageableUserState[];
  initialAssignedIds: Set<string>;
  onToggleUser: (userId: string) => void;
  searchTerm: string;
  onSearchChange: (term: string) => void;
  isLoading: boolean;
  hasMore: boolean;
  onLoadMore: () => void;
}> = observer(({
  users,
  initialAssignedIds,
  onToggleUser,
  searchTerm,
  onSearchChange,
  isLoading,
  hasMore,
  onLoadMore,
}) => {
  const listRef = useRef<HTMLDivElement>(null);

  // Infinite scroll handler
  const handleScroll = useCallback(() => {
    if (!listRef.current || isLoading || !hasMore) return;
    const { scrollTop, scrollHeight, clientHeight } = listRef.current;
    if (scrollTop + clientHeight >= scrollHeight - 50) {
      onLoadMore();
    }
  }, [isLoading, hasMore, onLoadMore]);

  return (
    <div className="flex flex-col h-full">
      {/* Search Input */}
      <div className="mb-3">
        <input
          type="text"
          placeholder="Search users by name or email..."
          value={searchTerm}
          onChange={(e) => onSearchChange(e.target.value)}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          aria-label="Search users"
        />
      </div>

      {/* User List */}
      <div
        ref={listRef}
        className="flex-1 overflow-y-auto border border-gray-200 rounded-lg"
        onScroll={handleScroll}
      >
        {users.length === 0 && !isLoading && (
          <div className="p-8 text-center text-gray-500">
            <Users className="w-12 h-12 mx-auto mb-3 text-gray-300" />
            <p>No users found</p>
          </div>
        )}

        {users.map((user) => {
          const wasInitiallyAssigned = initialAssignedIds.has(user.id);
          const isNowChecked = user.isChecked;
          const isChange = wasInitiallyAssigned !== isNowChecked;
          const isAdd = isChange && isNowChecked;
          const isRemove = isChange && !isNowChecked;

          return (
            <label
              key={user.id}
              className={cn(
                'flex items-center gap-3 p-3 border-b border-gray-100 cursor-pointer hover:bg-gray-50 transition-colors',
                !user.isActive && 'opacity-50 cursor-not-allowed',
                isAdd && 'bg-green-50 hover:bg-green-100',
                isRemove && 'bg-red-50 hover:bg-red-100'
              )}
            >
              <input
                type="checkbox"
                checked={isNowChecked}
                onChange={() => onToggleUser(user.id)}
                disabled={!user.isActive}
                className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                aria-label={`${isNowChecked ? 'Unassign' : 'Assign'} ${user.displayName}`}
              />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-gray-900 truncate">
                    {user.displayName}
                  </span>
                  {!user.isActive && (
                    <span className="text-xs px-1.5 py-0.5 bg-gray-200 text-gray-600 rounded">
                      Inactive
                    </span>
                  )}
                  {isAdd && (
                    <span className="text-xs px-1.5 py-0.5 bg-green-200 text-green-700 rounded flex items-center gap-1">
                      <Plus size={10} />
                      Adding
                    </span>
                  )}
                  {isRemove && (
                    <span className="text-xs px-1.5 py-0.5 bg-red-200 text-red-700 rounded flex items-center gap-1">
                      <Minus size={10} />
                      Removing
                    </span>
                  )}
                </div>
                <span className="text-sm text-gray-500 truncate block">
                  {user.email}
                </span>
                {user.currentRoles.length > 0 && (
                  <span className="text-xs text-gray-400">
                    Roles: {user.currentRoles.join(', ')}
                  </span>
                )}
              </div>
            </label>
          );
        })}

        {isLoading && (
          <div className="p-4 text-center">
            <Loader2 className="w-6 h-6 animate-spin mx-auto text-blue-600" />
          </div>
        )}
      </div>
    </div>
  );
});

ManageableUserList.displayName = 'ManageableUserList';

/**
 * Result display component for after save
 */
const SyncResult: React.FC<{
  viewModel: RoleAssignmentViewModel;
  onClose: () => void;
  onBack: () => void;
}> = observer(({ viewModel, onClose, onBack }) => {
  const { result, correlationId, isCompleteSuccess, isPartialSuccess } = viewModel;

  if (!result) return null;

  const totalChanges = result.added.successful.length + result.removed.successful.length;
  const totalFailed = result.added.failed.length + result.removed.failed.length;

  return (
    <div className="space-y-4">
      {/* Success Alert */}
      {isCompleteSuccess && totalChanges > 0 && (
        <Alert
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
        </Alert>
      )}

      {/* Partial Success Alert */}
      {isPartialSuccess && (
        <Alert
          variant="warning"
          icon={<AlertTriangle className="h-5 w-5 text-yellow-600" />}
          title="Partial Success"
        >
          {totalChanges} changes succeeded, {totalFailed} failed.
        </Alert>
      )}

      {/* Complete Failure Alert */}
      {totalChanges === 0 && totalFailed > 0 && (
        <Alert
          variant="error"
          icon={<XCircle className="h-5 w-5 text-red-600" />}
          title="Save Failed"
        >
          All operations failed. Please try again.
        </Alert>
      )}

      {/* Added Users */}
      {result.added.successful.length > 0 && (
        <div className="bg-green-50 rounded-lg p-4">
          <h4 className="text-sm font-medium text-green-800 mb-2">
            Added ({result.added.successful.length})
          </h4>
          <ul className="text-sm text-green-700 space-y-1 max-h-24 overflow-y-auto">
            {viewModel.users
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
            {viewModel.users
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

      {/* Failed Operations */}
      {(result.added.failed.length > 0 || result.removed.failed.length > 0) && (
        <div className="bg-red-50 rounded-lg p-4">
          <h4 className="text-sm font-medium text-red-800 mb-2">
            Failed ({totalFailed})
          </h4>
          <ul className="text-sm text-red-700 space-y-1 max-h-24 overflow-y-auto">
            {[...result.added.failed, ...result.removed.failed].map((failure) => {
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
        <strong>Note:</strong> Users must log out and back in to see their permission changes.
      </div>

      {/* Action Buttons */}
      <div className="flex gap-2 pt-2">
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
});

SyncResult.displayName = 'SyncResult';

/**
 * RoleAssignmentDialog - Modal for unified role assignment management
 *
 * @example
 * const viewModel = new RoleAssignmentViewModel(
 *   roleService,
 *   { id: 'role-uuid', name: 'Clinician' },
 *   'acme.pediatrics'
 * );
 *
 * <RoleAssignmentDialog
 *   viewModel={viewModel}
 *   isOpen={showDialog}
 *   onClose={() => setShowDialog(false)}
 *   onSuccess={() => reloadRoleData()}
 * />
 */
export const RoleAssignmentDialog: React.FC<RoleAssignmentDialogProps> = observer(
  ({ viewModel, isOpen, onClose, onSuccess }) => {
    const dialogRef = useRef<HTMLDivElement | null>(null);
    const closeButtonRef = useRef<HTMLButtonElement | null>(null);

    log.debug('RoleAssignmentDialog rendering', {
      isOpen,
      state: viewModel.state,
      hasChanges: viewModel.hasChanges,
      toAdd: viewModel.usersToAdd.length,
      toRemove: viewModel.usersToRemove.length,
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
        aria-labelledby="role-assign-title"
        aria-describedby="role-assign-description"
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
                id="role-assign-title"
                className="text-lg font-semibold text-gray-900 flex items-center gap-2"
              >
                <Settings size={20} className="text-blue-600" />
                Manage Role Assignments: {viewModel.role.name}
              </h2>
              <p id="role-assign-description" className="mt-1 text-sm text-gray-500">
                Check/uncheck users to assign or remove this role at scope: {viewModel.scopePath || '(root)'}
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
            {isLoading ? (
              <div className="h-[400px] flex items-center justify-center">
                <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
                <span className="ml-2 text-gray-600">Loading users...</span>
              </div>
            ) : isCompleted ? (
              <SyncResult
                viewModel={viewModel}
                onClose={handleClose}
                onBack={handleBack}
              />
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
                  <span className={cn(
                    viewModel.usersToAdd.length > 0 && 'text-green-600',
                    viewModel.usersToRemove.length > 0 && viewModel.usersToAdd.length === 0 && 'text-red-600'
                  )}>
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

RoleAssignmentDialog.displayName = 'RoleAssignmentDialog';
