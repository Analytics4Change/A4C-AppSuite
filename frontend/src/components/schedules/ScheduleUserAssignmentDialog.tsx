/**
 * Schedule User Assignment Dialog
 *
 * Modal dialog for selecting users to assign a schedule to.
 * Shows a searchable checklist of organization users.
 * Simplified version of RoleAssignmentDialog for schedule context.
 */

import React, { useEffect, useState, useCallback, useRef, RefObject } from 'react';
import { Button } from '@/components/ui/button';
import { useKeyboardNavigation } from '@/hooks/useKeyboardNavigation';
import { Users, X, Loader2, Search, AlertCircle } from 'lucide-react';
import { Logger } from '@/utils/logger';

const log = Logger.getLogger('component');

interface UserItem {
  id: string;
  display_name: string;
  email: string;
  is_active: boolean;
}

interface ScheduleUserAssignmentDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (userIds: string[]) => void;
  selectedUserIds: string[];
  title?: string;
}

export const ScheduleUserAssignmentDialog: React.FC<ScheduleUserAssignmentDialogProps> = ({
  isOpen,
  onClose,
  onConfirm,
  selectedUserIds: initialSelectedIds,
  title = 'Assign Users',
}) => {
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const [users, setUsers] = useState<UserItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set(initialSelectedIds));

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
    if (!isOpen) return;

    setSelectedIds(new Set(initialSelectedIds));
    setSearchTerm('');
    setLoadError(null);

    const loadUsers = async () => {
      setIsLoading(true);
      setLoadError(null);
      try {
        // Get supabase service for apiRpc + session for org_id
        const { supabaseService } = await import('@/services/auth/supabase.service');
        const client = supabaseService.getClient();
        const {
          data: { session },
        } = await client.auth.getSession();

        if (!session) throw new Error('No authenticated session');

        const payload = JSON.parse(globalThis.atob(session.access_token.split('.')[1]));
        const orgId = payload.org_id;
        if (!orgId) throw new Error('No org_id in JWT claims');

        const { data, error } = await supabaseService.apiRpc<
          Array<{
            id: string;
            email: string;
            display_name: string | null;
            is_active: boolean;
            total_count: number;
          }>
        >('list_users', {
          p_org_id: orgId,
          p_status: 'active',
          p_search_term: null,
          p_sort_by: 'name',
          p_sort_desc: false,
          p_page: 1,
          p_page_size: 200,
        });

        if (error) throw new Error(error.message);

        if (Array.isArray(data) && data.length > 0) {
          setUsers(
            data.map((u) => ({
              id: u.id,
              display_name: u.display_name || u.email || 'Unknown',
              email: u.email || '',
              is_active: u.is_active ?? true,
            }))
          );
        } else {
          setUsers([]);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to load users';
        log.error('Failed to load users for schedule assignment', err);
        setLoadError(message);
        setUsers([]);
      } finally {
        setIsLoading(false);
      }
    };

    loadUsers();
  }, [isOpen, initialSelectedIds]);

  const toggleUser = useCallback((userId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) {
        next.delete(userId);
      } else {
        next.add(userId);
      }
      return next;
    });
  }, []);

  const handleConfirm = useCallback(() => {
    onConfirm(Array.from(selectedIds));
  }, [onConfirm, selectedIds]);

  if (!isOpen) return null;

  const filteredUsers = searchTerm.trim()
    ? users.filter(
        (u) =>
          u.display_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
          u.email.toLowerCase().includes(searchTerm.toLowerCase())
      )
    : users;

  return (
    <div
      ref={dialogRef}
      className="fixed inset-0 z-50 flex items-center justify-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="schedule-assign-title"
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50" onClick={onClose} aria-hidden="true" />

      {/* Dialog Panel */}
      <div className="relative bg-white rounded-lg shadow-xl max-w-lg w-full mx-4 flex flex-col max-h-[70vh]">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-200">
          <h2
            id="schedule-assign-title"
            className="text-lg font-semibold text-gray-900 flex items-center gap-2"
          >
            <Users size={20} className="text-blue-600" />
            {title}
          </h2>
          <button
            ref={closeButtonRef}
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 p-1"
            aria-label="Close dialog"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Search */}
        <div className="p-4 border-b border-gray-200">
          <div className="relative">
            <Search
              className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400"
              aria-hidden="true"
            />
            <input
              type="text"
              placeholder="Search users..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-9 pr-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              aria-label="Search users"
            />
          </div>
        </div>

        {/* User List */}
        <div className="flex-1 overflow-y-auto">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-6 h-6 animate-spin text-blue-600" />
              <span className="ml-2 text-gray-600">Loading users...</span>
            </div>
          ) : loadError ? (
            <div className="p-8 text-center" role="alert">
              <AlertCircle className="w-12 h-12 mx-auto mb-3 text-red-400" />
              <p className="text-red-700 font-medium">Failed to load users</p>
              <p className="text-sm text-red-500 mt-1">{loadError}</p>
            </div>
          ) : filteredUsers.length === 0 ? (
            <div className="p-8 text-center text-gray-500">
              <Users className="w-12 h-12 mx-auto mb-3 text-gray-300" />
              <p>No users found</p>
            </div>
          ) : (
            filteredUsers.map((user) => (
              <label
                key={user.id}
                className="flex items-center gap-3 p-3 border-b border-gray-100 cursor-pointer hover:bg-gray-50 transition-colors"
              >
                <input
                  type="checkbox"
                  checked={selectedIds.has(user.id)}
                  onChange={() => toggleUser(user.id)}
                  className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                  aria-label={`${selectedIds.has(user.id) ? 'Unassign' : 'Assign'} ${user.display_name}`}
                />
                <div className="flex-1 min-w-0">
                  <span className="font-medium text-gray-900 truncate block">
                    {user.display_name}
                  </span>
                  <span className="text-sm text-gray-500 truncate block">{user.email}</span>
                </div>
              </label>
            ))
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between p-4 border-t border-gray-200">
          <span className="text-sm text-gray-500">{selectedIds.size} user(s) selected</span>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button onClick={handleConfirm} disabled={selectedIds.size === 0}>
              Confirm ({selectedIds.size})
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};

ScheduleUserAssignmentDialog.displayName = 'ScheduleUserAssignmentDialog';
