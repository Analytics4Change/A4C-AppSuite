import React from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { Logger } from '@/utils/logger';
import type { NavEntry, NavItem } from './navigation.types';

const log = Logger.getLogger('navigation');

/** Check if a nav item is visible for the given org type */
function isVisibleForOrgType(
  item: { showForOrgTypes?: string[]; hideForOrgTypes?: string[] },
  orgType: string | undefined
): boolean {
  if (item.showForOrgTypes && orgType) {
    if (!item.showForOrgTypes.includes(orgType)) return false;
  }
  if (item.hideForOrgTypes && orgType && item.hideForOrgTypes.includes(orgType)) {
    return false;
  }
  return true;
}

/** Check if a single nav item passes permission check (fail-closed on error) */
async function isItemPermitted(
  item: NavItem,
  hasPermission: (perm: string) => Promise<boolean>
): Promise<boolean> {
  if (!item.permission) return true;
  try {
    return await hasPermission(item.permission);
  } catch (err) {
    log.warn(`Permission check failed for ${item.label}, excluding item`, {
      permission: item.permission,
      error: err,
    });
    return false;
  }
}

/** Filter a group's items, returning only permitted ones */
async function filterGroupItems(
  items: NavItem[],
  orgType: string | undefined,
  hasPermission: (perm: string) => Promise<boolean>
): Promise<NavItem[]> {
  const filtered: NavItem[] = [];
  for (const item of items) {
    if (!isVisibleForOrgType(item, orgType)) continue;
    if (await isItemPermitted(item, hasPermission)) {
      filtered.push(item);
    }
  }
  return filtered;
}

/**
 * Shared hook that filters NAVIGATION_CONFIG by org_type and async hasPermission.
 * Used by both SidebarNavigation and MoreMenuSheet.
 *
 * Invariant: Reports and Settings have no permission/org_type filters and always survive.
 */
export function useFilteredNavEntries(entries: NavEntry[]): {
  filteredEntries: NavEntry[];
  isLoading: boolean;
} {
  const { session: authSession, hasPermission } = useAuth();
  const [filteredEntries, setFilteredEntries] = React.useState<NavEntry[]>([]);
  const [isLoading, setIsLoading] = React.useState(true);

  const orgType = authSession?.claims.org_type;

  React.useEffect(() => {
    let cancelled = false;

    const filterEntries = async () => {
      const result: NavEntry[] = [];

      for (const entry of entries) {
        if (entry.type === 'item') {
          if (!isVisibleForOrgType(entry.item, orgType)) continue;
          if (await isItemPermitted(entry.item, hasPermission)) {
            result.push(entry);
          }
        } else {
          // Group: check group-level visibility first
          if (!isVisibleForOrgType(entry.group, orgType)) continue;

          const filteredItems = await filterGroupItems(entry.group.items, orgType, hasPermission);
          if (filteredItems.length === 0) continue;

          result.push({
            type: 'group',
            group: { ...entry.group, items: filteredItems },
          });
        }
      }

      if (!cancelled) {
        if (result.length === 0) {
          log.error('Navigation filtering produced zero entries — this should not happen');
        }
        log.debug('Filtered nav entries', {
          orgType,
          count: result.length,
        });
        setFilteredEntries(result);
        setIsLoading(false);
      }
    };

    filterEntries();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- entries is module-level constant
  }, [authSession, orgType, hasPermission]);

  return { filteredEntries, isLoading };
}
