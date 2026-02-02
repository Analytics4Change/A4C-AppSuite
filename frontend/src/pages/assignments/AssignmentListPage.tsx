/**
 * Assignment List Page
 *
 * Overview of all client-staff assignments in the organization.
 * Filterable by user. Shows assignment cards grouped by staff member.
 */

import React, { useEffect, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { useNavigate } from 'react-router-dom';
import { UserCheck, Search, X } from 'lucide-react';
import { AssignmentListViewModel } from '@/viewModels/assignment/AssignmentListViewModel';

export const AssignmentListPage: React.FC = observer(() => {
  const [vm] = useState(() => new AssignmentListViewModel());
  const navigate = useNavigate();
  const [searchTerm, setSearchTerm] = useState('');

  useEffect(() => {
    vm.loadAssignments();
  }, [vm]);

  const filteredAssignments = searchTerm
    ? vm.assignments.filter(
        (a) =>
          a.user_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
          a.user_email?.toLowerCase().includes(searchTerm.toLowerCase()) ||
          a.client_id.toLowerCase().includes(searchTerm.toLowerCase())
      )
    : vm.assignments;

  // Group by user for card display
  const grouped = new Map<string, typeof filteredAssignments>();
  for (const a of filteredAssignments) {
    const key = a.user_id;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(a);
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <UserCheck className="h-6 w-6 text-blue-600" aria-hidden="true" />
          <h1 className="text-2xl font-bold text-gray-900">Client Assignments</h1>
        </div>
      </div>

      {/* Search and filters */}
      <div className="flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" aria-hidden="true" />
          <input
            type="text"
            placeholder="Search by name, email, or client ID..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-9 pr-8 py-2 border border-gray-300 rounded-lg text-sm
                     focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
            aria-label="Search assignments"
          />
          {searchTerm && (
            <button
              onClick={() => setSearchTerm('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-gray-400 hover:text-gray-600"
              aria-label="Clear search"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        <label className="flex items-center gap-2 text-sm text-gray-600">
          <input
            type="checkbox"
            checked={vm.showInactive}
            onChange={(e) => {
              vm.setShowInactive(e.target.checked);
              vm.loadAssignments();
            }}
            className="h-4 w-4 rounded border-gray-300 text-blue-600"
          />
          Show inactive
        </label>
      </div>

      {/* Loading state */}
      {vm.isLoading && (
        <div className="flex justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" role="status">
            <span className="sr-only">Loading assignments...</span>
          </div>
        </div>
      )}

      {/* Error state */}
      {vm.error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700" role="alert">
          {vm.error}
        </div>
      )}

      {/* Empty state */}
      {!vm.isLoading && !vm.error && grouped.size === 0 && (
        <div className="text-center py-12">
          <UserCheck className="mx-auto h-12 w-12 text-gray-300" aria-hidden="true" />
          <h3 className="mt-4 text-lg font-medium text-gray-900">No assignments found</h3>
          <p className="mt-2 text-sm text-gray-500">
            {searchTerm
              ? 'No assignments match your search criteria.'
              : 'No client assignments have been created yet.'}
          </p>
        </div>
      )}

      {/* Assignment cards grouped by user */}
      {!vm.isLoading && grouped.size > 0 && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[...grouped.entries()].map(([userId, assignments]) => {
            const first = assignments[0];
            const activeCount = assignments.filter((a) => a.is_active).length;
            return (
              <button
                key={userId}
                onClick={() => navigate(`/assignments/${userId}`)}
                className="text-left rounded-xl border border-gray-200/60 bg-white/70 backdrop-blur-sm p-4
                         shadow-sm hover:shadow-md hover:border-blue-200 transition-all
                         focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
              >
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <p className="font-medium text-gray-900">{first.user_name ?? 'Unknown User'}</p>
                    <p className="text-xs text-gray-500">{first.user_email}</p>
                  </div>
                  <span className="inline-flex items-center rounded-full bg-blue-50 px-2.5 py-0.5 text-xs font-medium text-blue-700">
                    {activeCount} client{activeCount !== 1 ? 's' : ''}
                  </span>
                </div>

                {/* Client ID previews */}
                <div className="space-y-1">
                  {assignments.slice(0, 3).map((a) => (
                    <div key={a.id} className="flex items-center gap-2 text-xs">
                      <span className={`w-1.5 h-1.5 rounded-full ${a.is_active ? 'bg-green-400' : 'bg-gray-300'}`} />
                      <span className="text-gray-600 truncate font-mono">{a.client_id.slice(0, 8)}...</span>
                      {a.assigned_until && (
                        <span className="text-gray-400 ml-auto">until {a.assigned_until.slice(0, 10)}</span>
                      )}
                    </div>
                  ))}
                  {assignments.length > 3 && (
                    <p className="text-[10px] text-gray-400">+{assignments.length - 3} more</p>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
});

AssignmentListPage.displayName = 'AssignmentListPage';
