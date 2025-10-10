/**
 * OAuth Configuration
 * 
 * IMPORTANT: These are demo/mock values for development.
 * In production, these should be:
 * 1. Stored in environment variables
 * 2. Never exposed in client-side code
 * 3. Handled through a secure backend
 */

export const oauthConfig = {
  // Google OAuth2 Configuration
  google: {
    clientId: import.meta.env.VITE_GOOGLE_CLIENT_ID || 'demo-google-client-id.apps.googleusercontent.com',
    scope: 'openid email profile',
    // In production, use actual Google OAuth2
    enabled: true,
    mockMode: true // Set to false when using real OAuth
  },

  // Facebook OAuth Configuration
  facebook: {
    appId: import.meta.env.VITE_FACEBOOK_APP_ID || 'demo-facebook-app-id',
    version: 'v18.0',
    scope: 'public_profile,email',
    enabled: true,
    mockMode: true // Set to false when using real OAuth
  },

  // Apple OAuth Configuration
  apple: {
    clientId: import.meta.env.VITE_APPLE_CLIENT_ID || 'com.a4cmedical.auth',
    redirectURI: import.meta.env.VITE_APPLE_REDIRECT_URI || window.location.origin,
    scope: 'name email',
    enabled: true,
    mockMode: true // Set to false when using real OAuth
  },

  // OAuth redirect settings
  redirects: {
    successPath: '/clients',
    failurePath: '/login',
    callbackPath: '/auth/callback'
  }
};

// Helper to check if we're in mock mode
export const isOAuthMockMode = () => {
  return oauthConfig.google.mockMode || 
         oauthConfig.facebook.mockMode || 
         oauthConfig.apple.mockMode;
};

// Mock OAuth responses for development
export const mockOAuthResponses = {
  google: {
    sub: 'google-user-123',
    name: 'Google User',
    given_name: 'Google',
    family_name: 'User',
    picture: 'https://ui-avatars.com/api/?name=Google+User&background=4285f4&color=fff',
    email: 'google.user@example.com',
    email_verified: true
  },
  facebook: {
    id: 'facebook-user-123',
    name: 'Facebook User',
    email: 'facebook.user@example.com',
    picture: {
      data: {
        url: 'https://ui-avatars.com/api/?name=Facebook+User&background=1877f2&color=fff'
      }
    }
  },
  apple: {
    sub: 'apple-user-123',
    email: 'apple.user@example.com',
    email_verified: true,
    is_private_email: false,
    name: {
      firstName: 'Apple',
      lastName: 'User'
    }
  }
};