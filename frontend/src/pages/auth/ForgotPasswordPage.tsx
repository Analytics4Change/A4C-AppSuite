import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { AlertCircle, ArrowLeft, Info } from 'lucide-react';
import { isMockAuth } from '@/services/auth/AuthProviderFactory';
import { Logger } from '@/utils/logger';

const log = Logger.getLogger('component');

type PageState = 'idle' | 'submitting' | 'success';

export const ForgotPasswordPage: React.FC = () => {
  const { sendPasswordResetEmail } = useAuth();
  const [email, setEmail] = useState('');
  const [pageState, setPageState] = useState<PageState>('idle');
  const [error, setError] = useState('');
  const useMockAuth = isMockAuth();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setPageState('submitting');

    try {
      await sendPasswordResetEmail(email);
      setPageState('success');
      log.info('[ForgotPasswordPage] Reset email request processed');
    } catch (err) {
      log.error('[ForgotPasswordPage] Failed to send reset email', err);
      setError('An unexpected error occurred. Please try again.');
      setPageState('idle');
    }
  };

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
            <CardTitle className="text-center">Reset Password</CardTitle>
            {useMockAuth && (
              <div className="flex items-start gap-2 text-xs text-amber-600 bg-amber-50/80 backdrop-blur-sm p-3 rounded-md mt-2">
                <Info className="w-4 h-4 mt-0.5 flex-shrink-0" />
                <div>
                  <div className="font-semibold">Mock Authentication Mode</div>
                  <div className="mt-1">Password reset is simulated. No email will be sent.</div>
                </div>
              </div>
            )}
          </CardHeader>
          <CardContent>
            {pageState === 'success' ? (
              <div className="space-y-4">
                <div
                  className="text-sm text-green-700 bg-green-50/80 backdrop-blur-sm p-4 rounded-md"
                  role="status"
                  aria-live="polite"
                >
                  If an account exists for that email, a password reset link has been sent. Please
                  check your inbox.
                </div>
                <Link
                  to="/login"
                  className="flex items-center justify-center gap-2 text-sm text-blue-600 hover:text-blue-800 hover:underline"
                >
                  <ArrowLeft className="w-4 h-4" />
                  Back to sign in
                </Link>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-4">
                <p className="text-sm text-gray-600">
                  Enter your email address and we'll send you a link to reset your password.
                </p>

                <div>
                  <Label htmlFor="reset-email">Email</Label>
                  <Input
                    id="reset-email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="Enter your email"
                    required
                    aria-required="true"
                    autoFocus
                    disabled={pageState === 'submitting'}
                  />
                </div>

                {error && (
                  <div
                    className="flex items-center gap-2 text-sm text-red-600 bg-red-50/80 backdrop-blur-sm p-3 rounded-md"
                    role="alert"
                    aria-live="polite"
                    id="reset-error"
                  >
                    <AlertCircle className="w-4 h-4" />
                    <span>{error}</span>
                  </div>
                )}

                <Button type="submit" className="w-full" disabled={pageState === 'submitting'}>
                  {pageState === 'submitting' ? 'Sending...' : 'Send Reset Link'}
                </Button>

                <Link
                  to="/login"
                  className="flex items-center justify-center gap-2 text-sm text-blue-600 hover:text-blue-800 hover:underline"
                >
                  <ArrowLeft className="w-4 h-4" />
                  Back to sign in
                </Link>
              </form>
            )}
          </CardContent>
        </Card>

        <p className="text-center text-sm text-gray-500 mt-8">
          &copy; 2024 A4C Medical. All rights reserved.
        </p>
      </div>
    </div>
  );
};
