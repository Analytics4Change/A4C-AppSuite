import { SupabaseClient, PostgrestError } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import { Logger } from '@/utils/logger';
import { Session } from '@/types/auth.types';

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
// eslint-disable-next-line @typescript-eslint/no-explicit-any
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
        Insert: Omit<Database['public']['Tables']['medications']['Row'], 'id' | 'created_at' | 'updated_at'>;
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
        Insert: Omit<Database['public']['Tables']['clients']['Row'], 'id' | 'created_at' | 'updated_at'>;
        Update: Partial<Database['public']['Tables']['clients']['Insert']>;
      };
    };
  };
}

/**
 * Supabase Data Service
 *
 * Provides typed database access and organization-scoped query helpers.
 * Uses the singleton Supabase client for all operations to avoid multiple
 * GoTrueClient instances and ensure consistent OAuth callback handling.
 *
 * Authentication is handled automatically by the singleton client:
 * - Auth sessions are managed by SupabaseAuthProvider
 * - JWT tokens are automatically included in all requests
 * - RLS policies on the database use JWT claims for authorization
 */
class SupabaseService {
  private client: SupabaseClient<Database>;
  private currentSession: Session | null = null;

  constructor() {
    // Use the singleton Supabase client to avoid multiple GoTrueClient instances
    // This prevents "Multiple GoTrueClient instances detected" warnings and
    // ensures OAuth callbacks are handled correctly by a single client instance
    this.client = supabase as SupabaseClient<Database>;

    log.info('SupabaseService initialized (using singleton client)');
  }

  /**
   * Update the current session reference
   *
   * Note: Authentication is handled automatically by the singleton Supabase client.
   * This method only stores the session reference for use in organization-scoped
   * helper methods (queryWithOrgScope, insertWithOrgScope, etc.)
   *
   * The Supabase client automatically:
   * - Includes Authorization headers with JWT tokens on all requests
   * - Handles token refresh
   * - Manages session persistence
   * - Processes OAuth callbacks
   *
   * RLS policies on the database read org_id, user_role, and permissions
   * directly from the JWT claims, so manual header injection is unnecessary
   * and can cause concurrency issues.
   */
  async updateAuthSession(session: Session | null): Promise<void> {
    this.currentSession = session;

    if (session) {
      log.info('Session reference updated', {
        user: session.user.email,
        org_id: session.claims.org_id,
        role: session.claims.user_role,
      });
    } else {
      log.info('Session reference cleared');
    }
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

  /**
   * Get the current session
   */
  getCurrentSession(): Session | null {
    return this.currentSession;
  }

  /**
   * Helper method for organization-scoped queries
   * Automatically adds organization_id filter based on current session
   */
  async queryWithOrgScope<T>(
    tableName: keyof Database['public']['Tables'],
    query?: {
      select?: string;
      filter?: Record<string, any>;
      orderBy?: { column: string; ascending?: boolean };
      limit?: number;
    }
  ): Promise<{ data: T[] | null; error: any }> {
    if (!this.currentSession?.claims.org_id) {
      return {
        data: null,
        error: new Error('No organization context available'),
      };
    }

    const client = this.getClient();
    let dbQuery = client.from(tableName).select(query?.select || '*');

    // Add organization filter
    dbQuery = dbQuery.eq('organization_id', this.currentSession.claims.org_id);

    // Add additional filters
    if (query?.filter) {
      Object.entries(query.filter).forEach(([key, value]) => {
        dbQuery = dbQuery.eq(key, value);
      });
    }

    // Add ordering
    if (query?.orderBy) {
      dbQuery = dbQuery.order(query.orderBy.column, {
        ascending: query.orderBy.ascending ?? true,
      });
    }

    // Add limit
    if (query?.limit) {
      dbQuery = dbQuery.limit(query.limit);
    }

    const result = await dbQuery;

    if (result.error) {
      log.error(`Query failed for ${tableName}`, result.error);
    }

    return result as { data: T[] | null; error: any };
  }

  /**
   * Helper method for inserting data with organization scope
   */
  async insertWithOrgScope<T>(
    tableName: keyof Database['public']['Tables'],
    data: Omit<T, 'organization_id' | 'id' | 'created_at' | 'updated_at'>
  ): Promise<{ data: T | null; error: any }> {
    if (!this.currentSession?.claims.org_id) {
      return {
        data: null,
        error: new Error('No organization context available'),
      };
    }

    const client = this.getClient();
    const result = await client
      .from(tableName)
      .insert({
        ...data,
        organization_id: this.currentSession.claims.org_id,
      } as any)
      .select()
      .single();

    if (result.error) {
      log.error(`Insert failed for ${tableName}`, result.error);
    }

    return result as { data: T | null; error: any };
  }

  /**
   * Helper method for updating data with organization scope verification
   */
  async updateWithOrgScope<T>(
    tableName: keyof Database['public']['Tables'],
    id: string,
    updates: Partial<Omit<T, 'organization_id' | 'id' | 'created_at' | 'updated_at'>>
  ): Promise<{ data: T | null; error: any }> {
    if (!this.currentSession?.claims.org_id) {
      return {
        data: null,
        error: new Error('No organization context available'),
      };
    }

    const client = this.getClient();
    const result = await (client as any)
      .from(tableName)
      .update(updates)
      .eq('id', id)
      .eq('organization_id', this.currentSession.claims.org_id) // Ensure org scope
      .select()
      .single();

    if (result.error) {
      log.error(`Update failed for ${tableName}`, result.error);
    }

    return result as { data: T | null; error: any };
  }

  /**
   * Helper method for deleting data with organization scope verification
   */
  async deleteWithOrgScope(
    tableName: keyof Database['public']['Tables'],
    id: string
  ): Promise<{ error: any }> {
    if (!this.currentSession?.claims.org_id) {
      return {
        error: new Error('No organization context available'),
      };
    }

    const client = this.getClient();
    const result = await client
      .from(tableName)
      .delete()
      .eq('id', id)
      .eq('organization_id', this.currentSession.claims.org_id); // Ensure org scope

    if (result.error) {
      log.error(`Delete failed for ${tableName}`, result.error);
    }

    return result;
  }

  /**
   * Real-time subscription helper
   */
  subscribeToChanges(
    tableName: keyof Database['public']['Tables'],
    callback: (payload: any) => void,
    filter?: { column: string; value: string }
  ) {
    if (!this.currentSession?.claims.org_id) {
      log.warn('Cannot subscribe without organization context');
      return null;
    }

    const channel = this.client
      .channel(`${tableName}-changes`)
      .on(
        'postgres_changes' as any,
        {
          event: '*',
          schema: 'public',
          table: tableName,
          filter: filter
            ? `${filter.column}=eq.${filter.value}`
            : `organization_id=eq.${this.currentSession.claims.org_id}`,
        },
        callback
      )
      .subscribe();

    return channel;
  }
}

export const supabaseService = new SupabaseService();