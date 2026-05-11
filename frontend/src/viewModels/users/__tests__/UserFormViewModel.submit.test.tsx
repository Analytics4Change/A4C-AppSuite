/**
 * UserFormViewModel.submit — error-surfacing tests.
 *
 * Verifies the architect-Finding-#4 contract: in edit mode with role changes,
 * the form VM delegates role-modification to the page-level `UsersViewModel`,
 * which captures structured failure state on itself (`lastRoleViolations` /
 * `lastRolePartialFailure`) for the page-level UsersErrorBanner. The form's
 * inline `submissionError` is suppressed when the page banner owns the error.
 *
 * Covers (per architect Finding #6):
 *   (a) Happy path — profile-only edit
 *   (b) Role-violation path
 *   (c) Partial-failure path
 *   (d) Non-role failure regression guard
 *   (e) Combined edit: profile-success + role-violation (the actual S4 shape)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { UserFormViewModel } from '../UserFormViewModel';
import type { UsersViewModel } from '../UsersViewModel';
import { UsersErrorBanner } from '@/components/users/UsersErrorBanner';
import type { IUserCommandService } from '@/services/users/IUserCommandService';
import type {
  RoleReference,
  UserListItem,
  ModifyUserRolesResult,
  UpdateUserResult,
  RoleAssignmentViolation,
} from '@/types/user.types';

const SUBJECT_ID = '093c0e7b-5ace-49df-9632-d49858d54ef5';
const PROVIDER_ADMIN_ROLE_ID = '4827a2c7-9c54-4f84-936e-02bbc53f1f32';
const SEQUOIA_ROLE_ID = 'ee59942f-7a61-469b-9edf-1a7b684d14ed';

const mockAssignableRoles: RoleReference[] = [
  { roleId: PROVIDER_ADMIN_ROLE_ID, roleName: 'provider_admin' },
  { roleId: SEQUOIA_ROLE_ID, roleName: 'Sequoia Med Admin' },
];

const mockExistingUser: UserListItem = {
  id: SUBJECT_ID,
  email: 'lars.tice+test2@gmail.com',
  firstName: 'Lars',
  lastName: 'Tice-Test2',
  displayStatus: 'active',
  roles: [{ roleId: SEQUOIA_ROLE_ID, roleName: 'Sequoia Med Admin' }],
  createdAt: new Date('2026-04-29'),
  expiresAt: null,
  isInvitation: false,
  invitationId: null,
};

function makeCommandService(): IUserCommandService {
  return {
    inviteUser: vi.fn(),
    updateUser: vi.fn(),
    modifyRoles: vi.fn(),
    resendInvitation: vi.fn(),
    revokeInvitation: vi.fn(),
    deactivateUser: vi.fn(),
    reactivateUser: vi.fn(),
    deleteUser: vi.fn(),
    resetPassword: vi.fn(),
    addUserToOrganization: vi.fn(),
    switchOrganization: vi.fn(),
    updateAccessDates: vi.fn(),
    addUserPhone: vi.fn(),
    updateUserPhone: vi.fn(),
    removeUserPhone: vi.fn(),
    updateNotificationPreferences: vi.fn(),
    addUserAddress: vi.fn(),
    updateUserAddress: vi.fn(),
    removeUserAddress: vi.fn(),
  } as unknown as IUserCommandService;
}

/**
 * Minimal page-VM stub that satisfies the funnel-through contract:
 *   - `modifyRoles(req)` returns the mocked result.
 *   - `lastRoleViolations` / `lastRolePartialFailure` get populated when the
 *     page VM would have captured them (simulated in the mock to match real
 *     behavior from UsersViewModel.modifyRoles).
 */
function makePageViewModel(
  modifyRolesMock: (req: {
    userId: string;
    roleIdsToAdd: string[];
    roleIdsToRemove: string[];
  }) => Promise<ModifyUserRolesResult>
): UsersViewModel {
  const stub = {
    lastRoleViolations: null as RoleAssignmentViolation[] | null,
    lastRolePartialFailure: null as UsersViewModel['lastRolePartialFailure'],
    modifyRoles: vi.fn(async (req) => {
      const result = await modifyRolesMock(req);
      // Simulate the real UsersViewModel.modifyRoles side effects (see
      // UsersViewModel.ts:1202-1229 — captures violation / partial state).
      if (!result.success && result.violations && result.violations.length > 0) {
        stub.lastRoleViolations = result.violations;
      } else if (!result.success && result.partial) {
        stub.lastRolePartialFailure = {
          failureSection: result.failureSection ?? 'add',
          failureIndex: result.failureIndex ?? 0,
          addedRoleEventIds: result.addedRoleEventIds ?? [],
          removedRoleEventIds: result.removedRoleEventIds ?? [],
          processingError: result.processingError,
        };
      }
      return result;
    }),
  };
  return stub as unknown as UsersViewModel;
}

