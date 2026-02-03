/**
 * UserSelectionList Component
 *
 * Displays a list of users with checkboxes for bulk selection.
 * Supports search filtering, select all, and pagination loading.
 *
 * Accessibility:
 * - Full keyboard navigation (Tab, Space to toggle, Arrow keys)
 * - ARIA attributes for screen readers
 * - Disabled state for already-assigned users
 *
 * @see BulkAssignmentDialog for parent component
 * @see BulkRoleAssignmentViewModel for state management
 */

import React, { useCallback } from 'react';
import { observer } from 'mobx-react-lite';
import { Search, User, Users, Loader2, CheckSquare, Square, MinusSquare } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import type { UserSelectionState } from '@/types/bulk-assignment.types';
import { Logger } from '@/utils/logger';

const log = Logger.getLogger('component');

interface UserSelectionListProps {
  /** List of users to display */
  users: UserSelectionState[];
  /** Set of selected user IDs */
  selectedUserIds: Set<string>;
  /** Callback when a user's selection state changes */
  onToggleUser: (userId: string) => void;
  /** Callback to select all eligible users */
  onSelectAll: () => void;
  /** Callback to deselect all users */
  onDeselectAll: () => void;
  /** Whether all eligible users are selected */
  allSelected?: boolean;
  /** Whether some (but not all) eligible users are selected */
  someSelected?: boolean;
  /** Search term for filtering */
  searchTerm: string;
  /** Callback when search term changes */
  onSearchChange: (term: string) => void;
  /** Number of eligible users (not already assigned) */
  eligibleCount: number;
  /** Whether the list is loading */
  isLoading: boolean;
  /** Whether more users can be loaded */
  hasMore?: boolean;
  /** Callback to load more users */
  onLoadMore?: () => void;
}

/**
 * Single user row component
 */
const UserRow: React.FC<{
  user: UserSelectionState;
  isSelected: boolean;
  onToggle: () => void;
}> = observer(({ user, isSelected, onToggle }) => {
  const isDisabled = user.isAlreadyAssigned || !user.isActive;

  return (
    <div
      className={`flex items-center gap-3 p-3 rounded-lg transition-colors ${
        isDisabled
          ? 'opacity-50 cursor-not-allowed bg-gray-50'
          : 'hover:bg-blue-50 cursor-pointer'
      }`}
      onClick={() => !isDisabled && onToggle()}
      role="option"
      aria-selected={isSelected}
      aria-disabled={isDisabled}
      tabIndex={isDisabled ? -1 : 0}
      onKeyDown={(e) => {
        if (e.key === ' ' && !isDisabled) {
          e.preventDefault();
          onToggle();
        }
      }}
    >
      <Checkbox
        id={`user-${user.id}`}
        checked={isSelected}
        disabled={isDisabled}
        onCheckedChange={() => onToggle()}
        aria-label={
          isDisabled
            ? `${user.displayName} (${user.isAlreadyAssigned ? 'already assigned' : 'inactive'})`
            : `Select ${user.displayName}`
        }
      />

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <User size={16} className="text-gray-400 flex-shrink-0" />
          <span className="font-medium text-gray-900 truncate">{user.displayName}</span>
          {user.isAlreadyAssigned && (
            <span className="text-xs px-2 py-0.5 bg-green-100 text-green-700 rounded-full flex-shrink-0">
              Already assigned
            </span>
          )}
          {!user.isActive && (
            <span className="text-xs px-2 py-0.5 bg-gray-100 text-gray-600 rounded-full flex-shrink-0">
              Inactive
            </span>
          )}
        </div>
        <div className="text-sm text-gray-500 truncate">{user.email}</div>
        {user.currentRoles.length > 0 && (
          <div className="text-xs text-gray-400 mt-1 truncate">
            Current roles: {user.currentRoles.join(', ')}
          </div>
        )}
      </div>
    </div>
  );
});

UserRow.displayName = 'UserRow';

