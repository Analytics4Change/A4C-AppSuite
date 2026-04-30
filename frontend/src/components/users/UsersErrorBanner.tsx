/**
 * Users page error banner — renders structured error state with stable test-ids.
 *
 * Three variants in priority order:
 *   1. Role-validation failure → renders per-violation list with
 *      `data-testid="role-modification-violation"` and per-row
 *      `data-testid="role-violation-<error_code>"`.
 *   2. Role-modification partial failure (multi-event loop short-circuit) →
 *      renders contextual recovery copy with
 *      `data-testid="role-modification-partial-warning"` and (if present)
 *      `data-testid="role-partial-processing-error"` for the masked PG error.
 *   3. Generic error → falls through to the message string from the VM or
 *      the page-level `operationError` state.
 *
 * Container always carries `data-testid="users-error-banner"`. Dismiss
 * button carries `data-testid="users-error-banner-dismiss"`. Extracted from
 * UsersManagePage to make the banner unit-testable in isolation.
 */

import { observer } from 'mobx-react-lite';
import { AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { RoleAssignmentViolation } from '@/types/user.types';

export interface UsersErrorBannerProps {
  /** Generic error string from the VM (`viewModel.error`). */
  error: string | null;

  /** Page-level error state (e.g., role-load failure). */
  operationError: string | null;

  /**
   * Per-role violations from the last `modifyRoles` call when the RPC
   * returned `error: 'VALIDATION_FAILED'`. Takes priority over `error`.
   */
  lastRoleViolations: RoleAssignmentViolation[] | null;

  /**
   * Partial-failure metadata from the last `modifyRoles` call when the
   * multi-event loop short-circuited. Takes priority over `error` (but
   * not over `lastRoleViolations`).
   */
  lastRolePartialFailure: {
    failureSection: 'add' | 'remove';
    failureIndex: number;
    addedRoleEventIds: string[];
    removedRoleEventIds: string[];
    processingError?: string;
  } | null;

  /** Invoked when the user clicks Dismiss; should clear both error sources. */
  onDismiss: () => void;
}

export const UsersErrorBanner = observer(function UsersErrorBanner({
  error,
  operationError,
  lastRoleViolations,
  lastRolePartialFailure,
  onDismiss,
}: UsersErrorBannerProps) {
  if (!error && !operationError) return null;

  return (
    <div
      className="mb-6 p-4 rounded-lg border border-red-300 bg-red-50"
      role="alert"
      data-testid="users-error-banner"
    >
      <div className="flex items-start gap-3">
        <AlertTriangle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
        <div className="flex-1">
          {lastRoleViolations && lastRoleViolations.length > 0 ? (
            <div data-testid="role-modification-violation">
              <h3 className="text-red-800 font-semibold">
                {lastRoleViolations.length === 1
                  ? 'Role assignment violation'
                  : `${lastRoleViolations.length} role assignment violations`}
              </h3>
              <ul className="text-red-700 text-sm mt-1 list-disc list-inside space-y-1">
                {lastRoleViolations.map((v) => (
                  <li key={v.role_id} data-testid={`role-violation-${v.error_code}`}>
                    {v.message}
                  </li>
                ))}
              </ul>
            </div>
          ) : lastRolePartialFailure ? (
            <div data-testid="role-modification-partial-warning">
              <h3 className="text-red-800 font-semibold">Partial failure modifying roles</h3>
              <p className="text-red-700 text-sm mt-1">
                The {lastRolePartialFailure.failureSection} loop stopped at index{' '}
                {lastRolePartialFailure.failureIndex}. Re-running with the same selections is safe;
                events already emitted ({lastRolePartialFailure.addedRoleEventIds.length} added,{' '}
                {lastRolePartialFailure.removedRoleEventIds.length} removed) will be no-ops.
              </p>
              {lastRolePartialFailure.processingError && (
                <p
                  className="text-red-700 text-xs mt-1 font-mono"
                  data-testid="role-partial-processing-error"
                >
                  {lastRolePartialFailure.processingError}
                </p>
              )}
            </div>
          ) : (
            <>
              <h3 className="text-red-800 font-semibold">Error</h3>
              <p className="text-red-700 text-sm mt-1">{error || operationError}</p>
            </>
          )}
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={onDismiss}
          className="text-red-600 border-red-300"
          data-testid="users-error-banner-dismiss"
        >
          Dismiss
        </Button>
      </div>
    </div>
  );
});
