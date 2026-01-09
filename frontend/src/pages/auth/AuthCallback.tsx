import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { Logger } from '@/utils/logger';
import { Loader2 } from 'lucide-react';
import { sanitizeRedirectUrl, buildSubdomainUrl } from '@/utils/redirect-validation';
import { getOrganizationSubdomainInfo } from '@/services/organization/getOrganizationSubdomainInfo';
import { getAuthContextStorage } from '@/services/storage';
import type { InvitationAuthContext } from '@/types/auth.types';
import { supabaseService } from '@/services/auth/supabase.service';
import { generateTraceparent, getSessionId } from '@/utils/tracing';
import {
  FunctionsHttpError,
  FunctionsRelayError,
  FunctionsFetchError,
} from '@supabase/supabase-js';
import { ErrorWithCorrelation } from '@/components/ui/ErrorWithCorrelation';

const log = Logger.getLogger('component');

/** Storage key for invitation context during OAuth redirect */
const INVITATION_CONTEXT_KEY = 'invitation_acceptance_context';

/** Context expires after 10 minutes */
const CONTEXT_TTL_MS = 10 * 60 * 1000;

/**
 * Result from extracting Edge Function errors
 */
interface EdgeFunctionErrorResult {
  message: string;
  details?: string;
  correlationId?: string;
}

/**
 * Result from OAuth invitation acceptance
 */
interface InvitationAcceptanceResult {
  success: boolean;
  redirectUrl?: string;
  error?: string;
  correlationId?: string;
  traceId?: string;
}

/**
 * Error state with correlation for display
 */
interface CallbackError {
  message: string;
  correlationId?: string;
  traceId?: string;
}

/**
 * Extract detailed error from Supabase Edge Function error response.
 */
async function extractEdgeFunctionError(
  error: unknown,
  operation: string
): Promise<EdgeFunctionErrorResult> {
  if (error instanceof FunctionsHttpError) {
    const correlationId = error.context.headers.get('x-correlation-id') ?? undefined;

    try {
      const body = await error.context.json();
      log.error(`[AuthCallback] Edge Function HTTP error for ${operation}`, {
        status: error.context.status,
        correlationId,
        body,
      });
      return {
        message: body?.message ?? body?.error ?? `${operation} failed`,
        details: body?.details,
        correlationId,
      };
    } catch {
      log.error(`[AuthCallback] Edge Function error (non-JSON response) for ${operation}`, {
        status: error.context.status,
        correlationId,
      });
      return {
        message: `${operation} failed (HTTP ${error.context.status})`,
        correlationId,
      };
    }
  }

  if (error instanceof FunctionsRelayError) {
    log.error(`[AuthCallback] Edge Function relay error for ${operation}`, error);
    return { message: `Network error: ${error.message}` };
  }

  if (error instanceof FunctionsFetchError) {
    log.error(`[AuthCallback] Edge Function fetch error for ${operation}`, error);
    return { message: `Connection error: ${error.message}` };
  }

  log.error(`[AuthCallback] Unknown error for ${operation}`, error);
  return { message: error instanceof Error ? error.message : 'Unknown error' };
}

/**
 * Complete invitation acceptance after OAuth callback.
 *
 * Calls the accept-invitation Edge Function with the authenticated user.
 * NOTE: Does NOT send X-Correlation-ID - backend uses stored invitation.correlation_id.
 */
async function completeOAuthInvitationAcceptance(
  context: InvitationAuthContext
): Promise<InvitationAcceptanceResult> {
  const client = supabaseService.getClient();

  const { data: { session } } = await client.auth.getSession();
  if (!session) {
    log.error('[AuthCallback] No session after OAuth callback');
    return { success: false, error: 'No authenticated session' };
  }

  // Generate tracing headers (NOT correlation ID - backend uses stored value)
  const { header: traceparent, traceId, spanId } = generateTraceparent();
  const sessionId = await getSessionId();

  const headers: Record<string, string> = {
    traceparent,
    // NOTE: Do NOT include X-Correlation-ID - backend reuses invitation.correlation_id
  };

  if (sessionId) {
    headers['X-Session-ID'] = sessionId;
  }

  const provider = context.authMethod.type === 'oauth'
    ? context.authMethod.provider
    : context.authMethod.type === 'sso'
      ? context.authMethod.config.type
      : 'unknown';

  log.info('[AuthCallback] Calling accept-invitation Edge Function', {
    traceId,
    spanId,
    provider,
    platform: context.platform,
  });

  const { data, error } = await client.functions.invoke('accept-invitation', {
    body: {
      token: context.token,
      credentials: {
        email: session.user.email,
        authMethod: context.authMethod,
        authenticatedUserId: session.user.id,
      },
      platform: context.platform,
    },
    headers,
  });

  if (error) {
    const extracted = await extractEdgeFunctionError(error, 'Accept invitation via OAuth');
    log.error('[AuthCallback] OAuth invitation acceptance failed', {
      message: extracted.message,
      correlationId: extracted.correlationId,
      traceId,
    });
    return {
      success: false,
      error: extracted.message,
      correlationId: extracted.correlationId,
      traceId,
    };
  }

  log.info('[AuthCallback] OAuth invitation acceptance successful', {
    userId: data.userId,
    orgId: data.orgId,
    redirectUrl: data.redirectUrl,
    traceId,
  });

  return {
    success: true,
    redirectUrl: data.redirectUrl,
  };
}

