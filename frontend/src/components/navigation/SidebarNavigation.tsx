import React, { useMemo } from 'react';
import { Logger } from '@/utils/logger';
import { NAVIGATION_CONFIG } from './navigation.config';
import { useFilteredNavEntries } from './useFilteredNavEntries';
import { useNavExpansion } from './useNavExpansion';
import { NavItemLink } from './NavItemLink';
import { NavGroupSection } from './NavGroupSection';

const log = Logger.getLogger('navigation');

interface SidebarNavigationProps {
  onNavClick: () => void;
}

/** Top-level sidebar navigation with collapsible groups */
export const SidebarNavigation: React.FC<SidebarNavigationProps> = ({ onNavClick }) => {
  const { filteredEntries, isLoading } = useFilteredNavEntries(NAVIGATION_CONFIG);

  // Extract visible groups for the expansion hook
  const visibleGroups = useMemo(
    () => filteredEntries.filter((e) => e.type === 'group').map((e) => e.group),
    [filteredEntries]
  );

  const { isExpanded, toggle } = useNavExpansion(visibleGroups);

  if (isLoading) {
    return (
      <nav data-testid="sidebar-nav" className="flex-1 px-4 py-6" aria-label="Main navigation">
        <div className="space-y-2">
          {/* Skeleton placeholders */}
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-10 rounded-xl bg-gray-200/30 animate-pulse" />
          ))}
        </div>
      </nav>
    );
  }

  if (filteredEntries.length === 0) {
    log.error('Navigation filtering produced zero entries — rendering fallback');
    return (
      <nav data-testid="sidebar-nav" className="flex-1 px-4 py-6" aria-label="Main navigation">
        <p className="text-sm text-gray-500 px-4">Navigation unavailable</p>
      </nav>
    );
  }

  return (
    <nav
      data-testid="sidebar-nav"
      className="flex-1 px-4 py-6 space-y-1"
      aria-label="Main navigation"
    >
      {filteredEntries.map((entry) => {
        if (entry.type === 'item') {
          return <NavItemLink key={entry.item.to} item={entry.item} onClick={onNavClick} />;
        }

        return (
          <NavGroupSection
            key={entry.group.key}
            group={entry.group}
            isExpanded={isExpanded(entry.group.key)}
            onToggle={() => toggle(entry.group.key)}
            onNavClick={onNavClick}
          />
        );
      })}
    </nav>
  );
};
