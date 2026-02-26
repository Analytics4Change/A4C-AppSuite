import { SupabaseClient, PostgrestError } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import { Logger } from '@/utils/logger';

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
   * Execute an RPC call on the 'api' schema.
   *
   * Centralizes schema selection and provides typed return values.
   * Use this for all RPC functions defined in the 'api' schema.
   *
   * @param functionName - Name of the RPC function (e.g., 'get_user_org_access')
   * @param params - Parameters to pass to the function
   * @returns Promise with typed data or error
   *
   * @example
   * ```typescript
   * const { data, error } = await supabaseService.apiRpc<UserOrgAccess[]>(
   *   'list_user_org_access',
   *   { p_user_id: userId }
   * );
   * ```
   */
  async apiRpc<T>(
    functionName: string,
    params: Record<string, unknown>
  ): Promise<{ data: T | null; error: PostgrestError | null }> {
    const apiClient = this.client as AnySchemaSupabaseClient;
    return apiClient.schema('api').rpc(functionName, params);
  }
}

export const supabaseService = new SupabaseService();
