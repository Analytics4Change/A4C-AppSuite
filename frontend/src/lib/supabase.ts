/**
 * Supabase Client Configuration
 *
 * Provides a singleton Supabase client for database and auth operations.
 * Uses environment variables for configuration.
 *
 * Mode Behavior:
 * - Production/Integration: Requires VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY
 * - Mock mode (VITE_APP_MODE=mock): Creates placeholder client (DevAuthProvider handles auth)
 */

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
const isMockMode = import.meta.env.VITE_APP_MODE === 'mock';

// Validate environment variables
// In mock mode, use placeholder values since DevAuthProvider handles auth
// and the Supabase client isn't actually used for authentication
if (!supabaseUrl || !supabaseAnonKey) {
  if (!isMockMode) {
    throw new Error(
      'Missing Supabase environment variables. ' +
      'Please ensure VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are set in .env.local'
    );
  }
}

// In mock mode without credentials, use placeholder URL to satisfy the client constructor
// The client won't be used for actual requests in mock mode (DevAuthProvider handles auth)
const effectiveUrl = supabaseUrl || 'https://placeholder.supabase.co';
const effectiveKey = supabaseAnonKey || 'placeholder-key-for-mock-mode';

/**
 * Supabase client singleton
 *
 * Configured with anonymous key for public operations.
 * Automatically handles JWT token injection for authenticated requests.
 * OAuth configuration ensures proper session detection and persistence.
 *
 * Note: In mock mode without credentials, this is a placeholder client.
 * DevAuthProvider handles authentication, so Supabase auth is not used.
 *
 * @example
 * ```typescript
 * import { supabase } from '@/lib/supabase';
 *
 * // Query data
 * const { data, error } = await supabase
 *   .from('domain_events')
 *   .select('*')
 *   .limit(10);
 * ```
 */
export const supabase = createClient(effectiveUrl, effectiveKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true, // Critical for OAuth callback handling
    flowType: 'pkce', // Use PKCE flow for enhanced security
  },
});
