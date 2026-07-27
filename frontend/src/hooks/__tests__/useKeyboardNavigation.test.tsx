import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import React from 'react';
import { useKeyboardNavigation } from '../useKeyboardNavigation';
import * as focusUtils from '@/utils/focus-management';

// The hook enumerates focusable elements via getAllFocusableElements and computes
// prev/next by index (it does NOT call findPreviousFocusableElement). Mock only the
// util the hook actually uses.
vi.mock('@/utils/focus-management', () => ({
  getAllFocusableElements: vi.fn(),
}));

describe('useKeyboardNavigation', () => {
  let container: HTMLDivElement;
  let button1: HTMLButtonElement;
  let button2: HTMLButtonElement;
  let input1: HTMLInputElement;
  let input2: HTMLInputElement;

  // The hook attaches its keydown listener to the container (capture phase) and
  // ignores events whose target is outside it — so dispatch on the container.
  const dispatchKey = async (
    target: EventTarget,
    key: string,
    opts: { shiftKey?: boolean } = {}
  ) => {
    const event = new KeyboardEvent('keydown', {
      key,
      shiftKey: opts.shiftKey ?? false,
      bubbles: true,
      cancelable: true,
    });
    const preventDefaultSpy = vi.spyOn(event, 'preventDefault');
    await act(async () => {
      target.dispatchEvent(event);
    });
    return { event, preventDefaultSpy };
  };

  // Initial focus is scheduled via requestAnimationFrame; flush a frame to settle it.
  const flushRAF = async () => {
    await act(async () => {
      await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
    });
  };

  beforeEach(() => {
    container = document.createElement('div');

    button1 = document.createElement('button');
    button1.tabIndex = 1;
    button1.textContent = 'Button 1';

    input1 = document.createElement('input');
    input1.tabIndex = 2;
    input1.type = 'text';

    input2 = document.createElement('input');
    input2.tabIndex = 3;
    input2.type = 'text';

    button2 = document.createElement('button');
    button2.tabIndex = 4;
    button2.textContent = 'Button 2';

    container.appendChild(button1);
    container.appendChild(input1);
    container.appendChild(input2);
    container.appendChild(button2);

    document.body.appendChild(container);

    vi.mocked(focusUtils.getAllFocusableElements).mockReturnValue([
      button1,
      input1,
      input2,
      button2,
    ]);
  });

  afterEach(() => {
    document.body.innerHTML = '';
    vi.clearAllMocks();
  });

  describe('Tab key navigation', () => {
    it('should not intercept plain Tab without a focus trap (browser handles natural order)', async () => {
      const containerRef = { current: container };

      renderHook(() => useKeyboardNavigation({ containerRef, enabled: true, trapFocus: false }));
      await flushRAF();

      await act(async () => {
        button1.focus();
      });

      const { preventDefaultSpy } = await dispatchKey(container, 'Tab');

      // trapFocus:false and wrapAround:false → the hook lets the browser move focus.
      expect(preventDefaultSpy).not.toHaveBeenCalled();
    });

    it('should move focus to the previous element on Shift+Tab when trapping', async () => {
      const containerRef = { current: container };

      renderHook(() => useKeyboardNavigation({ containerRef, enabled: true, trapFocus: true }));
      await flushRAF();

      // Move to input2 (index 2); Shift+Tab should focus input1 (index 1).
      await act(async () => {
        input2.focus();
      });
      const focusSpy = vi.spyOn(input1, 'focus');

      const { preventDefaultSpy } = await dispatchKey(container, 'Tab', { shiftKey: true });

      expect(preventDefaultSpy).toHaveBeenCalled();
      expect(focusSpy).toHaveBeenCalled();
    });

    it('should trap focus (wrap to first) on Tab from the last element', async () => {
      const containerRef = { current: container };

      renderHook(() => useKeyboardNavigation({ containerRef, enabled: true, trapFocus: true }));
      await flushRAF();

      await act(async () => {
        button2.focus();
      });
      const focusSpy = vi.spyOn(button1, 'focus');

      const { preventDefaultSpy } = await dispatchKey(container, 'Tab');

      expect(preventDefaultSpy).toHaveBeenCalled();
      expect(focusSpy).toHaveBeenCalled();
    });

    it('should wrap backwards on Shift+Tab from the first element when trapping', async () => {
      const containerRef = { current: container };

      renderHook(() => useKeyboardNavigation({ containerRef, enabled: true, trapFocus: true }));
      await flushRAF();

      await act(async () => {
        button1.focus();
      });
      const focusSpy = vi.spyOn(button2, 'focus');

      const { preventDefaultSpy } = await dispatchKey(container, 'Tab', { shiftKey: true });

      expect(preventDefaultSpy).toHaveBeenCalled();
      expect(focusSpy).toHaveBeenCalled();
    });
  });

  describe('Escape key handling', () => {
    it('should call onEscape when Escape is pressed', async () => {
      const onEscape = vi.fn();
      const containerRef = { current: container };

      renderHook(() => useKeyboardNavigation({ containerRef, enabled: true, onEscape }));

      await dispatchKey(container, 'Escape');

      expect(onEscape).toHaveBeenCalled();
    });

    it('should not call onEscape when disabled', async () => {
      const onEscape = vi.fn();
      const containerRef = { current: container };

      renderHook(() => useKeyboardNavigation({ containerRef, enabled: false, onEscape }));

      await dispatchKey(container, 'Escape');

      expect(onEscape).not.toHaveBeenCalled();
    });
  });

  describe('Focus restoration', () => {
    it('should restore focus on unmount when restoreFocus is true', () => {
      const previousElement = document.createElement('button');
      document.body.appendChild(previousElement);
      previousElement.focus();

      const containerRef = { current: container };

      const { unmount } = renderHook(() =>
        useKeyboardNavigation({ containerRef, enabled: true, restoreFocus: true })
      );

      input1.focus();
      expect(document.activeElement).toBe(input1);

      const focusSpy = vi.spyOn(previousElement, 'focus');
      unmount();

      expect(focusSpy).toHaveBeenCalled();
    });

    it('should not restore focus when restoreFocus is false', () => {
      const previousElement = document.createElement('button');
      document.body.appendChild(previousElement);
      previousElement.focus();

      const containerRef = { current: container };

      const { unmount } = renderHook(() =>
        useKeyboardNavigation({ containerRef, enabled: true, restoreFocus: false })
      );

      input1.focus();
      const focusSpy = vi.spyOn(previousElement, 'focus');
      unmount();

      expect(focusSpy).not.toHaveBeenCalled();
    });
  });

  describe('Initial focus', () => {
    it('should set initial focus when initialFocusRef is provided (after a frame)', async () => {
      const containerRef = { current: container };
      const initialFocusRef = { current: input2 };
      const focusSpy = vi.spyOn(input2, 'focus');

      renderHook(() => useKeyboardNavigation({ containerRef, enabled: true, initialFocusRef }));

      // Initial focus is deferred to requestAnimationFrame.
      await flushRAF();

      expect(focusSpy).toHaveBeenCalled();
    });

    it('should not set initial focus when disabled', async () => {
      const containerRef = { current: container };
      const initialFocusRef = { current: input2 };
      const focusSpy = vi.spyOn(input2, 'focus');

      renderHook(() => useKeyboardNavigation({ containerRef, enabled: false, initialFocusRef }));
      await flushRAF();

      expect(focusSpy).not.toHaveBeenCalled();
    });
  });

  describe('Edge cases', () => {
    it('should handle a missing container gracefully', async () => {
      const containerRef = React.createRef<HTMLElement>();
      const el = document.createElement('button');
      document.body.appendChild(el);

      renderHook(() =>
        useKeyboardNavigation({
          containerRef: containerRef as React.RefObject<HTMLElement>,
          enabled: true,
        })
      );

      // No container → the listener falls back to document. Real key events target an
      // element (which has .closest), not the document node itself; dispatch from one
      // so the hook must not throw.
      await expect(dispatchKey(el, 'Tab')).resolves.toBeDefined();
    });

    it('should handle empty focusable elements', async () => {
      vi.mocked(focusUtils.getAllFocusableElements).mockReturnValue([]);
      const containerRef = { current: container };

      renderHook(() => useKeyboardNavigation({ containerRef, enabled: true, trapFocus: true }));
      await flushRAF();

      await expect(dispatchKey(container, 'Tab')).resolves.toBeDefined();
    });

    it('should not interfere with non-Tab/Escape keys', async () => {
      const containerRef = { current: container };

      renderHook(() => useKeyboardNavigation({ containerRef, enabled: true }));

      const { preventDefaultSpy } = await dispatchKey(container, 'Enter');

      expect(preventDefaultSpy).not.toHaveBeenCalled();
    });

    it('should cleanup the keydown listener on the container on unmount', () => {
      const containerRef = { current: container };
      const removeEventListenerSpy = vi.spyOn(container, 'removeEventListener');

      const { unmount } = renderHook(() => useKeyboardNavigation({ containerRef, enabled: true }));
      unmount();

      expect(removeEventListenerSpy).toHaveBeenCalledWith('keydown', expect.any(Function), true);
    });

    it('should not intercept Tab for a target outside the container', async () => {
      const outsideButton = document.createElement('button');
      document.body.appendChild(outsideButton);
      outsideButton.focus();

      const containerRef = { current: container };

      renderHook(() => useKeyboardNavigation({ containerRef, enabled: true, trapFocus: true }));
      await flushRAF();

      // Dispatch on an element outside the container → the container guard drops it.
      const { preventDefaultSpy } = await dispatchKey(outsideButton, 'Tab');

      expect(preventDefaultSpy).not.toHaveBeenCalled();
    });
  });
});
