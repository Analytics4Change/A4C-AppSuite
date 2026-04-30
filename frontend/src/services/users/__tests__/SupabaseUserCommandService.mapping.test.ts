/**
 * SupabaseUserCommandService — snake_case → camelCase mapping tests
 *
 * Stubs `@/services/auth/supabase.service`'s `apiRpcEnvelope` via `vi.mock()`
 * with canned `ApiEnvelope<T>` responses so we test the mapping in isolation
 * from any real Supabase client. Updated for M3 helper migration: all mutating
 * RPCs now route through `apiRpcEnvelope<T>` (which returns the unwrapped
 * envelope directly, not the legacy `{data, error}` PostgrestSingleResponse).
 *
 * See also: `adr-rpc-readback-pattern.md` + `rpc-readback-vm-patch.md`.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// vi.mock is hoisted to the top of the file before any variable declaration,
// so the mock factories can't close over module-scope consts. Use vi.hoisted()
// to declare the shared spies in the hoisted scope.
const { mockApiRpcEnvelope, mockApiRpc, mockGetClient } = vi.hoisted(() => {
  return {
    mockApiRpcEnvelope: vi.fn(),
    mockApiRpc: vi.fn(),
    mockGetClient: vi.fn(() => ({
      auth: {
        getSession: vi.fn().mockResolvedValue({
          data: {
            session: {
              // Minimal JWT with org_id claim (base64 of {"org_id":"org-test"})
              access_token: 'header.eyJvcmdfaWQiOiJvcmctdGVzdCJ9.sig',
            },
          },
        }),
        resetPasswordForEmail: vi.fn(),
      },
      functions: {
        invoke: vi.fn(),
      },
    })),
  };
});

vi.mock('@/services/auth/supabase.service', () => ({
  supabaseService: {
    apiRpc: mockApiRpc,
    apiRpcEnvelope: mockApiRpcEnvelope,
    getClient: mockGetClient,
  },
}));

// Stub tracing module so tests don't need a real Supabase context
vi.mock('@/utils/tracing', () => ({
  createTracingContext: vi.fn().mockResolvedValue({
    correlationId: 'test-correlation',
    traceId: 'test-trace',
    sessionId: 'test-session',
    spanId: 'test-span',
  }),
  buildHeadersFromContext: vi.fn(() => ({})),
}));

// Stub JWT utility
vi.mock('@/utils/jwt', () => ({
  decodeJWT: vi.fn(() => ({ org_id: 'org-test' })),
}));

// Stub Edge Function error extractor
vi.mock('@/utils/edge-function-errors', () => ({
  extractEdgeFunctionError: vi.fn().mockResolvedValue({ message: 'mocked', code: 'UNKNOWN' }),
}));

import { SupabaseUserCommandService } from '../SupabaseUserCommandService';

/** Construct an envelope-shaped failure with a synthetic PostgrestError. */
function pgErrorEnvelope(code: string, message: string, hint?: string) {
  return {
    success: false as const,
    error: message,
    postgrestError: { code, message, details: '', hint: hint ?? '' },
  };
}

