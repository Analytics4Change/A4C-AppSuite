/**
 * User List Page
 *
 * Card-based listing of users and pending invitations.
 * Displays users in a responsive grid layout with:
 * - Status filter tabs (All / Active / Pending / Inactive)
 * - Search input
 * - User cards with quick actions
 * - Navigate to management page for details
 *
 * Route: /users
 * Permission: user.view
 */

import React, { useEffect, useState, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { observer } from 'mobx-react-lite';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { UserCard, InvitationList } from '@/components/users';
import { UsersViewModel } from '@/viewModels/users/UsersViewModel';
import { getUserQueryService, getUserCommandService } from '@/services/users';
import {
  Plus,
  Search,
  Users,
  UserCheck,
  Clock,
  UserX,
  RefreshCw,
} from 'lucide-react';
import type { UserListItem, UserDisplayStatus } from '@/types/user.types';
import { Logger } from '@/utils/logger';

const log = Logger.getLogger('component');

/**
 * Dialog state types for confirmation dialogs
 */
type DialogState =
  | { type: 'none' }
  | { type: 'deactivate'; userId: string; userName: string; isLoading: boolean }
  | { type: 'reactivate'; userId: string; userName: string; isLoading: boolean }
  | { type: 'resend'; invitationId: string; email: string; isLoading: boolean }
  | { type: 'revoke'; invitationId: string; email: string; isLoading: boolean };

/**
 * UserListPage - Card-based listing of users and invitations
 */
export const UserListPage: React.FC = observer(() => {
  const navigate = useNavigate();

  // Create ViewModel on mount
  const viewModel = useMemo(
    () => new UsersViewModel(getUserQueryService(), getUserCommandService()),
    []
  );

  // Local state
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<UserDisplayStatus | 'all'>('all');
  const [dialogState, setDialogState] = useState<DialogState>({ type: 'none' });

  // Load data on mount
  useEffect(() => {
    log.debug('UserListPage mounting, loading users');
    viewModel.loadAll();
  }, [viewModel]);

  // Filter users by search term and status (client-side for responsiveness)
  const filteredUsers = useMemo(() => {
    let users = viewModel.items;

    // Apply status filter
    if (statusFilter !== 'all') {
      users = users.filter((u: UserListItem) => u.displayStatus === statusFilter);
    }

    // Apply search filter
    if (searchTerm.trim()) {
      const term = searchTerm.toLowerCase();
      users = users.filter(
        (u: UserListItem) =>
          u.email.toLowerCase().includes(term) ||
          (u.firstName && u.firstName.toLowerCase().includes(term)) ||
          (u.lastName && u.lastName.toLowerCase().includes(term))
      );
    }

    return users;
  }, [viewModel.items, statusFilter, searchTerm]);

  // Count users by status
  const statusCounts = useMemo(() => {
    const all = viewModel.items;
    return {
      all: all.length,
      active: all.filter((u: UserListItem) => u.displayStatus === 'active').length,
      pending: all.filter((u: UserListItem) => u.displayStatus === 'pending').length,
      deactivated: all.filter(
        (u: UserListItem) => u.displayStatus === 'deactivated' || u.displayStatus === 'expired'
      ).length,
    };
  }, [viewModel.items]);

  // Navigation handlers
  const handleCreateClick = () => {
    navigate('/users/manage?mode=create');
  };

  const handleUserClick = (user: UserListItem) => {
    if (user.isInvitation) {
      navigate(`/users/manage?invitationId=${user.id}`);
    } else {
      navigate(`/users/manage?userId=${user.id}`);
    }
  };

  // Deactivate handlers
  const handleDeactivate = (userId: string) => {
    const user = viewModel.items.find((u: UserListItem) => u.id === userId);
    if (user) {
      setDialogState({
        type: 'deactivate',
        userId,
        userName: user.firstName
          ? `${user.firstName} ${user.lastName || ''}`.trim()
          : user.email,
        isLoading: false,
      });
    }
  };

  const handleDeactivateConfirm = useCallback(async () => {
    if (dialogState.type !== 'deactivate') return;

    setDialogState({ ...dialogState, isLoading: true });
    const result = await viewModel.deactivateUser(dialogState.userId);

    if (result.success) {
      log.info('User deactivated successfully', { userId: dialogState.userId });
    }
    setDialogState({ type: 'none' });
  }, [dialogState, viewModel]);

  // Reactivate handlers
  const handleReactivate = (userId: string) => {
    const user = viewModel.items.find((u: UserListItem) => u.id === userId);
    if (user) {
      setDialogState({
        type: 'reactivate',
        userId,
        userName: user.firstName
          ? `${user.firstName} ${user.lastName || ''}`.trim()
          : user.email,
        isLoading: false,
      });
    }
  };

  const handleReactivateConfirm = useCallback(async () => {
    if (dialogState.type !== 'reactivate') return;

    setDialogState({ ...dialogState, isLoading: true });
    const result = await viewModel.reactivateUser(dialogState.userId);

    if (result.success) {
      log.info('User reactivated successfully', { userId: dialogState.userId });
    }
    setDialogState({ type: 'none' });
  }, [dialogState, viewModel]);

  // Resend invitation handlers
  const handleResendInvitation = (invitationId: string) => {
    const invitation = viewModel.items.find(
      (u: UserListItem) => u.isInvitation && u.id === invitationId
    );
    if (invitation) {
      setDialogState({
        type: 'resend',
        invitationId,
        email: invitation.email,
        isLoading: false,
      });
    }
  };

  const handleResendConfirm = useCallback(async () => {
    if (dialogState.type !== 'resend') return;

    setDialogState({ ...dialogState, isLoading: true });
    const result = await viewModel.resendInvitation(dialogState.invitationId);

    if (result.success) {
      log.info('Invitation resent successfully', {
        invitationId: dialogState.invitationId,
      });
    }
    setDialogState({ type: 'none' });
  }, [dialogState, viewModel]);

  // Revoke invitation handlers
  const handleRevokeInvitation = (invitationId: string) => {
    const invitation = viewModel.items.find(
      (u: UserListItem) => u.isInvitation && u.id === invitationId
    );
    if (invitation) {
      setDialogState({
        type: 'revoke',
        invitationId,
        email: invitation.email,
        isLoading: false,
      });
    }
  };

  const handleRevokeConfirm = useCallback(async () => {
    if (dialogState.type !== 'revoke') return;

    setDialogState({ ...dialogState, isLoading: true });
    const result = await viewModel.revokeInvitation(dialogState.invitationId);

    if (result.success) {
      log.info('Invitation revoked successfully', {
        invitationId: dialogState.invitationId,
      });
    }
    setDialogState({ type: 'none' });
  }, [dialogState, viewModel]);

  const handleCancelDialog = () => {
    setDialogState({ type: 'none' });
  };

  log.debug('UserListPage rendering', {
    userCount: viewModel.totalCount,
    filteredCount: filteredUsers.length,
    statusFilter,
    searchTerm,
  });

  return (
    <div>
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">User Management</h1>
          <p className="text-gray-600 mt-1">
            Manage users and pending invitations
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => viewModel.loadAll()}
            disabled={viewModel.isLoading}
          >
            <RefreshCw
              size={16}
              className={viewModel.isLoading ? 'animate-spin' : ''}
            />
          </Button>
          <Button
            className="flex items-center gap-2"
            onClick={handleCreateClick}
            disabled={viewModel.isLoading}
          >
            <Plus size={20} />
            Invite User
          </Button>
        </div>
      </div>

      {/* Filter Tabs */}
      <div className="flex flex-wrap gap-2 mb-4" role="group" aria-label="Filter by status">
        <Button
          variant={statusFilter === 'all' ? 'default' : 'outline'}
          size="sm"
          onClick={() => setStatusFilter('all')}
          aria-pressed={statusFilter === 'all'}
          className="flex items-center gap-1.5"
        >
          <Users size={14} />
          All ({statusCounts.all})
        </Button>
        <Button
          variant={statusFilter === 'active' ? 'default' : 'outline'}
          size="sm"
          onClick={() => setStatusFilter('active')}
          aria-pressed={statusFilter === 'active'}
          className="flex items-center gap-1.5"
        >
          <UserCheck size={14} />
          Active ({statusCounts.active})
        </Button>
        <Button
          variant={statusFilter === 'pending' ? 'default' : 'outline'}
          size="sm"
          onClick={() => setStatusFilter('pending')}
          aria-pressed={statusFilter === 'pending'}
          className="flex items-center gap-1.5"
        >
          <Clock size={14} />
          Pending ({statusCounts.pending})
        </Button>
        <Button
          variant={statusFilter === 'deactivated' ? 'default' : 'outline'}
          size="sm"
          onClick={() => setStatusFilter('deactivated')}
          aria-pressed={statusFilter === 'deactivated'}
          className="flex items-center gap-1.5"
        >
          <UserX size={14} />
          Inactive ({statusCounts.deactivated})
        </Button>
      </div>

      {/* Search Bar */}
      <div className="relative mb-6">
        <Search
          className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400"
          size={20}
          aria-hidden="true"
        />
        <Input
          type="search"
          placeholder="Search by name or email..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="pl-10 max-w-md"
          aria-label="Search users"
        />
      </div>

      {/* Error Display */}
      {viewModel.error && (
        <div
          className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700"
          role="alert"
        >
          {viewModel.error}
          <Button
            variant="ghost"
            size="sm"
            className="ml-4 text-red-600 hover:text-red-800"
            onClick={() => viewModel.clearError()}
          >
            Dismiss
          </Button>
        </div>
      )}

      {/* Loading State */}
      {viewModel.isLoading && filteredUsers.length === 0 && (
        <div className="flex items-center justify-center py-12">
          <div className="flex items-center gap-3 text-gray-500">
            <Users className="w-6 h-6 animate-pulse" />
            <span>Loading users...</span>
          </div>
        </div>
      )}

      {/* User Grid */}
      <div
        className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4"
        data-testid="user-list"
        role="list"
        aria-label="Users and invitations"
      >
        {filteredUsers.map((user) => (
          <div key={user.id} role="listitem">
            <UserCard
              user={user}
              onClick={handleUserClick}
              onDeactivate={handleDeactivate}
              onReactivate={handleReactivate}
              onResendInvitation={handleResendInvitation}
              onRevokeInvitation={handleRevokeInvitation}
              isLoading={viewModel.isLoading}
            />
          </div>
        ))}
      </div>

      {/* Empty State */}
      {!viewModel.isLoading && filteredUsers.length === 0 && (
        <div className="text-center py-12">
          {viewModel.totalCount === 0 ? (
            <div>
              <Users className="w-12 h-12 mx-auto text-gray-300 mb-4" />
              <p className="text-gray-500 mb-4">
                No users in this organization yet.
              </p>
              <Button onClick={handleCreateClick}>
                <Plus size={16} className="mr-2" />
                Invite Your First User
              </Button>
            </div>
          ) : (
            <div>
              <Users className="w-12 h-12 mx-auto text-gray-300 mb-4" />
              <p className="text-gray-500">
                No users found matching your search.
              </p>
            </div>
          )}
        </div>
      )}

      {/* Deactivate Confirmation Dialog */}
      <ConfirmDialog
        isOpen={dialogState.type === 'deactivate'}
        title="Deactivate User"
        message={
          dialogState.type === 'deactivate'
            ? `Are you sure you want to deactivate "${dialogState.userName}"? They will lose access to the application until reactivated.`
            : ''
        }
        confirmLabel="Deactivate"
        cancelLabel="Cancel"
        onConfirm={handleDeactivateConfirm}
        onCancel={handleCancelDialog}
        isLoading={dialogState.type === 'deactivate' && dialogState.isLoading}
        variant="warning"
      />

      {/* Reactivate Confirmation Dialog */}
      <ConfirmDialog
        isOpen={dialogState.type === 'reactivate'}
        title="Reactivate User"
        message={
          dialogState.type === 'reactivate'
            ? `Are you sure you want to reactivate "${dialogState.userName}"? They will regain access to the application.`
            : ''
        }
        confirmLabel="Reactivate"
        cancelLabel="Cancel"
        onConfirm={handleReactivateConfirm}
        onCancel={handleCancelDialog}
        isLoading={dialogState.type === 'reactivate' && dialogState.isLoading}
        variant="success"
      />

      {/* Resend Invitation Dialog */}
      <ConfirmDialog
        isOpen={dialogState.type === 'resend'}
        title="Resend Invitation"
        message={
          dialogState.type === 'resend'
            ? `Are you sure you want to resend the invitation to "${dialogState.email}"?`
            : ''
        }
        confirmLabel="Resend"
        cancelLabel="Cancel"
        onConfirm={handleResendConfirm}
        onCancel={handleCancelDialog}
        isLoading={dialogState.type === 'resend' && dialogState.isLoading}
        variant="default"
      />

      {/* Revoke Invitation Dialog */}
      <ConfirmDialog
        isOpen={dialogState.type === 'revoke'}
        title="Revoke Invitation"
        message={
          dialogState.type === 'revoke'
            ? `Are you sure you want to revoke the invitation for "${dialogState.email}"? They will need a new invitation to join.`
            : ''
        }
        confirmLabel="Revoke"
        cancelLabel="Cancel"
        onConfirm={handleRevokeConfirm}
        onCancel={handleCancelDialog}
        isLoading={dialogState.type === 'revoke' && dialogState.isLoading}
        variant="danger"
      />
    </div>
  );
});

export default UserListPage;
