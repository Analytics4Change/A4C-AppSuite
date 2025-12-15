import React from 'react';
import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import {
  Users,
  Pill,
  FileText,
  Settings,
  LogOut,
  Menu,
  X,
  Building,
  UserCog,
  FolderTree,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ImpersonationBanner } from '@/components/auth/ImpersonationBanner';
import { ImpersonationModal } from '@/components/auth/ImpersonationModal';
import { useImpersonationUI } from '@/hooks/useImpersonationUI';

export const MainLayout: React.FC = () => {
  const { user, logout, session: authSession, hasPermission } = useAuth();
  const navigate = useNavigate();
  const [sidebarOpen, setSidebarOpen] = React.useState(false);

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

  // Define all possible nav items with their required roles and permissions
  const allNavItems = [
    { to: '/clients', icon: Users, label: 'Clients', roles: ['super_admin', 'provider_admin', 'administrator', 'nurse', 'caregiver'] },
    { to: '/organizations', icon: Building, label: 'Organizations', roles: ['super_admin', 'partner_onboarder'], permission: 'organization.create' },
    { to: '/organization-units', icon: FolderTree, label: 'Org Units', roles: ['super_admin', 'provider_admin'], permission: 'organization.view_ou' },
    { to: '/medications', icon: Pill, label: 'Medications', roles: ['super_admin', 'provider_admin', 'administrator', 'nurse'] },
    { to: '/reports', icon: FileText, label: 'Reports', roles: ['super_admin', 'provider_admin', 'administrator'] },
    { to: '/settings', icon: Settings, label: 'Settings', roles: ['super_admin', 'provider_admin', 'administrator'] },
  ];

  // Filter nav items based on user role and permissions
  const userRole = authSession?.claims.user_role || 'caregiver'; // Default to most restrictive role
  const [navItems, setNavItems] = React.useState<typeof allNavItems>([]);

  // Debug logging
  console.log('[MainLayout] Current user:', {
    email: user?.email,
    role: authSession?.claims.user_role,
    userRole: userRole,
    userRoleLowercase: userRole.toLowerCase()
  });

  // Filter nav items by role AND permission (async)
  React.useEffect(() => {
    const filterItems = async () => {
      console.log('[MainLayout] Filtering nav items:', {
        userRole,
        userPermissions: authSession?.claims.permissions,
        allNavItemsCount: allNavItems.length
      });

      const filtered = [];

      for (const item of allNavItems) {
        // Check role first
        const roleMatch = item.roles.includes(userRole.toLowerCase());
        console.log(`[MainLayout] ${item.label}: role check`, {
          userRole: userRole.toLowerCase(),
          requiredRoles: item.roles,
          roleMatch
        });

        if (!roleMatch) continue;

        // If item requires permission, check it
        if ('permission' in item && item.permission) {
          const allowed = await hasPermission(item.permission);
          console.log(`[MainLayout] ${item.label}: permission check`, {
            requiredPermission: item.permission,
            userPermissions: authSession?.claims.permissions,
            allowed
          });

          if (allowed) {
            filtered.push(item);
          } else {
            console.warn(`[MainLayout] ❌ Hiding ${item.label}: missing permission ${item.permission}`);
          }
        } else {
          // No permission required, just role
          console.log(`[MainLayout] ✅ Showing ${item.label}: role match, no permission required`);
          filtered.push(item);
        }
      }

      console.log('[MainLayout] Final nav items:', {
        count: filtered.length,
        items: filtered.map(i => i.label)
      });

      setNavItems(filtered);
    };

    filterItems();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- allNavItems is a module-level constant
  }, [authSession, userRole, hasPermission]);

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
        className="lg:hidden fixed top-4 left-4 z-50 p-2 bg-white/80 backdrop-blur-md rounded-md shadow-md"
        onClick={() => setSidebarOpen(!sidebarOpen)}
      >
        {sidebarOpen ? <X size={24} /> : <Menu size={24} />}
      </button>

      {/* Overlay for mobile */}
      {sidebarOpen && (
        <div 
          className="lg:hidden fixed inset-0 bg-black/20 backdrop-blur-sm z-30"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar with glassmorphism */}
      <aside className={`
        fixed lg:static inset-y-0 left-0 z-40
        w-64 
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
            className="h-10 w-auto"
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
      <main className="flex-1 lg:ml-0 bg-gradient-to-br from-gray-50 via-white to-blue-50 min-h-screen">
        <div className="p-6">
          <Outlet />
        </div>
      </main>
    </div>
    </>
  );
};