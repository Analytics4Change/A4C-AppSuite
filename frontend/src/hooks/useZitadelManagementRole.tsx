/**
 * Hook to check if the current user has Zitadel management roles
 * (ORG_OWNER, IAM_OWNER) which are required for administrative actions
 */

import { useState, useEffect } from 'react';
import { zitadelService } from '@/services/auth/zitadel.service';
import { Logger } from '@/utils/logger';

const log = Logger.getLogger('component');

interface ManagementRoleState {
  isOrgOwner: boolean;
  isIAMOwner: boolean;
  isLoading: boolean;
  error: string | null;
  hasManagementAccess: boolean; // true if user has either role
}

// Cache the result for the session to avoid repeated API calls
let cachedResult: {
  isOrgOwner: boolean;
  isIAMOwner: boolean;
  timestamp: number;
} | null = null;

const CACHE_DURATION_MS = 5 * 60 * 1000; // 5 minutes

export function useZitadelManagementRole(): ManagementRoleState {
  const [state, setState] = useState<ManagementRoleState>({
    isOrgOwner: false,
    isIAMOwner: false,
    isLoading: true,
    error: null,
    hasManagementAccess: false
  });

  useEffect(() => {
    const checkRoles = async () => {
      // Check cache first
      if (cachedResult && Date.now() - cachedResult.timestamp < CACHE_DURATION_MS) {
        setState({
          isOrgOwner: cachedResult.isOrgOwner,
          isIAMOwner: cachedResult.isIAMOwner,
          isLoading: false,
          error: null,
          hasManagementAccess: cachedResult.isOrgOwner || cachedResult.isIAMOwner
        });
        return;
      }

      setState(prev => ({ ...prev, isLoading: true, error: null }));

      try {
        const result = await zitadelService.checkUserManagementRoles();

        // Update cache
        cachedResult = {
          isOrgOwner: result.isOrgOwner,
          isIAMOwner: result.isIAMOwner,
          timestamp: Date.now()
        };

        setState({
          isOrgOwner: result.isOrgOwner,
          isIAMOwner: result.isIAMOwner,
          isLoading: false,
          error: null,
          hasManagementAccess: result.isOrgOwner || result.isIAMOwner
        });

        log.info('Management roles checked', {
          isOrgOwner: result.isOrgOwner,
          isIAMOwner: result.isIAMOwner,
          membershipCount: result.memberships.length
        });
      } catch (error) {
        log.error('Failed to check management roles', error);
        setState({
          isOrgOwner: false,
          isIAMOwner: false,
          isLoading: false,
          error: error instanceof Error ? error.message : 'Failed to check management roles',
          hasManagementAccess: false
        });
      }
    };

    checkRoles();
  }, []);

  return state;
}

/**
 * Clear the cached management role data
 * Useful when user logs out or permissions might have changed
 */
export function clearManagementRoleCache(): void {
  cachedResult = null;
}