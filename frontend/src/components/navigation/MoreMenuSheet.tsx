import React, { useRef } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { LogOut, X } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useKeyboardNavigation } from '@/hooks/useKeyboardNavigation';
import { NAVIGATION_CONFIG } from './navigation.config';
import { useFilteredNavEntries } from './useFilteredNavEntries';
import type { NavItem } from './navigation.types';

/** Routes shown in the bottom navigation bar — excluded from More menu */
const BOTTOM_NAV_ROUTES = new Set(['/', '/clients', '/medications', '/reports']);

interface MoreMenuSheetProps {
  isOpen: boolean;
  onClose: () => void;
}

/**
 * Bottom sheet modal for overflow navigation items.
 * Shows all nav items not in the bottom bar, with group heading dividers.
 * Uses shared filtering (org_type + permission checks).
 */
export const MoreMenuSheet: React.FC<MoreMenuSheetProps> = ({ isOpen, onClose }) => {
  const sheetRef = useRef<HTMLDivElement>(null);
  const { logout } = useAuth();
  const navigate = useNavigate();

  // Focus trapping
  useKeyboardNavigation({
    containerRef: sheetRef,
    enabled: isOpen,
    trapFocus: true,
    restoreFocus: true,
    onEscape: onClose,
  });

  const { filteredEntries } = useFilteredNavEntries(NAVIGATION_CONFIG);

  const handleLogout = () => {
    logout();
    navigate('/login');
    onClose();
  };

  const handleNavClick = () => {
    onClose();
  };

  if (!isOpen) return null;

  // Build flat list of sections for the More menu
  const sections: Array<{ heading?: string; items: NavItem[] }> = [];
  for (const entry of filteredEntries) {
    if (entry.type === 'item') {
      if (BOTTOM_NAV_ROUTES.has(entry.item.to)) continue;
      // Add ungrouped items without a heading
      const lastSection = sections[sections.length - 1];
      if (lastSection && !lastSection.heading) {
        lastSection.items.push(entry.item);
      } else {
        sections.push({ items: [entry.item] });
      }
    } else {
      const overflowItems = entry.group.items.filter((i) => !BOTTOM_NAV_ROUTES.has(i.to));
      if (overflowItems.length > 0) {
        sections.push({ heading: entry.group.label, items: overflowItems });
      }
    }
  }

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/40 z-50 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Sheet */}
      <div
        ref={sheetRef}
        role="dialog"
        aria-modal="true"
        aria-label="More navigation options"
        className="fixed bottom-0 left-0 right-0 z-50
                   bg-white rounded-t-2xl shadow-xl
                   animate-in slide-in-from-bottom duration-200"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        {/* Handle */}
        <div className="flex justify-center pt-3 pb-2">
          <div className="w-12 h-1 bg-gray-300 rounded-full" />
        </div>
        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-2 text-gray-500 hover:text-gray-700
                     focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 rounded-lg"
          aria-label="Close menu"
        >
          <X size={20} aria-hidden="true" />
        </button>
        {/* Menu items with section headings */}
        <nav className="px-4 py-2 space-y-1" aria-label="Additional navigation">
          {sections.map((section, sectionIdx) => (
            <div key={section.heading ?? `ungrouped-${sectionIdx}`}>
              {section.heading && (
                <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-400 px-4 pt-3 pb-1">
                  {section.heading}
                </h3>
              )}
              {section.items.map((item) => {
                const Icon = item.icon;
                return (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    onClick={handleNavClick}
                    className={({ isActive }) => `
                      flex items-center gap-3 px-4 py-3 rounded-lg
                      transition-colors duration-200
                      ${isActive ? 'bg-blue-50 text-blue-700' : 'text-gray-700 hover:bg-gray-100'}
                      focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500
                    `}
                  >
                    <Icon size={20} aria-hidden="true" />
                    <span className="font-medium">{item.label}</span>
                  </NavLink>
                );
              })}
            </div>
          ))}

          <div className="border-t border-gray-200 my-2" />

          <button
            onClick={handleLogout}
            className="flex items-center gap-3 px-4 py-3 rounded-lg
                       text-red-600 hover:bg-red-50 w-full text-left
                       focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
          >
            <LogOut size={20} aria-hidden="true" />
            <span className="font-medium">Logout</span>
          </button>
        </nav>
        <div className="h-4" /> {/* Bottom spacing */}
      </div>
    </>
  );
};
