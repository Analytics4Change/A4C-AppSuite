/**
 * useNotificationPreferencesSave
 *
 * Save handler for notification preferences. Extracted from `UsersManagePage`
 * so it can be exercised directly in unit tests (the page's full render graph
 * is too large to mock economically).
 *
 * Surfaces a Sonner toast on success / failure and mirrors the error into the
 * page's persistent error banner via the injected `onError` callback.
 */

import { useCallback, useState } from 'react';
import { toast } from 'sonner';
import { getUserCommandService } from '@/services/users';
import { Logger } from '@/utils/logger';
import type { NotificationPreferences } from '@/types/user.types';

const log = Logger.getLogger('api');

export interface UseNotificationPreferencesSaveParams {
  userId: string | null | undefined;
  orgId: string | null | undefined;
  /**
   * Called with the persistent error banner message on failure, or `null`
   * on success / at the start of a save (mirrors page-level error banner).
   */
  onError: (message: string | null) => void;
  /**
   * Called with the saved preferences on success so the page can commit them
   * to local state.
   */
  onSuccess: (saved: NotificationPreferences) => void;
}

export interface UseNotificationPreferencesSaveResult {
  isSaving: boolean;
  save: (preferences: NotificationPreferences) => Promise<void>;
}

/**
 * Pure save routine extracted so it can be unit-tested without a React
 * render harness. The hook below wraps this with local `isSaving` state.
 */
export async function performNotificationPreferencesSave(
  params: UseNotificationPreferencesSaveParams,
  preferences: NotificationPreferences
): Promise<void> {
  const { userId, orgId, onError, onSuccess } = params;
  if (!userId || !orgId) return;

  onError(null);
  try {
    const result = await getUserCommandService().updateNotificationPreferences({
      userId,
      orgId,
      notificationPreferences: preferences,
    });

    if (result.success) {
      onSuccess(preferences);
      log.info('Notification preferences saved', { userId });
      toast.success('Notification preferences updated');
    } else {
      const message = result.error || 'Failed to save notification preferences';
      onError(message);
      toast.error(message);
    }
  } catch (error) {
    log.error('Error saving notification preferences', error);
    const message =
      error instanceof Error ? error.message : 'Failed to save notification preferences';
    onError(message);
    toast.error(message);
  }
}

export function useNotificationPreferencesSave(
  params: UseNotificationPreferencesSaveParams
): UseNotificationPreferencesSaveResult {
  const [isSaving, setIsSaving] = useState(false);

  const save = useCallback(
    async (preferences: NotificationPreferences) => {
      setIsSaving(true);
      try {
        await performNotificationPreferencesSave(params, preferences);
      } finally {
        setIsSaving(false);
      }
    },
    [params]
  );

  return { isSaving, save };
}
