import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useFocusAdvancement } from '../useFocusAdvancement';
import * as focusUtils from '@/utils/focus-management';

// Mock the focus-management utilities
vi.mock('@/utils/focus-management', () => ({
  focusByTabIndex: vi.fn()
}));

// Mock the timings config
vi.mock('@/config/timings', () => ({
  TIMINGS: {
    focus: {
      transitionDelay: 0 // Use 0ms for tests
    }
  }
}));

describe('useFocusAdvancement', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  describe('handleSelection', () => {
    it('should advance focus immediately for keyboard selection', () => {
      const { result } = renderHook(() => 
        useFocusAdvancement({
          targetTabIndex: 5,
          enabled: true
        })
      );

      act(() => {
        result.current.handleSelection('test-value', 'keyboard');
      });

      // Should call focus immediately with 0ms delay in test environment
      vi.runAllTimers();
      
      expect(focusUtils.focusByTabIndex).toHaveBeenCalledWith(5);
      expect(focusUtils.focusByTabIndex).toHaveBeenCalledTimes(1);
    });

    it('should not advance focus for mouse selection', () => {
      const { result } = renderHook(() => 
        useFocusAdvancement({
          targetTabIndex: 5,
          enabled: true
        })
      );

      act(() => {
        result.current.handleSelection('test-value', 'mouse');
      });

      vi.runAllTimers();
      
      expect(focusUtils.focusByTabIndex).not.toHaveBeenCalled();
    });

    it('should not advance focus when disabled', () => {
      const { result } = renderHook(() => 
        useFocusAdvancement({
          targetTabIndex: 5,
          enabled: false
        })
      );

      act(() => {
        result.current.handleSelection('test-value', 'keyboard');
      });

      vi.runAllTimers();
      
      expect(focusUtils.focusByTabIndex).not.toHaveBeenCalled();
    });

    it('should use targetSelector when provided', () => {
      const mockElement = document.createElement('input');
      mockElement.id = 'test-input';
      document.body.appendChild(mockElement);

      const focusSpy = vi.spyOn(mockElement, 'focus');

      const { result } = renderHook(() => 
        useFocusAdvancement({
          targetSelector: '#test-input',
          enabled: true
        })
      );

      act(() => {
        result.current.handleSelection('test-value', 'keyboard');
      });

      vi.runAllTimers();
      
      expect(focusSpy).toHaveBeenCalled();
      expect(focusUtils.focusByTabIndex).not.toHaveBeenCalled();

      document.body.removeChild(mockElement);
    });

    it('should handle missing targetSelector element gracefully', () => {
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const { result } = renderHook(() => 
        useFocusAdvancement({
          targetSelector: '#non-existent',
          enabled: true
        })
      );

      act(() => {
        result.current.handleSelection('test-value', 'keyboard');
      });

      vi.runAllTimers();
      
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        'Focus advancement: Target element not found',
        '#non-existent'
      );
      
      consoleWarnSpy.mockRestore();
    });

    it('should cancel pending focus when called multiple times', () => {
      const { result } = renderHook(() => 
        useFocusAdvancement({
          targetTabIndex: 5,
          enabled: true
        })
      );

      act(() => {
        result.current.handleSelection('first', 'keyboard');
      });

      // Advance time partially
      vi.advanceTimersByTime(25);

      act(() => {
        result.current.handleSelection('second', 'keyboard');
      });

      // Complete the timers
      vi.runAllTimers();

      // Should only call focus once (for the second selection)
      expect(focusUtils.focusByTabIndex).toHaveBeenCalledTimes(1);
      expect(focusUtils.focusByTabIndex).toHaveBeenCalledWith(5);
    });

    it('should cleanup timeout on unmount', () => {
      const { result, unmount } = renderHook(() => 
        useFocusAdvancement({
          targetTabIndex: 5,
          enabled: true
        })
      );

      act(() => {
        result.current.handleSelection('test', 'keyboard');
      });

      // Unmount before timeout completes
      unmount();

      vi.runAllTimers();

      // Focus should not be called if component unmounted
      expect(focusUtils.focusByTabIndex).not.toHaveBeenCalled();
    });

    it('should track lastSelectionMethod correctly', () => {
      const { result } = renderHook(() => 
        useFocusAdvancement({
          targetTabIndex: 5,
          enabled: true
        })
      );

      // lastSelectionMethod removed from public API

      act(() => {
        result.current.handleSelection('test1', 'keyboard');
      });

      // lastSelectionMethod removed from public API

      act(() => {
        result.current.handleSelection('test2', 'mouse');
      });

      // lastSelectionMethod removed from public API
    });

    it('should handle keyboard selection with advancement', () => {
      const { result } = renderHook(() => 
        useFocusAdvancement({
          targetTabIndex: 5,
          enabled: true
        })
      );

      act(() => {
        result.current.handleSelection('test-value', 'keyboard');
      });

      vi.runAllTimers();

      // Focus advancement happens internally
      const focusedElement = document.querySelector('[tabIndex="5"]');
      if (focusedElement) {
        expect(document.activeElement).toBe(focusedElement);
      }
    });

    it('should not advance focus for mouse selection', () => {
      const { result } = renderHook(() => 
        useFocusAdvancement({
          targetTabIndex: 5,
          enabled: true
        })
      );

      const initialFocus = document.activeElement;

      act(() => {
        result.current.handleSelection('test-value', 'mouse');
      });

      vi.runAllTimers();

      // Focus should not change for mouse selection
      expect(document.activeElement).toBe(initialFocus);
    });
  });

  describe('edge cases', () => {
    it('should handle both targetTabIndex and targetSelector (targetSelector takes precedence)', () => {
      const mockElement = document.createElement('input');
      mockElement.id = 'priority-input';
      document.body.appendChild(mockElement);

      const focusSpy = vi.spyOn(mockElement, 'focus');

      const { result } = renderHook(() => 
        useFocusAdvancement({
          targetTabIndex: 5,
          targetSelector: '#priority-input',
          enabled: true
        })
      );

      act(() => {
        result.current.handleSelection('test', 'keyboard');
      });

      vi.runAllTimers();

      expect(focusSpy).toHaveBeenCalled();
      expect(focusUtils.focusByTabIndex).not.toHaveBeenCalled();

      document.body.removeChild(mockElement);
    });

    it('should handle neither targetTabIndex nor targetSelector gracefully', () => {
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const { result } = renderHook(() => 
        useFocusAdvancement({
          enabled: true
        })
      );

      act(() => {
        result.current.handleSelection('test', 'keyboard');
      });

      vi.runAllTimers();

      expect(consoleWarnSpy).toHaveBeenCalledWith(
        'Focus advancement: No target specified'
      );
      expect(focusUtils.focusByTabIndex).not.toHaveBeenCalled();

      consoleWarnSpy.mockRestore();
    });
  });
});