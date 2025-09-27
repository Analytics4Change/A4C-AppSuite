import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { Logger } from '@/utils/logger';
import { zitadelService, ZitadelUser } from './zitadel.service';

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
  private currentUser: ZitadelUser | null = null;

  constructor() {
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
    const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

    if (!supabaseUrl || !supabaseAnonKey) {
      throw new Error('Supabase configuration missing. Check your environment variables.');
    }

    this.client = createClient<Database>(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: false, // We'll use Zitadel for session management
        autoRefreshToken: false, // Zitadel handles token refresh
      },
      global: {
        headers: {
          // We'll set the Authorization header dynamically based on Zitadel token
        },
      },
    });

    log.info('Supabase client initialized');
  }

  /**
   * Update the Supabase client with the current Zitadel access token
   * This should be called whenever the user logs in or the token is refreshed
   */
  async updateAuthToken(user: ZitadelUser | null): Promise<void> {
    this.currentUser = user;

    if (user?.accessToken) {
      // Set the Zitadel JWT as the auth token for Supabase
      this.client = createClient<Database>(
        import.meta.env.VITE_SUPABASE_URL,
        import.meta.env.VITE_SUPABASE_ANON_KEY,
        {
          auth: {
            persistSession: false,
            autoRefreshToken: false,
          },
          global: {
            headers: {
              Authorization: `Bearer ${user.accessToken}`,
              'X-Organization-Id': user.organizationId, // Pass org ID for RLS
            },
          },
        }
      );
      log.info('Supabase auth token updated');
    } else {
      // Reset to anonymous access
      this.client = createClient<Database>(
        import.meta.env.VITE_SUPABASE_URL,
        import.meta.env.VITE_SUPABASE_ANON_KEY,
        {
          auth: {
            persistSession: false,
            autoRefreshToken: false,
          },
        }
      );
      log.info('Supabase reset to anonymous access');
    }
  }

  /**
   * Get the Supabase client instance
   * Ensures the token is current before returning
   */
  async getClient(): Promise<SupabaseClient<Database>> {
    // Check if we need to refresh the token
    const currentZitadelUser = await zitadelService.getUser();

    if (currentZitadelUser?.accessToken !== this.currentUser?.accessToken) {
      await this.updateAuthToken(currentZitadelUser);
    }

    return this.client;
  }

  /**
   * Helper method for organization-scoped queries
   * Automatically adds organization_id filter based on current user
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
    if (!this.currentUser?.organizationId) {
      return {
        data: null,
        error: new Error('No organization context available'),
      };
    }

    const client = await this.getClient();
    let dbQuery = client.from(tableName).select(query?.select || '*');

    // Add organization filter
    dbQuery = dbQuery.eq('organization_id', this.currentUser.organizationId);

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
    if (!this.currentUser?.organizationId) {
      return {
        data: null,
        error: new Error('No organization context available'),
      };
    }

    const client = await this.getClient();
    const result = await client
      .from(tableName)
      .insert({
        ...data,
        organization_id: this.currentUser.organizationId,
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
    if (!this.currentUser?.organizationId) {
      return {
        data: null,
        error: new Error('No organization context available'),
      };
    }

    const client = await this.getClient();
    const result = await client
      .from(tableName)
      .update(updates as any)
      .eq('id', id)
      .eq('organization_id', this.currentUser.organizationId) // Ensure org scope
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
    if (!this.currentUser?.organizationId) {
      return {
        error: new Error('No organization context available'),
      };
    }

    const client = await this.getClient();
    const result = await client
      .from(tableName)
      .delete()
      .eq('id', id)
      .eq('organization_id', this.currentUser.organizationId); // Ensure org scope

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
    if (!this.currentUser?.organizationId) {
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
            : `organization_id=eq.${this.currentUser.organizationId}`,
        },
        callback
      )
      .subscribe();

    return channel;
  }
}

export const supabaseService = new SupabaseService();