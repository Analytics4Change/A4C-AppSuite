/**
 * Supabase Client Configuration
 *
 * Provides a singleton Supabase client for database and auth operations.
 * Uses environment variables for configuration.
 */

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    'Missing Supabase environment variables. ' +
    'Please ensure VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are set in .env.local'
  );
}

/**
 * Supabase client singleton
 *
 * Configured with anonymous key for public operations.
 * Automatically handles JWT token injection for authenticated requests.
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
export const supabase = createClient(supabaseUrl, supabaseAnonKey);
