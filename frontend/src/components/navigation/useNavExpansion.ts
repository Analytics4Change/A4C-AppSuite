import { useState, useEffect, useCallback } from 'react';
import { useLocation } from 'react-router-dom';
import { Logger } from '@/utils/logger';
import type { NavGroup } from './navigation.types';

const log = Logger.getLogger('navigation');
const STORAGE_KEY = 'a4c-nav-expanded';

/** Read expanded keys from localStorage, falling back to all group keys */
function readFromStorage(allGroupKeys: string[]): Set<string> {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      if (Array.isArray(parsed)) return new Set(parsed);
    }
  } catch (err) {
    log.warn('Failed to read nav expansion state from localStorage, using defaults', {
      error: err,
    });
  }
  return new Set(allGroupKeys);
}

/** Write expanded keys to localStorage, swallowing errors */
function writeToStorage(keys: Set<string>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...keys]));
  } catch (err) {
    log.warn('Failed to persist nav expansion state to localStorage', { error: err });
  }
}

/**
 * Manages expand/collapse state for navigation groups.
 * Persists in localStorage and auto-expands the group containing the active route.
 */
export function useNavExpansion(groups: NavGroup[]) {
  const { pathname } = useLocation();
  const allGroupKeys = groups.map((g) => g.key);

  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(() =>
    readFromStorage(allGroupKeys)
  );

  // Persist on change
  useEffect(() => {
    writeToStorage(expandedKeys);
  }, [expandedKeys]);

  // Auto-expand group containing the active route
  useEffect(() => {
    for (const group of groups) {
      if (group.items.some((item) => pathname.startsWith(item.to))) {
        setExpandedKeys((prev) => {
          if (prev.has(group.key)) return prev;
          const next = new Set(prev);
          next.add(group.key);
          return next;
        });
        break;
      }
    }
  }, [pathname, groups]);

  const isExpanded = useCallback((key: string) => expandedKeys.has(key), [expandedKeys]);

  const toggle = useCallback((key: string) => {
    setExpandedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  return { isExpanded, toggle };
}
