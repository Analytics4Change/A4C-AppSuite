import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { Logger } from '@/utils/logger';
import { Loader2 } from 'lucide-react';

const log = Logger.getLogger('component');

export const AuthCallback: React.FC = () => {
  const navigate = useNavigate();
  const { handleOAuthCallback } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);

  useEffect(() => {
    // Prevent multiple executions
    if (isProcessing) return;

    // Only process if we have callback parameters in URL
    const urlParams = new URLSearchParams(window.location.search);
    const hasOAuthParams = urlParams.has('code') || urlParams.has('access_token');

    if (!hasOAuthParams) {
      log.info('[AuthCallback] No OAuth params in URL, redirecting to login');
      navigate('/login');
      return;
    }

    const processCallback = async () => {
      try {
        setIsProcessing(true);
        log.info('Processing OAuth callback');

        // Use the auth context's callback handler
        await handleOAuthCallback(window.location.href);

        log.info('Authentication successful');

        // Clear the URL parameters before redirecting
        window.history.replaceState({}, document.title, window.location.pathname);

        // Redirect to the intended page or default to clients
        const returnTo = sessionStorage.getItem('auth_return_to') || '/clients';
        sessionStorage.removeItem('auth_return_to');
        navigate(returnTo, { replace: true });
      } catch (err) {
        log.error('Auth callback failed', err);
        setError(err instanceof Error ? err.message : 'Authentication failed');
        setIsProcessing(false);

        // Redirect to login after a delay
        setTimeout(() => {
          navigate('/login');
        }, 3000);
      }
    };

    processCallback();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally runs once on mount
  }, []);

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