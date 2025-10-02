import { supabaseService } from '@/services/auth/supabase.service';
import {
  Provider,
  CreateProviderRequest,
  UpdateProviderRequest,
  ProviderFilterOptions,
  SubProvider,
  ProviderType,
  SubscriptionTier,
  AuditLogEntry
} from '@/types/provider.types';
import { Logger } from '@/utils/logger';

const log = Logger.getLogger('api');

/**
 * Provider Management Service
 * Handles all provider-related database operations via Supabase
 */
class ProviderService {
  /**
   * Get all providers (admin only)
   */
  async getProviders(filter?: ProviderFilterOptions): Promise<Provider[]> {
    try {
      log.info('Fetching providers', { filter });

      const client = await supabaseService.getClient();
      let query = client.from('providers').select('*');

      // Apply filters
      if (filter) {
        if (filter.status) {
          query = query.eq('status', filter.status);
        }
        if (filter.type) {
          query = query.eq('type', filter.type);
        }
        if (filter.subscriptionTierId) {
          query = query.eq('subscription_tier_id', filter.subscriptionTierId);
        }
        if (filter.searchTerm) {
          query = query.or(`name.ilike.%${filter.searchTerm}%,primary_contact_email.ilike.%${filter.searchTerm}%`);
        }
        if (filter.createdAfter) {
          query = query.gte('created_at', filter.createdAfter.toISOString());
        }
        if (filter.createdBefore) {
          query = query.lte('created_at', filter.createdBefore.toISOString());
        }
      }

      query = query.order('created_at', { ascending: false });

      const { data, error } = await query;

      if (error) {
        log.error('Failed to fetch providers', error);
        throw error;
      }

      return data || [];
    } catch (error) {
      log.error('Error in getProviders', error);
      throw error;
    }
  }

  /**
   * Get a single provider by ID
   */
  async getProvider(id: string): Promise<Provider | null> {
    try {
      log.info('Fetching provider', { id });

      const client = await supabaseService.getClient();
      const { data, error } = await client
        .from('providers')
        .select('*')
        .eq('id', id)
        .single();

      if (error) {
        log.error('Failed to fetch provider', error);
        throw error;
      }

      return data;
    } catch (error) {
      log.error('Error in getProvider', error);
      throw error;
    }
  }

  /**
   * Create a new provider (without Zitadel integration for now)
   * Note: In production, this should be called after successful Zitadel org creation
   */
  async createProvider(request: CreateProviderRequest, zitadelOrgId: string): Promise<Provider> {
    try {
      log.info('Creating provider', { name: request.name, zitadelOrgId });

      const client = await supabaseService.getClient();

      const providerData = {
        id: zitadelOrgId, // Use Zitadel org ID as provider ID
        name: request.name,
        type: request.type,
        status: 'pending' as const, // Start as pending until admin accepts invitation
        primary_contact_name: request.primaryContactName,
        primary_contact_email: request.primaryContactEmail,
        primary_contact_phone: request.primaryContactPhone,
        primary_address: request.primaryAddress,
        billing_contact_name: request.billingContactName,
        billing_contact_email: request.billingContactEmail,
        billing_contact_phone: request.billingContactPhone,
        billing_address: request.billingAddress,
        tax_id: request.taxId,
        subscription_tier_id: request.subscriptionTierId,
        service_start_date: request.serviceStartDate,
        metadata: request.metadata || {},
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };

      const { data, error } = await (client as any)
        .from('providers')
        .insert(providerData)
        .select()
        .single();

      if (error) {
        log.error('Failed to create provider', error);
        throw error;
      }

      log.info('Provider created successfully', { id: (data as any)?.id });
      return data as Provider;
    } catch (error) {
      log.error('Error in createProvider', error);
      throw error;
    }
  }

  /**
   * Update a provider
   */
  async updateProvider(id: string, request: UpdateProviderRequest): Promise<Provider> {
    try {
      log.info('Updating provider', { id, request });

      const client = await supabaseService.getClient();

      const updateData: any = {
        ...request,
        updated_at: new Date().toISOString()
      };

      // Convert camelCase to snake_case for database
      const dbData: any = {};
      Object.keys(updateData).forEach(key => {
        const snakeKey = key.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
        dbData[snakeKey] = updateData[key];
      });

      const { data, error } = await (client as any)
        .from('providers')
        .update(dbData)
        .eq('id', id)
        .select()
        .single();

      if (error) {
        log.error('Failed to update provider', error);
        throw error;
      }

      log.info('Provider updated successfully', { id });
      return data as Provider;
    } catch (error) {
      log.error('Error in updateProvider', error);
      throw error;
    }
  }

