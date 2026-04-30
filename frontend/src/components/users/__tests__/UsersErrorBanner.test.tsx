/**
 * UsersErrorBanner — render-variant tests with stable test-ids.
 *
 * Three branches in priority order:
 *   1. Role-validation failure (`lastRoleViolations` non-empty)
 *   2. Role-modification partial failure (`lastRolePartialFailure` set)
 *   3. Generic error (falls through to `error` || `operationError`)
 *
 * Architect review NEEDS-ATTENTION item: every variant carries a stable
 * `data-testid` so e2e tests can target them, and a future per-violation
 * UI enhancement has structured state to render against.
 *
 * Uses plain Vitest assertions and `fireEvent` from `@testing-library/react`
 * (no @testing-library/user-event dep, no jest-dom matchers — keeps the test
 * portable across the project's existing testing-library versions).
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, within, fireEvent } from '@testing-library/react';
import { UsersErrorBanner } from '../UsersErrorBanner';
import type { RoleAssignmentViolation } from '@/types/user.types';

const baseProps = {
  error: null,
  operationError: null,
  lastRoleViolations: null,
  lastRolePartialFailure: null,
  onDismiss: vi.fn(),
};

describe('UsersErrorBanner', () => {
  it('renders nothing when both error and operationError are null', () => {
    const { container } = render(<UsersErrorBanner {...baseProps} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders generic error when only `error` is set', () => {
    render(<UsersErrorBanner {...baseProps} error="Generic VM error" />);
    expect(screen.queryByTestId('users-error-banner')).not.toBeNull();
    expect(screen.queryByText('Generic VM error')).not.toBeNull();
    expect(screen.queryByTestId('role-modification-violation')).toBeNull();
    expect(screen.queryByTestId('role-modification-partial-warning')).toBeNull();
  });

  it('renders generic error when only `operationError` is set', () => {
    render(<UsersErrorBanner {...baseProps} operationError="Page-level error" />);
    expect(screen.queryByText('Page-level error')).not.toBeNull();
  });

  it('renders single-violation banner with role-modification-violation testid', () => {
    const violations: RoleAssignmentViolation[] = [
      {
        role_id: 'r1',
        role_name: 'cypress_clinician',
        error_code: 'SCOPE_HIERARCHY_VIOLATION',
        message: 'Role "cypress_clinician" scope is outside your authority',
      },
    ];
    render(
      <UsersErrorBanner
        {...baseProps}
        error="Role assignment violation"
        lastRoleViolations={violations}
      />
    );

    const banner = screen.getByTestId('role-modification-violation');
    expect(banner).not.toBeNull();
    expect(within(banner).queryByText('Role assignment violation')).not.toBeNull();
    expect(
      within(banner).queryByText('Role "cypress_clinician" scope is outside your authority')
    ).not.toBeNull();
    expect(within(banner).queryByTestId('role-violation-SCOPE_HIERARCHY_VIOLATION')).not.toBeNull();
  });

  it('renders multi-violation banner with one row per violation, each carrying its error_code testid', () => {
    const violations: RoleAssignmentViolation[] = [
      {
        role_id: 'r1',
        role_name: 'admin_role',
        error_code: 'SUBSET_ONLY_VIOLATION',
        message: 'Role "admin_role" has permissions you do not possess',
      },
      {
        role_id: 'r2',
        role_name: null,
        error_code: 'ROLE_NOT_FOUND',
        message: 'Role r2 not found or inactive',
      },
      {
        role_id: 'r3',
        role_name: 'cypress_clinician',
        error_code: 'SCOPE_HIERARCHY_VIOLATION',
        message: 'Role "cypress_clinician" scope is outside your authority',
      },
    ];
    render(
      <UsersErrorBanner
        {...baseProps}
        error="3 role assignment violations"
        lastRoleViolations={violations}
      />
    );

    const banner = screen.getByTestId('role-modification-violation');
    expect(within(banner).queryByText('3 role assignment violations')).not.toBeNull();
    expect(within(banner).queryByTestId('role-violation-SUBSET_ONLY_VIOLATION')).not.toBeNull();
    expect(within(banner).queryByTestId('role-violation-ROLE_NOT_FOUND')).not.toBeNull();
    expect(within(banner).queryByTestId('role-violation-SCOPE_HIERARCHY_VIOLATION')).not.toBeNull();
  });

  it('renders partial-failure banner with role-modification-partial-warning testid', () => {
    render(
      <UsersErrorBanner
        {...baseProps}
        error="Partial failure"
        lastRolePartialFailure={{
          failureSection: 'remove',
          failureIndex: 1,
          addedRoleEventIds: [],
          removedRoleEventIds: ['evt-rm-1'],
          processingError: 'Event processing failed: handler raised',
        }}
      />
    );

    const banner = screen.getByTestId('role-modification-partial-warning');
    expect(banner).not.toBeNull();
    // Banner copy is split across nodes by React (interpolated values render in
    // separate text nodes); assert against the full container text instead of
    // a single text-node match.
    expect(banner.textContent).toContain('remove loop stopped at index');
    expect(banner.textContent).toContain('1');
    expect(banner.textContent).toContain('0 added');
    expect(banner.textContent).toContain('1 removed');

    const procErr = within(banner).queryByTestId('role-partial-processing-error');
    expect(procErr).not.toBeNull();
    expect(procErr?.textContent).toBe('Event processing failed: handler raised');
  });

  it('omits role-partial-processing-error testid when processingError is undefined', () => {
    render(
      <UsersErrorBanner
        {...baseProps}
        error="Partial failure"
        lastRolePartialFailure={{
          failureSection: 'add',
          failureIndex: 0,
          addedRoleEventIds: [],
          removedRoleEventIds: [],
        }}
      />
    );
    expect(screen.queryByTestId('role-modification-partial-warning')).not.toBeNull();
    expect(screen.queryByTestId('role-partial-processing-error')).toBeNull();
  });

  it('prioritizes violations over partial-failure when both are set', () => {
    render(
      <UsersErrorBanner
        {...baseProps}
        error="violation wins"
        lastRoleViolations={[
          {
            role_id: 'r1',
            role_name: 'r',
            error_code: 'ROLE_NOT_FOUND',
            message: 'Role r1 not found',
          },
        ]}
        lastRolePartialFailure={{
          failureSection: 'add',
          failureIndex: 0,
          addedRoleEventIds: [],
          removedRoleEventIds: [],
        }}
      />
    );
    expect(screen.queryByTestId('role-modification-violation')).not.toBeNull();
    expect(screen.queryByTestId('role-modification-partial-warning')).toBeNull();
  });

  it('invokes onDismiss when the dismiss button is clicked', () => {
    const onDismiss = vi.fn();
    render(<UsersErrorBanner {...baseProps} error="Click me" onDismiss={onDismiss} />);
    fireEvent.click(screen.getByTestId('users-error-banner-dismiss'));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
