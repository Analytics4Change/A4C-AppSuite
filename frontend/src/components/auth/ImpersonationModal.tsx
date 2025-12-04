/**
 * Impersonation Modal Component
 * Modal dialog for starting impersonation sessions
 * Requires user selection and reason input
 */

import React, { useState, useEffect, useCallback } from 'react';
import { X, AlertTriangle, Search, User } from 'lucide-react';
import { impersonationService } from '@/services/auth/impersonation.service';

interface ImpersonationModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentUser: {
    id: string;
    email: string;
    role: string;
  };
  onImpersonationStart: () => void;
}

interface UserOption {
  id: string;
  email: string;
  name: string;
  role: string;
  organizationName?: string;
}

export const ImpersonationModal: React.FC<ImpersonationModalProps> = ({
  isOpen,
  onClose,
  currentUser,
  onImpersonationStart
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedUser, setSelectedUser] = useState<UserOption | null>(null);
  const [reason, setReason] = useState('');
  const [users, setUsers] = useState<UserOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const loadUsers = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // TODO: Replace with actual user fetch from Supabase
      // For now, using mock data
      const mockUsers: UserOption[] = [
        { id: '1', email: 'john.doe@example.com', name: 'John Doe', role: 'administrator', organizationName: 'Clinic A' },
        { id: '2', email: 'jane.smith@example.com', name: 'Jane Smith', role: 'clinician', organizationName: 'Clinic A' },
        { id: '3', email: 'bob.wilson@example.com', name: 'Bob Wilson', role: 'viewer', organizationName: 'Clinic B' },
      ].filter(u => u.id !== currentUser.id); // Don't show current user

      setUsers(mockUsers);
    } catch {
      setError('Failed to load users');
    } finally {
      setLoading(false);
    }
  }, [currentUser.id]);

  useEffect(() => {
    if (isOpen) {
      loadUsers();
    } else {
      // Reset form when modal closes
      setSearchTerm('');
      setSelectedUser(null);
      setReason('');
      setError(null);
    }
  }, [isOpen, loadUsers]);

  const filteredUsers = users.filter(user =>
    user.email.toLowerCase().includes(searchTerm.toLowerCase()) ||
    user.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    user.organizationName?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!selectedUser) {
      setError('Please select a user to impersonate');
      return;
    }

    if (!reason.trim()) {
      setError('Please provide a reason for impersonation');
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      await impersonationService.startImpersonation(
        currentUser,
        {
          id: selectedUser.id,
          email: selectedUser.email,
          role: selectedUser.role
        },
        reason
      );

      onImpersonationStart();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start impersonation');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="flex min-h-screen items-center justify-center px-4 pt-4 pb-20 text-center sm:block sm:p-0">
        {/* Background overlay */}
        <div
          className="fixed inset-0 bg-gray-500 bg-opacity-75 transition-opacity"
          onClick={onClose}
        />

        <div className="inline-block align-bottom bg-white rounded-lg text-left overflow-hidden shadow-xl transform transition-all sm:my-8 sm:align-middle sm:max-w-2xl sm:w-full">
          {/* Header */}
          <div className="bg-yellow-50 border-b border-yellow-200 px-4 py-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <AlertTriangle className="h-5 w-5 text-yellow-600" />
                <h3 className="text-lg font-semibold text-gray-900">
                  Start Impersonation Session
                </h3>
              </div>
              <button
                onClick={onClose}
                className="rounded-md text-gray-400 hover:text-gray-500"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
          </div>

          {/* Warning Message */}
          <div className="bg-yellow-50 px-4 py-3 border-b border-yellow-200">
            <p className="text-sm text-yellow-800">
              <strong>Warning:</strong> All actions taken during impersonation are logged for audit purposes.
              Sessions expire after 30 minutes. Some administrative actions are blocked during impersonation.
            </p>
          </div>

          <form onSubmit={handleSubmit}>
            <div className="px-6 py-4">
              {/* Search */}
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Search Users
                </label>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                  <input
                    type="text"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    placeholder="Search by name, email, or organization..."
                    className="w-full pl-10 pr-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>

              {/* User List */}
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Select User to Impersonate
                </label>
                <div className="border border-gray-300 rounded-md max-h-48 overflow-y-auto">
                  {loading ? (
                    <div className="p-4 text-center text-gray-500">Loading users...</div>
                  ) : filteredUsers.length === 0 ? (
                    <div className="p-4 text-center text-gray-500">No users found</div>
                  ) : (
                    <div className="divide-y divide-gray-200">
                      {filteredUsers.map((user) => (
                        <label
                          key={user.id}
                          className={`flex items-center p-3 hover:bg-gray-50 cursor-pointer ${
                            selectedUser?.id === user.id ? 'bg-blue-50' : ''
                          }`}
                        >
                          <input
                            type="radio"
                            name="user"
                            value={user.id}
                            checked={selectedUser?.id === user.id}
                            onChange={() => setSelectedUser(user)}
                            className="mr-3"
                          />
                          <User className="h-4 w-4 text-gray-400 mr-2" />
                          <div className="flex-1">
                            <div className="font-medium text-gray-900">{user.name}</div>
                            <div className="text-sm text-gray-500">
                              {user.email} • {user.role.replace('_', ' ')}
                              {user.organizationName && ` • ${user.organizationName}`}
                            </div>
                          </div>
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Reason */}
              <div className="mb-4">
                <label htmlFor="reason" className="block text-sm font-medium text-gray-700 mb-2">
                  Reason for Impersonation <span className="text-red-500">*</span>
                </label>
                <textarea
                  id="reason"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  rows={3}
                  required
                  placeholder="Provide a detailed reason for this impersonation session..."
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              {/* Error Message */}
              {error && (
                <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-md">
                  <p className="text-sm text-red-800">{error}</p>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="bg-gray-50 px-6 py-3 flex justify-end space-x-3">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSubmitting || !selectedUser || !reason.trim()}
                className="px-4 py-2 bg-yellow-600 text-white rounded-md hover:bg-yellow-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-yellow-500 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isSubmitting ? 'Starting...' : 'Start Impersonation'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};