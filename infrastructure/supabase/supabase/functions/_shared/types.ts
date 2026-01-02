/**
 * Shared Type Definitions - Edge Functions
 *
 * Common type aliases used across Supabase Edge Functions.
 */
import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

// =============================================================================
// Supabase Client Types
// =============================================================================

/**
 * Type alias for Supabase clients configured with non-default schemas.
 *
 * The default SupabaseClient<Database, 'public', Schema> type assumes
 * SchemaName='public', but our Edge Functions use schema='api' for RPC calls.
 * This type uses 'any' to preserve RPC method typing while accepting any
 * schema configuration.
 *
 * Without generated database types (from `supabase gen types`), we can't have
 * stricter typing anyway. This matches how Supabase documents usage without codegen.
 *
 * @example
 * ```typescript
 * // Function that accepts any Supabase client
 * async function doRpcCall(supabase: AnySchemaSupabaseClient) {
 *   const { data, error } = await supabase.rpc('my_function', { ... });
 * }
 *
 * // Works with clients using any schema
 * const apiClient = createClient(url, key, { db: { schema: 'api' } });
 * const publicClient = createClient(url, key);
 *
 * await doRpcCall(apiClient);    // OK
 * await doRpcCall(publicClient); // OK
 * ```
 */
// deno-lint-ignore no-explicit-any
export type AnySchemaSupabaseClient = SupabaseClient<any, any, any>;
