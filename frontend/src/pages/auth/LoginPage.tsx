import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation, useSearchParams } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { AlertCircle, Info } from 'lucide-react';
import { isMockAuth } from '@/services/auth/AuthProviderFactory';
import { sanitizeRedirectUrl, buildSubdomainUrl } from '@/utils/redirect-validation';
import { getOrganizationSubdomainInfo } from '@/services/organization/getOrganizationSubdomainInfo';
import { Logger } from '@/utils/logger';

const log = Logger.getLogger('component');

export const LoginPage: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const { login, loginWithOAuth, isAuthenticated, loading, providerType, session } = useAuth();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const useMockAuth = isMockAuth();

  // Get redirect URL from query param (sanitized for security)
  const redirectParam = sanitizeRedirectUrl(searchParams.get('redirect'));

  // Log initial component state for debugging redirect flow
  useEffect(() => {
    log.info('[LoginPage] Component mounted', {
      isAuthenticated,
      loading,
      redirectParam,
      rawRedirectParam: searchParams.get('redirect'),
      hasSession: !!session,
      sessionOrgId: session?.claims?.org_id,
      locationState: location.state,
    });
  }, []); // Only log once on mount

  /**
   * Handle post-login redirect with priority:
   * 1. Explicit redirect URL (from invitation flow)
   * 2. Location state (from ProtectedRoute)
   * 3. Subdomain based on JWT claims (returning user)
   * 4. Default fallback (/clients)
   */
  const handlePostLoginRedirect = async () => {
    // Priority 1: Explicit redirect URL (from invitation flow)
    if (redirectParam) {
      log.info('[LoginPage] Redirecting to explicit URL', { redirectParam });
      if (redirectParam.startsWith('http')) {
        window.location.href = redirectParam;
      } else {
        navigate(redirectParam, { replace: true });
      }
      return;
    }

    // Priority 2: Location state (from ProtectedRoute)
    const fromState = (location.state as { from?: { pathname: string } })?.from?.pathname;
    if (fromState && fromState !== '/login') {
      log.info('[LoginPage] Redirecting to location state', { fromState });
      navigate(fromState, { replace: true });
      return;
    }

    // Priority 3: Determine from JWT claims (returning user)
    // Query organizations_projection to get slug and subdomain_status
    const orgId = session?.claims?.org_id;
    if (orgId) {
      try {
        log.info('[LoginPage] Looking up org subdomain', { orgId });
        const orgInfo = await getOrganizationSubdomainInfo(orgId);
        if (orgInfo?.slug && orgInfo.subdomain_status === 'verified') {
          const subdomainUrl = buildSubdomainUrl(orgInfo.slug, '/dashboard');
          if (subdomainUrl) {
            log.info('[LoginPage] Redirecting to org subdomain', { subdomainUrl });
            window.location.href = subdomainUrl;
            return;
          }
        } else {
          log.info('[LoginPage] Subdomain not verified, using default', {
            slug: orgInfo?.slug,
            status: orgInfo?.subdomain_status
          });
        }
      } catch (err) {
        log.error('[LoginPage] Failed to get org subdomain info', err);
      }
    }

    // Priority 4: Default fallback
    log.info('[LoginPage] Using default redirect to /clients');
    navigate('/clients', { replace: true });
  };

  // Redirect if already authenticated
  useEffect(() => {
    if (isAuthenticated && !loading) {
      handlePostLoginRedirect();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally excludes handlePostLoginRedirect
  }, [isAuthenticated, loading]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsSubmitting(true);

    try {
      await login({ email, password });
      // Navigation handled by useEffect above
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Authentication failed';
      setError(errorMessage);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleOAuthLogin = async (provider: 'google' | 'github') => {
    setError('');
    setIsSubmitting(true);

    try {
      // Store redirect URL before OAuth (OAuth redirects lose query params)
      if (redirectParam) {
        log.info('[LoginPage] Storing redirect URL for OAuth', { redirectParam });
        sessionStorage.setItem('auth_return_to', redirectParam);
      }

      await loginWithOAuth(provider, {
        redirectTo: window.location.origin + '/auth/callback',
      });
      // For real OAuth, this will redirect
      // For mock OAuth, navigation handled by useEffect
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : `${provider} authentication failed`;
      setError(errorMessage);
      setIsSubmitting(false);
    }
  };

  const isLoading = loading || isSubmitting;

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-indigo-100">
      <div className="w-full max-w-md px-4">
        <div className="text-center mb-8">
          <img
            src="/logo.png"
            alt="Analytics4Change"
            className="h-16 w-auto mx-auto"
          />
        </div>

        <Card className="glass" style={{
          background: 'rgba(255, 255, 255, 0.85)',
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
          border: '1px solid rgba(255, 255, 255, 0.3)',
          boxShadow: '0 8px 32px rgba(0, 0, 0, 0.1)'
        }}>
          <CardHeader>
            <CardTitle className="text-center">Sign In</CardTitle>
            {useMockAuth && (
              <div className="flex items-start gap-2 text-xs text-amber-600 bg-amber-50/80 backdrop-blur-sm p-3 rounded-md mt-2">
                <Info className="w-4 h-4 mt-0.5 flex-shrink-0" />
                <div>
                  <div className="font-semibold">Mock Authentication Mode</div>
                  <div className="mt-1">
                    Using instant authentication for development.
                    Any credentials will work.
                  </div>
                </div>
              </div>
            )}
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {/* OAuth Providers */}
              <div className="space-y-3">
                <Button
                  type="button"
                  variant="outline"
                  className="w-full flex items-center justify-center gap-2"
                  onClick={() => handleOAuthLogin('google')}
                  disabled={isLoading}
                >
                  <svg className="w-5 h-5" viewBox="0 0 24 24">
                    <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                    <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                    <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                    <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                  </svg>
                  {useMockAuth ? 'Mock Google Sign In' : 'Continue with Google'}
                </Button>
              </div>

              {/* Divider */}
              <div className="relative">
                <div className="absolute inset-0 flex items-center">
                  <span className="w-full border-t border-gray-300/50" />
                </div>
                <div className="relative flex justify-center text-xs uppercase">
                  <span className="bg-white/80 backdrop-blur-sm px-2 text-gray-500">
                    Or continue with email
                  </span>
                </div>
              </div>

              {/* Email/Password Form */}
              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <Label htmlFor="email">Email</Label>
                  <Input
                    id="email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="Enter your email"
                    required
                    autoFocus
                    disabled={isLoading}
                  />
                </div>

                <div>
                  <Label htmlFor="password">Password</Label>
                  <Input
                    id="password"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Enter your password"
                    required
                    disabled={isLoading}
                  />
                </div>

                {error && (
                  <div className="flex items-center gap-2 text-sm text-red-600 bg-red-50/80 backdrop-blur-sm p-3 rounded-md">
                    <AlertCircle className="w-4 h-4" />
                    <span>{error}</span>
                  </div>
                )}

                <Button
                  type="submit"
                  className="w-full"
                  disabled={isLoading}
                >
                  {isLoading ? 'Signing in...' : 'Sign In'}
                </Button>
              </form>

              {/* Mock Mode Info */}
              {useMockAuth && (
                <div className="text-center text-sm text-gray-600 pt-4 border-t border-gray-200/50">
                  <p className="font-semibold mb-2">Development Mode</p>
                  <p>Any credentials will authenticate instantly</p>
                  <p className="text-xs mt-2 text-gray-500">
                    Mode: <span className="font-mono">{providerType}</span>
                  </p>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        <p className="text-center text-sm text-gray-500 mt-8">
          © 2024 A4C Medical. All rights reserved.
        </p>
      </div>
    </div>
  );
};
