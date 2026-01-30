/**
 * Settings Hub Page
 *
 * Main settings page at /settings with card links to sub-pages.
 * Shows organization settings card only for provider org types
 * with organization.update permission.
 */

import React from 'react';
import { useNavigate } from 'react-router-dom';
import { observer } from 'mobx-react-lite';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Building, ChevronRight, Settings } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';

const glassCardStyle = {
  background: 'rgba(255, 255, 255, 0.7)',
  backdropFilter: 'blur(20px)',
  WebkitBackdropFilter: 'blur(20px)',
  border: '1px solid rgba(255, 255, 255, 0.3)',
  boxShadow: '0 2px 4px rgba(0, 0, 0, 0.05)',
};

export const SettingsPage: React.FC = observer(() => {
  const navigate = useNavigate();
  const { session, hasPermission } = useAuth();

  const orgType = session?.claims.org_type;
  const isProvider = orgType === 'provider';

  const [canUpdateOrg, setCanUpdateOrg] = React.useState(false);
  React.useEffect(() => {
    let cancelled = false;
    hasPermission('organization.update').then((result) => {
      if (!cancelled) {
        setCanUpdateOrg(result);
      }
    });
    return () => { cancelled = true; };
  }, [hasPermission]);

  const showOrgSettings = isProvider && canUpdateOrg;

  return (
    <div className="max-w-3xl mx-auto">
      {/* Page Header */}
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-gray-900">Settings</h1>
        <p className="text-gray-600 mt-1">
          Manage your application preferences and organization configuration.
        </p>
      </div>

      <div className="space-y-4">
        {/* Organization Settings Card */}
        {showOrgSettings && (
          <Card
            style={glassCardStyle}
            className="cursor-pointer hover:shadow-md transition-shadow"
            onClick={() => navigate('/settings/organization')}
            role="link"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                navigate('/settings/organization');
              }
            }}
            aria-label="Organization Settings"
          >
            <CardContent className="flex items-center gap-4 py-4">
              <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-blue-100 text-blue-600">
                <Building size={20} />
              </div>
              <div className="flex-1">
                <CardHeader className="p-0">
                  <CardTitle className="text-base">Organization Settings</CardTitle>
                </CardHeader>
                <p className="text-sm text-gray-500 mt-0.5">
                  Direct care workflow routing, feature flags, and organization configuration.
                </p>
              </div>
              <ChevronRight size={20} className="text-gray-400" />
            </CardContent>
          </Card>
        )}

        {/* Placeholder for future settings */}
        {!showOrgSettings && (
          <Card style={glassCardStyle}>
            <CardContent className="pt-6">
              <div className="text-center py-8">
                <Settings className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                <h2 className="text-xl font-semibold text-gray-900 mb-2">
                  Settings
                </h2>
                <p className="text-gray-600">
                  Additional settings will be available here in future updates.
                </p>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
});
