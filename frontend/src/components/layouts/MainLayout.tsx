import React, { useRef, useState } from 'react';
import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { OrganizationType } from '@/types/auth.types';
import { useKeyboardNavigation } from '@/hooks/useKeyboardNavigation';
import { BottomNavigation, MoreMenuSheet } from '@/components/navigation';
import {
  Users,
  UsersRound,
  Pill,
  FileText,
  Settings,
  LogOut,
  Menu,
  X,
  Building,
  UserCog,
  FolderTree,
  Shield,
  AlertTriangle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ImpersonationBanner } from '@/components/auth/ImpersonationBanner';
import { ImpersonationModal } from '@/components/auth/ImpersonationModal';
import { useImpersonationUI } from '@/hooks/useImpersonationUI';
import { Logger } from '@/utils/logger';

const log = Logger.getLogger('navigation');

export const MainLayout: React.FC = () => {
  const { user, logout, session: authSession, hasPermission } = useAuth();
  const navigate = useNavigate();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  const sidebarRef = useRef<HTMLElement>(null);

  // Focus trapping for mobile sidebar
  useKeyboardNavigation({
    containerRef: sidebarRef,
    enabled: sidebarOpen,
    trapFocus: true,
    restoreFocus: true,
    onEscape: () => setSidebarOpen(false)
  });

  // Impersonation UI hook
  const {
    session: impersonationSession,
    isImpersonating,
    canImpersonate,
    isModalOpen,
    openImpersonationModal,
    closeImpersonationModal,
    handleImpersonationStart,
    handleEndImpersonation
  } = useImpersonationUI();

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  // Nav item definition with optional org type filter
  interface NavItem {
    to: string;
    icon: React.ComponentType<{ size?: number; className?: string }>;
    label: string;
    roles: string[];
    permission?: string;
    hideForOrgTypes?: OrganizationType[];
    showForOrgTypes?: OrganizationType[];  // Only show for these org types (inclusion pattern)
  }

  // Define all possible nav items with their required roles, permissions, and org type filters
  // Org type visibility:
  // - platform_owner: Organizations, Reports, Settings
  // - provider: Clients, Organization Units, Medication Management, Reports, Settings
  // - provider_partner: Clients, Reports, Settings
  const allNavItems: NavItem[] = [
    { to: '/clients', icon: Users, label: 'Clients', roles: ['super_admin', 'provider_admin', 'administrator', 'nurse', 'caregiver'], hideForOrgTypes: ['platform_owner'] },
    { to: '/organizations', icon: Building, label: 'Organizations', roles: ['super_admin'], permission: 'organization.create', showForOrgTypes: ['platform_owner'] },
    { to: '/organization-units', icon: FolderTree, label: 'Organization Units', roles: ['super_admin', 'provider_admin'], permission: 'organization.view_ou', showForOrgTypes: ['provider'] },
    { to: '/roles', icon: Shield, label: 'Roles', roles: ['super_admin', 'provider_admin'], permission: 'role.create', showForOrgTypes: ['provider'] },
    { to: '/users', icon: UsersRound, label: 'User Management', roles: ['super_admin', 'provider_admin'], permission: 'user.view', showForOrgTypes: ['provider'] },
    { to: '/medications', icon: Pill, label: 'Medication Management', roles: ['super_admin', 'provider_admin', 'administrator', 'nurse'], hideForOrgTypes: ['platform_owner', 'provider_partner'] },
    { to: '/reports', icon: FileText, label: 'Reports', roles: ['super_admin', 'provider_admin', 'administrator'] },
    { to: '/settings', icon: Settings, label: 'Settings', roles: ['super_admin', 'provider_admin', 'administrator'] },
    { to: '/admin/events', icon: AlertTriangle, label: 'Event Monitor', roles: ['super_admin'], showForOrgTypes: ['platform_owner'] },
  ];

  // Filter nav items based on user role and permissions
  const userRole = authSession?.claims.user_role || 'caregiver'; // Default to most restrictive role
  const [navItems, setNavItems] = React.useState<typeof allNavItems>([]);

  // Debug logging
  const userOrgType = authSession?.claims.org_type;
  log.debug('Current user', {
    email: user?.email,
    role: authSession?.claims.user_role,
    orgType: userOrgType,
    userRole: userRole,
    userRoleLowercase: userRole.toLowerCase()
  });

  // Filter nav items by role, permission, AND org type (async)
  React.useEffect(() => {
    const filterItems = async () => {
      log.debug('Filtering nav items', {
        userRole,
        userOrgType,
        userPermissions: authSession?.claims.permissions,
        allNavItemsCount: allNavItems.length
      });

      const filtered: NavItem[] = [];

      for (const item of allNavItems) {
        // Check role first
        const roleMatch = item.roles.includes(userRole.toLowerCase());
        log.debug(`${item.label}: role check`, {
          userRole: userRole.toLowerCase(),
          requiredRoles: item.roles,
          roleMatch
        });

        if (!roleMatch) continue;

        // Check org type filter (showForOrgTypes - inclusion pattern)
        // If showForOrgTypes is set, item is ONLY visible to those org types
        if (item.showForOrgTypes && userOrgType) {
          if (!item.showForOrgTypes.includes(userOrgType)) {
            log.debug(`Hiding ${item.label}: org type not in showForOrgTypes`, {
              userOrgType,
              showForOrgTypes: item.showForOrgTypes
            });
            continue;
          }
        }

        // Check org type filter (hideForOrgTypes - exclusion pattern)
        if (item.hideForOrgTypes && userOrgType && item.hideForOrgTypes.includes(userOrgType)) {
          log.debug(`Hiding ${item.label}: org type excluded`, {
            userOrgType,
            hideForOrgTypes: item.hideForOrgTypes
          });
          continue;
        }

        // If item requires permission, check it
        if ('permission' in item && item.permission) {
          const allowed = await hasPermission(item.permission);
          log.debug(`${item.label}: permission check`, {
            requiredPermission: item.permission,
            userPermissions: authSession?.claims.permissions,
            allowed
          });

          if (allowed) {
            filtered.push(item);
          } else {
            log.warn(`Hiding ${item.label}: missing permission`, { permission: item.permission });
          }
        } else {
          // No permission required, just role
          log.debug(`Showing ${item.label}: role match, no permission required`);
          filtered.push(item);
        }
      }

      log.debug('Final nav items', {
        count: filtered.length,
        items: filtered.map(i => i.label)
      });

      setNavItems(filtered);
    };

    filterItems();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- allNavItems is a module-level constant
  }, [authSession, userRole, userOrgType, hasPermission]);

  return (
    <>
      {/* Impersonation Banner - Always at the top */}
      {isImpersonating && impersonationSession && (
        <ImpersonationBanner
          session={impersonationSession}
          onEndImpersonation={handleEndImpersonation}
        />
      )}

      {/* Impersonation Modal */}
      {canImpersonate && user && authSession && (
        <ImpersonationModal
          isOpen={isModalOpen}
          onClose={closeImpersonationModal}
          currentUser={{
            id: user.id,
            email: user.email,
            role: authSession.claims.user_role
          }}
          onImpersonationStart={handleImpersonationStart}
        />
      )}

      <div className="min-h-screen flex">
      {/* Mobile menu button */}
      <button
        className="lg:hidden fixed top-4 left-4 z-50 p-2 bg-white/80 backdrop-blur-md rounded-md shadow-md
                   focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
        onClick={() => setSidebarOpen(!sidebarOpen)}
        aria-label={sidebarOpen ? 'Close navigation menu' : 'Open navigation menu'}
        aria-expanded={sidebarOpen}
        aria-controls="mobile-sidebar"
      >
        {sidebarOpen ? <X size={24} aria-hidden="true" /> : <Menu size={24} aria-hidden="true" />}
      </button>

      {/* Overlay for mobile */}
      {sidebarOpen && (
        <div
          className="lg:hidden fixed inset-0 bg-black/20 backdrop-blur-sm z-30"
          onClick={() => setSidebarOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Sidebar with glassmorphism */}
      <aside
        ref={sidebarRef}
        id="mobile-sidebar"
        role="navigation"
        aria-label="Main navigation"
        className={`
          fixed lg:static inset-y-0 left-0 z-40
          w-[280px] sm:w-72 lg:w-64
          transform ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}
          lg:translate-x-0 transition-transform duration-200 ease-in-out
          flex flex-col
          glass-sidebar glass-sidebar-borders
        `}
      style={{
        background: 'rgba(255, 255, 255, 0.75)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        borderRight: '1px solid',
        borderImage: 'linear-gradient(180deg, rgba(255,255,255,0.5) 0%, rgba(255,255,255,0.2) 50%, rgba(255,255,255,0.5) 100%) 1',
        boxShadow: `
          0 0 0 1px rgba(255, 255, 255, 0.18) inset,
          2px 0 4px rgba(0, 0, 0, 0.04),
          4px 0 8px rgba(0, 0, 0, 0.04),
          8px 0 16px rgba(0, 0, 0, 0.04),
          0 0 24px rgba(59, 130, 246, 0.03)
        `.trim()
      }}>
        {/* Logo */}
        <div className="p-4 border-b border-gray-200/30">
          <img
            src="/logo.png"
            alt="Analytics4Change"
            className="h-24 w-auto"
          />
        </div>

        {/* Navigation */}
        <nav className="flex-1 px-4 py-6 space-y-2">
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) => `
                  flex items-center gap-3 px-4 py-3 rounded-xl
                  transition-all duration-300 group
                  ${isActive 
                    ? 'glass-nav-active' 
                    : 'glass-nav-inactive'
                  }
                `}
                onClick={() => setSidebarOpen(false)}
              >
                <Icon size={20} className={navItems.find(n => n.to === item.to) ? '' : ''} />
                <span className="font-medium">{item.label}</span>
              </NavLink>
            );
          })}
        </nav>

        {/* User Section */}
        <div className="p-4" style={{
          borderTop: '1px solid',
          borderImage: 'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.5) 50%, transparent 100%) 1'
        }}>
          <div className="flex items-center justify-between mb-3">
            <div>
              <p className="text-sm font-medium text-gray-800">
                {isImpersonating && impersonationSession ? impersonationSession.context.impersonatedUserEmail : user?.name}
              </p>
              <p className="text-xs text-gray-600">
                {isImpersonating && impersonationSession ? impersonationSession.context.impersonatedUserRole : authSession?.claims.user_role}
              </p>
              {isImpersonating && impersonationSession && (
                <p className="text-xs text-yellow-600 font-medium mt-1">Impersonating</p>
              )}
            </div>
          </div>

          {/* Impersonation button for super admins */}
          {canImpersonate && !isImpersonating && (
            <Button
              variant="ghost"
              size="sm"
              className="w-full justify-start text-gray-700 hover:text-gray-900 rounded-lg transition-all duration-300 mb-2"
              onClick={openImpersonationModal}
              style={{
                background: 'rgba(255, 255, 255, 0.3)',
                backdropFilter: 'blur(10px)',
                WebkitBackdropFilter: 'blur(10px)',
                border: '1px solid rgba(255, 255, 255, 0.2)'
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'rgba(255, 193, 7, 0.1)';
                e.currentTarget.style.borderColor = 'rgba(255, 193, 7, 0.3)';
                e.currentTarget.style.boxShadow = '0 0 20px rgba(255, 193, 7, 0.15) inset';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'rgba(255, 255, 255, 0.3)';
                e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.2)';
                e.currentTarget.style.boxShadow = 'none';
              }}
            >
              <UserCog className="mr-2" size={16} />
              Impersonate User
            </Button>
          )}

          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-start text-gray-700 hover:text-gray-900 rounded-lg transition-all duration-300"
            onClick={handleLogout}
            style={{
              background: 'rgba(255, 255, 255, 0.3)',
              backdropFilter: 'blur(10px)',
              WebkitBackdropFilter: 'blur(10px)',
              border: '1px solid rgba(255, 255, 255, 0.2)'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'rgba(255, 71, 87, 0.1)';
              e.currentTarget.style.borderColor = 'rgba(255, 71, 87, 0.3)';
              e.currentTarget.style.boxShadow = '0 0 20px rgba(255, 71, 87, 0.15) inset';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'rgba(255, 255, 255, 0.3)';
              e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.2)';
              e.currentTarget.style.boxShadow = 'none';
            }}
          >
            <LogOut className="mr-2" size={16} />
            Logout
          </Button>
        </div>
      </aside>

      {/* Main Content with subtle gradient background */}
      {/* pb-20 provides space for bottom nav on mobile */}
      <main className="flex-1 lg:ml-0 bg-gradient-to-br from-gray-50 via-white to-blue-50 min-h-screen pb-20 lg:pb-0">
        <div className="p-6">
          <Outlet />
        </div>
      </main>
    </div>

    {/* Mobile bottom navigation */}
    <BottomNavigation onMoreClick={() => setMoreMenuOpen(true)} />

    {/* More menu sheet for overflow items */}
    <MoreMenuSheet
      isOpen={moreMenuOpen}
      onClose={() => setMoreMenuOpen(false)}
    />
    </>
  );
};