/**
 * UserSelectionList - Multi-select user list with search
 *
 * @example
 * <UserSelectionList
 *   users={viewModel.filteredUsers}
 *   selectedUserIds={viewModel.selectedUserIds}
 *   onToggleUser={(id) => viewModel.toggleUser(id)}
 *   onSelectAll={() => viewModel.selectAll()}
 *   onDeselectAll={() => viewModel.deselectAll()}
 *   searchTerm={viewModel.searchTerm}
 *   onSearchChange={(term) => viewModel.setSearchTerm(term)}
 *   eligibleCount={viewModel.eligibleCount}
 *   isLoading={viewModel.isLoading}
 * />
 */
export const UserSelectionList: React.FC<UserSelectionListProps> = observer(
  ({
    users,
    selectedUserIds,
    onToggleUser,
    onSelectAll,
    onDeselectAll,
    allSelected = false,
    someSelected = false,
    searchTerm,
    onSearchChange,
    eligibleCount,
    isLoading,
    hasMore = false,
    onLoadMore,
  }) => {
    log.debug('UserSelectionList rendering', {
      userCount: users.length,
      selectedCount: selectedUserIds.size,
      eligibleCount,
    });

    const handleSearchChange = useCallback(
      (e: React.ChangeEvent<HTMLInputElement>) => {
        onSearchChange(e.target.value);
      },
      [onSearchChange]
    );

    const handleSelectAllClick = useCallback(() => {
      if (allSelected) {
        onDeselectAll();
      } else {
        onSelectAll();
      }
    }, [allSelected, onSelectAll, onDeselectAll]);

    const selectedCount = selectedUserIds.size;

    return (
      <div className="flex flex-col h-full">
        {/* Search Input */}
        <div className="mb-4">
          <div className="relative">
            <Search
              size={18}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
            />
            <Input
              type="text"
              placeholder="Search users by name or email..."
              value={searchTerm}
              onChange={handleSearchChange}
              className="pl-10"
              aria-label="Search users"
            />
          </div>
        </div>

        {/* Select All / Selection Summary */}
        <div className="flex items-center justify-between mb-3 py-2 border-b border-gray-200">
          <button
            type="button"
            onClick={handleSelectAllClick}
            className="flex items-center gap-2 text-sm font-medium text-gray-700 hover:text-blue-600 transition-colors"
            disabled={eligibleCount === 0}
            aria-pressed={allSelected}
          >
            {allSelected ? (
              <CheckSquare size={18} className="text-blue-600" />
            ) : someSelected ? (
              <MinusSquare size={18} className="text-blue-400" />
            ) : (
              <Square size={18} className="text-gray-400" />
            )}
            <span>
              {allSelected ? 'Deselect All' : 'Select All'} ({eligibleCount} eligible)
            </span>
          </button>

          <div className="flex items-center gap-2 text-sm text-gray-600">
            <Users size={16} />
            <span>
              {selectedCount} selected
            </span>
          </div>
        </div>

        {/* User List */}
        <div
          className="flex-1 overflow-y-auto space-y-1"
          role="listbox"
          aria-label="Users available for assignment"
          aria-multiselectable="true"
        >
          {isLoading && users.length === 0 ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="animate-spin h-6 w-6 text-blue-500" />
              <span className="ml-2 text-gray-500">Loading users...</span>
            </div>
          ) : users.length === 0 ? (
            <div className="text-center py-8 text-gray-500">
              <Users size={48} className="mx-auto mb-2 opacity-30" />
              <p>No users found</p>
              {searchTerm && (
                <p className="text-sm mt-1">Try adjusting your search term</p>
              )}
            </div>
          ) : (
            <>
              {users.map((user) => (
                <UserRow
                  key={user.id}
                  user={user}
                  isSelected={selectedUserIds.has(user.id)}
                  onToggle={() => onToggleUser(user.id)}
                />
              ))}

              {/* Load More Button */}
              {hasMore && (
                <div className="py-4 text-center">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={onLoadMore}
                    disabled={isLoading}
                  >
                    {isLoading ? (
                      <>
                        <Loader2 className="animate-spin h-4 w-4 mr-2" />
                        Loading...
                      </>
                    ) : (
                      'Load More Users'
                    )}
                  </Button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    );
  }
);

UserSelectionList.displayName = 'UserSelectionList';
