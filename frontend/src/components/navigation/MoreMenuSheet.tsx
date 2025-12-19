import React, { useRef } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { Building, FolderTree, Settings, LogOut, X } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useKeyboardNavigation } from '@/hooks/useKeyboardNavigation';
import { OrganizationType } from '@/types/auth.types';

/**
 * More menu item definition
 */
interface MoreMenuItem {
  to: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  label: string;
  hideForOrgTypes?: OrganizationType[];
  showForOrgTypes?: OrganizationType[];
}

/**
 * More menu items - overflow items not shown in bottom nav
 */
const moreMenuItems: MoreMenuItem[] = [
  { to: '/organizations', icon: Building, label: 'Organizations', showForOrgTypes: ['platform_owner'] },
  { to: '/organization-units', icon: FolderTree, label: 'Organization Units', showForOrgTypes: ['provider'] },
  { to: '/settings', icon: Settings, label: 'Settings' },
];

interface MoreMenuSheetProps {
  isOpen: boolean;
  onClose: () => void;
}

/**
 * Bottom sheet modal for overflow navigation items
 * Contains items not shown in the bottom navigation bar
 */
export const MoreMenuSheet: React.FC<MoreMenuSheetProps> = ({ isOpen, onClose }) => {
  const sheetRef = useRef<HTMLDivElement>(null);
  const { session, logout } = useAuth();
  const navigate = useNavigate();
  const orgType = session?.claims.org_type;

  // Focus trapping
  useKeyboardNavigation({
    containerRef: sheetRef,
    enabled: isOpen,
    trapFocus: true,
    restoreFocus: true,
    onEscape: onClose
  });

  // Filter items based on org_type
  const visibleItems = moreMenuItems.filter(item => {
    // Check showForOrgTypes (inclusion pattern)
    if (item.showForOrgTypes && orgType) {
      if (!item.showForOrgTypes.includes(orgType)) {
        return false;
      }
    }
    // Check hideForOrgTypes (exclusion pattern)
    if (item.hideForOrgTypes && orgType && item.hideForOrgTypes.includes(orgType)) {
      return false;
    }
    return true;
  });

  const handleLogout = () => {
    logout();
    navigate('/login');
    onClose();
  };

  const handleNavClick = () => {
    onClose();
  };

  if (!isOpen) return null;

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

        {/* Menu items */}
        <nav className="px-4 py-2 space-y-1" aria-label="Additional navigation">
          {visibleItems.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                onClick={handleNavClick}
                className={({ isActive }) => `
                  flex items-center gap-3 px-4 py-3 rounded-lg
                  transition-colors duration-200
                  ${isActive
                    ? 'bg-blue-50 text-blue-700'
                    : 'text-gray-700 hover:bg-gray-100'
                  }
                  focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500
                `}
              >
                <Icon size={20} aria-hidden="true" />
                <span className="font-medium">{item.label}</span>
              </NavLink>
            );
          })}

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
