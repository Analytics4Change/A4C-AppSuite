/**
 * Orphaned Deletions Admin Page
 *
 * Platform-owner admin dashboard for monitoring organizations that were
 * soft-deleted but whose async cleanup workflow never completed.
 *
 * Features:
 * - Table listing orphaned orgs with deletion details
 * - "Retry Workflow" button per row
 * - Stats summary at top
 * - Auto-refresh every 60s
 * - Empty state when no orphaned deletions detected
 *
 * Route: /admin/deletions
 * Permission: Platform-owner only (organization.delete)
 *
 * @see services/admin/OrphanedDeletionService.ts
 */

import React, { useEffect, useState, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { orphanedDeletionService } from '@/services/admin/OrphanedDeletionService';
import type { OrphanedDeletion } from '@/services/admin/OrphanedDeletionService';
import { RefreshCw, RotateCcw, CheckCircle, XCircle, Clock, AlertTriangle } from 'lucide-react';

const AUTO_REFRESH_INTERVAL = 60_000;

export const OrphanedDeletionsPage: React.FC = () => {
  const [deletions, setDeletions] = useState<OrphanedDeletion[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState<Set<string>>(new Set());
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);

  const fetchDeletions = useCallback(async () => {
    setLoading(true);
    setError(null);

    const result = await orphanedDeletionService.getOrphanedDeletions(1);

    if (result.success && result.data) {
      setDeletions(result.data);
    } else {
      setError(result.error ?? 'Failed to fetch data');
    }

    setLoading(false);
    setLastRefresh(new Date());
  }, []);

  useEffect(() => {
    fetchDeletions();
  }, [fetchDeletions]);

  useEffect(() => {
    if (!autoRefresh) return;
    const interval = setInterval(fetchDeletions, AUTO_REFRESH_INTERVAL);
    return () => clearInterval(interval);
  }, [autoRefresh, fetchDeletions]);

  const handleRetry = async (orgId: string) => {
    setRetrying((prev) => new Set(prev).add(orgId));

    const result = await orphanedDeletionService.retryDeletionWorkflow(orgId);

    if (!result.success) {
      setError(`Retry failed for ${orgId}: ${result.error}`);
    }

    setRetrying((prev) => {
      const next = new Set(prev);
      next.delete(orgId);
      return next;
    });

    // Refresh the list after retry
    await fetchDeletions();
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleString();
  };

  const formatHours = (hours: number) => {
    if (hours < 24) return `${hours.toFixed(1)}h`;
    const days = Math.floor(hours / 24);
    const remainingHours = hours % 24;
    return `${days}d ${remainingHours.toFixed(0)}h`;
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Deletion Monitor</h1>
          <p className="text-sm text-gray-500 mt-1">
            Organizations soft-deleted without completed cleanup workflows
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setAutoRefresh(!autoRefresh)}
            className={autoRefresh ? 'border-green-300 text-green-700' : ''}
          >
            <Clock size={16} className="mr-1" />
            {autoRefresh ? 'Auto-refresh ON' : 'Auto-refresh OFF'}
          </Button>
          <Button variant="outline" size="sm" onClick={fetchDeletions} disabled={loading}>
            <RefreshCw size={16} className={`mr-1 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-gray-500">Orphaned Deletions</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{deletions.length}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-gray-500">Workflow Initiated</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-amber-600">
              {deletions.filter((d) => d.has_initiated_event && !d.has_completed_event).length}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-gray-500">Never Triggered</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-red-600">
              {deletions.filter((d) => !d.has_initiated_event).length}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Error */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-start gap-3">
          <AlertTriangle size={20} className="text-red-500 mt-0.5 shrink-0" />
          <div>
            <p className="text-sm font-medium text-red-800">Error</p>
            <p className="text-sm text-red-600">{error}</p>
          </div>
        </div>
      )}

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          {loading && deletions.length === 0 ? (
            <div className="p-8 text-center text-gray-500">
              <RefreshCw size={24} className="animate-spin mx-auto mb-2" />
              Loading...
            </div>
          ) : deletions.length === 0 ? (
            <div className="p-8 text-center text-gray-500">
              <CheckCircle size={32} className="mx-auto mb-3 text-green-400" />
              <p className="text-lg font-medium text-gray-700">No orphaned deletions detected</p>
              <p className="text-sm mt-1">
                All soft-deleted organizations have completed cleanup workflows.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-gray-50">
                    <th className="text-left p-3 font-medium text-gray-600">Organization</th>
                    <th className="text-left p-3 font-medium text-gray-600">Slug</th>
                    <th className="text-left p-3 font-medium text-gray-600">Deleted At</th>
                    <th className="text-left p-3 font-medium text-gray-600">Age</th>
                    <th className="text-left p-3 font-medium text-gray-600">Reason</th>
                    <th className="text-center p-3 font-medium text-gray-600">Initiated</th>
                    <th className="text-center p-3 font-medium text-gray-600">Completed</th>
                    <th className="text-right p-3 font-medium text-gray-600">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {deletions.map((deletion) => (
                    <tr key={deletion.id} className="border-b hover:bg-gray-50">
                      <td className="p-3 font-medium text-gray-900">{deletion.name}</td>
                      <td className="p-3 text-gray-500 font-mono text-xs">{deletion.slug}</td>
                      <td className="p-3 text-gray-600">{formatDate(deletion.deleted_at)}</td>
                      <td className="p-3">
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                            deletion.hours_since_deletion > 72
                              ? 'bg-red-100 text-red-700'
                              : deletion.hours_since_deletion > 24
                                ? 'bg-amber-100 text-amber-700'
                                : 'bg-gray-100 text-gray-700'
                          }`}
                        >
                          {formatHours(deletion.hours_since_deletion)}
                        </span>
                      </td>
                      <td className="p-3 text-gray-600 max-w-[200px] truncate">
                        {deletion.deletion_reason ?? '-'}
                      </td>
                      <td className="p-3 text-center">
                        {deletion.has_initiated_event ? (
                          <CheckCircle size={16} className="inline text-green-500" />
                        ) : (
                          <XCircle size={16} className="inline text-red-400" />
                        )}
                      </td>
                      <td className="p-3 text-center">
                        {deletion.has_completed_event ? (
                          <CheckCircle size={16} className="inline text-green-500" />
                        ) : (
                          <XCircle size={16} className="inline text-red-400" />
                        )}
                      </td>
                      <td className="p-3 text-right">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleRetry(deletion.id)}
                          disabled={retrying.has(deletion.id)}
                        >
                          {retrying.has(deletion.id) ? (
                            <RefreshCw size={14} className="animate-spin mr-1" />
                          ) : (
                            <RotateCcw size={14} className="mr-1" />
                          )}
                          Retry
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Footer */}
      {lastRefresh && (
        <p className="text-xs text-gray-400 text-right">
          Last refreshed: {lastRefresh.toLocaleTimeString()}
          {autoRefresh && ' (auto-refresh every 60s)'}
        </p>
      )}
    </div>
  );
};
