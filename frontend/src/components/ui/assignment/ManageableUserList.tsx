/**
 * ManageableUserList Component
 *
 * Domain-agnostic user selection list for assignment management dialogs.
 * Displays all users with checkboxes reflecting current assignment state,
 * with visual indicators for pending additions and removals.
 *
 * Features:
 * - Search input with filtering
 * - Infinite scroll with load-more trigger
 * - Color-coded add/remove tags for pending changes
 * - Render prop for domain-specific user context (e.g., current roles, schedules)
 *
 * Accessibility:
 * - aria-label on search input and each checkbox
 * - Inactive users are visually dimmed and checkboxes disabled
 *
 * @see RoleAssignmentDialog for role-specific usage
 * @see BaseManageableUserState for user state shape
 */

import React, { useCallback, useRef } from 'react';
import { observer } from 'mobx-react-lite';
import { cn } from '@/components/ui/utils';
import { Users, Plus, Minus, Loader2 } from 'lucide-react';
import type { BaseManageableUserState } from '@/types/assignment.types';

interface ManageableUserListProps {
  users: BaseManageableUserState[];
  initialAssignedIds: Set<string>;
  onToggleUser: (userId: string) => void;
  searchTerm: string;
  onSearchChange: (term: string) => void;
  isLoading: boolean;
  hasMore: boolean;
  onLoadMore: () => void;
  /** Render domain-specific context per user (e.g., current roles, current schedule) */
  renderUserContext?: (user: BaseManageableUserState) => React.ReactNode;
}

export const ManageableUserList: React.FC<ManageableUserListProps> = observer(
  ({
    users,
    initialAssignedIds,
    onToggleUser,
    searchTerm,
    onSearchChange,
    isLoading,
    hasMore,
    onLoadMore,
    renderUserContext,
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
                    <span className="font-medium text-gray-900 truncate">{user.displayName}</span>
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
                  <span className="text-sm text-gray-500 truncate block">{user.email}</span>
                  {renderUserContext?.(user)}
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
  }
);

ManageableUserList.displayName = 'ManageableUserList';
