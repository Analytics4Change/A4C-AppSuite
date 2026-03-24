import React, { useRef, useState } from 'react';
import { Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { useKeyboardNavigation } from '@/hooks/useKeyboardNavigation';
import { BottomNavigation, MoreMenuSheet, SidebarNavigation } from '@/components/navigation';
import { LogOut, Menu, X, UserCog } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ImpersonationBanner } from '@/components/auth/ImpersonationBanner';
import { ImpersonationModal } from '@/components/auth/ImpersonationModal';
import { useImpersonationUI } from '@/hooks/useImpersonationUI';

export const MainLayout: React.FC = () => {
  const { user, logout, session: authSession } = useAuth();
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
    onEscape: () => setSidebarOpen(false),
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
    handleEndImpersonation,
  } = useImpersonationUI();

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

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
            role: authSession.claims.org_type,
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
            borderImage:
              'linear-gradient(180deg, rgba(255,255,255,0.5) 0%, rgba(255,255,255,0.2) 50%, rgba(255,255,255,0.5) 100%) 1',
            boxShadow: `
          0 0 0 1px rgba(255, 255, 255, 0.18) inset,
          2px 0 4px rgba(0, 0, 0, 0.04),
          4px 0 8px rgba(0, 0, 0, 0.04),
          8px 0 16px rgba(0, 0, 0, 0.04),
          0 0 24px rgba(59, 130, 246, 0.03)
        `.trim(),
          }}
        >
          {/* Logo */}
          <div className="p-4 border-b border-gray-200/30">
            <img src="/logo.png" alt="Analytics4Change" className="h-24 w-auto" />
          </div>

          {/* Navigation — collapsible tree structure */}
          <SidebarNavigation onNavClick={() => setSidebarOpen(false)} />

          {/* User Section */}
          <div
            className="p-4"
            style={{
              borderTop: '1px solid',
              borderImage:
                'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.5) 50%, transparent 100%) 1',
            }}
          >
            <div className="flex items-center justify-between mb-3">
              <div>
                <p className="text-sm font-medium text-gray-800">
                  {isImpersonating && impersonationSession
                    ? impersonationSession.context.impersonatedUserEmail
                    : user?.name}
                </p>
                <p className="text-xs text-gray-600">
                  {isImpersonating && impersonationSession
                    ? impersonationSession.context.impersonatedUserRole
                    : authSession?.claims.org_type}
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
                  border: '1px solid rgba(255, 255, 255, 0.2)',
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
                border: '1px solid rgba(255, 255, 255, 0.2)',
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
      <MoreMenuSheet isOpen={moreMenuOpen} onClose={() => setMoreMenuOpen(false)} />
    </>
  );
};
