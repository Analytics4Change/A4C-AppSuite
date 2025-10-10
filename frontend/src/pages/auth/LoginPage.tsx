import React, { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Heart, AlertCircle } from 'lucide-react';
import { OAuthProviders } from '@/components/auth/OAuthProviders';

export const LoginPage: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { login, loginWithOAuth, loginWithZitadel } = useAuth();
  
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);

    try {
      const success = await login(username, password);
      
      if (success) {
        // Redirect to where they came from or default to clients
        const from = (location.state as any)?.from?.pathname || '/clients';
        navigate(from, { replace: true });
      } else {
        setError('Invalid username or password');
      }
    } catch (err) {
      setError('An error occurred during login');
    } finally {
      setIsLoading(false);
    }
  };

  const handleOAuthSuccess = async (provider: string, userData: any) => {
    setError('');
    setIsLoading(true);
    
    try {
      const success = await loginWithOAuth(
        provider as 'google' | 'facebook' | 'apple',
        userData
      );
      
      if (success) {
        const from = (location.state as any)?.from?.pathname || '/clients';
        navigate(from, { replace: true });
      } else {
        setError(`Failed to authenticate with ${provider}`);
      }
    } catch (err) {
      setError(`An error occurred during ${provider} login`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleOAuthError = (provider: string, error: Error) => {
    setError(`${provider} login failed: ${error.message}`);
  };

  const handleZitadelLogin = async () => {
    try {
      setIsLoading(true);
      await loginWithZitadel();
    } catch (err) {
      setError('Failed to initiate Zitadel login');
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-indigo-100">
      <div className="w-full max-w-md px-4">
        <div className="text-center mb-8">
          <div className="flex justify-center mb-4">
            <div className="p-3 bg-blue-600 rounded-full">
              <Heart className="w-8 h-8 text-white" />
            </div>
          </div>
          <h1 className="text-3xl font-bold text-gray-900">A4C Medical</h1>
          <p className="text-gray-600 mt-2">Medication Management System</p>
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
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <Label htmlFor="username">Username</Label>
                <Input
                  id="username"
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="Enter your username"
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

              {/* Zitadel SSO Login */}
              {import.meta.env.VITE_AUTH_MODE === 'production' && (
                <div className="space-y-3">
                  <div className="relative">
                    <div className="absolute inset-0 flex items-center">
                      <span className="w-full border-t border-gray-300/50" />
                    </div>
                    <div className="relative flex justify-center text-xs uppercase">
                      <span className="bg-white/80 backdrop-blur-sm px-2 text-gray-500">
                        Or
                      </span>
                    </div>
                  </div>

                  <Button
                    type="button"
                    variant="outline"
                    className="w-full"
                    onClick={handleZitadelLogin}
                    disabled={isLoading}
                  >
                    Sign in with Enterprise SSO
                  </Button>
                </div>
              )}

              {/* OAuth Providers (Mock Mode) */}
              <OAuthProviders
                onSuccess={handleOAuthSuccess}
                onError={handleOAuthError}
              />

              <div className="text-center text-sm text-gray-600 pt-4 border-t border-gray-200/50">
                <p>Demo Credentials:</p>
                <p className="font-mono mt-1">admin / admin123</p>
                <p className="font-mono">demo / demo123</p>
              </div>
            </form>
          </CardContent>
        </Card>

        <p className="text-center text-sm text-gray-500 mt-8">
          © 2024 A4C Medical. All rights reserved.
        </p>
      </div>
    </div>
  );
};