/**
 * Hook for managing impersonation UI components
 * Provides integration between impersonation service and UI components
 */

import { useState, useEffect } from 'react';
import { impersonationService } from '@/services/auth/impersonation.service';
import { ImpersonationSession } from '@/services/auth/impersonation.service';
import { useAuth } from '@/contexts/AuthContext';
import { Logger } from '@/utils/logger';

const log = Logger.getLogger('auth');

export function useImpersonationUI() {
  const { session: authSession } = useAuth();
  const [session, setSession] = useState<ImpersonationSession | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  // Check for existing session on mount and update periodically
  useEffect(() => {
    const updateSession = () => {
      const currentSession = impersonationService.getCurrentSession();
      setSession(currentSession);
    };

    // Initial check
    updateSession();

    // Update every second while impersonating
    const interval = setInterval(updateSession, 1000);

    // Register for expiration callback
    const handleExpiration = () => {
      setSession(null);
      // Could show a notification here
      log.info('Impersonation session expired');
    };

    impersonationService.onExpiration(handleExpiration);

    // Register for warning callback
    const handleWarning = () => {
      // Could show a more prominent warning notification
      log.warn('Impersonation session expiring soon!');
    };

    impersonationService.onWarning(handleWarning);

    return () => {
      clearInterval(interval);
    };
  }, [refreshKey]);

  // super_admin is identified by platform_owner org type + having organization.create permission
  const canImpersonate = authSession?.claims.org_type === 'platform_owner' &&
    authSession?.claims.effective_permissions?.some(ep => ep.p === 'users.impersonate');

  const openImpersonationModal = () => {
    if (canImpersonate && !session) {
      setIsModalOpen(true);
    }
  };

  const closeImpersonationModal = () => {
    setIsModalOpen(false);
  };

  const handleImpersonationStart = () => {
    // Force refresh of session
    setRefreshKey(prev => prev + 1);
  };

  const handleEndImpersonation = async () => {
    await impersonationService.endImpersonation();
    setSession(null);
    // Page will reload automatically from the service
  };

  return {
    session,
    isImpersonating: !!session,
    canImpersonate,
    isModalOpen,
    openImpersonationModal,
    closeImpersonationModal,
    handleImpersonationStart,
    handleEndImpersonation
  };
}