describe('UserFormViewModel.submit — error surfacing', () => {
  let cs: IUserCommandService;

  beforeEach(() => {
    cs = makeCommandService();
  });

  it('(a) happy path — profile-only edit succeeds without touching page VM', async () => {
    const vm = new UserFormViewModel(mockAssignableRoles, 'edit', mockExistingUser);
    // No role changes — leave selectedRoles unchanged.
    (cs.updateUser as ReturnType<typeof vi.fn>).mockResolvedValue({
      success: true,
    } satisfies UpdateUserResult);
    const pageVm = makePageViewModel(async () => {
      throw new Error('modifyRoles should not be called when no role changes');
    });

    const result = await vm.submit(cs, pageVm);

    expect(result.success).toBe(true);
    expect(vm.submissionError).toBe(null);
    expect(pageVm.lastRoleViolations).toBe(null);
    expect(pageVm.lastRolePartialFailure).toBe(null);
    expect(pageVm.modifyRoles).not.toHaveBeenCalled();
  });

  it('(b) role-violation path — page banner owns the error; form is silent', async () => {
    const vm = new UserFormViewModel(mockAssignableRoles, 'edit', mockExistingUser);
    // Trigger role change: add provider_admin
    vm.toggleRole(PROVIDER_ADMIN_ROLE_ID);
    expect(vm.hasRoleChanges).toBe(true);

    (cs.updateUser as ReturnType<typeof vi.fn>).mockResolvedValue({
      success: true,
    } satisfies UpdateUserResult);

    const violations: RoleAssignmentViolation[] = [
      {
        role_id: PROVIDER_ADMIN_ROLE_ID,
        role_name: 'provider_admin',
        error_code: 'SUBSET_ONLY_VIOLATION',
        message: 'Role "provider_admin" has permissions you don\'t have',
      },
    ];
    const pageVm = makePageViewModel(async () => ({
      success: false,
      error: 'VALIDATION_FAILED',
      violations,
      errorDetails: {
        code: 'VALIDATION_FAILED',
        message: violations[0].message,
      },
    }));

    const result = await vm.submit(cs, pageVm);

    expect(result.success).toBe(false);
    // The role-failure shape replaces the profile result
    expect((result as ModifyUserRolesResult).violations).toEqual(violations);
    // Form's inline error is suppressed — page banner owns it
    expect(vm.submissionError).toBe(null);
    expect(vm.submissionErrorDetails).toBe(null);
    // Page VM captured the violation
    expect(pageVm.lastRoleViolations).toEqual(violations);
  });

  it('(c) partial-failure path — page banner shows recovery; form is silent', async () => {
    const vm = new UserFormViewModel(mockAssignableRoles, 'edit', mockExistingUser);
    vm.toggleRole(PROVIDER_ADMIN_ROLE_ID);

    (cs.updateUser as ReturnType<typeof vi.fn>).mockResolvedValue({
      success: true,
    } satisfies UpdateUserResult);

    const pageVm = makePageViewModel(async () => ({
      success: false,
      error: 'PARTIAL_FAILURE',
      partial: true,
      failureSection: 'remove',
      failureIndex: 1,
      processingError: 'handler raised mid-loop',
      addedRoleEventIds: [],
      removedRoleEventIds: ['evt-1'],
    }));

    const result = await vm.submit(cs, pageVm);

    expect(result.success).toBe(false);
    expect((result as ModifyUserRolesResult).partial).toBe(true);
    // Form silent
    expect(vm.submissionError).toBe(null);
    expect(vm.submissionErrorDetails).toBe(null);
    // Page VM captured partial state
    expect(pageVm.lastRolePartialFailure).not.toBe(null);
    expect(pageVm.lastRolePartialFailure?.failureSection).toBe('remove');
    expect(pageVm.lastRolePartialFailure?.failureIndex).toBe(1);
    expect(pageVm.lastRolePartialFailure?.processingError).toBe('handler raised mid-loop');
  });

  it('(d) non-role failure regression guard — surfaces inline in the form, not the banner', async () => {
    const vm = new UserFormViewModel(mockAssignableRoles, 'edit', mockExistingUser);
    // NO role changes — only profile update fails
    (cs.updateUser as ReturnType<typeof vi.fn>).mockResolvedValue({
      success: false,
      error: 'PROCESSING_ERROR',
      errorDetails: { code: 'PROCESSING_ERROR', message: 'Connection refused' },
    } satisfies UpdateUserResult);
    const pageVm = makePageViewModel(async () => {
      throw new Error('modifyRoles should not be called');
    });

    const result = await vm.submit(cs, pageVm);

    expect(result.success).toBe(false);
    // Prefer the rich `errorDetails.message` over the bare error code
    expect(vm.submissionError).toBe('Connection refused');
    // Page VM untouched
    expect(pageVm.lastRoleViolations).toBe(null);
    expect(pageVm.lastRolePartialFailure).toBe(null);
  });

  /**
   * (f) Integration render test — covers the end-to-end contract from
   * architect Finding #4: form-submit failure → page VM captures violations
   * → UsersErrorBanner mounted with that state renders the rich block with
   * stable test-ids. Verifies the wiring between this test file's case (b)
   * and UsersErrorBanner.test.tsx without requiring a full UsersManagePage
   * harness (matches the project's existing manage-pages contract-test
   * pattern at frontend/src/pages/__tests__/manage-pages-*.test.tsx).
   */
  it('(f) integration — page VM state after submit drives the rich UsersErrorBanner', async () => {
    const vm = new UserFormViewModel(mockAssignableRoles, 'edit', mockExistingUser);
    vm.toggleRole(PROVIDER_ADMIN_ROLE_ID);

    (cs.updateUser as ReturnType<typeof vi.fn>).mockResolvedValue({
      success: true,
    } satisfies UpdateUserResult);

    const violations: RoleAssignmentViolation[] = [
      {
        role_id: PROVIDER_ADMIN_ROLE_ID,
        role_name: 'provider_admin',
        error_code: 'SUBSET_ONLY_VIOLATION',
        message: 'Role "provider_admin" has permissions you don\'t have',
      },
    ];
    const pageVm = makePageViewModel(async () => ({
      success: false,
      error: 'VALIDATION_FAILED',
      violations,
      errorDetails: { code: 'VALIDATION_FAILED', message: violations[0].message },
    }));

    await vm.submit(cs, pageVm);

    // Mount the real UsersErrorBanner with the state captured by the page VM.
    render(
      <UsersErrorBanner
        error={violations[0].message}
        operationError={null}
        lastRoleViolations={pageVm.lastRoleViolations}
        lastRolePartialFailure={pageVm.lastRolePartialFailure}
        onDismiss={vi.fn()}
      />
    );

    // Rich violation block renders with stable test-ids.
    const banner = screen.getByTestId('users-error-banner');
    expect(banner).not.toBeNull();
    const violationBlock = within(banner).getByTestId('role-modification-violation');
    expect(violationBlock).not.toBeNull();
    const violationRow = within(violationBlock).getByTestId(
      'role-violation-SUBSET_ONLY_VIOLATION'
    );
    expect(violationRow).not.toBeNull();
    expect(violationRow.textContent).toContain(
      'Role "provider_admin" has permissions you don\'t have'
    );

    // Negative assertion: the bare error code string never appears in the UI.
    expect(within(banner).queryByText('VALIDATION_FAILED')).toBeNull();
    // Negative assertion: form's inline submissionError is null (verified
    // separately in case (b)) — the page banner is the ONLY error surface.
    expect(vm.submissionError).toBe(null);
  });

  it('(e) combined edit — profile-success + role-violation (the actual S4 shape)', async () => {
    const vm = new UserFormViewModel(mockAssignableRoles, 'edit', mockExistingUser);
    vm.toggleRole(PROVIDER_ADMIN_ROLE_ID);

    // Profile update succeeds
    (cs.updateUser as ReturnType<typeof vi.fn>).mockResolvedValue({
      success: true,
    } satisfies UpdateUserResult);

    const violations: RoleAssignmentViolation[] = [
      {
        role_id: PROVIDER_ADMIN_ROLE_ID,
        role_name: 'provider_admin',
        error_code: 'SUBSET_ONLY_VIOLATION',
        message: 'Role "provider_admin" has permissions you don\'t have',
      },
    ];
    const pageVm = makePageViewModel(async () => ({
      success: false,
      error: 'VALIDATION_FAILED',
      violations,
      errorDetails: { code: 'VALIDATION_FAILED', message: violations[0].message },
    }));

    const result = await vm.submit(cs, pageVm);

    // Overall result is the role-modify result, not the profile success
    expect(result.success).toBe(false);
    expect(result.error).toBe('VALIDATION_FAILED');
    expect((result as ModifyUserRolesResult).violations).toEqual(violations);

    // Form's inline error is silent — page banner displays the violation
    expect(vm.submissionError).toBe(null);

    // Page VM captured the rich state for UsersErrorBanner to render
    expect(pageVm.lastRoleViolations).toEqual(violations);
    expect(pageVm.lastRoleViolations?.[0].error_code).toBe('SUBSET_ONLY_VIOLATION');
    expect(pageVm.lastRoleViolations?.[0].message).toBe(
      'Role "provider_admin" has permissions you don\'t have'
    );
  });
});
