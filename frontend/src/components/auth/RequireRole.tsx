import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { Loader2 } from 'lucide-react';
import { Logger } from '@/utils/logger';
import type { UserRole } from '@/types/auth.types';

const log = Logger.getLogger('auth');

interface RequireRoleProps {
  role: UserRole | UserRole[];
  fallback?: string;
  children: React.ReactNode;
}

/**
 * Route guard that checks for specific role(s)
 * Redirects users without the required role to fallback route
 *
 * Use this for platform-owner features that are role-gated rather than permission-gated.
 * Per rbac-architecture.md Appendix D, platform-owner features use role-based checks.
 *
 * Usage:
 * ```tsx
 * <Route path="/admin/events" element={
 *   <RequireRole role="super_admin" fallback="/clients">
 *     <FailedEventsPage />
 *   </RequireRole>
 * } />
 *
 * // Multiple roles allowed:
 * <RequireRole role={['super_admin', 'provider_admin']} fallback="/clients">
 *   <AdminDashboard />
 * </RequireRole>
 * ```
 */
export const RequireRole: React.FC<RequireRoleProps> = ({
  role,
  fallback = '/clients',
  children
}) => {
  const { session } = useAuth();
  const navigate = useNavigate();
  const [allowed, setAllowed] = useState<boolean | null>(null);

  useEffect(() => {
    const checkRole = () => {
      const roles = Array.isArray(role) ? role : [role];
      const userRole = session?.claims.user_role;

      log.debug(`Checking role: ${roles.join(', ')}`, {
        userRole,
        orgId: session?.claims.org_id
      });

      const hasRole = userRole ? roles.includes(userRole) : false;

      if (!hasRole) {
        log.warn(`Access denied: missing role ${roles.join(' or ')}`);
        navigate(fallback, { replace: true });
      } else {
        log.debug(`Access granted for role ${userRole}`);
      }

      setAllowed(hasRole);
    };

    checkRole();
  }, [role, session, navigate, fallback]);

  // Show loader while checking
  if (allowed === null) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
      </div>
    );
  }

  // Don't render if not allowed (will redirect)
  if (!allowed) return null;

  return <>{children}</>;
};
