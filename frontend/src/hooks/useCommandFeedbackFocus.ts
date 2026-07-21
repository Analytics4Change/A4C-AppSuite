/**
 * useCommandFeedbackFocus — focus orchestration for a *form-blocking*
 * command-feedback banner, per the command-feedback standard
 * (documentation/frontend/patterns/command-feedback.md).
 *
 * Contract (all declarative, never `setTimeout`):
 *   - `captureTrigger()` — call at submit time to remember the control that
 *     triggered the command (the submit button, or the field Enter was pressed
 *     in). It is only a *candidate*: the one moment the trigger still holds
 *     focus, before an effect could run and find it disabled/blurred.
 *   - When `active` flips true (the banner is showing a failure), focus moves to
 *     the banner (`bannerRef`) and the captured candidate is promoted to the
 *     armed restore target. The effect's cleanup disarms it the instant the
 *     banner goes away for any reason — so restoration is armed IFF a banner we
 *     focused is currently up. A background-load error banner (which never takes
 *     focus because its `active` stays false) can never arm a stale restore.
 *   - `restore()` — call from the banner's `onDismiss`; returns focus to the
 *     trigger and consumes-and-clears the target so it can't fire twice.
 *
 * One instance drives one banner. A page with several independently-focusable
 * banners (e.g. UsersManagePage's form banner + rich role-violation banner)
 * uses one instance per banner; they are mutually exclusive in practice, so each
 * captures the same trigger and only the active one restores.
 */

import { useCallback, useEffect, useMemo, useRef, type RefObject } from 'react';

export interface CommandFeedbackFocusResult<T extends HTMLElement = HTMLDivElement> {
  /** Attach to the focusable banner container (it must be `tabIndex={-1}`). */
  bannerRef: RefObject<T | null>;
  /** Call at submit time to capture the control that triggered the command. */
  captureTrigger: () => void;
  /** Call from the banner's `onDismiss` to restore focus to that control. */
  restore: () => void;
}

/**
 * @param active Whether the form-blocking banner is currently showing a failure.
 */
export function useCommandFeedbackFocus<T extends HTMLElement = HTMLDivElement>(
  active: boolean
): CommandFeedbackFocusResult<T> {
  const triggerCandidateRef = useRef<HTMLElement | null>(null);
  const restoreTargetRef = useRef<HTMLElement | null>(null);
  const bannerRef = useRef<T>(null);

  const captureTrigger = useCallback(() => {
    triggerCandidateRef.current = (document.activeElement as HTMLElement) ?? null;
  }, []);

  const restore = useCallback(() => {
    const el = restoreTargetRef.current;
    restoreTargetRef.current = null;
    if (el && document.contains(el)) {
      el.focus();
    }
  }, []);

  useEffect(() => {
    if (active) {
      restoreTargetRef.current = triggerCandidateRef.current;
      bannerRef.current?.focus();
      return () => {
        restoreTargetRef.current = null;
      };
    }
  }, [active]);

  // Stable identity (all members are stable) so consumers can list the whole
  // result in a useCallback/useEffect dep array without defeating memoization.
  return useMemo(() => ({ bannerRef, captureTrigger, restore }), [captureTrigger, restore]);
}
