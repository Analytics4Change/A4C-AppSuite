/**
 * Hook to check if the current user is a Zitadel administrator
 * Since we can't call the Management API from the browser due to CORS,
 * we check for indicators in the token that suggest admin status
 */

import { useState, useEffect } from 'react';
import { zitadelService } from '@/services/auth/zitadel.service';
import { Logger } from '@/utils/logger';

const log = Logger.getLogger('component');

interface ZitadelAdminState {
  isZitadelAdmin: boolean;
  isLoading: boolean;
  debugInfo: {
    userId: string;
    email: string;
    organizationId: string;
    hasZitadelAudience: boolean;
  } | null;
}

export function useZitadelAdmin(): ZitadelAdminState {
  const [state, setState] = useState<ZitadelAdminState>({
    isZitadelAdmin: false,
    isLoading: true,
    debugInfo: null
  });

  useEffect(() => {
    const checkAdminStatus = async () => {
      setState(prev => ({ ...prev, isLoading: true }));

      try {
        const user = await zitadelService.getUser();
        if (!user) {
          setState({
            isZitadelAdmin: false,
            isLoading: false,
            debugInfo: null
          });
          return;
        }

        // Check if the access token has Zitadel API in audience
        // This indicates the user has some level of Zitadel access
        const hasZitadelAudience = user.accessToken?.includes('zitadel') || false;

        // For now, we'll use a simple check:
        // If the user has the Zitadel API in their audience and is from the primary organization
        // they likely have admin access
        // This is a temporary solution until we can properly check roles
        const isLikelyAdmin = hasZitadelAudience && user.organizationId;

        // Special case for known admins (temporary)
        const knownAdmins = ['lars.tice@gmail.com'];
        const isKnownAdmin = knownAdmins.includes(user.email.toLowerCase());

        setState({
          isZitadelAdmin: isLikelyAdmin || isKnownAdmin,
          isLoading: false,
          debugInfo: {
            userId: user.id,
            email: user.email,
            organizationId: user.organizationId,
            hasZitadelAudience
          }
        });

        log.info('Zitadel admin check', {
          email: user.email,
          isLikelyAdmin,
          isKnownAdmin,
          hasZitadelAudience
        });
      } catch (error) {
        log.error('Failed to check Zitadel admin status', error);
        setState({
          isZitadelAdmin: false,
          isLoading: false,
          debugInfo: null
        });
      }
    };

    checkAdminStatus();
  }, []);

  return state;
}