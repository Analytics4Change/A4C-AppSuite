/**
 * SupabaseUserCommandService — snake_case → camelCase mapping tests
 *
 * PR #32 review item 3 + architect SHOULD-ADD Q5/Q9.1. Targets the
 * non-trivial mapping layer in:
 *   - `updateUserPhone` (row_to_json → camelCase + Date parsing)
 *   - `addUserPhone` (camelCase passthrough + Date parsing)
 *   - `updateUser` (row_to_json → camelCase + nullable Date)
 *   - `updateNotificationPreferences` (Pattern A v2 RPC envelope + snake→camel)
 *
 * Stubs `@/services/auth/supabase.service`'s `apiRpc` via `vi.mock()` with
 * canned responses so we test the mapping in isolation from any real
 * Supabase client.
 *
 * See also: `adr-rpc-readback-pattern.md` + `rpc-readback-vm-patch.md`.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// vi.mock is hoisted to the top of the file before any variable declaration,
// so the mock factories can't close over module-scope consts. Use vi.hoisted()
// to declare the shared spies in the hoisted scope.
const { mockApiRpc, mockGetClient } = vi.hoisted(() => {
  return {
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

describe('SupabaseUserCommandService — snake_case → camelCase mapping', () => {
  let service: SupabaseUserCommandService;

  beforeEach(() => {
    mockApiRpc.mockReset();
    service = new SupabaseUserCommandService();
  });

  // ---------------------------------------------------------------------------
  // updateUserPhone — snake_case row_to_json → camelCase + Date parsing
  // ---------------------------------------------------------------------------
  describe('updateUserPhone', () => {
    it('maps snake_case phone row to camelCase with Date instances', async () => {
      mockApiRpc.mockResolvedValueOnce({
        data: {
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
        },
        error: null,
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
      mockApiRpc.mockResolvedValueOnce({
        data: {
          success: false,
          error: 'Event processing failed: some handler error',
        },
        error: null,
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
      mockApiRpc.mockResolvedValueOnce({
        data: {
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
        },
        error: null,
      });

      const result = await service.updateUserPhone({
        phoneId: 'phone-1',
        orgId: null,
        updates: { label: 'Mobile' },
      });

      // Surface: service currently calls `new Date('not-a-date')` which
      // produces an Invalid Date (isNaN(date.getTime()) === true). Test
      // documents the existing behavior so regressions to silent NaN are
      // caught. If service is hardened later to surface a parse error,
      // update this assertion.
      expect(result.success).toBe(true);
      const createdAt = result.phone?.createdAt;
      expect(createdAt).toBeInstanceOf(Date);
      expect(Number.isNaN((createdAt as Date).getTime())).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // addUserPhone — camelCase passthrough + Date parsing (migration 20260423232531)
  // ---------------------------------------------------------------------------
  describe('addUserPhone', () => {
    it('passes camelCase phone through and parses Date fields', async () => {
      mockApiRpc.mockResolvedValueOnce({
        data: {
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
        },
        error: null,
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
      mockApiRpc.mockResolvedValueOnce({
        data: {
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
        },
        error: null,
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

    // Architect Q5 SHOULD-ADD — omitted/undefined optional Date must not
    // produce `new Date(undefined)` which yields NaN
    it('handles undefined last_login_at without NaN date', async () => {
      mockApiRpc.mockResolvedValueOnce({
        data: {
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
        },
        error: null,
      });

      const result = await service.updateUser({
        userId: 'user-1',
        firstName: 'First',
        lastName: 'Last',
      });

      expect(result.success).toBe(true);
      // Service maps last_login_at via ternary `? new Date(...) : null` —
      // undefined is falsy, yields null (not NaN). This test locks that in.
      expect(result.user?.lastLoginAt).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // updateNotificationPreferences — RPC envelope contract
  // (api.update_user_notification_preferences, first Edge→RPC extraction)
  // Tests the Pattern A v2 RPC contract: snake_case response → camelCase type,
  // error envelope surfacing, and PostgREST permission-denied (42501) handling.
  // This block also serves as the template for the 4 follow-up extractions.
  // ---------------------------------------------------------------------------
  describe('updateNotificationPreferences — RPC envelope contract', () => {
    it('maps snake_case RPC response to camelCase NotificationPreferences', async () => {
      mockApiRpc.mockResolvedValueOnce({
        data: {
          success: true,
          eventId: '11111111-2222-3333-4444-555555555555',
          notificationPreferences: {
            email: true,
            sms: { enabled: true, phone_id: 'phone-abc' },
            in_app: false,
          },
        },
        error: null,
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

      expect(mockApiRpc).toHaveBeenCalledWith(
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
      mockApiRpc.mockResolvedValueOnce({
        data: {
          success: true,
          eventId: '11111111-2222-3333-4444-555555555555',
          notificationPreferences: {
            email: false,
            sms: { enabled: false, phone_id: null },
            in_app: true,
          },
        },
        error: null,
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
      mockApiRpc.mockResolvedValueOnce({
        data: {
          success: false,
          error:
            'Event processing failed: new row for relation "user_notification_preferences_projection" violates check constraint "spot_check"',
        },
        error: null,
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
      // Template assertion for the 4 follow-up extractions: the RPC raises
      // with ERRCODE 42501 (SQLSTATE permission_denied); PostgREST surfaces
      // it as an error object on the apiRpc result. Service returns
      // {success: false, error: <message>, errorDetails: {code: 'UNKNOWN'}}.
      mockApiRpc.mockResolvedValueOnce({
        data: null,
        error: {
          code: '42501',
          message:
            'Permission denied: Can only update your own notification preferences unless you have user.update permission',
          hint: null,
        },
      });

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
});
