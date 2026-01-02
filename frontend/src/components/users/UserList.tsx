import React from 'react';
import { observer } from 'mobx-react-lite';
import { Search, Filter, Users, Clock, UserX, UserCheck } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { UserCard } from './UserCard';
import type { UserListItem, UserDisplayStatus } from '@/types/user.types';
import { Logger } from '@/utils/logger';

const log = Logger.getLogger('component');

export interface UserListProps {
  /** Array of users/invitations to display */
  users: UserListItem[];
  /** Currently selected user ID */
  selectedId?: string | null;
  /** Search term value */
  searchTerm: string;
  /** Called when search term changes */
  onSearchChange: (value: string) => void;
  /** Status filter value */
  statusFilter: UserDisplayStatus | 'all';
  /** Called when status filter changes */
  onStatusFilterChange: (status: UserDisplayStatus | 'all') => void;
  /** Called when a user card is clicked */
  onUserClick: (user: UserListItem) => void;
  /** Called when deactivate action is triggered */
  onDeactivate?: (userId: string) => void;
  /** Called when reactivate action is triggered */
  onReactivate?: (userId: string) => void;
  /** Called when resend invitation action is triggered */
  onResendInvitation?: (invitationId: string) => void;
  /** Called when revoke invitation action is triggered */
  onRevokeInvitation?: (invitationId: string) => void;
  /** Whether the list is currently loading */
  isLoading?: boolean;
  /** Total count of all users (for display) */
  totalCount?: number;
  /** Show only invitations filter */
  showInvitationsOnly?: boolean;
  /** Called when invitations-only filter changes */
  onShowInvitationsOnlyChange?: (value: boolean) => void;
  /** Show only users filter */
  showUsersOnly?: boolean;
  /** Called when users-only filter changes */
  onShowUsersOnlyChange?: (value: boolean) => void;
}

/**
 * Status filter button configuration
 */
const STATUS_FILTERS: Array<{
  value: UserDisplayStatus | 'all';
  label: string;
  icon: React.ReactNode;
}> = [
  { value: 'all', label: 'All', icon: <Users size={14} /> },
  { value: 'active', label: 'Active', icon: <UserCheck size={14} /> },
  { value: 'pending', label: 'Pending', icon: <Clock size={14} /> },
  { value: 'deactivated', label: 'Inactive', icon: <UserX size={14} /> },
];

/**
 * UserList - Displays a filterable list of users and invitations
 *
 * Features:
 * - Real-time search with debouncing (handled by parent)
 * - Status filter (all, active, pending, inactive)
 * - Toggle for invitations-only or users-only views
 * - Selection state with visual feedback
 * - Empty states for no results
 *
 * @example
 * <UserList
 *   users={viewModel.displayedUsers}
 *   selectedId={viewModel.selectedUserId}
 *   searchTerm={viewModel.searchTerm}
 *   onSearchChange={viewModel.setSearchTerm}
 *   statusFilter={viewModel.statusFilter}
 *   onStatusFilterChange={viewModel.setStatusFilter}
 *   onUserClick={viewModel.selectUser}
 * />
 */
