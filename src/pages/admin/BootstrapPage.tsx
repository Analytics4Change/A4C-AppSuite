/**
 * Bootstrap Page for Syncing Roles to Zitadel
 * Only accessible by super administrators
 */

import React, { useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { AlertTriangle, CheckCircle, XCircle, Info, Loader2 } from 'lucide-react';
import { getBootstrapService } from '@/services/bootstrap/zitadel-bootstrap.service';
import { BOOTSTRAP_ROLES } from '@/config/roles.config';
import { PERMISSIONS } from '@/config/permissions.config';
import { useAuth } from '@/contexts/AuthContext';
import { Navigate } from 'react-router-dom';
import { useZitadelAdmin } from '@/hooks/useZitadelAdmin';

interface BootstrapResult {
  success: boolean;
  rolesCreated: string[];
  rolesFailed: string[];
  errors: string[];
  warnings: string[];
}

interface BootstrapStatus {
  rolesConfigured: number;
  rolesSynced: string[];
  rolesNotSynced: string[];
  permissionsConfigured: number;
}

export const BootstrapPage: React.FC = () => {
  const { user } = useAuth();
  const [isLoading, setIsLoading] = useState(false);
  const [isDryRun, setIsDryRun] = useState(true);
  const [result, setResult] = useState<BootstrapResult | null>(null);
  const [status, setStatus] = useState<BootstrapStatus | null>(null);

  // Check for Zitadel admin status
  const {
    isZitadelAdmin,
    isLoading: isCheckingAdmin,
    debugInfo
  } = useZitadelAdmin();

  // Allow access if:
  // 1. User has super_admin role (after bootstrap), OR
  // 2. User is detected as a Zitadel admin
  const isAllowedToBootstrap =
    user?.role === 'super_admin' || isZitadelAdmin;

  // Show loading while checking admin status
  if (isCheckingAdmin) {
    return (
      <div className="max-w-6xl mx-auto p-6">
        <div className="flex items-center gap-2">
          <Loader2 className="h-5 w-5 animate-spin" />
          <span>Checking authorization...</span>
        </div>
      </div>
    );
  }

  // Redirect if not authorized
  if (!isAllowedToBootstrap) {
    return (
      <div className="max-w-6xl mx-auto p-6">
        <Card className="p-6">
          <h1 className="text-2xl font-bold mb-4 text-red-600">Access Denied</h1>
          <p className="mb-4">
            You need one of the following roles to access this page:
          </p>
          <ul className="list-disc ml-6 mb-4">
            <li>Application super_admin role</li>
            <li>Zitadel administrator access</li>
          </ul>
          {debugInfo && (
            <div className="text-sm text-gray-500 mt-4">
              <p>Debug Info:</p>
              <pre className="bg-gray-100 p-2 rounded mt-1">
                {JSON.stringify(debugInfo, null, 2)}
              </pre>
            </div>
          )}
          <Button onClick={() => window.history.back()} variant="outline">
            Go Back
          </Button>
        </Card>
      </div>
    );
  }

  const checkStatus = async () => {
    setIsLoading(true);
    try {
      const service = getBootstrapService();
      const currentStatus = await service.getStatus();
      setStatus(currentStatus);
    } catch (error) {
      console.error('Failed to check status:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const runBootstrap = async () => {
    setIsLoading(true);
    setResult(null);

    try {
      const service = getBootstrapService({ isDryRun });
      const bootstrapResult = isDryRun
        ? await service.dryRun()
        : await service.bootstrap();

      setResult(bootstrapResult);

      // Refresh status after bootstrap
      if (!isDryRun && bootstrapResult.success) {
        await checkStatus();
      }
    } catch (error) {
      console.error('Bootstrap failed:', error);
      setResult({
        success: false,
        rolesCreated: [],
        rolesFailed: [],
        errors: [error instanceof Error ? error.message : 'Unknown error'],
        warnings: []
      });
    } finally {
      setIsLoading(false);
    }
  };

  React.useEffect(() => {
    checkStatus();
  }, []);

  return (
    <div className="max-w-6xl mx-auto">
      <h1 className="text-3xl font-bold mb-6">Zitadel Role Bootstrap</h1>

      {/* Authorization Info */}
      <div className="bg-green-50 border border-green-200 rounded-md p-4 mb-6">
        <p className="text-sm text-green-800">
          <span className="font-medium">Authorized access via: </span>
          {user?.role === 'super_admin' ? (
            <span>Application super_admin role</span>
          ) : isZitadelAdmin ? (
            <span>Zitadel administrator (temporary authorization)</span>
          ) : (
            <span>Unknown authorization</span>
          )}
        </p>
      </div>

      {/* Status Card */}
      <Card className="p-6 mb-6">
        <h2 className="text-xl font-semibold mb-4 flex items-center gap-2">
          <Info className="h-5 w-5" />
          Current Status
        </h2>

        {status ? (
          <div className="space-y-3">
            <div>
              <span className="font-medium">Roles Configured:</span> {status.rolesConfigured}
            </div>
            <div>
              <span className="font-medium">Roles Synced:</span>
              {status.rolesSynced.length > 0 ? (
                <ul className="ml-4 mt-1">
                  {status.rolesSynced.map(role => (
                    <li key={role} className="flex items-center gap-2">
                      <CheckCircle className="h-4 w-4 text-green-600" />
                      {role}
                    </li>
                  ))}
                </ul>
              ) : (
                <span className="text-gray-500 ml-2">None</span>
              )}
            </div>
            <div>
              <span className="font-medium">Roles Not Synced:</span>
              {status.rolesNotSynced.length > 0 ? (
                <ul className="ml-4 mt-1">
                  {status.rolesNotSynced.map(role => (
                    <li key={role} className="flex items-center gap-2">
                      <XCircle className="h-4 w-4 text-red-600" />
                      {role}
                    </li>
                  ))}
                </ul>
              ) : (
                <span className="text-gray-500 ml-2">None</span>
              )}
            </div>
            <div>
              <span className="font-medium">Permissions Configured:</span> {status.permissionsConfigured}
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading status...
          </div>
        )}
      </Card>

      {/* Configuration Card */}
      <Card className="p-6 mb-6">
        <h2 className="text-xl font-semibold mb-4">Roles to Bootstrap</h2>

        <div className="space-y-4">
          {Object.entries(BOOTSTRAP_ROLES).map(([key, role]) => (
            <div key={key} className="border-l-4 border-blue-500 pl-4">
              <h3 className="font-semibold">{role.displayName}</h3>
              <p className="text-sm text-gray-600">{role.description}</p>
              <p className="text-xs text-gray-500 mt-1">
                {role.permissions.length} permissions • Scope: {role.scope}
              </p>
            </div>
          ))}
        </div>

        <div className="mt-4 text-sm text-gray-600">
          <p><strong>Total Permissions:</strong> {Object.keys(PERMISSIONS).length}</p>
          <p><strong>Initial Admin:</strong> {import.meta.env.VITE_BOOTSTRAP_ADMIN_EMAIL || 'Not configured'}</p>
        </div>
      </Card>

      {/* Actions Card */}
      <Card className="p-6 mb-6">
        <h2 className="text-xl font-semibold mb-4">Bootstrap Actions</h2>

        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="dry-run"
              checked={isDryRun}
              onChange={(e) => setIsDryRun(e.target.checked)}
              disabled={isLoading}
              className="h-4 w-4"
            />
            <label htmlFor="dry-run" className="text-sm">
              Dry Run Mode (simulate without making changes)
            </label>
          </div>

          <div className="flex gap-3">
            <Button
              onClick={runBootstrap}
              disabled={isLoading}
              variant={isDryRun ? "outline" : "default"}
            >
              {isLoading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  Running...
                </>
              ) : (
                <>
                  {isDryRun ? 'Run Dry Run' : 'Bootstrap Roles'}
                </>
              )}
            </Button>

            <Button
              onClick={checkStatus}
              disabled={isLoading}
              variant="outline"
            >
              Refresh Status
            </Button>
          </div>

          {!isDryRun && (
            <div className="bg-yellow-50 border border-yellow-200 rounded-md p-4">
              <div className="flex items-start gap-2">
                <AlertTriangle className="h-5 w-5 text-yellow-600 flex-shrink-0 mt-0.5" />
                <div className="text-sm">
                  <p className="font-medium text-yellow-800">Warning: Live Mode</p>
                  <p className="text-yellow-700 mt-1">
                    This will create or update roles in your Zitadel project.
                    Operations are idempotent (safe to run multiple times).
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>
      </Card>

      {/* Results Card */}
      {result && (
        <Card className="p-6">
          <h2 className="text-xl font-semibold mb-4 flex items-center gap-2">
            {result.success ? (
              <>
                <CheckCircle className="h-5 w-5 text-green-600" />
                Bootstrap Successful
              </>
            ) : (
              <>
                <XCircle className="h-5 w-5 text-red-600" />
                Bootstrap Failed
              </>
            )}
          </h2>

          <div className="space-y-4">
            {result.rolesCreated.length > 0 && (
              <div>
                <h3 className="font-medium text-green-700">Roles Created:</h3>
                <ul className="ml-4 mt-1">
                  {result.rolesCreated.map(role => (
                    <li key={role}>✅ {role}</li>
                  ))}
                </ul>
              </div>
            )}

            {result.rolesFailed.length > 0 && (
              <div>
                <h3 className="font-medium text-red-700">Roles Failed:</h3>
                <ul className="ml-4 mt-1">
                  {result.rolesFailed.map(role => (
                    <li key={role}>❌ {role}</li>
                  ))}
                </ul>
              </div>
            )}

            {result.warnings.length > 0 && (
              <div>
                <h3 className="font-medium text-yellow-700">Warnings:</h3>
                <ul className="ml-4 mt-1 space-y-1">
                  {result.warnings.map((warning, i) => (
                    <li key={i} className="text-sm text-yellow-600">
                      ⚠️ {warning}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {result.errors.length > 0 && (
              <div>
                <h3 className="font-medium text-red-700">Errors:</h3>
                <ul className="ml-4 mt-1 space-y-1">
                  {result.errors.map((error, i) => (
                    <li key={i} className="text-sm text-red-600">
                      ❌ {error}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {result.success && !isDryRun && (
              <div className="bg-green-50 border border-green-200 rounded-md p-4 mt-4">
                <h3 className="font-medium text-green-800 mb-2">Next Steps:</h3>
                <ol className="list-decimal ml-5 text-sm text-green-700 space-y-1">
                  <li>Ensure the Zitadel application is configured to assert roles in tokens</li>
                  <li>Grant super_admin role to {import.meta.env.VITE_BOOTSTRAP_ADMIN_EMAIL || 'your admin user'}</li>
                  <li>Log out and log back in to apply new roles</li>
                </ol>
              </div>
            )}
          </div>
        </Card>
      )}
    </div>
  );
};