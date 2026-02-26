import React from 'react';
import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { Logger } from '@/utils/logger';

const log = Logger.getLogger('navigation');

export const ProtectedRoute: React.FC = () => {
  const { isAuthenticated, session, loading } = useAuth();

  log.debug('ProtectedRoute auth check', { isAuthenticated, loading });

  // Show loading state while auth is initializing
  // This prevents flash redirect to login during session restoration
  if (loading) {
    log.debug('Auth loading, showing loading state');
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  // Block access during password recovery flow
  if (isAuthenticated && sessionStorage.getItem('password_recovery_in_progress')) {
    log.info('Recovery session active, redirecting to reset password');
    return <Navigate to="/auth/reset-password" replace />;
  }

  // Redirect blocked users (e.g. org deactivated) to access-blocked page
  if (isAuthenticated && session?.claims.access_blocked) {
    log.info('User access blocked, redirecting to access-blocked page', {
      reason: session.claims.access_block_reason,
    });
    return <Navigate to="/access-blocked" replace />;
  }

  if (!isAuthenticated) {
    log.info('User not authenticated, redirecting to login');
    // Redirect to login page if not authenticated
    return <Navigate to="/login" replace />;
  }

  log.debug('User authenticated, rendering protected content');
  // Render child routes if authenticated
  return <Outlet />;
};
