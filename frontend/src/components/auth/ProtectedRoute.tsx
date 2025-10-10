import React from 'react';
import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { Logger } from '@/utils/logger';

const log = Logger.getLogger('navigation');

export const ProtectedRoute: React.FC = () => {
  const { isAuthenticated } = useAuth();
  
  log.debug('ProtectedRoute auth check', { isAuthenticated });

  if (!isAuthenticated) {
    log.info('User not authenticated, redirecting to login');
    // Redirect to login page if not authenticated
    return <Navigate to="/login" replace />;
  }

  log.debug('User authenticated, rendering protected content');
  // Render child routes if authenticated
  return <Outlet />;
};