import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useFocusAdvancement } from '../useFocusAdvancement';
import * as focusUtils from '@/utils/focus-management';

// The hook resolves a tabIndex target via findElementByTabIndex, then focuses the
// element directly (it does NOT call focusByTabIndex). Mock the util the hook uses.
vi.mock('@/utils/focus-management', () => ({
  findElementByTabIndex: vi.fn(),
}));

// Mock the timings config → 0ms so the hook takes the RAF fast-path in tests.
vi.mock('@/config/timings', () => ({
  TIMINGS: {
    focus: {
      transitionDelay: 0,
    },
  },
}));

/** Create a real, "visible" focusable element (jsdom returns 0×0 rects by default,
 *  which trips the hook's visibility gate — so a non-zero rect is stubbed globally). */
function makeFocusable(id?: string): {
  el: HTMLInputElement;
  focusSpy: ReturnType<typeof vi.spyOn>;
} {
  const el = document.createElement('input');
  el.type = 'text';
  if (id) el.id = id;
  document.body.appendChild(el);
  const focusSpy = vi.spyOn(el, 'focus');
  return { el, focusSpy };
}

describe('useFocusAdvancement', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    // jsdom has no layout → getBoundingClientRect is 0×0; report a visible rect so
    // the hook's `rect.width > 0 && rect.height > 0` visibility gate passes.
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      width: 10,
      height: 10,
      top: 0,
      left: 0,
      right: 10,
      bottom: 10,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as ReturnType<HTMLElement['getBoundingClientRect']>);
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  describe('handleSelection', () => {
    it('should advance focus immediately for keyboard selection', () => {
      const { focusSpy } = makeFocusable();
      vi.mocked(focusUtils.findElementByTabIndex).mockReturnValue(document.querySelector('input'));

      const { result } = renderHook(() =>
        useFocusAdvancement({ targetTabIndex: 5, enabled: true })
      );

      act(() => {
        result.current.handleSelection('test-value', 'keyboard');
      });
      act(() => {
        vi.runAllTimers();
      });

      expect(focusUtils.findElementByTabIndex).toHaveBeenCalledWith(5);
      expect(focusSpy).toHaveBeenCalledTimes(1);
    });

    it('should not advance focus for mouse selection', () => {
      const { focusSpy } = makeFocusable();
      vi.mocked(focusUtils.findElementByTabIndex).mockReturnValue(document.querySelector('input'));

      const { result } = renderHook(() =>
        useFocusAdvancement({ targetTabIndex: 5, enabled: true })
      );

      act(() => {
        result.current.handleSelection('test-value', 'mouse');
      });
      act(() => {
        vi.runAllTimers();
      });

      expect(focusSpy).not.toHaveBeenCalled();
      expect(focusUtils.findElementByTabIndex).not.toHaveBeenCalled();
    });

    it('should not advance focus when disabled', () => {
      vi.mocked(focusUtils.findElementByTabIndex).mockReturnValue(document.createElement('input'));

      const { result } = renderHook(() =>
        useFocusAdvancement({ targetTabIndex: 5, enabled: false })
      );

      act(() => {
        result.current.handleSelection('test-value', 'keyboard');
      });
      act(() => {
        vi.runAllTimers();
      });

      expect(focusUtils.findElementByTabIndex).not.toHaveBeenCalled();
    });

    it('should use targetSelector when provided', () => {
      const { focusSpy } = makeFocusable('test-input');

      const { result } = renderHook(() =>
        useFocusAdvancement({ targetSelector: '#test-input', enabled: true })
      );

      act(() => {
        result.current.handleSelection('test-value', 'keyboard');
      });
      act(() => {
        vi.runAllTimers();
      });

      expect(focusSpy).toHaveBeenCalled();
      expect(focusUtils.findElementByTabIndex).not.toHaveBeenCalled();
    });

    it('should report an error via onFocusError when the targetSelector element is missing', () => {
      const onFocusError = vi.fn();

      const { result } = renderHook(() =>
        useFocusAdvancement({ targetSelector: '#non-existent', enabled: true, onFocusError })
      );

      act(() => {
        result.current.handleSelection('test-value', 'keyboard');
      });
      act(() => {
        vi.runAllTimers();
      });

      expect(onFocusError).toHaveBeenCalledWith(expect.any(Error));
      expect(onFocusError.mock.calls[0][0].message).toMatch(/No element found matching selector/);
      expect(result.current.lastError?.message).toMatch(/No element found matching selector/);
    });

    it('should cancel pending focus when called multiple times', () => {
      const { focusSpy } = makeFocusable();
      vi.mocked(focusUtils.findElementByTabIndex).mockReturnValue(document.querySelector('input'));

      const { result } = renderHook(() =>
        useFocusAdvancement({ targetTabIndex: 5, enabled: true })
      );

      act(() => {
        result.current.handleSelection('first', 'keyboard');
      });
      act(() => {
        result.current.handleSelection('second', 'keyboard');
      });
      act(() => {
        vi.runAllTimers();
      });

      // Only the second (superseding) selection resolves to a focus call.
      expect(focusSpy).toHaveBeenCalledTimes(1);
      expect(focusUtils.findElementByTabIndex).toHaveBeenLastCalledWith(5);
    });

    it('should cleanup timeout on unmount', () => {
      const { focusSpy } = makeFocusable();
      vi.mocked(focusUtils.findElementByTabIndex).mockReturnValue(document.querySelector('input'));

      const { result, unmount } = renderHook(() =>
        useFocusAdvancement({ targetTabIndex: 5, enabled: true })
      );

      act(() => {
        result.current.handleSelection('test', 'keyboard');
      });
      unmount();
      act(() => {
        vi.runAllTimers();
      });

      expect(focusSpy).not.toHaveBeenCalled();
    });
  });

  describe('edge cases', () => {
    it('should let targetTabIndex take precedence over targetSelector', () => {
      // Current hook resolution order is targetRef > targetTabIndex > targetSelector
      // (useFocusAdvancement.ts), so when both are given, the tabIndex path wins.
      const { focusSpy: selectorFocusSpy } = makeFocusable('priority-input');
      const tabIndexEl = document.createElement('input');
      document.body.appendChild(tabIndexEl);
      const tabIndexFocusSpy = vi.spyOn(tabIndexEl, 'focus');
      vi.mocked(focusUtils.findElementByTabIndex).mockReturnValue(tabIndexEl);

      const { result } = renderHook(() =>
        useFocusAdvancement({ targetTabIndex: 5, targetSelector: '#priority-input', enabled: true })
      );

      act(() => {
        result.current.handleSelection('test', 'keyboard');
      });
      act(() => {
        vi.runAllTimers();
      });

      expect(focusUtils.findElementByTabIndex).toHaveBeenCalledWith(5);
      expect(tabIndexFocusSpy).toHaveBeenCalled();
      expect(selectorFocusSpy).not.toHaveBeenCalled();
    });

    it('should report an error via onFocusError when neither target is specified', () => {
      const onFocusError = vi.fn();

      const { result } = renderHook(() => useFocusAdvancement({ enabled: true, onFocusError }));

      act(() => {
        result.current.handleSelection('test', 'keyboard');
      });
      act(() => {
        vi.runAllTimers();
      });

      expect(onFocusError).toHaveBeenCalledWith(expect.any(Error));
      expect(onFocusError.mock.calls[0][0].message).toMatch(/No target specified/);
      expect(focusUtils.findElementByTabIndex).not.toHaveBeenCalled();
    });
  });
});
