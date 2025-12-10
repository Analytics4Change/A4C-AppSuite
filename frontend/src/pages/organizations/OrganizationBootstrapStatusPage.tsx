/**
 * Organization Bootstrap Status Page
 *
 * Displays real-time workflow progress for organization bootstrap.
 * Polls workflow client for status updates and shows step-by-step progress.
 *
 * Features:
 * - Real-time workflow status polling
 * - Step-by-step progress visualization
 * - Success/failure handling
 * - Redirect on completion
 * - Cancel workflow capability
 */

import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  CheckCircle,
  XCircle,
  Loader2,
  AlertCircle,
  Home
} from 'lucide-react';
import { WorkflowClientFactory } from '@/services/workflow/WorkflowClientFactory';
import type { WorkflowStatus } from '@/types';
import { Logger } from '@/utils/logger';

const log = Logger.getLogger('component');

/**
 * Organization Bootstrap Status Page Component
 *
 * Real-time workflow progress tracking with polling.
 */
export const OrganizationBootstrapStatusPage: React.FC = () => {
  const { workflowId } = useParams<{ workflowId: string }>();
  const navigate = useNavigate();

  const [status, setStatus] = useState<WorkflowStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [_isLoading, setIsLoading] = useState(true);

  const workflowClient = WorkflowClientFactory.create();

  /**
   * Fetch workflow status
   */
  const fetchStatus = async () => {
    if (!workflowId) return;

    try {
      const currentStatus = await workflowClient.getWorkflowStatus(workflowId);
      setStatus(currentStatus);
      setError(null);

      // Stop polling if workflow is terminal
      if (
        currentStatus.status === 'completed' ||
        currentStatus.status === 'failed' ||
        currentStatus.status === 'cancelled'
      ) {
        setIsLoading(false);
      }
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : 'Failed to fetch workflow status';
      setError(errorMessage);
      setIsLoading(false);
      log.error('Error fetching workflow status', err);
    }
  };

  /**
   * Poll workflow status every 2 seconds
   */
  useEffect(() => {
    if (!workflowId) {
      setError('No workflow ID provided');
      setIsLoading(false);
      return;
    }

    log.debug('Starting workflow status polling', { workflowId });

    // Initial fetch
    fetchStatus();

    // Poll every 2 seconds
    const interval = setInterval(() => {
      if (status?.status === 'running') {
        fetchStatus();
      }
    }, 2000);

    return () => {
      clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fetchStatus is stable within the component
  }, [workflowId, status?.status]);

  /**
   * Handle workflow cancellation
   */
  const handleCancel = async () => {
    if (!workflowId) return;

    try {
      await workflowClient.cancelWorkflow(workflowId);
      log.info('Workflow cancelled', { workflowId });
      await fetchStatus(); // Refresh status
    } catch (err) {
      log.error('Failed to cancel workflow', err);
    }
  };

  /**
   * Navigate to dashboard on completion
   */
  const handleComplete = () => {
    if (status?.result?.orgId) {
      navigate(`/organizations/${status.result.orgId}/dashboard`);
    } else {
      navigate('/organizations');
    }
  };

  /**
   * Get step icon based on status
   */
  const getStepIcon = (completed: boolean, hasError: boolean) => {
    if (hasError) {
      return <XCircle className="text-red-500" size={24} />;
    }
    if (completed) {
      return <CheckCircle className="text-green-500" size={24} />;
    }
    return <Loader2 className="text-blue-500 animate-spin" size={24} />;
  };

  /**
   * Get overall status color
   */
  const _getStatusColor = (workflowStatus: string) => {
    switch (workflowStatus) {
      case 'running':
        return 'text-blue-600';
      case 'completed':
        return 'text-green-600';
      case 'failed':
        return 'text-red-600';
      case 'cancelled':
        return 'text-gray-600';
      default:
        return 'text-gray-600';
    }
  };

  /**
   * Get status badge
   */
  const getStatusBadge = (workflowStatus: string) => {
    switch (workflowStatus) {
      case 'running':
        return 'bg-blue-100 text-blue-600';
      case 'completed':
        return 'bg-green-100 text-green-600';
      case 'failed':
        return 'bg-red-100 text-red-600';
      case 'cancelled':
        return 'bg-gray-100 text-gray-600';
      default:
        return 'bg-gray-100 text-gray-600';
    }
  };

  return (
    <div className="max-w-3xl mx-auto">
      {/* Page Header */}
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-gray-900">
          Organization Bootstrap
        </h1>
        <p className="text-gray-600 mt-1">
          Tracking workflow progress for organization setup
        </p>
      </div>

      {/* Error State */}
      {error && (
        <Card
          className="mb-6"
          style={{
            background: 'rgba(254, 242, 242, 0.9)',
            backdropFilter: 'blur(20px)',
            border: '1px solid rgba(239, 68, 68, 0.3)'
          }}
        >
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <AlertCircle className="text-red-500" size={24} />
              <div>
                <h3 className="font-semibold text-red-900">Error</h3>
                <p className="text-red-700">{error}</p>
              </div>
            </div>
            <div className="mt-4 flex gap-3">
              <Button
                variant="outline"
                onClick={() => navigate('/organizations')}
              >
                Return to Organizations
              </Button>
              <Button onClick={() => fetchStatus()}>Retry</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Status Card */}
      {status && (
        <Card
          className="mb-6"
          style={{
            background: 'rgba(255, 255, 255, 0.7)',
            backdropFilter: 'blur(20px)',
            WebkitBackdropFilter: 'blur(20px)',
            border: '1px solid rgba(255, 255, 255, 0.3)',
            boxShadow: '0 2px 4px rgba(0, 0, 0, 0.05)'
          }}
        >
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>Workflow Status</CardTitle>
              <span
                className={`px-3 py-1 rounded-full text-sm font-medium ${getStatusBadge(status.status)}`}
              >
                {status.status.toUpperCase()}
              </span>
            </div>
          </CardHeader>
          <CardContent>
            {/* Workflow ID */}
            <div className="mb-6 p-3 bg-gray-50 rounded-md">
              <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">
                Workflow ID
              </p>
              <p className="text-sm font-mono text-gray-700">{workflowId}</p>
            </div>

            {/* Progress Steps */}
            <div className="space-y-4">
              {(status.progress ?? []).map((step, index) => (
                <div
                  key={index}
                  className="flex items-start gap-4 p-4 rounded-lg transition-all"
                  style={{
                    background: step.completed
                      ? 'rgba(240, 253, 244, 0.6)'
                      : step.error
                        ? 'rgba(254, 242, 242, 0.6)'
                        : 'rgba(239, 246, 255, 0.6)',
                    border: '1px solid',
                    borderColor: step.completed
                      ? 'rgba(34, 197, 94, 0.2)'
                      : step.error
                        ? 'rgba(239, 68, 68, 0.2)'
                        : 'rgba(59, 130, 246, 0.2)'
                  }}
                >
                  {getStepIcon(step.completed, !!step.error)}
                  <div className="flex-1">
                    <h4
                      className={`font-medium ${
                        step.completed
                          ? 'text-green-900'
                          : step.error
                            ? 'text-red-900'
                            : 'text-blue-900'
                      }`}
                    >
                      {step.step}
                    </h4>
                    {step.error && (
                      <p className="text-sm text-red-600 mt-1">{step.error}</p>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {/* Result Information */}
            {status.status === 'completed' && status.result && (
              <div className="mt-6 p-4 bg-green-50 rounded-lg border border-green-200">
                <h4 className="font-semibold text-green-900 mb-2">
                  Organization Created Successfully
                </h4>
                <div className="space-y-2 text-sm text-green-800">
                  <p>
                    <strong>Organization ID:</strong> {status.result.orgId}
                  </p>
                  <p>
                    <strong>Domain:</strong> {status.result.domain}
                  </p>
                  <p>
                    <strong>DNS Configured:</strong>{' '}
                    {status.result.dnsConfigured ? 'Yes' : 'No'}
                  </p>
                  <p>
                    <strong>Invitations Sent:</strong>{' '}
                    {status.result.invitationsSent}
                  </p>
                </div>
              </div>
            )}

            {/* Actions */}
            <div className="mt-6 flex justify-end gap-3">
              {status.status === 'running' && (
                <Button
                  variant="outline"
                  onClick={handleCancel}
                  className="text-red-600 border-red-300 hover:bg-red-50"
                >
                  Cancel Workflow
                </Button>
              )}

              {status.status === 'completed' && (
                <Button onClick={handleComplete}>
                  <Home size={20} className="mr-2" />
                  Go to Dashboard
                </Button>
              )}

              {(status.status === 'failed' || status.status === 'cancelled') && (
                <Button
                  variant="outline"
                  onClick={() => navigate('/organizations/create')}
                >
                  Start Over
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
};
