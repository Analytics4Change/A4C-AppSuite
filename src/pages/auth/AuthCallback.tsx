import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { zitadelService } from '@/services/auth/zitadel.service';
import { supabaseService } from '@/services/auth/supabase.service';
import { useAuth } from '@/contexts/AuthContext';
import { Logger } from '@/utils/logger';
import { Loader2 } from 'lucide-react';

const log = Logger.getLogger('component');

export const AuthCallback: React.FC = () => {
  const navigate = useNavigate();
  const { setAuthState } = useAuth();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const handleCallback = async () => {
      try {
        log.info('Processing auth callback');

        // Handle the OAuth callback
        const user = await zitadelService.handleCallback();

        if (user) {
          // Update Supabase with the Zitadel token
          await supabaseService.updateAuthToken(user);

          // Update the auth context
          await setAuthState({
            isAuthenticated: true,
            user: {
              id: user.id,
              name: user.name,
              email: user.email,
              role: user.roles[0] || 'viewer', // Map first role or default
              provider: 'zitadel' as any,
              picture: user.picture,
            },
            zitadelUser: user,
          });

          log.info('Authentication successful', { userId: user.id });

          // Redirect to the intended page or default to clients
          const returnTo = sessionStorage.getItem('auth_return_to') || '/clients';
          sessionStorage.removeItem('auth_return_to');
          navigate(returnTo);
        } else {
          throw new Error('No user data received from callback');
        }
      } catch (err) {
        log.error('Auth callback failed', err);
        setError(err instanceof Error ? err.message : 'Authentication failed');

        // Redirect to login after a delay
        setTimeout(() => {
          navigate('/login');
        }, 3000);
      }
    };

    handleCallback();
  }, [navigate, setAuthState]);

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-[#f8fafc] to-white">
        <div className="text-center">
          <div className="mb-4">
            <div className="inline-flex h-16 w-16 items-center justify-center rounded-full bg-red-100">
              <svg
                className="h-8 w-8 text-red-600"
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </div>
          </div>
          <h2 className="text-2xl font-semibold text-gray-900 mb-2">Authentication Failed</h2>
          <p className="text-gray-600 mb-4">{error}</p>
          <p className="text-sm text-gray-500">Redirecting to login...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-[#f8fafc] to-white">
      <div className="text-center">
        <Loader2 className="h-12 w-12 animate-spin text-blue-600 mx-auto mb-4" />
        <h2 className="text-2xl font-semibold text-gray-900 mb-2">Completing Sign In</h2>
        <p className="text-gray-600">Please wait while we verify your credentials...</p>
      </div>
    </div>
  );
};