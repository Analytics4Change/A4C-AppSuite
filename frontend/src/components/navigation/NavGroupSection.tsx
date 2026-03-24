import React from 'react';
import { ChevronRight, ChevronDown } from 'lucide-react';
import type { NavGroup } from './navigation.types';
import { NavItemLink } from './NavItemLink';

interface NavGroupSectionProps {
  group: NavGroup;
  isExpanded: boolean;
  onToggle: () => void;
  onNavClick: () => void;
}

/** Collapsible navigation group with accessible disclosure pattern */
export const NavGroupSection: React.FC<NavGroupSectionProps> = ({
  group,
  isExpanded,
  onToggle,
  onNavClick,
}) => {
  const itemsId = `nav-group-${group.key}-items`;
  const ChevronIcon = isExpanded ? ChevronDown : ChevronRight;

  return (
    <div>
      <button
        data-testid={`nav-group-${group.key}`}
        aria-expanded={isExpanded}
        aria-controls={itemsId}
        onClick={onToggle}
        className="flex items-center gap-2 w-full px-4 py-2 text-xs font-semibold uppercase tracking-wider
                   text-gray-500 hover:text-gray-700 rounded-lg
                   transition-colors duration-200
                   focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
      >
        <ChevronIcon
          size={14}
          aria-hidden="true"
          className="transition-transform duration-200 flex-shrink-0"
        />
        <span>{group.label}</span>
      </button>

      {isExpanded && (
        <ul
          id={itemsId}
          data-testid={itemsId}
          role="list"
          aria-label={`${group.label} navigation items`}
          className="space-y-1 mt-1"
        >
          {group.items.map((item) => (
            <li key={item.to} role="listitem">
              <NavItemLink item={item} onClick={onNavClick} indented />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};
