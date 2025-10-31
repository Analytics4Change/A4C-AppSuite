import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { Loader2 } from 'lucide-react';

interface RequirePermissionProps {
  permission: string;
  fallback?: string;
  children: React.ReactNode;
}

/**
 * Route guard that checks for specific permission
 * Redirects users without permission to fallback route
 *
 * Usage:
 * ```tsx
 * <Route path="/organizations/create" element={
 *   <RequirePermission permission="organization.create_root" fallback="/clients">
 *     <OrganizationCreatePage />
 *   </RequirePermission>
 * } />
 * ```
 */
export const RequirePermission: React.FC<RequirePermissionProps> = ({
  permission,
  fallback = '/clients',
  children
}) => {
  const { hasPermission, session } = useAuth();
  const navigate = useNavigate();
  const [allowed, setAllowed] = useState<boolean | null>(null);

  useEffect(() => {
    const checkPermission = async () => {
      const result = await hasPermission(permission);

      if (!result) {
        console.warn(`[RequirePermission] Access denied: missing ${permission}`, {
          user: session?.user.email,
          permissions: session?.claims.permissions
        });
        navigate(fallback, { replace: true });
      }

      setAllowed(result);
    };

    checkPermission();
  }, [permission, hasPermission, navigate, fallback, session]);

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
