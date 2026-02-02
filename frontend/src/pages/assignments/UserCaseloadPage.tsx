/**
 * User Caseload Page
 *
 * Shows all client assignments for a specific staff member.
 * Allows assigning new clients and unassigning existing ones.
 */

import React, { useEffect, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, UserCheck, UserPlus, UserMinus } from 'lucide-react';
import { AssignmentListViewModel } from '@/viewModels/assignment/AssignmentListViewModel';

export const UserCaseloadPage: React.FC = observer(() => {
  const { userId } = useParams<{ userId: string }>();
  const navigate = useNavigate();
  const [vm] = useState(() => new AssignmentListViewModel());

  // Assign form state
  const [showAssignForm, setShowAssignForm] = useState(false);
  const [newClientId, setNewClientId] = useState('');
  const [newNotes, setNewNotes] = useState('');
  const [newAssignedUntil, setNewAssignedUntil] = useState('');
  const [assignReason, setAssignReason] = useState('');
  const [isAssigning, setIsAssigning] = useState(false);

  // Unassign state
  const [unassignTarget, setUnassignTarget] = useState<string | null>(null);
  const [unassignReason, setUnassignReason] = useState('');
  const [isUnassigning, setIsUnassigning] = useState(false);

  useEffect(() => {
    if (userId) {
      vm.setFilterUserId(userId);
      vm.loadAssignments();
    }
  }, [vm, userId]);

  const handleAssign = async () => {
    if (!userId || !newClientId.trim() || assignReason.length < 10) return;
    setIsAssigning(true);
    const success = await vm.assignClient({
      userId,
      clientId: newClientId.trim(),
      assignedUntil: newAssignedUntil || undefined,
      notes: newNotes || undefined,
      reason: assignReason,
    });
    setIsAssigning(false);
    if (success) {
      setShowAssignForm(false);
      setNewClientId('');
      setNewNotes('');
      setNewAssignedUntil('');
      setAssignReason('');
    }
  };

  const handleUnassign = async (clientId: string) => {
    if (!userId || unassignReason.length < 10) return;
    setIsUnassigning(true);
    const success = await vm.unassignClient(userId, clientId, unassignReason);
    setIsUnassigning(false);
    if (success) {
      setUnassignTarget(null);
      setUnassignReason('');
    }
  };

  const userName = vm.assignments[0]?.user_name ?? 'Staff Member';

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => navigate('/assignments')}
          className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors
                   focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
          aria-label="Back to assignments"
        >
          <ArrowLeft className="h-5 w-5 text-gray-600" />
        </button>
        <UserCheck className="h-6 w-6 text-blue-600" aria-hidden="true" />
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{userName}&apos;s Caseload</h1>
          <p className="text-sm text-gray-500">
            {vm.assignments.filter((a) => a.is_active).length} active assignment{vm.assignments.filter((a) => a.is_active).length !== 1 ? 's' : ''}
          </p>
        </div>
      </div>

      {/* Assign new client button */}
      <div>
        <button
          onClick={() => setShowAssignForm(!showAssignForm)}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg
                   bg-blue-600 text-white text-sm font-medium hover:bg-blue-700
                   focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
        >
          <UserPlus className="h-4 w-4" />
          Assign Client
        </button>
      </div>

      {/* Assign form */}
      {showAssignForm && (
        <div className="rounded-xl border border-blue-200 bg-blue-50/50 p-4 space-y-3">
          <h3 className="text-sm font-medium text-gray-900">Assign New Client</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="client-id" className="block text-xs font-medium text-gray-700 mb-1">Client ID</label>
              <input
                id="client-id"
                type="text"
                value={newClientId}
                onChange={(e) => setNewClientId(e.target.value)}
                placeholder="UUID of client"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm
                         focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
              />
            </div>
            <div>
              <label htmlFor="assigned-until" className="block text-xs font-medium text-gray-700 mb-1">Assigned Until (optional)</label>
              <input
                id="assigned-until"
                type="date"
                value={newAssignedUntil}
                onChange={(e) => setNewAssignedUntil(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm
                         focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
              />
            </div>
          </div>
          <div>
            <label htmlFor="assign-notes" className="block text-xs font-medium text-gray-700 mb-1">Notes (optional)</label>
            <input
              id="assign-notes"
              type="text"
              value={newNotes}
              onChange={(e) => setNewNotes(e.target.value)}
              placeholder="Assignment notes"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm
                       focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
            />
          </div>
          <div>
            <label htmlFor="assign-reason" className="block text-xs font-medium text-gray-700 mb-1">
              Reason <span className="text-gray-400">(min 10 characters)</span>
            </label>
            <input
              id="assign-reason"
              type="text"
              value={assignReason}
              onChange={(e) => setAssignReason(e.target.value)}
              placeholder="Reason for assignment..."
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm
                       focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
            />
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleAssign}
              disabled={!newClientId.trim() || assignReason.length < 10 || isAssigning}
              className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium
                       hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed
                       focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
            >
              {isAssigning ? 'Assigning...' : 'Assign'}
            </button>
            <button
              onClick={() => setShowAssignForm(false)}
              className="px-4 py-2 rounded-lg border border-gray-300 text-gray-700 text-sm
                       hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

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
      {!vm.isLoading && !vm.error && vm.assignments.length === 0 && (
        <div className="text-center py-12">
          <UserCheck className="mx-auto h-12 w-12 text-gray-300" aria-hidden="true" />
          <h3 className="mt-4 text-lg font-medium text-gray-900">No assignments</h3>
          <p className="mt-2 text-sm text-gray-500">This staff member has no client assignments yet.</p>
        </div>
      )}

      {/* Assignment list */}
      {!vm.isLoading && vm.assignments.length > 0 && (
        <div className="space-y-3">
          {vm.assignments.map((assignment) => (
            <div
              key={assignment.id}
              className={`rounded-xl border p-4 transition-colors ${
                assignment.is_active
                  ? 'border-gray-200/60 bg-white/70'
                  : 'border-gray-100 bg-gray-50/50'
              }`}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className={`w-2 h-2 rounded-full ${assignment.is_active ? 'bg-green-400' : 'bg-gray-300'}`} />
                  <div>
                    <p className="text-sm font-mono text-gray-900">{assignment.client_id}</p>
                    <p className="text-xs text-gray-500">
                      Assigned {new Date(assignment.assigned_at).toLocaleDateString()}
                      {assignment.assigned_until && ` · Until ${assignment.assigned_until.slice(0, 10)}`}
                    </p>
                    {assignment.notes && (
                      <p className="text-xs text-gray-400 mt-0.5">{assignment.notes}</p>
                    )}
                  </div>
                </div>

                {assignment.is_active && (
                  <>
                    {unassignTarget === assignment.client_id ? (
                      <div className="flex items-center gap-2">
                        <input
                          type="text"
                          value={unassignReason}
                          onChange={(e) => setUnassignReason(e.target.value)}
                          placeholder="Reason (min 10 chars)..."
                          className="w-48 px-2 py-1 border border-gray-300 rounded text-xs
                                   focus:border-red-500 focus:ring-1 focus:ring-red-500"
                          aria-label="Reason for unassignment"
                        />
                        <button
                          onClick={() => handleUnassign(assignment.client_id)}
                          disabled={unassignReason.length < 10 || isUnassigning}
                          className="px-2 py-1 rounded bg-red-600 text-white text-xs font-medium
                                   hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          {isUnassigning ? '...' : 'Confirm'}
                        </button>
                        <button
                          onClick={() => { setUnassignTarget(null); setUnassignReason(''); }}
                          className="px-2 py-1 rounded border border-gray-300 text-gray-600 text-xs hover:bg-gray-50"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => setUnassignTarget(assignment.client_id)}
                        className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs text-red-600
                                 hover:bg-red-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
                        aria-label={`Unassign client ${assignment.client_id.slice(0, 8)}`}
                      >
                        <UserMinus className="h-3 w-3" />
                        Unassign
                      </button>
                    )}
                  </>
                )}

                {!assignment.is_active && (
                  <span className="text-xs text-gray-400">Inactive</span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
});

UserCaseloadPage.displayName = 'UserCaseloadPage';
