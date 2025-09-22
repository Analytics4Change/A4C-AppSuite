# OAuthProviders

## Overview

A comprehensive OAuth authentication component that provides sign-in options for multiple social providers including Google, Facebook, and Apple. This component handles the OAuth flow, loading states, error handling, and provides consistent branding across all authentication providers.

## Props Interface

```typescript
interface OAuthProvidersProps {
  onSuccess?: (provider: string, userData: any) => void;  // Success callback with provider and user data
  onError?: (provider: string, error: Error) => void;     // Error callback with provider and error details
}
```

## Usage Examples

### Basic Usage

```tsx
import { OAuthProviders } from '@/components/auth/OAuthProviders';

function LoginPage() {
  const handleAuthSuccess = (provider: string, userData: any) => {
    console.log(`Successfully authenticated with ${provider}:`, userData);
    // Handle successful authentication
    // e.g., store tokens, redirect to dashboard
  };

  const handleAuthError = (provider: string, error: Error) => {
    console.error(`Authentication failed for ${provider}:`, error);
    // Handle authentication error
    // e.g., show error message to user
  };

  return (
    <div className="login-page">
      <h1>Sign In</h1>
      <OAuthProviders
        onSuccess={handleAuthSuccess}
        onError={handleAuthError}
      />
    </div>
  );
}
```

### Advanced Usage with State Management

```tsx
import { useState } from 'react';
import { observer } from 'mobx-react-lite';
import { AuthViewModel } from '@/viewModels/auth/AuthViewModel';

const LoginForm = observer(() => {
  const [authVM] = useState(() => new AuthViewModel());
  const [errorMessage, setErrorMessage] = useState('');

  const handleOAuthSuccess = async (provider: string, userData: any) => {
    try {
      setErrorMessage('');
      await authVM.handleOAuthSuccess(provider, userData);
      // Redirect handled by auth state change
    } catch (error) {
      setErrorMessage(`Failed to complete ${provider} authentication`);
    }
  };

  const handleOAuthError = (provider: string, error: Error) => {
    setErrorMessage(`${provider} authentication failed: ${error.message}`);
  };

  return (
    <div className="auth-container">
      <div className="auth-header">
        <h2>Welcome to A4C</h2>
        <p>Choose your preferred sign-in method</p>
      </div>

      {errorMessage && (
        <div className="error-message" role="alert">
          {errorMessage}
        </div>
      )}

      <OAuthProviders
        onSuccess={handleOAuthSuccess}
        onError={handleOAuthError}
      />

      <div className="auth-footer">
        <p>By signing in, you agree to our Terms of Service</p>
      </div>
    </div>
  );
});
```

### Integration with Router

```tsx
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';

function AuthenticationPage() {
  const navigate = useNavigate();
  const { login } = useAuth();

  const handleOAuthSuccess = async (provider: string, userData: any) => {
    try {
      // Process authentication through context
      await login(provider, userData);
      
      // Redirect to intended destination or dashboard
      const redirectTo = sessionStorage.getItem('redirectAfterLogin') || '/dashboard';
      sessionStorage.removeItem('redirectAfterLogin');
      navigate(redirectTo, { replace: true });
    } catch (error) {
      console.error('Login processing failed:', error);
    }
  };

  return (
    <div className="authentication-page">
      <OAuthProviders onSuccess={handleOAuthSuccess} />
    </div>
  );
}
```

## Accessibility

### WCAG 2.1 Level AA Compliance

- **Keyboard Navigation**: 
  - Tab/Shift+Tab navigation between provider buttons
  - Enter/Space to activate OAuth providers
  - Focus indicators on all interactive elements

- **ARIA Attributes**:
  - `aria-label` for each provider button with clear purpose
  - `aria-describedby` for loading states and error messages
  - `role="button"` for clickable provider elements
  - `aria-disabled` during loading states

- **Focus Management**:
  - Clear focus indicators on all provider buttons
  - Focus preserved during loading states
  - Focus restoration after OAuth window closes

### Screen Reader Support

- Provider names clearly announced ("Sign in with Google")
- Loading states announced ("Google authentication in progress")
- Error states announced with specific error information
- Success states communicated appropriately

## Styling

### CSS Classes