export const AuthCallback: React.FC = () => {
  const navigate = useNavigate();
  const { handleOAuthCallback, session } = useAuth();
  const [error, setError] = useState<CallbackError | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [statusMessage, setStatusMessage] = useState('Please wait while we verify your credentials...');

  /**
   * Determine the best redirect URL after OAuth callback.
   * Priority: sessionStorage returnTo > org subdomain > /clients
   */
  const determineRedirectUrl = async (): Promise<string> => {
    // Priority 1: Explicit redirect from sessionStorage (from invitation flow)
    const returnTo = sessionStorage.getItem('auth_return_to');
    sessionStorage.removeItem('auth_return_to');

    const validRedirect = sanitizeRedirectUrl(returnTo);
    if (validRedirect) {
      log.info('[AuthCallback] Using explicit redirect URL', { validRedirect });
      return validRedirect;
    }

    // Priority 2: Determine from JWT claims (returning user)
    const orgId = session?.claims?.org_id;
    if (orgId) {
      try {
        log.info('[AuthCallback] Looking up org subdomain', { orgId });
        const orgInfo = await getOrganizationSubdomainInfo(orgId);
        if (orgInfo?.slug && orgInfo.subdomain_status === 'verified') {
          const subdomainUrl = buildSubdomainUrl(orgInfo.slug, '/dashboard');
          if (subdomainUrl) {
            log.info('[AuthCallback] Using org subdomain', { subdomainUrl });
            return subdomainUrl;
          }
        }
      } catch (err) {
        log.error('[AuthCallback] Failed to get org subdomain info', err);
      }
    }

    // Priority 3: Default fallback
    log.info('[AuthCallback] Using default redirect to /clients');
    return '/clients';
  };

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
        log.info('[AuthCallback] Processing OAuth callback');

        // Use the auth context's callback handler
        await handleOAuthCallback(window.location.href);

        log.info('[AuthCallback] OAuth authentication successful');

        // Clear the URL parameters before redirecting
        window.history.replaceState({}, document.title, window.location.pathname);

        // Check for invitation acceptance flow
        const storage = getAuthContextStorage();
        const invitationContextStr = await storage.getItem(INVITATION_CONTEXT_KEY);

        if (invitationContextStr) {
          // Clear context immediately to prevent re-processing
          await storage.removeItem(INVITATION_CONTEXT_KEY);

          let invitationContext: InvitationAuthContext;
          try {
            invitationContext = JSON.parse(invitationContextStr);
          } catch {
            log.error('[AuthCallback] Failed to parse invitation context');
            setError({ message: 'Invalid invitation context. Please try accepting the invitation again.' });
            return;
          }

          // TTL check - reject stale context
          const age = Date.now() - invitationContext.createdAt;
          if (age > CONTEXT_TTL_MS) {
            log.warn('[AuthCallback] Invitation context expired', {
              age,
              maxAge: CONTEXT_TTL_MS,
            });
            setError({ message: 'Session expired. Please try accepting the invitation again.' });
            return;
          }

          if (invitationContext.flow === 'invitation_acceptance') {
            setStatusMessage('Completing invitation acceptance...');

            const provider = invitationContext.authMethod.type === 'oauth'
              ? invitationContext.authMethod.provider
              : 'sso';

            log.info('[AuthCallback] Completing invitation acceptance', {
              provider,
              platform: invitationContext.platform,
            });

            const result = await completeOAuthInvitationAcceptance(invitationContext);

            if (result.success && result.redirectUrl) {
              // Redirect to login with the target URL as parameter
              // User will log in and then be redirected to the subdomain
              const loginUrl = `/login?redirect=${encodeURIComponent(result.redirectUrl)}`;
              log.info('[AuthCallback] Invitation accepted, redirecting to login', {
                redirectUrl: result.redirectUrl,
                loginUrl,
              });
              navigate(loginUrl, { replace: true });
              return;
            } else {
              // Display error with correlation ID
              log.error('[AuthCallback] Invitation acceptance failed', {
                error: result.error,
                correlationId: result.correlationId,
              });
              setError({
                message: result.error || 'Failed to accept invitation',
                correlationId: result.correlationId,
                traceId: result.traceId,
              });
              return;
            }
          }
        }

        // Standard OAuth flow (not invitation acceptance)
        // Determine best redirect URL (explicit > org subdomain > default)
        const redirectUrl = await determineRedirectUrl();

        // Redirect: use window.location for cross-origin, navigate for same-origin
        if (redirectUrl.startsWith('http')) {
          log.info('[AuthCallback] Cross-origin redirect', { redirectUrl });
          window.location.href = redirectUrl;
        } else {
          log.info('[AuthCallback] Same-origin redirect', { redirectUrl });
          navigate(redirectUrl, { replace: true });
        }
      } catch (err) {
        log.error('[AuthCallback] Auth callback failed', err);
        setError({
          message: err instanceof Error ? err.message : 'Authentication failed',
        });
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
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-[#f8fafc] to-white p-4">
        <div className="w-full max-w-md">
          <ErrorWithCorrelation
            title="Authentication Failed"
            message={error.message}
            correlationId={error.correlationId}
            traceId={error.traceId}
            onDismiss={() => navigate('/login')}
          />
          <p className="text-sm text-gray-500 text-center mt-4">Redirecting to login...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-[#f8fafc] to-white">
      <div className="text-center">
        <Loader2 className="h-12 w-12 animate-spin text-blue-600 mx-auto mb-4" />
        <h2 className="text-2xl font-semibold text-gray-900 mb-2">Completing Sign In</h2>
        <p className="text-gray-600">{statusMessage}</p>
      </div>
    </div>
  );
};