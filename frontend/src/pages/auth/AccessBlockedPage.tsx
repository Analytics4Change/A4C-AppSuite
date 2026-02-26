import React from 'react';
import { useNavigate } from 'react-router-dom';
import { ShieldX, LogOut } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';

const BLOCK_REASON_LABELS: Record<string, string> = {
  organization_deactivated:
    'Your organization has been deactivated by a platform administrator. Contact your organization administrator or A4C support for assistance.',
};

const DEFAULT_REASON =
  'Your access to this application has been temporarily blocked. Please contact your administrator for more information.';

export const AccessBlockedPage: React.FC = () => {
  const { session, logout } = useAuth();
  const navigate = useNavigate();

  const reason = session?.claims.access_block_reason;
  const message = (reason && BLOCK_REASON_LABELS[reason]) || DEFAULT_REASON;

  const handleLogout = async () => {
    await logout();
    navigate('/login', { replace: true });
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-indigo-100">
      <div className="w-full max-w-md px-4">
        <div
          className="rounded-xl shadow-lg p-8"
          style={{
            background: 'rgba(255, 255, 255, 0.85)',
            backdropFilter: 'blur(20px)',
            WebkitBackdropFilter: 'blur(20px)',
          }}
        >
          <div className="flex flex-col items-center text-center">
            <div className="w-16 h-16 rounded-full bg-red-100 flex items-center justify-center mb-4">
              <ShieldX className="w-8 h-8 text-red-600" aria-hidden="true" />
            </div>

            <h1 className="text-xl font-semibold text-gray-900 mb-2">Access Blocked</h1>

            <p className="text-sm text-gray-600 mb-6">{message}</p>

            {session?.user?.email && (
              <p className="text-xs text-gray-400 mb-4">Signed in as {session.user.email}</p>
            )}

            <button
              onClick={handleLogout}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-gray-800 rounded-lg hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-500 transition-colors"
              aria-label="Sign out and return to login page"
            >
              <LogOut className="w-4 h-4" aria-hidden="true" />
              Sign Out
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