  /**
   * Delete a provider (soft delete by setting status to inactive)
   */
  async deleteProvider(id: string): Promise<void> {
    try {
      log.info('Deleting provider (soft delete)', { id });

      await this.updateProvider(id, { status: 'inactive' });

      log.info('Provider deleted successfully', { id });
    } catch (error) {
      log.error('Error in deleteProvider', error);
      throw error;
    }
  }

  /**
   * Get sub-providers for a provider
   */
  async getSubProviders(providerId: string): Promise<SubProvider[]> {
    try {
      log.info('Fetching sub-providers', { providerId });

      const client = await supabaseService.getClient();
      const { data, error } = await client
        .from('sub_providers')
        .select('*')
        .eq('provider_id', providerId)
        .order('level')
        .order('name');

      if (error) {
        log.error('Failed to fetch sub-providers', error);
        throw error;
      }

      return data || [];
    } catch (error) {
      log.error('Error in getSubProviders', error);
      throw error;
    }
  }

  /**
   * Create a sub-provider
   */
  async createSubProvider(
    providerId: string,
    name: string,
    parentId?: string
  ): Promise<SubProvider> {
    try {
      log.info('Creating sub-provider', { providerId, name, parentId });

      const client = await supabaseService.getClient();

      // Determine level based on parent
      let level = 1;
      if (parentId) {
        const { data: parent } = await client
          .from('sub_providers')
          .select('level')
          .eq('id', parentId)
          .single();

        if (parent) {
          level = (parent as any).level + 1;
          if (level > 3) {
            throw new Error('Maximum sub-provider depth (3 levels) exceeded');
          }
        }
      }

      const { data, error } = await (client as any)
        .from('sub_providers')
        .insert({
          provider_id: providerId,
          parent_id: parentId,
          name,
          level,
          metadata: {},
          created_at: new Date().toISOString()
        })
        .select()
        .single();

      if (error) {
        log.error('Failed to create sub-provider', error);
        throw error;
      }

      log.info('Sub-provider created successfully', { id: (data as any)?.id });
      return data as SubProvider;
    } catch (error) {
      log.error('Error in createSubProvider', error);
      throw error;
    }
  }

  /**
   * Get provider types
   */
  async getProviderTypes(): Promise<ProviderType[]> {
    try {
      log.info('Fetching provider types');

      const client = await supabaseService.getClient();
      const { data, error } = await client
        .from('provider_types')
        .select('*')
        .eq('is_active', true)
        .order('display_order');

      if (error) {
        log.error('Failed to fetch provider types', error);
        throw error;
      }

      return data || [];
    } catch (error) {
      log.error('Error in getProviderTypes', error);
      throw error;
    }
  }

  /**
   * Get subscription tiers
   */
  async getSubscriptionTiers(): Promise<SubscriptionTier[]> {
    try {
      log.info('Fetching subscription tiers');

      const client = await supabaseService.getClient();
      const { data, error } = await client
        .from('subscription_tiers')
        .select('*')
        .eq('is_active', true)
        .order('price');

      if (error) {
        log.error('Failed to fetch subscription tiers', error);
        throw error;
      }

      return data || [];
    } catch (error) {
      log.error('Error in getSubscriptionTiers', error);
      throw error;
    }
  }

  /**
   * Get audit log for a provider
   */
  async getProviderAuditLog(providerId: string): Promise<AuditLogEntry[]> {
    try {
      log.info('Fetching provider audit log', { providerId });

      const client = await supabaseService.getClient();
      const { data, error } = await client
        .from('audit_log')
        .select('*')
        .eq('record_id', providerId)
        .eq('table_name', 'providers')
        .order('timestamp', { ascending: false })
        .limit(100);

      if (error) {
        log.error('Failed to fetch audit log', error);
        throw error;
      }

      return data || [];
    } catch (error) {
      log.error('Error in getProviderAuditLog', error);
      throw error;
    }
  }
}

export const providerService = new ProviderService();