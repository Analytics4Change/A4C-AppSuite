/**
 * usePermissionGate
 *
 * Standard frontend permission-check hook. Wraps the async ceremony
 * (state + effect + cancellation guard + fail-closed catch) that was
 * previously hand-rolled at every call site.
 *
 * Returns `false` while the check is pending, while it's resolving,
 * and on any rejection (fail-closed). Returns `true` only when the
 * underlying `hasPermission` resolves true.
 *
 * Convention reminder (codified in `frontend/CLAUDE.md`):
 *   - Permission-gated affordances: hide entirely (`{allowed && <Button/>}`).
 *   - State-gated affordances (form submitting, inactive entity):
 *     disable + tooltip.
 *
 * @example
 *   const canManageUsers = usePermissionGate('user.role_assign');
 *   return canManageUsers ? <ManageUsersButton /> : null;
 *
 * @example with scope
 *   const canEditOu = usePermissionGate('organization.update_ou', ouPath);
 */

import { useEffect, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { Logger } from '@/utils/logger';

const log = Logger.getLogger('component');

export function usePermissionGate(permission: string, targetPath?: string): boolean {
  const { hasPermission } = useAuth();
  const [allowed, setAllowed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    hasPermission(permission, targetPath)
      .then((result) => {
        if (!cancelled) setAllowed(result);
      })
      .catch((err) => {
        // Fail-closed on any error (parity with useFilteredNavEntries).
        if (!cancelled) {
          log.warn(`Permission check failed for ${permission}, denying`, {
            permission,
            targetPath,
            error: err,
          });
          setAllowed(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [hasPermission, permission, targetPath]);

  return allowed;
}
