/**
 * performNotificationPreferencesSave — regression tests
 *
 * Guards the Sonner toast emission on the notification-preferences save path.
 * The previous inline handler in `UsersManagePage` silently persisted without
 * user-visible confirmation; the save logic was extracted to a pure function
 * so it is exercisable without a React render harness (the project doesn't
 * install `@testing-library/react`).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockUpdate, mockSuccess, mockError } = vi.hoisted(() => ({
  mockUpdate: vi.fn(),
  mockSuccess: vi.fn(),
  mockError: vi.fn(),
}));

vi.mock('sonner', () => ({
  toast: { success: mockSuccess, error: mockError },
}));

vi.mock('@/services/users', () => ({
  getUserCommandService: () => ({
    updateNotificationPreferences: mockUpdate,
  }),
}));

import { performNotificationPreferencesSave } from '../useNotificationPreferencesSave';
import type { NotificationPreferences } from '@/types/user.types';

const PREFS: NotificationPreferences = {
  email: true,
  sms: { enabled: false, phoneId: null },
  inApp: true,
};

function makeParams(overrides: Record<string, unknown> = {}) {
  const onError = vi.fn();
  const onSuccess = vi.fn();
  return {
    params: {
      userId: 'user-1' as string | null | undefined,
      orgId: 'org-1' as string | null | undefined,
      onError,
      onSuccess,
      ...overrides,
    },
    onError,
    onSuccess,
  };
}

describe('performNotificationPreferencesSave', () => {
  beforeEach(() => {
    mockUpdate.mockReset();
    mockSuccess.mockReset();
    mockError.mockReset();
  });

  it('fires toast.success on successful save', async () => {
    mockUpdate.mockResolvedValueOnce({ success: true, notificationPreferences: PREFS });
    const { params, onError, onSuccess } = makeParams();

    await performNotificationPreferencesSave(params, PREFS);

    expect(mockUpdate).toHaveBeenCalledWith({
      userId: 'user-1',
      orgId: 'org-1',
      notificationPreferences: PREFS,
    });
    expect(mockSuccess).toHaveBeenCalledWith('Notification preferences updated');
    expect(mockError).not.toHaveBeenCalled();
    expect(onSuccess).toHaveBeenCalledWith(PREFS);
    expect(onError).toHaveBeenCalledWith(null);
    expect(onError).not.toHaveBeenCalledWith(expect.stringContaining('Failed'));
  });

  it('fires toast.error + onError with RPC error message on failure envelope', async () => {
    mockUpdate.mockResolvedValueOnce({
      success: false,
      error: 'Event processing failed: handler column mismatch',
    });
    const { params, onError, onSuccess } = makeParams();

    await performNotificationPreferencesSave(params, PREFS);

    expect(mockSuccess).not.toHaveBeenCalled();
    expect(mockError).toHaveBeenCalledWith('Event processing failed: handler column mismatch');
    expect(onError).toHaveBeenLastCalledWith('Event processing failed: handler column mismatch');
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it('fires toast.error with generic fallback when service envelope omits error', async () => {
    mockUpdate.mockResolvedValueOnce({ success: false });
    const { params } = makeParams();

    await performNotificationPreferencesSave(params, PREFS);

    expect(mockError).toHaveBeenCalledWith('Failed to save notification preferences');
  });

  it('fires toast.error when the service throws', async () => {
    mockUpdate.mockRejectedValueOnce(new Error('Network gone'));
    const { params, onError } = makeParams();

    await performNotificationPreferencesSave(params, PREFS);

    expect(mockError).toHaveBeenCalledWith('Network gone');
    expect(onError).toHaveBeenLastCalledWith('Network gone');
  });

  it('is a no-op when userId or orgId is missing (no toast, no service call)', async () => {
    const missingUser = makeParams({ userId: null });
    const missingOrg = makeParams({ orgId: null });

    await performNotificationPreferencesSave(missingUser.params, PREFS);
    await performNotificationPreferencesSave(missingOrg.params, PREFS);

    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockSuccess).not.toHaveBeenCalled();
    expect(mockError).not.toHaveBeenCalled();
  });
});