- `.oauth-providers`: Main container for all providers
- `.oauth-provider`: Individual provider button styling
- `.oauth-provider--google`: Google-specific styling
- `.oauth-provider--facebook`: Facebook-specific styling
- `.oauth-provider--apple`: Apple-specific styling
- `.oauth-provider--loading`: Loading state styling
- `.oauth-provider--disabled`: Disabled state styling
- `.oauth-provider__icon`: Provider icon styling
- `.oauth-provider__text`: Provider text styling
- `.oauth-provider__loading`: Loading indicator styling

### Provider Branding

Each provider button follows official brand guidelines:
- **Google**: Uses official Google colors and logo
- **Facebook**: Uses official Facebook blue and logo
- **Apple**: Uses Apple's sign-in button design standards

### Visual States

- **Default**: Clear, accessible buttons with provider branding
- **Hover**: Subtle hover effects maintaining brand colors
- **Focus**: High-contrast focus indicators
- **Loading**: Animated loading indicator with disabled state
- **Error**: Error state indication without breaking brand design

## Implementation Notes

### Design Patterns

- **Provider Strategy Pattern**: Consistent interface across different OAuth providers
- **Loading State Management**: Individual loading states per provider
- **Error Boundary**: Graceful error handling for OAuth failures
- **Security Best Practices**: Secure token handling and validation

### OAuth Flow Implementation

1. **Provider Selection**: User clicks on desired provider button
2. **OAuth Window**: Opens provider's OAuth authorization window
3. **Authentication**: User completes authentication on provider's site
4. **Callback Handling**: Receives authorization code/token from provider
5. **Token Exchange**: Exchanges authorization code for access tokens
6. **User Data**: Retrieves user profile information
7. **Success Callback**: Calls `onSuccess` with provider and user data

### Security Considerations

- **PKCE Flow**: Uses Proof Key for Code Exchange for security
- **State Validation**: Validates OAuth state parameter
- **Token Storage**: Secure token storage and handling
- **CSRF Protection**: Prevents cross-site request forgery
- **Scope Limitation**: Requests minimal necessary permissions

### Dependencies

- OAuth provider SDKs (Google, Facebook, Apple)
- React 18+ for component functionality
- Lucide React for additional icons
- Logger utility for authentication monitoring

### Provider-Specific Notes

- **Google**: Uses Google Identity Services
- **Facebook**: Uses Facebook SDK for JavaScript
- **Apple**: Uses Apple ID JavaScript SDK
- All providers configured with app-specific client IDs

## Testing

### Unit Tests

Located in `OAuthProviders.test.tsx`. Covers:
- Provider button rendering
- Click handlers and OAuth initiation
- Loading state management
- Error handling scenarios
- Accessibility attribute presence

### Integration Tests

- OAuth flow simulation with mock providers
- Success and error callback execution
- Loading state transitions
- Focus management during OAuth flow

### E2E Tests

- Complete OAuth authentication flows
- Provider-specific authentication testing
- Error scenarios and recovery
- Accessibility compliance verification

## Related Components

- `ProtectedRoute` - Uses authentication state from OAuth
- `AuthContext` - Provides authentication state management
- `LoginPage` - Container for OAuth providers
- `AuthViewModel` - State management for authentication flow

## Configuration

### Environment Variables

```env
# OAuth Provider Configuration
VITE_GOOGLE_CLIENT_ID=your_google_client_id
VITE_FACEBOOK_APP_ID=your_facebook_app_id
VITE_APPLE_CLIENT_ID=your_apple_client_id

# OAuth Redirect URLs
VITE_OAUTH_REDIRECT_URL=https://yourdomain.com/auth/callback
```

### Provider Setup

Each OAuth provider requires specific setup:
- **Google**: Configure in Google Cloud Console
- **Facebook**: Configure in Facebook Developers
- **Apple**: Configure in Apple Developer Portal

## Error Handling

### Common Error Scenarios

- **Network Issues**: Handle connectivity problems gracefully
- **User Cancellation**: Handle when user cancels OAuth flow
- **Invalid Configuration**: Handle misconfigured OAuth settings
- **Rate Limiting**: Handle provider rate limit responses
- **Token Expiration**: Handle expired tokens appropriately

### Error Recovery

- Clear error messaging for different failure types
- Retry mechanisms for transient failures
- Fallback authentication options
- Logging for debugging and monitoring

## Changelog

- Initial implementation with Google, Facebook, and Apple
- Added comprehensive error handling
- Enhanced accessibility features
- Improved loading state management
- Added security best practices
- Enhanced provider branding compliance