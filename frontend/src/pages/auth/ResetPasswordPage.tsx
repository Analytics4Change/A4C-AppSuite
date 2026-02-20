import React, { useState, useEffect, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { AlertCircle, ArrowLeft, Info } from 'lucide-react';
import { isMockAuth } from '@/services/auth/AuthProviderFactory';
import { toast } from 'sonner';
import { Logger } from '@/utils/logger';

const log = Logger.getLogger('component');

const RECOVERY_TIMEOUT_MS = 10_000;
const MIN_PASSWORD_LENGTH = 6;

type PageState = 'loading' | 'form' | 'submitting' | 'success' | 'error';

export const ResetPasswordPage: React.FC = () => {
  const { isAuthenticated, updatePassword, logout, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const useMockAuth = isMockAuth();

  const [pageState, setPageState] = useState<PageState>('loading');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [validationError, setValidationError] = useState('');
  const [submitError, setSubmitError] = useState('');
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const passwordInputRef = useRef<HTMLInputElement>(null);

  // Mark recovery in progress on mount
  useEffect(() => {
    sessionStorage.setItem('password_recovery_in_progress', 'true');

    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  // Wait for Supabase to auto-exchange recovery code and establish session
  useEffect(() => {
    if (pageState !== 'loading') return;

    // Mock mode: no Supabase recovery code exchange, show error
    if (useMockAuth) {
      setPageState('error');
      return;
    }

    if (!authLoading && isAuthenticated) {
      log.info('[ResetPasswordPage] Recovery session established');
      setPageState('form');
      return;
    }

    // Start timeout for invalid/expired codes
    if (!timeoutRef.current) {
      timeoutRef.current = setTimeout(() => {
        if (pageState === 'loading') {
          log.warn('[ResetPasswordPage] Recovery code exchange timed out');
          setPageState('error');
        }
      }, RECOVERY_TIMEOUT_MS);
    }
  }, [pageState, isAuthenticated, authLoading, useMockAuth]);

  // Focus password input when form state is reached
  useEffect(() => {
    if (pageState === 'form') {
      passwordInputRef.current?.focus();
    }
  }, [pageState]);

  const validate = (): boolean => {
    if (password.length < MIN_PASSWORD_LENGTH) {
      setValidationError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
      return false;
    }
    if (password !== confirmPassword) {
      setValidationError('Passwords do not match.');
      return false;
    }
    setValidationError('');
    return true;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;

    setSubmitError('');
    setPageState('submitting');

    try {
      await updatePassword(password);
      setPageState('success');

      // Clear recovery flag and logout
      sessionStorage.removeItem('password_recovery_in_progress');
      await logout();

      toast.success('Password updated successfully. Please sign in with your new password.');
      navigate('/login', { replace: true });
    } catch (err) {
      log.error('[ResetPasswordPage] Password update failed', err);
      setSubmitError(
        err instanceof Error ? err.message : 'Failed to update password. Please try again.'
      );
      setPageState('form');
    }
  };

  const renderLoading = () => (
    <div className="flex flex-col items-center gap-4 py-8">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      <p className="text-sm text-gray-600" role="status" aria-live="polite">
        Verifying your reset link...
      </p>
    </div>
  );

  const renderError = () => (
    <div className="space-y-4">
      <div
        className="flex items-center gap-2 text-sm text-red-600 bg-red-50/80 backdrop-blur-sm p-4 rounded-md"
        role="alert"
        aria-live="polite"
      >
        <AlertCircle className="w-4 h-4 flex-shrink-0" />
        <span>
          {useMockAuth
            ? 'Password reset links are not available in mock mode.'
            : 'This password reset link is invalid or has expired.'}
        </span>
      </div>
      <Link
        to="/auth/forgot-password"
        className="flex items-center justify-center gap-2 text-sm text-blue-600 hover:text-blue-800 hover:underline"
      >
        Request a new reset link
      </Link>
      <Link
        to="/login"
        className="flex items-center justify-center gap-2 text-sm text-gray-500 hover:text-gray-700 hover:underline"
      >
        <ArrowLeft className="w-4 h-4" />
        Back to sign in
      </Link>
    </div>
  );

  const renderForm = () => (
    <form onSubmit={handleSubmit} className="space-y-4">
      <p className="text-sm text-gray-600">Enter your new password below.</p>

      <div>
        <Label htmlFor="new-password">New Password</Label>
        <Input
          ref={passwordInputRef}
          id="new-password"
          type="password"
          value={password}
          onChange={(e) => {
            setPassword(e.target.value);
            setValidationError('');
          }}
          placeholder="Enter new password"
          required
          aria-required="true"
          aria-invalid={!!validationError || undefined}
          aria-errormessage={validationError ? 'password-error' : undefined}
          disabled={pageState === 'submitting'}
          minLength={MIN_PASSWORD_LENGTH}
        />
      </div>

      <div>
        <Label htmlFor="confirm-password">Confirm Password</Label>
        <Input
          id="confirm-password"
          type="password"
          value={confirmPassword}
          onChange={(e) => {
            setConfirmPassword(e.target.value);
            setValidationError('');
          }}
          placeholder="Confirm new password"
          required
          aria-required="true"
          aria-invalid={!!validationError || undefined}
          aria-errormessage={validationError ? 'password-error' : undefined}
          disabled={pageState === 'submitting'}
          minLength={MIN_PASSWORD_LENGTH}
        />
      </div>

      {validationError && (
        <div
          className="flex items-center gap-2 text-sm text-red-600 bg-red-50/80 backdrop-blur-sm p-3 rounded-md"
          role="alert"
          aria-live="polite"
          id="password-error"
        >
          <AlertCircle className="w-4 h-4" />
          <span>{validationError}</span>
        </div>
      )}

      {submitError && (
        <div
          className="flex items-center gap-2 text-sm text-red-600 bg-red-50/80 backdrop-blur-sm p-3 rounded-md"
          role="alert"
          aria-live="polite"
        >
          <AlertCircle className="w-4 h-4" />
          <span>{submitError}</span>
        </div>
      )}

      <Button type="submit" className="w-full" disabled={pageState === 'submitting'}>
        {pageState === 'submitting' ? 'Updating...' : 'Update Password'}
      </Button>
    </form>
  );

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-indigo-100">
      <div className="w-full max-w-md px-4">
        <div className="text-center mb-8">
          <img src="/logo.png" alt="Analytics4Change" className="h-16 w-auto mx-auto" />
        </div>

        <Card
          className="glass"
          style={{
            background: 'rgba(255, 255, 255, 0.85)',
            backdropFilter: 'blur(20px)',
            WebkitBackdropFilter: 'blur(20px)',
            border: '1px solid rgba(255, 255, 255, 0.3)',
            boxShadow: '0 8px 32px rgba(0, 0, 0, 0.1)',
          }}
        >
          <CardHeader>
            <CardTitle className="text-center">Set New Password</CardTitle>
            {useMockAuth && pageState !== 'error' && (
              <div className="flex items-start gap-2 text-xs text-amber-600 bg-amber-50/80 backdrop-blur-sm p-3 rounded-md mt-2">
                <Info className="w-4 h-4 mt-0.5 flex-shrink-0" />
                <div>
                  <div className="font-semibold">Mock Authentication Mode</div>
                  <div className="mt-1">Password reset is simulated.</div>
                </div>
              </div>
            )}
          </CardHeader>
          <CardContent>
            {pageState === 'loading' && renderLoading()}
            {pageState === 'error' && renderError()}
            {(pageState === 'form' || pageState === 'submitting') && renderForm()}
          </CardContent>
        </Card>

        <p className="text-center text-sm text-gray-500 mt-8">
          &copy; 2024 A4C Medical. All rights reserved.
        </p>
      </div>
    </div>
  );
};
