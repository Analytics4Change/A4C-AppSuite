/**
 * Users Management Page
 *
 * Single-page interface for managing users with split view layout.
 * Left panel: Filterable user/invitation list with selection
 * Right panel: Form for invite/edit with role selector
 *
 * Features:
 * - Split view layout (list 1/3 + form 2/3)
 * - Select user → shows editable form
 * - Create mode for new invitations
 * - Smart email lookup with contextual actions
 * - Deactivate/Reactivate/Delete operations for users
 * - Resend/Revoke operations for invitations
 * - Unsaved changes warning
 *
 * Route: /users/manage
 * Permission: user.create, user.delete
 */

import React, { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { observer } from 'mobx-react-lite';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { UserList, UserFormFields } from '@/components/users';
import { AccessDatesForm, NotificationPreferencesForm, UserPhonesSection } from '@/components/users';
import { UsersViewModel } from '@/viewModels/users/UsersViewModel';
import { UserFormViewModel } from '@/viewModels/users/UserFormViewModel';
import { getUserQueryService, getUserCommandService } from '@/services/users';
import { getRoleService } from '@/services/roles';
import { useAuth } from '@/contexts/AuthContext';
import type { UserListItem, UserDisplayStatus, NotificationPreferences, UserPhone } from '@/types/user.types';
import { DEFAULT_NOTIFICATION_PREFERENCES } from '@/types/user.types';
import type { Role } from '@/types/role.types';
import {
  Plus,
  RefreshCw,
  ArrowLeft,
  UserPlus,
  AlertTriangle,
  X,
  CheckCircle,
  XCircle,
  Save,
  Mail,
  Power,
  PowerOff,
  Trash2,
} from 'lucide-react';
import { Logger } from '@/utils/logger';
import { cn } from '@/components/ui/utils';

const log = Logger.getLogger('component');

/** Panel mode: empty (no selection), edit (user selected), create (inviting new user) */
type PanelMode = 'empty' | 'edit' | 'create';

/**
 * Discriminated union for dialog state.
 */
type DialogState =
  | { type: 'none' }
  | { type: 'discard' }
  | { type: 'deactivate'; isLoading: boolean }
  | { type: 'reactivate'; isLoading: boolean }
  | { type: 'resend'; isLoading: boolean }
  | { type: 'revoke'; isLoading: boolean }
  | { type: 'delete'; isLoading: boolean }
  | { type: 'delete-warning' };

/**
 * Users Management Page Component
 */
export const UsersManagePage: React.FC = observer(() => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { session } = useAuth();
  const organizationId = session?.claims?.org_id ?? '';

  // List ViewModel - manages user list state
  const [viewModel] = useState(
    () => new UsersViewModel(getUserQueryService(), getUserCommandService())
  );

  // Available roles for assignment
  const [availableRoles, setAvailableRoles] = useState<Role[]>([]);

  // Panel mode: empty, edit, or create
  const [panelMode, setPanelMode] = useState<PanelMode>('empty');

  // Current user/invitation being edited
  const [currentItem, setCurrentItem] = useState<UserListItem | null>(null);

  // Form ViewModel (for edit and create modes)
  const [formViewModel, setFormViewModel] = useState<UserFormViewModel | null>(null);

  // Dialog state
  const [dialogState, setDialogState] = useState<DialogState>({ type: 'none' });
  const pendingActionRef = useRef<{
    type: 'select' | 'create';
    itemId?: string;
  } | null>(null);

  // Error states
  const [operationError, setOperationError] = useState<string | null>(null);

  // Filter state
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<UserDisplayStatus | 'all'>('all');

  // Notification preferences state (for selected user)
  const [notificationPrefs, setNotificationPrefs] = useState<NotificationPreferences>(DEFAULT_NOTIFICATION_PREFERENCES);
  const [userPhones, setUserPhones] = useState<UserPhone[]>([]);
  const [isLoadingPrefs, setIsLoadingPrefs] = useState(false);
  const [isSavingPrefs, setIsSavingPrefs] = useState(false);

  // Load users and roles on mount
  useEffect(() => {
    log.debug('UsersManagePage mounted, loading data');
    viewModel.loadAll();

    // Load available roles
    const loadRoles = async () => {
      try {
        const roleService = getRoleService();
        const roles = await roleService.getRoles();
        // Filter to active roles only
        setAvailableRoles(roles.filter((r) => r.isActive));
        log.debug('Available roles loaded', { roleCount: roles.length });
      } catch (error) {
        log.error('Failed to load roles', error);
      }
    };
    loadRoles();
  }, [viewModel]);

  // Handle URL params for initial selection
  useEffect(() => {
    const userId = searchParams.get('userId');
    const invitationId = searchParams.get('invitationId');
    const mode = searchParams.get('mode');

    if (mode === 'create') {
      enterCreateMode();
    } else if (userId) {
      selectAndLoadUser(userId, false);
    } else if (invitationId) {
      selectAndLoadUser(invitationId, true);
    }
  }, [searchParams, viewModel.items]);

  // Sync roles to ViewModel when they load (handles async timing)
  // This fixes the case where user clicks Create before roles finish loading
  useEffect(() => {
    if (formViewModel && availableRoles.length > 0) {
      const roleRefs = availableRoles.map((r: Role) => ({
        roleId: r.id,
        roleName: r.name,
      }));
      formViewModel.setAssignableRoles(roleRefs);
      log.debug('Synced roles to formViewModel', { roleCount: roleRefs.length });
    }
  }, [formViewModel, availableRoles]);

  // Filter users based on search and status
  const filteredUsers = useMemo(() => {
    let users = viewModel.items;

    if (statusFilter !== 'all') {
      users = users.filter((u: UserListItem) => u.displayStatus === statusFilter);
    }

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

  // Select and load a user or invitation for editing
  const selectAndLoadUser = useCallback(
    async (itemId: string, isInvitation: boolean) => {
      setOperationError(null);
      try {
        const item = viewModel.items.find((u: UserListItem) => u.id === itemId);

        if (item) {
          setCurrentItem(item);
          // Convert Role[] to RoleReference[]
          const roleRefs = availableRoles.map((r: Role) => ({
            roleId: r.id,
            roleName: r.name,
          }));
          const form = new UserFormViewModel(roleRefs);
          // Initialize form with list item data
          form.setEmail(item.email);
          form.setFirstName(item.firstName || '');
          form.setLastName(item.lastName || '');
          form.setRoles(item.roles.map((r) => r.roleId));
          form.syncOriginalData(); // Sync baseline to prevent false "unsaved changes"
          setFormViewModel(form);
          setPanelMode('edit');
          // Ensure viewModel state is synced
          await viewModel.selectItem(itemId);

          // Load notification preferences and phones for active users
          if (!item.isInvitation && item.displayStatus === 'active') {
            setIsLoadingPrefs(true);
            try {
              const queryService = getUserQueryService();
              const [prefs, phones] = await Promise.all([
                queryService.getUserNotificationPreferences(item.id),
                queryService.getUserPhones(item.id),
              ]);
              setNotificationPrefs(prefs);
              setUserPhones(phones);
              log.debug('Loaded notification preferences and phones', {
                userId: item.id,
                smsEnabled: prefs.sms.enabled,
                phoneCount: phones.length,
              });
            } catch (prefsError) {
              log.error('Failed to load notification preferences', prefsError);
              // Don't block - use defaults
              setNotificationPrefs(DEFAULT_NOTIFICATION_PREFERENCES);
              setUserPhones([]);
            } finally {
              setIsLoadingPrefs(false);
            }
          } else {
            // Reset for invitations or inactive users
            setNotificationPrefs(DEFAULT_NOTIFICATION_PREFERENCES);
            setUserPhones([]);
          }

          log.debug('User/invitation loaded for editing', {
            itemId,
            isInvitation: item.isInvitation,
          });
        }
      } catch (error) {
        log.error('Failed to load user/invitation', error);
        setOperationError('Failed to load user details');
      }
    },
    [viewModel, availableRoles]
  );

  // Handle user list selection with dirty check
  const handleUserSelect = useCallback(
    (item: UserListItem) => {
      if (item.id === viewModel.selectedItemId && panelMode === 'edit') {
        return;
      }

      if (formViewModel?.isDirty) {
        pendingActionRef.current = { type: 'select', itemId: item.id };
        setDialogState({ type: 'discard' });
      } else {
        selectAndLoadUser(item.id, item.isInvitation);
      }
    },
    [viewModel.selectedItemId, panelMode, formViewModel, selectAndLoadUser]
  );

  // Handle discard changes
  const handleDiscardChanges = useCallback(() => {
    const pending = pendingActionRef.current;
    setDialogState({ type: 'none' });
    pendingActionRef.current = null;

    if (pending?.type === 'select' && pending.itemId) {
      const item = viewModel.items.find((u: UserListItem) => u.id === pending.itemId);
      if (item) {
        selectAndLoadUser(pending.itemId, item.isInvitation);
      }
    } else if (pending?.type === 'create') {
      enterCreateMode();
    }
  }, [selectAndLoadUser, viewModel.items]);

  // Handle cancel discard
  const handleCancelDiscard = useCallback(() => {
    setDialogState({ type: 'none' });
    pendingActionRef.current = null;
  }, []);

  // Enter create mode
  const enterCreateMode = useCallback(() => {
    setOperationError(null);
    // Convert Role[] to RoleReference[]
    const roleRefs = availableRoles.map((r: Role) => ({
      roleId: r.id,
      roleName: r.name,
    }));
    setFormViewModel(new UserFormViewModel(roleRefs));
    setCurrentItem(null);
    setPanelMode('create');
    viewModel.clearSelection();
    log.debug('Entered create mode');
  }, [viewModel, availableRoles]);

  // Handle create button click with dirty check
  const handleCreateClick = useCallback(() => {
    if (formViewModel?.isDirty) {
      pendingActionRef.current = { type: 'create' };
      setDialogState({ type: 'discard' });
    } else {
      enterCreateMode();
    }
  }, [formViewModel, enterCreateMode]);

  // Handle form submission
  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!formViewModel) return;

      const commandService = getUserCommandService();
      const result = await formViewModel.submit(commandService);

      if (result.success) {
        log.info('Form submitted successfully', { mode: panelMode });
        await viewModel.loadAll();
        // Reset form after successful creation
        if (panelMode === 'create') {
          formViewModel.reset();
        }
      }
    },
    [formViewModel, panelMode, viewModel]
  );

  // Handle cancel in form
  const handleCancel = useCallback(() => {
    if (panelMode === 'create') {
      if (viewModel.selectedItemId) {
        const item = viewModel.items.find(
          (u: UserListItem) => u.id === viewModel.selectedItemId
        );
        if (item) {
          selectAndLoadUser(viewModel.selectedItemId, item.isInvitation);
        }
      } else {
        setPanelMode('empty');
        setFormViewModel(null);
        setCurrentItem(null);
      }
    }
  }, [panelMode, viewModel.selectedItemId, viewModel.items, selectAndLoadUser]);

  // Navigation handlers
  const handleBackClick = () => {
    navigate('/users');
  };

  // Deactivate handlers
  const handleDeactivateClick = useCallback(() => {
    if (currentItem && !currentItem.isInvitation && currentItem.displayStatus === 'active') {
      setOperationError(null);
      setDialogState({ type: 'deactivate', isLoading: false });
    }
  }, [currentItem]);

  const handleDeactivateConfirm = useCallback(async () => {
    if (!currentItem) return;

    setDialogState({ type: 'deactivate', isLoading: true });
    setOperationError(null);
    try {
      const result = await viewModel.deactivateUser(currentItem.id);

      if (result.success) {
        setDialogState({ type: 'none' });
        log.info('User deactivated successfully', { userId: currentItem.id });
        await viewModel.loadAll();
        selectAndLoadUser(currentItem.id, false);
      } else {
        setDialogState({ type: 'none' });
        setOperationError(result.error || 'Failed to deactivate user');
      }
    } catch (error) {
      setDialogState({ type: 'none' });
      setOperationError(
        error instanceof Error ? error.message : 'Failed to deactivate user'
      );
    }
  }, [currentItem, viewModel, selectAndLoadUser]);

  // Reactivate handlers
  const handleReactivateClick = useCallback(() => {
    if (currentItem && !currentItem.isInvitation && currentItem.displayStatus === 'deactivated') {
      setOperationError(null);
      setDialogState({ type: 'reactivate', isLoading: false });
    }
  }, [currentItem]);

  const handleReactivateConfirm = useCallback(async () => {
    if (!currentItem) return;

    setDialogState({ type: 'reactivate', isLoading: true });
    setOperationError(null);
    try {
      const result = await viewModel.reactivateUser(currentItem.id);

      if (result.success) {
        setDialogState({ type: 'none' });
        log.info('User reactivated successfully', { userId: currentItem.id });
        await viewModel.loadAll();
        selectAndLoadUser(currentItem.id, false);
      } else {
        setDialogState({ type: 'none' });
        setOperationError(result.error || 'Failed to reactivate user');
      }
    } catch (error) {
      setDialogState({ type: 'none' });
      setOperationError(
        error instanceof Error ? error.message : 'Failed to reactivate user'
      );
    }
  }, [currentItem, viewModel, selectAndLoadUser]);

  // Resend invitation handlers
  const handleResendClick = useCallback(() => {
    if (currentItem && currentItem.isInvitation) {
      setOperationError(null);
      setDialogState({ type: 'resend', isLoading: false });
    }
  }, [currentItem]);

  const handleResendConfirm = useCallback(async () => {
    if (!currentItem || !currentItem.invitationId) return;

    setDialogState({ type: 'resend', isLoading: true });
    setOperationError(null);
    try {
      const result = await viewModel.resendInvitation(currentItem.invitationId);

      if (result.success) {
        setDialogState({ type: 'none' });
        log.info('Invitation resent successfully', {
          invitationId: currentItem.invitationId,
        });
        await viewModel.loadAll();
      } else {
        setDialogState({ type: 'none' });
        setOperationError(result.error || 'Failed to resend invitation');
      }
    } catch (error) {
      setDialogState({ type: 'none' });
      setOperationError(
        error instanceof Error ? error.message : 'Failed to resend invitation'
      );
    }
  }, [currentItem, viewModel]);

  // Revoke invitation handlers
  const handleRevokeClick = useCallback(() => {
    if (currentItem && currentItem.isInvitation) {
      setOperationError(null);
      setDialogState({ type: 'revoke', isLoading: false });
    }
  }, [currentItem]);

  const handleRevokeConfirm = useCallback(async () => {
    if (!currentItem || !currentItem.invitationId) return;

    setDialogState({ type: 'revoke', isLoading: true });
    setOperationError(null);
    try {
      const result = await viewModel.revokeInvitation(currentItem.invitationId);

      if (result.success) {
        setDialogState({ type: 'none' });
        log.info('Invitation revoked successfully', {
          invitationId: currentItem.invitationId,
        });
        setPanelMode('empty');
        setFormViewModel(null);
        setCurrentItem(null);
        await viewModel.loadAll();
      } else {
        setDialogState({ type: 'none' });
        setOperationError(result.error || 'Failed to revoke invitation');
      }
    } catch (error) {
      setDialogState({ type: 'none' });
      setOperationError(
        error instanceof Error ? error.message : 'Failed to revoke invitation'
      );
    }
  }, [currentItem, viewModel]);

  // Delete handlers
  const handleDeleteClick = useCallback(() => {
    if (!currentItem || currentItem.isInvitation) return;

    setOperationError(null);
    // If user is active, show warning that they must be deactivated first
    if (currentItem.displayStatus === 'active') {
      setDialogState({ type: 'delete-warning' });
    } else if (currentItem.displayStatus === 'deactivated') {
      setDialogState({ type: 'delete', isLoading: false });
    }
  }, [currentItem]);

  const handleDeleteConfirm = useCallback(async () => {
    if (!currentItem) return;

    setDialogState({ type: 'delete', isLoading: true });
    setOperationError(null);
    try {
      const result = await viewModel.deleteUser(currentItem.id);

      if (result.success) {
        setDialogState({ type: 'none' });
        log.info('User deleted successfully', { userId: currentItem.id });
        setPanelMode('empty');
        setFormViewModel(null);
        setCurrentItem(null);
        // List refresh is handled by the viewModel.deleteUser method
      } else {
        setDialogState({ type: 'none' });
        setOperationError(result.error || 'Failed to delete user');
      }
    } catch (error) {
      setDialogState({ type: 'none' });
      setOperationError(
        error instanceof Error ? error.message : 'Failed to delete user'
      );
    }
  }, [currentItem, viewModel]);

  // Save notification preferences handler
  const handleSaveNotificationPreferences = useCallback(
    async (preferences: NotificationPreferences) => {
      if (!currentItem || currentItem.isInvitation || !organizationId) return;

      setIsSavingPrefs(true);
      setOperationError(null);
      try {
        const commandService = getUserCommandService();
        const result = await commandService.updateNotificationPreferences({
          userId: currentItem.id,
          orgId: organizationId,
          notificationPreferences: preferences,
        });

        if (result.success) {
          setNotificationPrefs(preferences);
          log.info('Notification preferences saved', { userId: currentItem.id });
        } else {
          setOperationError(result.error || 'Failed to save notification preferences');
        }
      } catch (error) {
        log.error('Error saving notification preferences', error);
        setOperationError(
          error instanceof Error ? error.message : 'Failed to save notification preferences'
        );
      } finally {
        setIsSavingPrefs(false);
      }
    },
    [currentItem, organizationId]
  );

  // Get display name for current item
  const getDisplayName = (item: UserListItem | null): string => {
    if (!item) return '';
    if (item.firstName && item.lastName) {
      return `${item.firstName} ${item.lastName}`;
    }
    return item.email;
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-blue-50 p-8">
      <div className="max-w-7xl mx-auto">
        {/* Page Header */}
        <div className="mb-8">
          <div className="flex items-center gap-4 mb-4">
            <Button
              variant="outline"
              size="sm"
              onClick={handleBackClick}
              className="text-gray-600"
            >
              <ArrowLeft className="w-4 h-4 mr-1" />
              Back to Users
            </Button>
          </div>
          <div className="flex items-center gap-3">
            <UserPlus className="w-8 h-8 text-blue-600" />
            <div>
              <h1 className="text-3xl font-bold text-gray-900">User Management</h1>
              <p className="text-gray-600 mt-1">
                Invite and manage users within your organization
              </p>
            </div>
          </div>
        </div>

        {/* Error Banner */}
        {(viewModel.error || operationError) && (
          <div
            className="mb-6 p-4 rounded-lg border border-red-300 bg-red-50"
            role="alert"
          >
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <h3 className="text-red-800 font-semibold">Error</h3>
                <p className="text-red-700 text-sm mt-1">
                  {viewModel.error || operationError}
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  viewModel.clearError();
                  setOperationError(null);
                }}
                className="text-red-600 border-red-300"
              >
                Dismiss
              </Button>
            </div>
          </div>
        )}

        {/* Split View Layout */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left Panel: User List */}
          <div className="lg:col-span-1">
            <Card className="shadow-lg h-[calc(100vh-280px)]">
              <CardHeader className="border-b border-gray-200 pb-4">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-lg font-semibold text-gray-900">
                    Users
                  </CardTitle>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => viewModel.loadAll()}
                    disabled={viewModel.isLoading}
                  >
                    <RefreshCw
                      className={cn('w-4 h-4', viewModel.isLoading && 'animate-spin')}
                    />
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="p-0 h-[calc(100%-80px)]">
                <UserList
                  users={filteredUsers}
                  selectedId={viewModel.selectedItemId}
                  searchTerm={searchTerm}
                  onSearchChange={setSearchTerm}
                  statusFilter={statusFilter}
                  onStatusFilterChange={setStatusFilter}
                  onUserClick={handleUserSelect}
                  isLoading={viewModel.isLoading}
                  totalCount={viewModel.totalCount}
                />
              </CardContent>
            </Card>
          </div>

          {/* Right Panel: Form Panel */}
          <div className="lg:col-span-2">
            {/* Create Button */}
            <Button
              onClick={handleCreateClick}
              disabled={viewModel.isLoading}
              className="w-full mb-4 bg-blue-600 hover:bg-blue-700 text-white justify-start"
            >
              <Plus className="w-4 h-4 mr-2" />
              Invite New User
            </Button>

            {/* Empty State */}
            {panelMode === 'empty' && (
              <Card className="shadow-lg">
                <CardContent className="p-12 text-center">
                  <UserPlus className="w-16 h-16 text-gray-300 mx-auto mb-4" />
                  <h3 className="text-xl font-medium text-gray-900 mb-2">
                    No User Selected
                  </h3>
                  <p className="text-gray-500 max-w-md mx-auto">
                    Select a user from the list to view and edit their details,
                    or click "Invite New User" to add someone to your organization.
                  </p>
                </CardContent>
              </Card>
            )}

            {/* Create Mode */}
            {panelMode === 'create' && formViewModel && (
              <Card className="shadow-lg">
                <CardHeader className="border-b border-gray-200">
                  <div className="flex items-center gap-2">
                    <Mail className="w-5 h-5 text-blue-600" />
                    <CardTitle className="text-xl font-semibold text-gray-900">
                      Invite New User
                    </CardTitle>
                  </div>
                  <p className="text-sm text-gray-500 mt-1">
                    Send an invitation to join your organization
                  </p>
                </CardHeader>
                <CardContent className="p-6">
                  <form onSubmit={handleSubmit} className="space-y-6">
                    {/* Submission Error */}
                    {formViewModel.submissionError && (
                      <div
                        className="p-4 rounded-lg border border-red-300 bg-red-50"
                        role="alert"
                      >
                        <div className="flex items-start gap-2">
                          <AlertTriangle className="w-5 h-5 text-red-600 flex-shrink-0" />
                          <div className="flex-1">
                            <h4 className="text-red-800 font-semibold">
                              Failed to send invitation
                            </h4>
                            <p className="text-red-700 text-sm mt-1">
                              {formViewModel.submissionError}
                            </p>
                            {formViewModel.submissionErrorDetails?.details && (
                              <p className="text-red-600 text-xs mt-2 font-mono bg-red-100 p-2 rounded">
                                Details: {formViewModel.submissionErrorDetails.details}
                              </p>
                            )}
                          </div>
                          <button
                            type="button"
                            onClick={() => formViewModel.clearSubmissionError()}
                            className="text-red-600 hover:text-red-800"
                            aria-label="Dismiss error"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Form Fields */}
                    <UserFormFields
                      formData={formViewModel.formData}
                      onFieldChange={formViewModel.updateField.bind(formViewModel)}
                      onFieldBlur={formViewModel.touchField.bind(formViewModel)}
                      getFieldError={formViewModel.getFieldError.bind(formViewModel)}
                      availableRoles={availableRoles}
                      onRoleToggle={formViewModel.toggleRole.bind(formViewModel)}
                      emailLookup={formViewModel.emailLookupResult}
                      isEmailLookupLoading={formViewModel.isCheckingEmail}
                      onEmailBlur={() => {
                        // Email lookup integration - for now just mark as touched
                        formViewModel.touchField('email');
                      }}
                      suggestedAction={
                        formViewModel.suggestedAction === 'none'
                          ? null
                          : formViewModel.suggestedAction
                      }
                      onSuggestedAction={() => {
                        // Handle suggested action based on status
                        log.debug('Suggested action clicked', {
                          action: formViewModel.suggestedAction,
                        });
                      }}
                      disabled={formViewModel.isSubmitting}
                    />

                    {/* Access Dates (Optional) */}
                    <div className="border-t border-gray-200 pt-6">
                      <h4 className="text-sm font-medium text-gray-700 mb-3">
                        Access Window (Optional)
                      </h4>
                      <AccessDatesForm
                        accessStartDate={formViewModel.formData.accessStartDate || null}
                        accessExpirationDate={formViewModel.formData.accessExpirationDate || null}
                        onChange={(data) => {
                          // Real-time sync - dates are captured immediately as user types
                          formViewModel.setAccessStartDate(data.accessStartDate || undefined);
                          formViewModel.setAccessExpirationDate(
                            data.accessExpirationDate || undefined
                          );
                        }}
                        onSave={() => {
                          // No-op: onChange handles real-time sync in inline mode
                        }}
                        inline
                      />
                    </div>

                    {/* Form Actions */}
                    <div className="flex items-center justify-end gap-3 pt-4 border-t border-gray-200">
                      <Button
                        type="button"
                        variant="outline"
                        onClick={handleCancel}
                        disabled={formViewModel.isSubmitting}
                      >
                        Cancel
                      </Button>
                      <Button
                        type="submit"
                        disabled={!formViewModel.canSubmit}
                        className="bg-blue-600 hover:bg-blue-700 text-white"
                      >
                        <Mail className="w-4 h-4 mr-1" />
                        {formViewModel.isSubmitting ? 'Sending...' : 'Send Invitation'}
                      </Button>
                    </div>
                  </form>
                </CardContent>
              </Card>
            )}

            {/* Loading State - while user details are being fetched */}
            {panelMode === 'edit' && currentItem && !formViewModel && viewModel.isLoadingDetails && (
              <Card className="shadow-lg">
                <CardContent className="p-12 text-center">
                  <RefreshCw className="w-12 h-12 text-blue-500 mx-auto mb-4 animate-spin" />
                  <h3 className="text-lg font-medium text-gray-900 mb-2">
                    Loading User Details
                  </h3>
                  <p className="text-gray-500">
                    Please wait while we fetch the user information...
                  </p>
                </CardContent>
              </Card>
            )}

            {/* Edit Mode */}
            {panelMode === 'edit' && currentItem && formViewModel && (
              <div className="space-y-4">
                {/* Inactive Warning Banner */}
                {currentItem.displayStatus === 'deactivated' && (
                  <div className="p-4 rounded-lg border border-amber-300 bg-amber-50">
                    <div className="flex items-start gap-3">
                      <XCircle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
                      <div className="flex-1">
                        <h3 className="text-amber-800 font-semibold">
                          Deactivated User
                        </h3>
                        <p className="text-amber-700 text-sm mt-1">
                          This user is deactivated and cannot access the application.
                        </p>
                      </div>
                      <Button
                        type="button"
                        size="sm"
                        onClick={handleReactivateClick}
                        disabled={
                          formViewModel.isSubmitting ||
                          (dialogState.type === 'reactivate' && dialogState.isLoading)
                        }
                        className="bg-green-600 hover:bg-green-700 text-white flex-shrink-0"
                      >
                        <CheckCircle className="w-4 h-4 mr-1" />
                        {dialogState.type === 'reactivate' && dialogState.isLoading
                          ? 'Reactivating...'
                          : 'Reactivate'}
                      </Button>
                    </div>
                  </div>
                )}

                {/* Pending/Expired Invitation Banner */}
                {currentItem.isInvitation && (
                  <div
                    className={cn(
                      'p-4 rounded-lg border',
                      currentItem.displayStatus === 'expired'
                        ? 'border-red-300 bg-red-50'
                        : 'border-yellow-300 bg-yellow-50'
                    )}
                  >
                    <div className="flex items-start gap-3">
                      <Mail
                        className={cn(
                          'w-5 h-5 flex-shrink-0 mt-0.5',
                          currentItem.displayStatus === 'expired'
                            ? 'text-red-600'
                            : 'text-yellow-600'
                        )}
                      />
                      <div className="flex-1">
                        <h3
                          className={cn(
                            'font-semibold',
                            currentItem.displayStatus === 'expired'
                              ? 'text-red-800'
                              : 'text-yellow-800'
                          )}
                        >
                          {currentItem.displayStatus === 'expired'
                            ? 'Expired Invitation'
                            : 'Pending Invitation'}
                        </h3>
                        <p
                          className={cn(
                            'text-sm mt-1',
                            currentItem.displayStatus === 'expired'
                              ? 'text-red-700'
                              : 'text-yellow-700'
                          )}
                        >
                          {currentItem.displayStatus === 'expired'
                            ? 'This invitation has expired. Send a new invitation.'
                            : 'Waiting for the user to accept.'}
                        </p>
                      </div>
                      <div className="flex gap-2 flex-shrink-0">
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={handleResendClick}
                          disabled={
                            formViewModel.isSubmitting ||
                            (dialogState.type === 'resend' && dialogState.isLoading)
                          }
                        >
                          <RefreshCw className="w-4 h-4 mr-1" />
                          Resend
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={handleRevokeClick}
                          disabled={
                            formViewModel.isSubmitting ||
                            (dialogState.type === 'revoke' && dialogState.isLoading)
                          }
                          className="text-red-600 border-red-300 hover:bg-red-50"
                        >
                          <Trash2 className="w-4 h-4 mr-1" />
                          Revoke
                        </Button>
                      </div>
                    </div>
                  </div>
                )}

                {/* Form Card */}
                <Card className="shadow-lg">
                  <CardHeader className="border-b border-gray-200">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-xl font-semibold text-gray-900">
                        {currentItem.isInvitation ? 'Invitation Details' : 'User Details'}
                      </CardTitle>
                      <span
                        className={cn(
                          'inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium',
                          currentItem.displayStatus === 'active'
                            ? 'bg-green-100 text-green-800'
                            : currentItem.displayStatus === 'pending'
                              ? 'bg-yellow-100 text-yellow-800'
                              : currentItem.displayStatus === 'expired'
                                ? 'bg-red-100 text-red-800'
                                : 'bg-gray-100 text-gray-600'
                        )}
                      >
                        {currentItem.displayStatus.charAt(0).toUpperCase() +
                          currentItem.displayStatus.slice(1)}
                      </span>
                    </div>
                  </CardHeader>
                  <CardContent className="p-6">
                    <form onSubmit={handleSubmit} className="space-y-6">
                      {/* Submission Error */}
                      {formViewModel.submissionError && (
                        <div
                          className="p-4 rounded-lg border border-red-300 bg-red-50"
                          role="alert"
                        >
                          <div className="flex items-start gap-2">
                            <AlertTriangle className="w-5 h-5 text-red-600 flex-shrink-0" />
                            <div className="flex-1">
                              <h4 className="text-red-800 font-semibold">
                                Failed to update
                              </h4>
                              <p className="text-red-700 text-sm mt-1">
                                {formViewModel.submissionError}
                              </p>
                              {formViewModel.submissionErrorDetails?.details && (
                                <p className="text-red-600 text-xs mt-2 font-mono bg-red-100 p-2 rounded">
                                  Details: {formViewModel.submissionErrorDetails.details}
                                </p>
                              )}
                            </div>
                            <button
                              type="button"
                              onClick={() => formViewModel.clearSubmissionError()}
                              className="text-red-600 hover:text-red-800"
                              aria-label="Dismiss error"
                            >
                              <X className="w-4 h-4" />
                            </button>
                          </div>
                        </div>
                      )}

                      {/* Form Fields */}
                      <UserFormFields
                        formData={formViewModel.formData}
                        onFieldChange={formViewModel.updateField.bind(formViewModel)}
                        onFieldBlur={formViewModel.touchField.bind(formViewModel)}
                        getFieldError={formViewModel.getFieldError.bind(formViewModel)}
                        availableRoles={availableRoles}
                        onRoleToggle={formViewModel.toggleRole.bind(formViewModel)}
                        emailLookup={null}
                        isEmailLookupLoading={false}
                        onEmailBlur={() => {}}
                        suggestedAction={null}
                        onSuggestedAction={() => {}}
                        disabled={
                          formViewModel.isSubmitting ||
                          currentItem.displayStatus === 'deactivated'
                        }
                        isEditMode
                      />

                      {/* Form Actions */}
                      {!currentItem.isInvitation && currentItem.displayStatus === 'active' && (
                        <div className="flex items-center justify-between pt-4 border-t border-gray-200">
                          <div>
                            {formViewModel.isDirty && (
                              <span className="text-sm text-amber-600">
                                Unsaved changes
                              </span>
                            )}
                          </div>
                          <Button
                            type="submit"
                            disabled={!formViewModel.canSubmit}
                            className="bg-blue-600 hover:bg-blue-700 text-white"
                          >
                            <Save className="w-4 h-4 mr-1" />
                            {formViewModel.isSubmitting ? 'Saving...' : 'Save Changes'}
                          </Button>
                        </div>
                      )}
                    </form>
                  </CardContent>
                </Card>

                {/* Phone Numbers Section (for active users only) */}
                {!currentItem.isInvitation && currentItem.displayStatus === 'active' && (
                  <UserPhonesSection
                    userId={currentItem.id}
                    editable={true}
                  />
                )}

                {/* Notification Preferences Section (for active users only) */}
                {!currentItem.isInvitation && currentItem.displayStatus === 'active' && (
                  <Card className="shadow-lg">
                    <CardContent className="p-6">
                      {isLoadingPrefs ? (
                        <div className="flex items-center justify-center py-8 text-gray-500">
                          <RefreshCw className="w-5 h-5 animate-spin mr-2" />
                          Loading notification preferences...
                        </div>
                      ) : (
                        <NotificationPreferencesForm
                          preferences={notificationPrefs}
                          availablePhones={userPhones}
                          onSave={handleSaveNotificationPreferences}
                          isSaving={isSavingPrefs}
                        />
                      )}
                    </CardContent>
                  </Card>
                )}

                {/* Danger Zone (for active and deactivated users) */}
                {!currentItem.isInvitation &&
                 (currentItem.displayStatus === 'active' || currentItem.displayStatus === 'deactivated') && (
                  <section aria-labelledby="danger-zone-heading">
                    <Card className="shadow-lg border-red-200">
                      <CardHeader className="border-b border-red-200 bg-red-50 py-3">
                        <CardTitle
                          id="danger-zone-heading"
                          className="text-sm font-semibold text-red-800"
                        >
                          Danger Zone
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="p-4 space-y-4">
                        {/* Deactivate Section (for active users) */}
                        {currentItem.displayStatus === 'active' && (
                          <div>
                            <h4 className="text-sm font-medium text-gray-900">
                              Deactivate this user
                            </h4>
                            <p className="text-xs text-gray-600 mt-1">
                              Deactivating will prevent the user from accessing the
                              application. They can be reactivated later.
                            </p>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={handleDeactivateClick}
                              disabled={
                                formViewModel?.isSubmitting ||
                                (dialogState.type === 'deactivate' && dialogState.isLoading)
                              }
                              className="mt-2 text-orange-600 border-orange-300 hover:bg-orange-50"
                            >
                              <PowerOff className="w-3 h-3 mr-1" />
                              {dialogState.type === 'deactivate' && dialogState.isLoading
                                ? 'Deactivating...'
                                : 'Deactivate User'}
                            </Button>
                          </div>
                        )}

                        {/* Delete Section */}
                        <div className={currentItem.displayStatus === 'active' ? 'pt-4 border-t border-red-200' : ''}>
                          <h4 className="text-sm font-medium text-gray-900">
                            Delete this user
                          </h4>
                          <p className="text-xs text-gray-600 mt-1">
                            Permanently remove this user from the organization.
                            {currentItem.displayStatus === 'active' && (
                              <span className="block text-orange-600 mt-1">
                                User must be deactivated before deletion.
                              </span>
                            )}
                          </p>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={handleDeleteClick}
                            disabled={
                              formViewModel?.isSubmitting ||
                              (dialogState.type === 'delete' && dialogState.isLoading)
                            }
                            className="mt-2 text-red-600 border-red-300 hover:bg-red-50"
                          >
                            <Trash2 className="w-3 h-3 mr-1" />
                            {dialogState.type === 'delete' && dialogState.isLoading
                              ? 'Deleting...'
                              : 'Delete User'}
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  </section>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Unsaved Changes Dialog */}
      <ConfirmDialog
        isOpen={dialogState.type === 'discard'}
        title="Unsaved Changes"
        message="You have unsaved changes. Do you want to discard them?"
        confirmLabel="Discard Changes"
        cancelLabel="Stay Here"
        onConfirm={handleDiscardChanges}
        onCancel={handleCancelDiscard}
        variant="warning"
      />

      {/* Deactivate Confirmation Dialog */}
      <ConfirmDialog
        isOpen={dialogState.type === 'deactivate'}
        title="Deactivate User"
        message={`Are you sure you want to deactivate "${getDisplayName(currentItem)}"? They will lose access to the application until reactivated.`}
        confirmLabel="Deactivate"
        cancelLabel="Cancel"
        onConfirm={handleDeactivateConfirm}
        onCancel={() => setDialogState({ type: 'none' })}
        isLoading={dialogState.type === 'deactivate' && dialogState.isLoading}
        variant="warning"
      />

      {/* Reactivate Confirmation Dialog */}
      <ConfirmDialog
        isOpen={dialogState.type === 'reactivate'}
        title="Reactivate User"
        message={`Are you sure you want to reactivate "${getDisplayName(currentItem)}"? They will regain access to the application.`}
        confirmLabel="Reactivate"
        cancelLabel="Cancel"
        onConfirm={handleReactivateConfirm}
        onCancel={() => setDialogState({ type: 'none' })}
        isLoading={dialogState.type === 'reactivate' && dialogState.isLoading}
        variant="success"
      />

      {/* Resend Invitation Dialog */}
      <ConfirmDialog
        isOpen={dialogState.type === 'resend'}
        title="Resend Invitation"
        message={`Are you sure you want to resend the invitation to "${currentItem?.email}"?`}
        confirmLabel="Resend"
        cancelLabel="Cancel"
        onConfirm={handleResendConfirm}
        onCancel={() => setDialogState({ type: 'none' })}
        isLoading={dialogState.type === 'resend' && dialogState.isLoading}
        variant="default"
      />

      {/* Revoke Invitation Dialog */}
      <ConfirmDialog
        isOpen={dialogState.type === 'revoke'}
        title="Revoke Invitation"
        message={`Are you sure you want to revoke the invitation for "${currentItem?.email}"? They will need a new invitation to join.`}
        confirmLabel="Revoke"
        cancelLabel="Cancel"
        onConfirm={handleRevokeConfirm}
        onCancel={() => setDialogState({ type: 'none' })}
        isLoading={dialogState.type === 'revoke' && dialogState.isLoading}
        variant="danger"
      />

      {/* Delete User Confirmation Dialog */}
      <ConfirmDialog
        isOpen={dialogState.type === 'delete'}
        title="Delete User"
        message={`Are you sure you want to permanently delete "${getDisplayName(currentItem)}"? This action cannot be undone.`}
        confirmLabel="Delete"
        cancelLabel="Cancel"
        onConfirm={handleDeleteConfirm}
        onCancel={() => setDialogState({ type: 'none' })}
        isLoading={dialogState.type === 'delete' && dialogState.isLoading}
        variant="danger"
      />

      {/* Cannot Delete Active User Warning Dialog */}
      <ConfirmDialog
        isOpen={dialogState.type === 'delete-warning'}
        title="Cannot Delete Active User"
        message={`"${getDisplayName(currentItem)}" is currently active. You must deactivate the user before they can be deleted.`}
        confirmLabel="Deactivate First"
        cancelLabel="Cancel"
        onConfirm={() => {
          setDialogState({ type: 'none' });
          handleDeactivateClick();
        }}
        onCancel={() => setDialogState({ type: 'none' })}
        variant="warning"
      />
    </div>
  );
});

export default UsersManagePage;