export const UserList: React.FC<UserListProps> = observer(
  ({
    users,
    selectedId,
    searchTerm,
    onSearchChange,
    statusFilter,
    onStatusFilterChange,
    onUserClick,
    onDeactivate,
    onReactivate,
    onResendInvitation,
    onRevokeInvitation,
    isLoading = false,
    totalCount,
    showInvitationsOnly = false,
    onShowInvitationsOnlyChange,
    showUsersOnly = false,
    onShowUsersOnlyChange,
  }) => {
    log.debug('UserList rendering', {
      userCount: users.length,
      selectedId,
      statusFilter,
    });

    const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Escape') {
        onSearchChange('');
        (e.target as HTMLInputElement).blur();
      }
    };

    return (
      <div className="flex flex-col h-full">
        {/* Search Bar */}
        <div className="p-4 border-b border-gray-200">
          <div className="relative">
            <Search
              className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400"
              size={18}
              aria-hidden="true"
            />
            <Input
              id="user-search"
              type="search"
              placeholder="Search by name or email..."
              value={searchTerm}
              onChange={(e) => onSearchChange(e.target.value)}
              onKeyDown={handleSearchKeyDown}
              className="pl-10 pr-4"
              aria-label="Search users"
              aria-describedby="search-help"
            />
            <span id="search-help" className="sr-only">
              Press Escape to clear the search
            </span>
          </div>

          {/* Status Filter Buttons */}
          <div className="flex gap-2 mt-3" role="group" aria-label="Filter by status">
            {STATUS_FILTERS.map((filter) => (
              <Button
                key={filter.value}
                size="sm"
                variant={statusFilter === filter.value ? 'default' : 'outline'}
                onClick={() => onStatusFilterChange(filter.value)}
                className={`flex items-center gap-1.5 transition-all ${
                  statusFilter === filter.value
                    ? 'bg-blue-600 text-white hover:bg-blue-700'
                    : 'hover:bg-gray-100'
                }`}
                aria-pressed={statusFilter === filter.value}
              >
                {filter.icon}
                {filter.label}
              </Button>
            ))}
          </div>

          {/* Type Toggle Filters */}
          {(onShowInvitationsOnlyChange || onShowUsersOnlyChange) && (
            <div className="flex gap-2 mt-3" role="group" aria-label="Filter by type">
              {onShowInvitationsOnlyChange && (
                <Button
                  size="sm"
                  variant={showInvitationsOnly ? 'default' : 'outline'}
                  onClick={() => {
                    onShowInvitationsOnlyChange(!showInvitationsOnly);
                    // Clear the other filter if enabling this one
                    if (!showInvitationsOnly && showUsersOnly && onShowUsersOnlyChange) {
                      onShowUsersOnlyChange(false);
                    }
                  }}
                  className={`flex items-center gap-1.5 transition-all ${
                    showInvitationsOnly
                      ? 'bg-yellow-600 text-white hover:bg-yellow-700'
                      : 'hover:bg-gray-100'
                  }`}
                  aria-pressed={showInvitationsOnly}
                >
                  <Clock size={14} />
                  Invitations Only
                </Button>
              )}
              {onShowUsersOnlyChange && (
                <Button
                  size="sm"
                  variant={showUsersOnly ? 'default' : 'outline'}
                  onClick={() => {
                    onShowUsersOnlyChange(!showUsersOnly);
                    // Clear the other filter if enabling this one
                    if (!showUsersOnly && showInvitationsOnly && onShowInvitationsOnlyChange) {
                      onShowInvitationsOnlyChange(false);
                    }
                  }}
                  className={`flex items-center gap-1.5 transition-all ${
                    showUsersOnly
                      ? 'bg-green-600 text-white hover:bg-green-700'
                      : 'hover:bg-gray-100'
                  }`}
                  aria-pressed={showUsersOnly}
                >
                  <UserCheck size={14} />
                  Users Only
                </Button>
              )}
            </div>
          )}

          {/* Result Count */}
          <div className="mt-3 text-sm text-gray-500 flex items-center gap-2">
            <Filter size={14} aria-hidden="true" />
            <span>
              Showing {users.length}
              {totalCount && totalCount > users.length && ` of ${totalCount}`}
              {' '}
              {users.length === 1 ? 'result' : 'results'}
            </span>
          </div>
        </div>

        {/* User Cards List */}
        <div
          className="flex-1 overflow-y-auto p-4 space-y-3"
          role="list"
          aria-label="Users and invitations"
        >
          {isLoading ? (
            // Loading skeleton
            <div className="space-y-3" aria-busy="true" aria-label="Loading users">
              {[1, 2, 3].map((i) => (
                <div
                  key={i}
                  className="h-40 rounded-lg bg-gray-100 animate-pulse"
                  aria-hidden="true"
                />
              ))}
            </div>
          ) : users.length === 0 ? (
            // Empty state
            <div
              className="flex flex-col items-center justify-center py-12 text-gray-500"
              role="status"
              aria-label="No results found"
            >
              <Users size={48} className="text-gray-300 mb-4" aria-hidden="true" />
              <h3 className="font-medium text-gray-700 mb-1">No users found</h3>
              <p className="text-sm text-center max-w-xs">
                {searchTerm
                  ? `No users match "${searchTerm}". Try a different search term.`
                  : statusFilter !== 'all'
                    ? `No ${statusFilter} users. Try changing the filter.`
                    : 'No users have been added to this organization yet.'}
              </p>
            </div>
          ) : (
            // User cards
            users.map((user) => (
              <div key={user.id} role="listitem">
                <UserCard
                  user={user}
                  isSelected={selectedId === user.id}
                  onClick={onUserClick}
                  onDeactivate={onDeactivate}
                  onReactivate={onReactivate}
                  onResendInvitation={onResendInvitation}
                  onRevokeInvitation={onRevokeInvitation}
                  isLoading={isLoading}
                />
              </div>
            ))
          )}
        </div>
      </div>
    );
  }
);

UserList.displayName = 'UserList';
