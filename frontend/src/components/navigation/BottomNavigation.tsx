import React from 'react';
import { NavLink } from 'react-router-dom';
import { Home, Users, Pill, FileText, MoreHorizontal } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { OrganizationType } from '@/types/auth.types';

/**
 * Bottom navigation item definition
 */
interface BottomNavItem {
  to: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  label: string;
  hideForOrgTypes?: OrganizationType[];
  showForOrgTypes?: OrganizationType[];
}

/**
 * Bottom navigation items configuration
 * Mirrors the org_type filtering from the sidebar navigation
 */
const bottomNavItems: BottomNavItem[] = [
  { to: '/', icon: Home, label: 'Home' },
  { to: '/clients', icon: Users, label: 'Clients', hideForOrgTypes: ['platform_owner'] },
  { to: '/medications', icon: Pill, label: 'Meds', hideForOrgTypes: ['platform_owner', 'provider_partner'] },
  { to: '/reports', icon: FileText, label: 'Reports' },
];

interface BottomNavigationProps {
  onMoreClick?: () => void;
}

/**
 * Mobile bottom navigation bar
 * Provides quick access to primary destinations on mobile devices
 * Hidden on desktop (lg breakpoint and above)
 */
export const BottomNavigation: React.FC<BottomNavigationProps> = ({ onMoreClick }) => {
  const { session } = useAuth();
  const orgType = session?.claims.org_type;

  // Filter items based on org_type
  const visibleItems = bottomNavItems.filter(item => {
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

  return (
    <nav
      className="lg:hidden fixed bottom-0 left-0 right-0 z-50
                 bg-white/95 backdrop-blur-md border-t border-gray-200/50"
      role="navigation"
      aria-label="Quick navigation"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <div className="flex justify-around items-center h-16">
        {visibleItems.map((item) => {
          const Icon = item.icon;
          return (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) => `
                flex flex-col items-center justify-center flex-1 h-full py-2
                transition-colors duration-200
                ${isActive
                  ? 'text-blue-600'
                  : 'text-gray-600 hover:text-gray-900'
                }
                focus-visible:outline-none focus-visible:ring-2
                focus-visible:ring-blue-500 focus-visible:ring-inset
              `}
            >
              {({ isActive }) => (
                <>
                  <Icon size={24} aria-hidden="true" />
                  <span className="text-xs mt-1 font-medium">{item.label}</span>
                  {isActive && <span className="sr-only">(current page)</span>}
                </>
              )}
            </NavLink>
          );
        })}

        {/* More button */}
        <button
          className="flex flex-col items-center justify-center flex-1 h-full py-2
                     text-gray-600 hover:text-gray-900
                     focus-visible:outline-none focus-visible:ring-2
                     focus-visible:ring-blue-500 focus-visible:ring-inset"
          onClick={onMoreClick}
          aria-label="More navigation options"
          aria-haspopup="dialog"
        >
          <MoreHorizontal size={24} aria-hidden="true" />
          <span className="text-xs mt-1 font-medium">More</span>
        </button>
      </div>
    </nav>
  );
};
