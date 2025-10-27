import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { Logger } from '@/utils/logger';
import { Session } from '@/types/auth.types';

const log = Logger.getLogger('api');

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

class SupabaseService {
  private client: SupabaseClient<Database>;
  private currentSession: Session | null = null;

  constructor() {
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
    const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

    if (!supabaseUrl || !supabaseAnonKey) {
      throw new Error('Supabase configuration missing. Check your environment variables.');
    }

    this.client = createClient<Database>(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: false, // Session managed by auth providers
        autoRefreshToken: false, // Token refresh handled by auth providers
      },
      global: {
        headers: {
          // Headers will be set dynamically based on auth session
        },
      },
    });

    log.info('Supabase client initialized');
  }

  /**
   * Update the Supabase client with the current auth session
   * Works with both mock and real authentication sessions
   * This should be called whenever the user logs in or the session is refreshed
   */
  async updateAuthSession(session: Session | null): Promise<void> {
    this.currentSession = session;

    // Update headers for authenticated requests
    // Works with sessions from both DevAuthProvider and SupabaseAuthProvider
    if (session?.access_token) {
      (this.client as any).rest.headers = {
        ...((this.client as any).rest?.headers || {}),
        Authorization: `Bearer ${session.access_token}`,
        'X-Organization-Id': session.claims.org_id,
        'X-User-Role': session.claims.user_role,
      };

      // Also update the realtime headers if needed
      if ((this.client as any).realtime) {
        (this.client as any).realtime.headers = {
          ...((this.client as any).realtime?.headers || {}),
          Authorization: `Bearer ${session.access_token}`,
          'X-Organization-Id': session.claims.org_id,
        };
      }

      log.info('Supabase auth session updated', {
        user: session.user.email,
        org_id: session.claims.org_id,
        role: session.claims.user_role,
      });
    } else {
      // Reset to anonymous access
      (this.client as any).rest.headers = {
        ...((this.client as any).rest?.headers || {}),
        apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
      };

      delete (this.client as any).rest.headers.Authorization;
      delete (this.client as any).rest.headers['X-Organization-Id'];
      delete (this.client as any).rest.headers['X-User-Role'];

      log.info('Supabase reset to anonymous access');
    }
  }

  /**
   * Get the Supabase client instance
   */
  getClient(): SupabaseClient<Database> {
    return this.client;
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