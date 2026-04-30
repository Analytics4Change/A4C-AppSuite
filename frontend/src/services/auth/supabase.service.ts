import { SupabaseClient, PostgrestError } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import { Logger } from '@/utils/logger';
import { unwrapApiEnvelope, maskPostgrestError, type ApiEnvelope } from '@/services/api/envelope';
import type { EnvelopeRpcs, ReadRpcs } from '@/services/api/rpc-registry.generated';

const log = Logger.getLogger('api');

/**
 * Type alias for Supabase clients configured with non-default schemas.
 *
 * The default SupabaseClient<Database, 'public', Schema> type assumes
 * SchemaName='public', but we need schema='api' for RPC calls.
 * This type uses 'any' to preserve RPC method typing while accepting any
 * schema configuration.
 *
 * Matches the pattern used in Edge Functions (_shared/types.ts).
 */

type AnySchemaSupabaseClient = SupabaseClient<any, any, any>;

export interface Database {
  public: {
    Tables: {
      // Define your table types here as you create them
      medications: {
        Row: {
          id: string;
          name: string;
          organization_id: string;
          created_at: string;
          updated_at: string;
        };
        Insert: Omit<
          Database['public']['Tables']['medications']['Row'],
          'id' | 'created_at' | 'updated_at'
        >;
        Update: Partial<Database['public']['Tables']['medications']['Insert']>;
      };
      clients: {
        Row: {
          id: string;
          name: string;
          organization_id: string;
          created_at: string;
          updated_at: string;
        };
        Insert: Omit<
          Database['public']['Tables']['clients']['Row'],
          'id' | 'created_at' | 'updated_at'
        >;
        Update: Partial<Database['public']['Tables']['clients']['Insert']>;
      };
    };
  };
}

/**
 * Supabase Data Service
 *
 * Provides typed database access via the singleton Supabase client.
 * Authentication is handled automatically by the singleton client:
 * - Auth sessions are managed by SupabaseAuthProvider
 * - JWT tokens are automatically included in all requests
 * - RLS policies on the database use JWT claims for authorization
 *
 * For queries that need org_id or sub from the JWT, retrieve the session
 * directly from the client and decode the access token:
 *
 *   const { data: { session } } = await client.auth.getSession();
 *   const claims = decodeJWT(session.access_token);
 */
class SupabaseService {
  private client: SupabaseClient<Database>;

  constructor() {
    // Use the singleton Supabase client to avoid multiple GoTrueClient instances
    // This prevents "Multiple GoTrueClient instances detected" warnings and
    // ensures OAuth callbacks are handled correctly by a single client instance
    this.client = supabase as SupabaseClient<Database>;

    log.info('SupabaseService initialized (using singleton client)');
  }

  /**
   * Get the Supabase client instance
   */
  getClient(): SupabaseClient<Database> {
    return this.client;
  }

  /**
   * Execute an RPC call on the 'api' schema (read-shape: arrays, scalars, custom objects).
   *
   * ⚠️ **MUST NOT** be used for RPCs that return the Pattern A v2 envelope
   *    (`{success: true, ...}` | `{success: false, error: string, ...}`).
   *    Call `apiRpcEnvelope<T>` for those. `apiRpc` does NOT mask `data.error` —
   *    masking caller-owned `T` would silently break the typed contract.
   *
   * Failure-path masking: PostgrestError fields (`message`, `details`, `hint`) ARE
   * masked at the SDK boundary so callers cannot accidentally surface raw PHI in
   * log lines or UI. The returned object preserves the PostgrestError shape; only
   * its string fields are replaced.
   *
   * @param functionName - Name of the RPC function (e.g., 'get_user_org_access')
   * @param params - Parameters to pass to the function
   * @returns Promise with typed data or masked PostgrestError
   *
   * @example
   * ```typescript
   * const { data, error } = await supabaseService.apiRpc<UserOrgAccess[]>(
   *   'list_user_org_access',
   *   { p_user_id: userId }
   * );
   * ```
   *
   * @see apiRpcEnvelope — for envelope-shaped writes (Pattern A v2)
   * @see frontend/src/services/api/envelope.ts — unwrapApiEnvelope helper
   * @see dev/active/migrate-services-to-api-rpc-envelope/ — bulk-migration follow-up
   */
  async apiRpc<T>(
    functionName: ReadRpcs,
    params: Record<string, unknown>
  ): Promise<{ data: T | null; error: PostgrestError | null }> {
    const apiClient = this.client as AnySchemaSupabaseClient;
    const result = await apiClient.schema('api').rpc(functionName, params);
    if (result.error) {
      const masked = maskPostgrestError(result.error);
      return {
        data: result.data as T | null,
        error: { ...result.error, ...masked } as PostgrestError,
      };
    }
    return result as { data: T | null; error: PostgrestError | null };
  }

  /**
   * Execute a Pattern A v2 RPC and unwrap the envelope into a typed `ApiEnvelope<T>`.
   *
   * This is the ONLY sanctioned way to read `error` off an `api.*` RPC envelope.
   * `unwrapApiEnvelope` applies `maskPii` exactly once at the SDK boundary so any
   * downstream consumer (services, ViewModels, log emissions) can never accidentally
   * surface raw PHI from `processing_error` or `PG_EXCEPTION_DETAIL`.
   *
   * Success-path shape is `{success: true} & T` — flat intersection — preserving the
   * existing return-shape convention used by services in this repo.
   *
   * @param functionName - Name of the envelope-shaped RPC (e.g., 'update_user', 'create_role')
   * @param params - Parameters to pass to the function
   * @returns Promise with discriminated `ApiEnvelope<T>`
   *
   * @example
   * ```typescript
   * const env = await supabaseService.apiRpcEnvelope<{ user: User; event_id: string }>(
   *   'update_user',
   *   { p_user_id: id, p_email: email }
   * );
   * if (!env.success) return { success: false, error: env.error };
   * return { success: true, user: env.user };  // flat intersection: env.user is typed
   * ```
   */
  async apiRpcEnvelope<T extends Record<string, unknown> = Record<string, never>>(
    functionName: EnvelopeRpcs,
    params: Record<string, unknown>
  ): Promise<ApiEnvelope<T>> {
    const apiClient = this.client as AnySchemaSupabaseClient;
    const result = await apiClient.schema('api').rpc(functionName, params);
    return unwrapApiEnvelope<T>(result);
  }
}

export const supabaseService = new SupabaseService();
