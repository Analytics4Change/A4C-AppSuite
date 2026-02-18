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

// =============================================================================
// JWT v4 Types
// =============================================================================

/** Single effective permission from JWT claims v4 */
export interface EffectivePermission {
  p: string;  // Permission name
  s: string;  // Scope path (ltree)
}

/** JWT payload matching custom_access_token_hook v4 */
export interface JWTPayload {
  sub?: string;
  email?: string;
  org_id?: string;
  org_type?: string;
  effective_permissions?: EffectivePermission[];
  access_blocked?: boolean;
  claims_version?: number;
  current_org_unit_id?: string;
  current_org_unit_path?: string;
}

/** Check if JWT claims include a specific permission (any scope) */
export function hasPermission(
  effectivePermissions: EffectivePermission[] | undefined,
  permission: string
): boolean {
  return effectivePermissions?.some(ep => ep.p === permission) ?? false;
}
