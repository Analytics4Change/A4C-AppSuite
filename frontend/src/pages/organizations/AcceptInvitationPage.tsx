/**
 * Accept Invitation Page
 *
 * Allows invited users to accept organization invitations and create accounts.
 * Supports email/password and Google OAuth authentication methods.
 *
 * Features:
 * - Token validation
 * - Email/password account creation
 * - Google OAuth sign-in
 * - Invitation details display
 * - Error handling
 */

import React, { useEffect, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { observer } from 'mobx-react-lite';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  InvitationAcceptanceViewModel,
  type AuthMethodSelection
} from '@/viewModels/organization/InvitationAcceptanceViewModel';
import { getAuthProvider } from '@/services/auth/AuthProviderFactory';
import {
  Building,
  Mail,
  AlertCircle,
  CheckCircle,
  Loader2
} from 'lucide-react';
import { Logger } from '@/utils/logger';

const log = Logger.getLogger('component');

/**
 * Accept Invitation Page Component
 *
 * Full invitation acceptance flow with multiple auth methods.
 */
export const AcceptInvitationPage: React.FC = observer(() => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [viewModel] = useState(() => new InvitationAcceptanceViewModel());
  const authProvider = getAuthProvider();

  const token = searchParams.get('token');

  useEffect(() => {
    if (!token) {
      log.error('No invitation token provided');
      return;
    }

    log.debug('Validating invitation token', { token });
    viewModel.validateToken(token);
  }, [token, viewModel]);

  /**
   * Handle redirect after invitation acceptance.
   *
   * After accepting an invitation, the user needs to log in. The edge function
   * creates their account but doesn't establish a frontend session.
   *
   * Flow:
   * 1. Pass the redirect URL to the login page via query param
   * 2. User logs in at /login?redirect=...
   * 3. After successful login, redirect to the subdomain
   *
   * This ensures session is established before redirecting to subdomain,
   * and the cookie-based session will persist across subdomains.
   */
  const handleRedirect = (redirectUrl: string) => {
    const isAbsoluteUrl = redirectUrl.startsWith('http://') || redirectUrl.startsWith('https://');
    const loginUrl = `/login?redirect=${encodeURIComponent(redirectUrl)}`;

    log.info('handleRedirect called', {
      redirectUrl,
      isAbsoluteUrl,
      loginUrl,
      currentLocation: window.location.href,
    });

    if (isAbsoluteUrl) {
      // Cross-origin URL: Pass to login via query param
      // User will be redirected there after authentication
      log.info('Navigating to login with cross-origin redirect', { loginUrl });
    } else {
      // Same-origin relative path: Pass to login via query param
      log.info('Navigating to login with same-origin redirect', { loginUrl });
    }

    navigate(loginUrl);
  };

  /**
   * Handle email/password submission
   */
  const handleEmailPasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const result = await viewModel.acceptWithEmailPassword();

    if (result?.redirectUrl) {
      log.info('Invitation accepted, redirecting', {
        redirectUrl: result.redirectUrl
      });
      handleRedirect(result.redirectUrl);
    }
  };

  /**
   * Handle Google OAuth
   *
   * Initiates OAuth flow via ViewModel. The page will redirect to Google,
   * then callback to /auth/callback which completes the invitation acceptance.
   */
  const handleGoogleSignIn = async () => {
    log.info('Initiating Google OAuth for invitation acceptance');
    // This will redirect to Google - page will be unloaded
    await viewModel.acceptWithOAuth('google', authProvider);
    // If we reach here, OAuth initiation failed (error is in viewModel)
  };

  /**
   * Handle auth method selection change
   */
  const handleAuthMethodChange = (method: AuthMethodSelection) => {
    viewModel.setAuthMethod(method);
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <Card
        className="w-full max-w-md"
        style={{
          background: 'rgba(255, 255, 255, 0.9)',
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
          border: '1px solid rgba(255, 255, 255, 0.3)',
          boxShadow: '0 8px 32px rgba(0, 0, 0, 0.1)'
        }}
      >
        <CardHeader>
          <CardTitle className="text-2xl text-center">
            Accept Organization Invitation
          </CardTitle>
        </CardHeader>

        <CardContent>
          {/* Loading State */}
          {viewModel.isValidatingToken && (
            <div className="flex flex-col items-center justify-center py-12">
              <Loader2 className="animate-spin text-blue-500 mb-4" size={48} />
              <p className="text-gray-600">Validating invitation...</p>
            </div>
          )}

          {/* Validation Error */}
          {viewModel.validationError && (
            <div
              className="p-4 rounded-lg mb-6"
              style={{
                background: 'rgba(254, 242, 242, 0.9)',
                border: '1px solid rgba(239, 68, 68, 0.3)'
              }}
            >
              <div className="flex items-center gap-3">
                <AlertCircle className="text-red-500" size={24} />
                <div>
                  <h4 className="font-semibold text-red-900">Invalid Invitation</h4>
                  <p className="text-red-700 text-sm">
                    {viewModel.validationError}
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Invitation Details */}
          {viewModel.isTokenValid && viewModel.invitationDetails && (
            <div>
              {/* Organization Info */}
              <div
                className="p-4 rounded-lg mb-6"
                style={{
                  background: 'rgba(239, 246, 255, 0.9)',
                  border: '1px solid rgba(59, 130, 246, 0.2)'
                }}
              >
                <div className="flex items-center gap-3">
                  <div
                    className="p-2 rounded-full"
                    style={{
                      background: 'rgba(59, 130, 246, 0.2)',
                      border: '1px solid rgba(59, 130, 246, 0.3)'
                    }}
                  >
                    <Building className="text-blue-600" size={24} />
                  </div>
                  <div>
                    <h3 className="font-semibold text-gray-900">
                      {viewModel.invitationDetails.orgName}
                    </h3>
                    <p className="text-sm text-gray-600">
                      Role: {viewModel.invitationDetails.role}
                    </p>
                    {viewModel.invitationDetails.inviterName && (
                      <p className="text-xs text-gray-500">
                        Invited by: {viewModel.invitationDetails.inviterName}
                      </p>
                    )}
                  </div>
                </div>
              </div>

              {/* Auth Method Selection */}
              <div className="mb-6">
                <Label className="mb-3 block">Choose Sign-In Method</Label>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => handleAuthMethodChange('email_password')}
                    className={`p-3 rounded-lg border-2 transition-all ${
                      viewModel.authMethodSelection === 'email_password'
                        ? 'border-blue-500 bg-blue-50'
                        : 'border-gray-200 hover:border-gray-300'
                    }`}
                  >
                    <Mail className="mx-auto mb-2" size={24} />
                    <p className="text-sm font-medium">Email & Password</p>
                  </button>

                  <button
                    type="button"
                    onClick={() => handleAuthMethodChange('oauth')}
                    className={`p-3 rounded-lg border-2 transition-all ${
                      viewModel.authMethodSelection === 'oauth'
                        ? 'border-blue-500 bg-blue-50'
                        : 'border-gray-200 hover:border-gray-300'
                    }`}
                  >
                    <svg
                      className="mx-auto mb-2"
                      width="24"
                      height="24"
                      viewBox="0 0 24 24"
                    >
                      <path
                        fill="#4285F4"
                        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                      />
                      <path
                        fill="#34A853"
                        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                      />
                      <path
                        fill="#FBBC05"
                        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                      />
                      <path
                        fill="#EA4335"
                        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                      />
                    </svg>
                    <p className="text-sm font-medium">Google</p>
                  </button>
                </div>
              </div>

              {/* Email/Password Form */}
              {viewModel.authMethodSelection === 'email_password' && (
                <form onSubmit={handleEmailPasswordSubmit} className="space-y-4">
                  {/* Email */}
                  <div className="space-y-2">
                    <Label htmlFor="email">
                      Email <span className="text-red-500">*</span>
                    </Label>
                    <Input
                      id="email"
                      type="email"
                      value={viewModel.email}
                      onChange={(e) => viewModel.setEmail(e.target.value)}
                      placeholder="your.email@example.com"
                      disabled={!!viewModel.invitationDetails.email}
                      className={viewModel.emailError ? 'border-red-500' : ''}
                    />
                    {viewModel.emailError && (
                      <p className="text-sm text-red-500">
                        {viewModel.emailError}
                      </p>
                    )}
                  </div>

                  {/* Password */}
                  <div className="space-y-2">
                    <Label htmlFor="password">
                      Password <span className="text-red-500">*</span>
                    </Label>
                    <Input
                      id="password"
                      type="password"
                      value={viewModel.password}
                      onChange={(e) => viewModel.setPassword(e.target.value)}
                      placeholder="At least 8 characters"
                      className={viewModel.passwordError ? 'border-red-500' : ''}
                    />
                    {viewModel.passwordError && (
                      <p className="text-sm text-red-500">
                        {viewModel.passwordError}
                      </p>
                    )}
                  </div>

                  {/* Confirm Password */}
                  <div className="space-y-2">
                    <Label htmlFor="confirm-password">
                      Confirm Password <span className="text-red-500">*</span>
                    </Label>
                    <Input
                      id="confirm-password"
                      type="password"
                      value={viewModel.confirmPassword}
                      onChange={(e) => viewModel.setConfirmPassword(e.target.value)}
                      placeholder="Confirm your password"
                      className={
                        viewModel.confirmPasswordError ? 'border-red-500' : ''
                      }
                    />
                    {viewModel.confirmPasswordError && (
                      <p className="text-sm text-red-500">
                        {viewModel.confirmPasswordError}
                      </p>
                    )}
                  </div>

                  {/* Submit Button */}
                  <Button
                    type="submit"
                    className="w-full"
                    disabled={!viewModel.canSubmit || viewModel.isAccepting}
                  >
                    {viewModel.isAccepting ? (
                      <>
                        <Loader2 className="animate-spin mr-2" size={20} />
                        Creating Account...
                      </>
                    ) : (
                      <>
                        <CheckCircle size={20} className="mr-2" />
                        Accept Invitation
                      </>
                    )}
                  </Button>
                </form>
              )}

              {/* Google OAuth */}
              {viewModel.authMethodSelection === 'oauth' && (
                <div className="space-y-4">
                  {/* Email (read-only for Google) */}
                  <div className="space-y-2">
                    <Label htmlFor="google-email">
                      Email <span className="text-red-500">*</span>
                    </Label>
                    <Input
                      id="google-email"
                      type="email"
                      value={viewModel.email}
                      onChange={(e) => viewModel.setEmail(e.target.value)}
                      placeholder="your.email@gmail.com"
                      disabled={!!viewModel.invitationDetails.email}
                      className={viewModel.emailError ? 'border-red-500' : ''}
                    />
                    {viewModel.emailError && (
                      <p className="text-sm text-red-500">
                        {viewModel.emailError}
                      </p>
                    )}
                    <p className="text-xs text-gray-500">
                      Use the email associated with your Google account
                    </p>
                  </div>

                  <Button
                    type="button"
                    onClick={handleGoogleSignIn}
                    className="w-full"
                    disabled={!viewModel.canSubmit || viewModel.isAccepting}
                  >
                    {viewModel.isAccepting ? (
                      <>
                        <Loader2 className="animate-spin mr-2" size={20} />
                        Signing In...
                      </>
                    ) : (
                      <>
                        <svg className="mr-2" width="20" height="20" viewBox="0 0 24 24">
                          <path
                            fill="currentColor"
                            d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                          />
                        </svg>
                        Sign In with Google
                      </>
                    )}
                  </Button>
                </div>
              )}

              {/* Acceptance Error */}
              {viewModel.acceptanceError && (
                <div
                  className="mt-4 p-3 rounded-lg"
                  style={{
                    background: 'rgba(254, 242, 242, 0.9)',
                    border: '1px solid rgba(239, 68, 68, 0.3)'
                  }}
                >
                  <p className="text-sm text-red-700">
                    {viewModel.acceptanceError}
                  </p>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
});
