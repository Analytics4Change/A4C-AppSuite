import React from 'react';
import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { Logger } from '@/utils/logger';

const log = Logger.getLogger('navigation');

export const ProtectedRoute: React.FC = () => {
  const { isAuthenticated, loading } = useAuth();

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

  if (!isAuthenticated) {
    log.info('User not authenticated, redirecting to login');
    // Redirect to login page if not authenticated
    return <Navigate to="/login" replace />;
  }

  log.debug('User authenticated, rendering protected content');
  // Render child routes if authenticated
  return <Outlet />;
};