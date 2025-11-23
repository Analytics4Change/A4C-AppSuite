/**
 * Supabase Client Utility
 *
 * Provides configured Supabase client for database operations.
 * Uses service role key to bypass RLS (required for workflow activities).
 *
 * Requirements:
 * - SUPABASE_URL environment variable
 * - SUPABASE_SERVICE_ROLE_KEY environment variable
 *
 * Usage:
 * ```typescript
 * import { getSupabaseClient } from '@shared/utils/supabase';
 *
 * const supabase = getSupabaseClient();
 * const { data, error } = await supabase
 *   .from('organizations_projection')
 *   .select('*')
 *   .eq('id', orgId);
 * ```
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';

let supabaseClient: SupabaseClient | null = null;

/**
 * Get or create Supabase client (singleton)
 * @returns Configured Supabase client with service role
 * @throws Error if environment variables not set
 */
export function getSupabaseClient(): SupabaseClient {
  if (supabaseClient) {
    return supabaseClient;
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl) {
    throw new Error(
      'Missing required environment variable: SUPABASE_URL\n' +
      'Example: https://your-project.supabase.co'
    );
  }

  if (!serviceRoleKey) {
    throw new Error(
      'Missing required environment variable: SUPABASE_SERVICE_ROLE_KEY\n' +
      'Get service role key from: Supabase Dashboard → Settings → API'
    );
  }

  supabaseClient = createClient(supabaseUrl, serviceRoleKey, {
    db: { schema: 'public' },
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  });

  return supabaseClient;
}

/**
 * Reset Supabase client (for testing)
 */
export function resetSupabaseClient(): void {
  supabaseClient = null;
}
