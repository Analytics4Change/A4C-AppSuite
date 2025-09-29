import React, { createContext, useState, useContext, ReactNode, useEffect } from 'react';
import { Logger } from '@/utils/logger';
import { zitadelService, ZitadelUser } from '@/services/auth/zitadel.service';
import { supabaseService } from '@/services/auth/supabase.service';
import { mockOAuthResponses } from '@/config/oauth.config';

const log = Logger.getLogger('main');

interface User {
  id: string;
  name: string;
  email: string;
  role: 'super_admin' | 'partner_onboarder' | 'administrator' | 'provider_admin' | 'admin' | 'clinician' | 'nurse' | 'caregiver' | 'viewer';
  provider?: 'local' | 'google' | 'facebook' | 'apple' | 'zitadel';
  picture?: string;
}

interface AuthState {
  isAuthenticated: boolean;
  user: User | null;
  zitadelUser?: ZitadelUser | null;
}

interface AuthContextType {
  isAuthenticated: boolean;
  user: User | null;
  zitadelUser?: ZitadelUser | null;
  login: (username: string, password: string) => Promise<boolean>;
  loginWithOAuth: (provider: 'google' | 'facebook' | 'apple', oauthData: any) => Promise<boolean>;
  loginWithZitadel: () => Promise<void>;
  logout: () => void;
  setAuthState: (state: AuthState) => Promise<void>;
  hasRole: (role: string) => boolean;
  hasPermission: (permission: string) => boolean;
  switchOrganization: (orgId: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

interface AuthProviderProps {
  children: ReactNode;
}

export const AuthProvider: React.FC<AuthProviderProps> = ({ children }) => {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [zitadelUser, setZitadelUser] = useState<ZitadelUser | null>(null);

  log.debug('AuthProvider state', { isAuthenticated, user });

  // Check for existing Zitadel session on mount
  useEffect(() => {
    const checkExistingSession = async () => {
      try {
        const existingUser = await zitadelService.getUser();
        if (existingUser) {
          log.info('Existing Zitadel session found');
          await supabaseService.updateAuthToken(existingUser);

          setZitadelUser(existingUser);
          setUser({
            id: existingUser.id,
            name: existingUser.name,
            email: existingUser.email,
            role: mapZitadelRoleToAppRole(existingUser.roles),
            provider: 'zitadel',
            picture: existingUser.picture,
          });
          setIsAuthenticated(true);
        } else {
          // Check for legacy session storage (for mock login)
          const storedUser = sessionStorage.getItem('user');
          if (storedUser) {
            setUser(JSON.parse(storedUser));
            setIsAuthenticated(true);
          }
        }
      } catch (error) {
        log.error('Failed to restore session', error);
      }
    };

    checkExistingSession();
  }, []);

  const login = async (username: string, password: string): Promise<boolean> => {
    log.info('Login attempt', { username });

    // Mock authentication - accept admin/admin123 or demo/demo123
    if (
      (username === 'admin' && password === 'admin123') ||
      (username === 'demo' && password === 'demo123')
    ) {
      const mockUser: User = {
        id: '1',
        name: username === 'admin' ? 'Admin User' : 'Demo User',
        email: `${username}@a4c-medical.com`,
        role: username === 'admin' ? 'admin' : 'clinician',
        provider: 'local'
      };

      log.info('Login successful', { user: mockUser });
      setUser(mockUser);
      setIsAuthenticated(true);

      // Store in sessionStorage for page refresh persistence
      sessionStorage.setItem('user', JSON.stringify(mockUser));

      return true;
    }

    log.warn('Login failed - invalid credentials');
    return false;
  };

  const loginWithOAuth = async (
    provider: 'google' | 'facebook' | 'apple',
    oauthData: any
  ): Promise<boolean> => {
    log.info('OAuth login attempt', { provider });

    try {
      // Transform OAuth response to User format
      let user: User;

      switch (provider) {
        case 'google':
          user = {
            id: oauthData.sub,
            name: oauthData.name,
            email: oauthData.email,
            role: 'clinician', // Default role for OAuth users
            provider: 'google',
            picture: oauthData.picture
          };
          break;

        case 'facebook':
          user = {
            id: oauthData.id,
            name: oauthData.name,
            email: oauthData.email,
            role: 'clinician',
            provider: 'facebook',
            picture: oauthData.picture?.data?.url
          };
          break;

        case 'apple':
          user = {
            id: oauthData.sub,
            name: oauthData.name ?
              `${oauthData.name.firstName} ${oauthData.name.lastName}` :
              'Apple User',
            email: oauthData.email,
            role: 'clinician',
            provider: 'apple'
          };
          break;

        default:
          throw new Error(`Unknown OAuth provider: ${provider}`);
      }

      log.info('OAuth login successful', { provider, user });
      setUser(user);
      setIsAuthenticated(true);

      // Store in sessionStorage
      sessionStorage.setItem('user', JSON.stringify(user));

      return true;
    } catch (error) {
      log.error('OAuth login failed', { provider, error });
      return false;
    }
  };

  const loginWithZitadel = async (): Promise<void> => {
    log.info('Initiating Zitadel login');

    // Store the current location to return after auth
    sessionStorage.setItem('auth_return_to', window.location.pathname);

    // Redirect to Zitadel
    await zitadelService.login();
  };

  const logout = async () => {
    log.info('User logout');

    if (zitadelUser) {
      // Logout from Zitadel
      await zitadelService.logout();
    }

    // Clear local state
    setUser(null);
    setZitadelUser(null);
    setIsAuthenticated(false);
    sessionStorage.removeItem('user');

    // Clear Supabase auth
    await supabaseService.updateAuthToken(null);
  };

  const setAuthState = async (state: AuthState): Promise<void> => {
    setIsAuthenticated(state.isAuthenticated);
    setUser(state.user);
    setZitadelUser(state.zitadelUser || null);

    if (state.user) {
      sessionStorage.setItem('user', JSON.stringify(state.user));
    }
  };

  const hasRole = (role: string): boolean => {
    if (!zitadelUser) return false;
    return zitadelService.hasRole(zitadelUser, role);
  };

  const hasPermission = (permission: string): boolean => {
    if (!zitadelUser) return false;
    return zitadelService.hasPermission(zitadelUser, permission);
  };

  const switchOrganization = async (orgId: string): Promise<void> => {
    if (!zitadelUser) {
      throw new Error('No authenticated user');
    }

    await zitadelService.switchOrganization(orgId);

    // Update the current user's organization context
    const updatedUser = {
      ...zitadelUser,
      organizationId: orgId,
    };

    setZitadelUser(updatedUser);
    await supabaseService.updateAuthToken(updatedUser);

    log.info('Organization switched', { orgId });
  };

  return (
    <AuthContext.Provider
      value={{
        isAuthenticated,
        user,
        zitadelUser,
        login,
        loginWithOAuth,
        loginWithZitadel,
        logout,
        setAuthState,
        hasRole,
        hasPermission,
        switchOrganization,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

// Helper function to map Zitadel roles to app roles
function mapZitadelRoleToAppRole(roles: string[]): 'admin' | 'clinician' | 'nurse' | 'viewer' {
  // Priority order for role mapping
  if (roles.includes('admin') || roles.includes('administrator')) return 'admin';
  if (roles.includes('clinician') || roles.includes('doctor') || roles.includes('physician')) return 'clinician';
  if (roles.includes('nurse')) return 'nurse';

  // Default to viewer for any other role
  return 'viewer';
}