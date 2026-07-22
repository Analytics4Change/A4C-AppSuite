import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, afterEach } from 'vitest';
import { useCommandFeedbackFocus } from './useCommandFeedbackFocus';

/** Create a focusable element attached to the document so `.focus()` takes. */
function makeFocusable(id: string): HTMLElement {
  const el = document.createElement('button');
  el.id = id;
  document.body.appendChild(el);
  return el;
}

/** Attach a real DOM node to the hook's banner ref (the component would normally). */
function attachBanner(ref: { current: HTMLElement | null }, el: HTMLElement) {
  ref.current = el;
}

describe('useCommandFeedbackFocus', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('moves focus to the banner when active flips true', () => {
    const banner = makeFocusable('banner');
    const { result, rerender } = renderHook(({ active }) => useCommandFeedbackFocus(active), {
      initialProps: { active: false },
    });
    attachBanner(result.current.bannerRef, banner);

    rerender({ active: true });

    expect(document.activeElement).toBe(banner);
  });

  it('restores focus to the captured trigger on restore()', () => {
    const trigger = makeFocusable('trigger');
    const banner = makeFocusable('banner');
    trigger.focus();

    const { result, rerender } = renderHook(({ active }) => useCommandFeedbackFocus(active), {
      initialProps: { active: false },
    });
    attachBanner(result.current.bannerRef, banner);

    // Capture while the trigger still holds focus (as a submit handler would).
    act(() => result.current.captureTrigger());
    rerender({ active: true });
    expect(document.activeElement).toBe(banner);

    act(() => result.current.restore());
    expect(document.activeElement).toBe(trigger);
  });

  it('never steals or arms focus while inactive (background-load error banner)', () => {
    const trigger = makeFocusable('trigger');
    trigger.focus();

    const { result } = renderHook(() => useCommandFeedbackFocus(false));
    act(() => result.current.captureTrigger());
    act(() => result.current.restore()); // nothing was armed

    expect(document.activeElement).toBe(trigger);
  });

  it('restore consumes the target — a second restore is a no-op', () => {
    const trigger = makeFocusable('trigger');
    const banner = makeFocusable('banner');
    trigger.focus();

    const { result, rerender } = renderHook(({ active }) => useCommandFeedbackFocus(active), {
      initialProps: { active: false },
    });
    attachBanner(result.current.bannerRef, banner);
    act(() => result.current.captureTrigger());
    rerender({ active: true });

    act(() => result.current.restore());
    expect(document.activeElement).toBe(trigger);

    // A second restore must not re-move focus (target was consumed).
    banner.focus();
    act(() => result.current.restore());
    expect(document.activeElement).toBe(banner);
  });

  it('disarms the restore target when the banner goes away (active → false)', () => {
    const trigger = makeFocusable('trigger');
    const banner = makeFocusable('banner');
    trigger.focus();

    const { result, rerender } = renderHook(({ active }) => useCommandFeedbackFocus(active), {
      initialProps: { active: false },
    });
    attachBanner(result.current.bannerRef, banner);
    act(() => result.current.captureTrigger());
    rerender({ active: true }); // arms + focuses banner
    rerender({ active: false }); // banner dismissed elsewhere → cleanup disarms

    banner.focus();
    act(() => result.current.restore()); // target was disarmed → no-op
    expect(document.activeElement).toBe(banner);
  });
});