describe('SupabaseUserCommandService — snake_case → camelCase mapping', () => {
  let service: SupabaseUserCommandService;

  beforeEach(() => {
    mockApiRpcEnvelope.mockReset();
    mockApiRpc.mockReset();
    service = new SupabaseUserCommandService();
  });

  // ---------------------------------------------------------------------------
  // updateUserPhone — snake_case row_to_json → camelCase + Date parsing
  // ---------------------------------------------------------------------------
  describe('updateUserPhone', () => {
    it('maps snake_case phone row to camelCase with Date instances', async () => {
      mockApiRpcEnvelope.mockResolvedValueOnce({
        success: true,
        phoneId: 'phone-1',
        eventId: 'event-1',
        phone: {
          id: 'phone-1',
          user_id: 'user-1',
          org_id: null,
          label: 'Mobile',
          type: 'mobile',
          number: '555-0100',
          extension: null,
          country_code: '+1',
          is_primary: true,
          sms_capable: true,
          is_active: true,
          created_at: '2026-04-24T00:00:00.000Z',
          updated_at: '2026-04-24T00:00:00.000Z',
        },
      });

      const result = await service.updateUserPhone({
        phoneId: 'phone-1',
        orgId: null,
        updates: { label: 'Mobile' },
      });

      expect(result.success).toBe(true);
      expect(result.phone).toBeDefined();
      expect(result.phone?.id).toBe('phone-1');
      expect(result.phone?.userId).toBe('user-1'); // camelCase
      expect(result.phone?.orgId).toBeNull();
      expect(result.phone?.countryCode).toBe('+1'); // camelCase
      expect(result.phone?.isPrimary).toBe(true); // camelCase
      expect(result.phone?.smsCapable).toBe(true); // camelCase
      expect(result.phone?.createdAt).toBeInstanceOf(Date);
      expect(result.phone?.updatedAt).toBeInstanceOf(Date);
      expect((result.phone?.createdAt as Date).toISOString()).toBe('2026-04-24T00:00:00.000Z');
    });

    it('returns error envelope without phone on {success: false}', async () => {
      mockApiRpcEnvelope.mockResolvedValueOnce({
        success: false,
        error: 'Event processing failed: some handler error',
      });

      const result = await service.updateUserPhone({
        phoneId: 'phone-1',
        orgId: null,
        updates: { label: 'Mobile' },
      });

      expect(result.success).toBe(false);
      expect(result.phone).toBeUndefined();
      expect(result.error).toContain('Event processing failed');
    });

    // Architect Q5 SHOULD-ADD — malformed createdAt must not produce NaN
    it('handles malformed createdAt without producing NaN date', async () => {
      mockApiRpcEnvelope.mockResolvedValueOnce({
        success: true,
        phoneId: 'phone-1',
        eventId: 'event-1',
        phone: {
          id: 'phone-1',
          user_id: 'user-1',
          org_id: null,
          label: 'Mobile',
          type: 'mobile',
          number: '555-0100',
          extension: null,
          country_code: '+1',
          is_primary: false,
          sms_capable: false,
          is_active: true,
          created_at: 'not-a-date',
          updated_at: '2026-04-24T00:00:00.000Z',
        },
      });

      const result = await service.updateUserPhone({
        phoneId: 'phone-1',
        orgId: null,
        updates: { label: 'Mobile' },
      });

      expect(result.success).toBe(true);
      const createdAt = result.phone?.createdAt;
      expect(createdAt).toBeInstanceOf(Date);
      expect(Number.isNaN((createdAt as Date).getTime())).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // addUserPhone — camelCase passthrough + Date parsing
  // ---------------------------------------------------------------------------
  describe('addUserPhone', () => {
    it('passes camelCase phone through and parses Date fields', async () => {
      mockApiRpcEnvelope.mockResolvedValueOnce({
        success: true,
        phoneId: 'phone-new',
        eventId: 'event-2',
        phone: {
          id: 'phone-new',
          userId: 'user-1',
          orgId: null,
          label: 'Work',
          type: 'office',
          number: '555-0200',
          extension: '1234',
          countryCode: '+1',
          isPrimary: false,
          smsCapable: false,
          isActive: true,
          createdAt: '2026-04-24T01:00:00.000Z',
          updatedAt: '2026-04-24T01:00:00.000Z',
        },
      });

      const result = await service.addUserPhone({
        userId: 'user-1',
        orgId: null,
        label: 'Work',
        type: 'office',
        number: '555-0200',
      });

      expect(result.success).toBe(true);
      expect(result.phone?.id).toBe('phone-new');
      expect(result.phone?.userId).toBe('user-1');
      expect(result.phone?.createdAt).toBeInstanceOf(Date);
      expect(result.phone?.updatedAt).toBeInstanceOf(Date);
    });
  });

  // ---------------------------------------------------------------------------
  // updateUser — snake_case row_to_json → camelCase + nullable Date
  // ---------------------------------------------------------------------------
  describe('updateUser', () => {
    it('maps snake_case user row to camelCase with null lastLoginAt', async () => {
      mockApiRpcEnvelope.mockResolvedValueOnce({
        success: true,
        event_id: 'event-3',
        user: {
          id: 'user-1',
          email: 'user@example.com',
          first_name: 'First',
          last_name: 'Last',
          name: 'First Last',
          current_organization_id: 'org-test',
          is_active: true,
          created_at: '2026-04-24T02:00:00.000Z',
          updated_at: '2026-04-24T02:00:00.000Z',
          last_login_at: null,
        },
      });

      const result = await service.updateUser({
        userId: 'user-1',
        firstName: 'First',
        lastName: 'Last',
      });

      expect(result.success).toBe(true);
      expect(result.user).toBeDefined();
      expect(result.user?.firstName).toBe('First');
      expect(result.user?.lastName).toBe('Last');
      expect(result.user?.currentOrganizationId).toBe('org-test');
      expect(result.user?.createdAt).toBeInstanceOf(Date);
      expect(result.user?.updatedAt).toBeInstanceOf(Date);
      expect(result.user?.lastLoginAt).toBeNull();
    });

    it('handles undefined last_login_at without NaN date', async () => {
      mockApiRpcEnvelope.mockResolvedValueOnce({
        success: true,
        event_id: 'event-4',
        user: {
          id: 'user-1',
          email: 'user@example.com',
          first_name: 'First',
          last_name: 'Last',
          name: 'First Last',
          current_organization_id: 'org-test',
          is_active: true,
          created_at: '2026-04-24T02:00:00.000Z',
          updated_at: '2026-04-24T02:00:00.000Z',
          // last_login_at omitted
        },
      });

      const result = await service.updateUser({
        userId: 'user-1',
        firstName: 'First',
        lastName: 'Last',
      });

      expect(result.success).toBe(true);
      // Service maps last_login_at via ternary `? new Date(...) : null` —
      // undefined is falsy, yields null (not NaN).
      expect(result.user?.lastLoginAt).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // updateNotificationPreferences — RPC envelope contract
  // ---------------------------------------------------------------------------
  describe('updateNotificationPreferences — RPC envelope contract', () => {
    it('maps snake_case RPC response to camelCase NotificationPreferences', async () => {
      mockApiRpcEnvelope.mockResolvedValueOnce({
        success: true,
        eventId: '11111111-2222-3333-4444-555555555555',
        notificationPreferences: {
          email: true,
          sms: { enabled: true, phone_id: 'phone-abc' },
          in_app: false,
        },
      });

      const result = await service.updateNotificationPreferences({
        userId: 'user-1',
        orgId: 'org-test',
        notificationPreferences: {
          email: true,
          sms: { enabled: true, phoneId: 'phone-abc' },
          inApp: false,
        },
      });

      expect(mockApiRpcEnvelope).toHaveBeenCalledWith(
        'update_user_notification_preferences',
        expect.objectContaining({
          p_user_id: 'user-1',
          p_notification_preferences: {
            email: true,
            sms: { enabled: true, phone_id: 'phone-abc' },
            in_app: false,
          },
        })
      );
      expect(result.success).toBe(true);
      expect(result.notificationPreferences).toEqual({
        email: true,
        sms: { enabled: true, phoneId: 'phone-abc' },
        inApp: false,
      });
    });

    it('preserves null phoneId through the snake→camel mapping', async () => {
      mockApiRpcEnvelope.mockResolvedValueOnce({
        success: true,
        eventId: '11111111-2222-3333-4444-555555555555',
        notificationPreferences: {
          email: false,
          sms: { enabled: false, phone_id: null },
          in_app: true,
        },
      });

      const result = await service.updateNotificationPreferences({
        userId: 'user-1',
        orgId: 'org-test',
        notificationPreferences: {
          email: false,
          sms: { enabled: false, phoneId: null },
          inApp: true,
        },
      });

      expect(result.success).toBe(true);
      expect(result.notificationPreferences?.sms.phoneId).toBeNull();
      expect(result.notificationPreferences?.inApp).toBe(true);
    });

    it('surfaces handler-failure envelope without notificationPreferences', async () => {
      mockApiRpcEnvelope.mockResolvedValueOnce({
        success: false,
        error:
          'Event processing failed: new row for relation "user_notification_preferences_projection" violates check constraint "spot_check"',
      });

      const result = await service.updateNotificationPreferences({
        userId: 'user-1',
        orgId: 'org-test',
        notificationPreferences: {
          email: true,
          sms: { enabled: false, phoneId: null },
          inApp: true,
        },
      });

      expect(result.success).toBe(false);
      expect(result.notificationPreferences).toBeUndefined();
      expect(result.error).toContain('Event processing failed');
    });

    it('surfaces PostgREST permission-denied (42501) through the error path', async () => {
      mockApiRpcEnvelope.mockResolvedValueOnce(pgErrorEnvelope('42501', 'Permission denied'));

      const result = await service.updateNotificationPreferences({
        userId: 'other-user',
        orgId: 'org-test',
        notificationPreferences: {
          email: true,
          sms: { enabled: false, phoneId: null },
          inApp: true,
        },
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Permission denied');
      expect(result.errorDetails?.code).toBe('UNKNOWN');
      expect(result.errorDetails?.context).toEqual(
        expect.objectContaining({ postgresCode: '42501' })
      );
    });
  });

  // ---------------------------------------------------------------------------
  // revokeInvitation — RPC envelope contract
  // ---------------------------------------------------------------------------
  describe('revokeInvitation — RPC envelope contract', () => {
    it('returns success when the RPC envelope reports success', async () => {
      mockApiRpcEnvelope.mockResolvedValueOnce({
        success: true,
        eventId: '11111111-2222-3333-4444-555555555555',
        invitationId: 'inv-1',
      });

      const result = await service.revokeInvitation('inv-1');

      expect(mockApiRpcEnvelope).toHaveBeenCalledWith(
        'revoke_invitation',
        expect.objectContaining({
          p_invitation_id: 'inv-1',
          p_reason: 'Revoked by administrator',
        })
      );
      expect(result.success).toBe(true);
    });

    it('surfaces handler-failure envelope through result.error', async () => {
      mockApiRpcEnvelope.mockResolvedValueOnce({
        success: false,
        error: 'Invitation not found or not revocable',
      });

      const result = await service.revokeInvitation('inv-missing');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Invitation not found or not revocable');
    });

    it('maps PostgREST 42501 to FORBIDDEN via the in-file precedent', async () => {
      mockApiRpcEnvelope.mockResolvedValueOnce(pgErrorEnvelope('42501', 'Permission denied'));

      const result = await service.revokeInvitation('inv-1');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Access denied - insufficient permissions');
      expect(result.errorDetails?.code).toBe('FORBIDDEN');
      expect(result.errorDetails?.message).toBe('Permission denied');
    });
  });

  // ---------------------------------------------------------------------------
  // deleteUser — RPC envelope contract
  // ---------------------------------------------------------------------------
  describe('deleteUser — RPC envelope contract', () => {
    it('returns success when the RPC envelope reports success', async () => {
      mockApiRpcEnvelope.mockResolvedValueOnce({
        success: true,
        eventId: '11111111-2222-3333-4444-555555555555',
        userId: 'user-1',
      });

      const result = await service.deleteUser('user-1', 'cleanup');

      expect(mockApiRpcEnvelope).toHaveBeenCalledWith(
        'delete_user',
        expect.objectContaining({
          p_user_id: 'user-1',
          p_reason: 'cleanup',
        })
      );
      expect(result.success).toBe(true);
    });

    it('surfaces handler-failure envelope through result.error', async () => {
      mockApiRpcEnvelope.mockResolvedValueOnce({
        success: false,
        error: 'User is already deleted',
      });

      const result = await service.deleteUser('user-already-gone');

      expect(result.success).toBe(false);
      expect(result.error).toBe('User is already deleted');
      expect(result.errorDetails?.code).toBe('USER_ACTIVE');
    });

    it('maps PostgREST 42501 to FORBIDDEN via the in-file precedent', async () => {
      mockApiRpcEnvelope.mockResolvedValueOnce(pgErrorEnvelope('42501', 'Permission denied'));

      const result = await service.deleteUser('user-out-of-scope');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Access denied - insufficient permissions');
      expect(result.errorDetails?.code).toBe('FORBIDDEN');
      expect(result.errorDetails?.message).toBe('Permission denied');
    });

    it('defaults p_reason to "Manual delete" when reason is omitted', async () => {
      mockApiRpcEnvelope.mockResolvedValueOnce({
        success: true,
        eventId: '22222222-3333-4444-5555-666666666666',
        userId: 'user-2',
      });

      await service.deleteUser('user-2');

      expect(mockApiRpcEnvelope).toHaveBeenCalledWith(
        'delete_user',
        expect.objectContaining({
          p_user_id: 'user-2',
          p_reason: 'Manual delete',
        })
      );
    });
  });

  // ---------------------------------------------------------------------------
  // modifyRoles — multi-event Pattern A v2 (api.modify_user_roles)
  // ---------------------------------------------------------------------------
  describe('modifyRoles — RPC envelope contract', () => {
    it('returns success with split add/remove event ID arrays', async () => {
      mockApiRpcEnvelope.mockResolvedValueOnce({
        success: true,
        userId: 'user-1',
        addedRoleEventIds: ['evt-add-1', 'evt-add-2'],
        removedRoleEventIds: ['evt-rm-1'],
      });

      const result = await service.modifyRoles({
        userId: 'user-1',
        roleIdsToAdd: ['role-a', 'role-b'],
        roleIdsToRemove: ['role-c'],
      });

      expect(mockApiRpcEnvelope).toHaveBeenCalledWith(
        'modify_user_roles',
        expect.objectContaining({
          p_user_id: 'user-1',
          p_role_ids_to_add: ['role-a', 'role-b'],
          p_role_ids_to_remove: ['role-c'],
        })
      );
      expect(result.success).toBe(true);
      expect(result.userId).toBe('user-1');
      expect(result.addedRoleEventIds).toEqual(['evt-add-1', 'evt-add-2']);
      expect(result.removedRoleEventIds).toEqual(['evt-rm-1']);
    });

    it('surfaces VALIDATION_FAILED with violations array', async () => {
      mockApiRpcEnvelope.mockResolvedValueOnce({
        success: false,
        error: 'VALIDATION_FAILED',
        violations: [
          {
            role_id: 'role-z',
            role_name: 'cypress_clinician',
            error_code: 'SCOPE_HIERARCHY_VIOLATION',
            message: 'Role "cypress_clinician" scope is outside your authority',
          },
        ],
      });

      const result = await service.modifyRoles({
        userId: 'user-1',
        roleIdsToAdd: ['role-z'],
        roleIdsToRemove: [],
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('VALIDATION_FAILED');
      expect(result.violations).toHaveLength(1);
      expect(result.violations?.[0].error_code).toBe('SCOPE_HIERARCHY_VIOLATION');
      expect(result.errorDetails?.code).toBe('VALIDATION_FAILED');
      expect(result.errorDetails?.message).toContain('cypress_clinician');
    });

    it('surfaces VALIDATION_FAILED with multiple violations', async () => {
      mockApiRpcEnvelope.mockResolvedValueOnce({
        success: false,
        error: 'VALIDATION_FAILED',
        violations: [
          {
            role_id: 'role-x',
            role_name: 'admin_role',
            error_code: 'SUBSET_ONLY_VIOLATION',
            message: 'Role "admin_role" has permissions you do not possess',
          },
          {
            role_id: 'role-y',
            role_name: null,
            error_code: 'ROLE_NOT_FOUND',
            message: 'Role role-y not found or inactive',
          },
        ],
      });

      const result = await service.modifyRoles({
        userId: 'user-1',
        roleIdsToAdd: ['role-x', 'role-y'],
        roleIdsToRemove: [],
      });

      expect(result.success).toBe(false);
      expect(result.violations).toHaveLength(2);
      expect(result.violations?.[0].error_code).toBe('SUBSET_ONLY_VIOLATION');
      expect(result.violations?.[1].error_code).toBe('ROLE_NOT_FOUND');
    });

    it('surfaces NOT_FOUND envelope when target user is out of tenant', async () => {
      mockApiRpcEnvelope.mockResolvedValueOnce({
        success: false,
        error: 'NOT_FOUND',
        errorDetails: { code: 'NOT_FOUND', message: 'User not found in this organization' },
      });

      const result = await service.modifyRoles({
        userId: 'cross-tenant-user',
        roleIdsToAdd: ['role-a'],
        roleIdsToRemove: [],
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('NOT_FOUND');
      expect(result.errorDetails?.code).toBe('NOT_FOUND');
    });

    it('passes through PARTIAL_FAILURE state with failureIndex/section', async () => {
      mockApiRpcEnvelope.mockResolvedValueOnce({
        success: false,
        error: 'PARTIAL_FAILURE',
        partial: true,
        userId: 'user-1',
        addedRoleEventIds: [],
        removedRoleEventIds: ['evt-rm-1'],
        failureIndex: 1,
        failureSection: 'remove',
        processingError: 'Event processing failed: handler raised',
      });

      const result = await service.modifyRoles({
        userId: 'user-1',
        roleIdsToAdd: [],
        roleIdsToRemove: ['role-a', 'role-b'],
      });

      expect(result.success).toBe(false);
      expect(result.partial).toBe(true);
      expect(result.failureIndex).toBe(1);
      expect(result.failureSection).toBe('remove');
      expect(result.removedRoleEventIds).toEqual(['evt-rm-1']);
      expect(result.errorDetails?.code).toBe('PARTIAL_FAILURE');
      expect(result.processingError).toContain('handler raised');
    });

    it('maps PostgREST 42501 to FORBIDDEN', async () => {
      mockApiRpcEnvelope.mockResolvedValueOnce(pgErrorEnvelope('42501', 'Permission denied'));

      const result = await service.modifyRoles({
        userId: 'user-1',
        roleIdsToAdd: ['role-a'],
        roleIdsToRemove: [],
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Access denied - insufficient permissions');
      expect(result.errorDetails?.code).toBe('FORBIDDEN');
    });
  });
});
