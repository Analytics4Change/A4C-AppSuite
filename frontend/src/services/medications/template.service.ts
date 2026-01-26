/**
 * Medication Template Service
 * Manages creation and usage of medication templates
 */

import {
  MedicationTemplate,
  CreateTemplateRequest,
  TemplateFilterOptions,
  TemplateStats,
  ApplyTemplateResult
} from '@/types/medication-template.types';
import { MedicationHistory, DosageInfo } from '@/types/models/Medication';
import { supabaseService } from '@/services/auth/supabase.service';
import { Logger } from '@/utils/logger';

const log = Logger.getLogger('api');

interface DecodedJWTClaims {
  org_id?: string;
  sub?: string;
}

class MedicationTemplateService {
  private static instance: MedicationTemplateService;

  private constructor() {}

  /**
   * Decode JWT token to extract claims
   * Uses same approach as SupabaseAuthProvider.decodeJWT()
   */
  private decodeJWT(token: string): DecodedJWTClaims {
    try {
      const payload = token.split('.')[1];
      const decoded = JSON.parse(globalThis.atob(payload));
      return {
        org_id: decoded.org_id,
        sub: decoded.sub,
      };
    } catch {
      return {};
    }
  }

  static getInstance(): MedicationTemplateService {
    if (!MedicationTemplateService.instance) {
      MedicationTemplateService.instance = new MedicationTemplateService();
    }
    return MedicationTemplateService.instance;
  }

  /**
   * Create a template from an existing medication
   */
  async createTemplate(request: CreateTemplateRequest): Promise<MedicationTemplate> {
    try {
      log.info('Creating medication template', {
        medicationId: request.medicationId,
        templateName: request.templateName
      });

      // Get the source medication
      const sourceMedication = await this.getSourceMedication(request.medicationId);
      if (!sourceMedication) {
        throw new Error('Source medication not found');
      }

      // Get session from Supabase client (already authenticated)
      const client = supabaseService.getClient();
      const { data: { session } } = await client.auth.getSession();
      if (!session) {
        log.error('No authenticated session for createTemplate');
        throw new Error('User organization context required');
      }

      // Decode JWT to get org_id and user_id
      const claims = this.decodeJWT(session.access_token);
      if (!claims.org_id || !claims.sub) {
        log.error('No organization context for createTemplate');
        throw new Error('User organization context required');
      }

      // Extract client initials if requested
      let clientInitials: string | undefined;
      if (request.includeClientInitials) {
        clientInitials = await this.getClientInitials(sourceMedication.id);
      }

      // Create template object (stripping PII)
      const template: Omit<MedicationTemplate, 'id'> = {
        organizationId: claims.org_id,
        name: request.templateName,

        // Preserve medication info
        medicationName: sourceMedication.medication.name,
        genericName: sourceMedication.medication.genericName,
        brandName: sourceMedication.medication.brandNames?.[0],
        categories: sourceMedication.medication.categories,
        flags: sourceMedication.medication.flags,

        // Preserve dosage configuration
        form: sourceMedication.dosageInfo.form,
        route: sourceMedication.dosageInfo.route,
        strength: this.extractStrength(sourceMedication.dosageInfo),
        frequency: sourceMedication.dosageInfo.frequency,
        timings: sourceMedication.dosageInfo.timings,
        foodConditions: sourceMedication.dosageInfo.foodConditions,
        specialRestrictions: sourceMedication.dosageInfo.specialRestrictions,

        // Explicitly null fields
        pharmacyInfo: null,
        dosageAmount: null,
        startDate: null,
        discontinueDate: null,
        prescriber: null,
        clientId: null,

        // Metadata
        sourceClientInitials: clientInitials,
        createdBy: claims.sub,
        createdAt: new Date(),
        updatedAt: new Date(),
        usageCount: 0,
        tags: request.tags,
        notes: request.notes,
        isActive: true
      };

      // Save to database
      const { data, error } = await (client as any)
        .from('medication_templates')
        .insert(template)
        .select()
        .single();

      if (error) {
        log.error('Failed to create template', error);
        throw error;
      }

      log.info('Template created successfully', { templateId: data.id });
      return data as MedicationTemplate;
    } catch (error) {
      log.error('Error creating medication template', error);
      throw error;
    }
  }

  /**
   * Get templates for the organization
   */
  async getTemplates(options?: TemplateFilterOptions): Promise<MedicationTemplate[]> {
    try {
      const client = supabaseService.getClient();

      // Get session from Supabase client (already authenticated)
      const { data: { session } } = await client.auth.getSession();
      if (!session) {
        log.error('No authenticated session for getTemplates');
        throw new Error('User organization context required');
      }

      // Decode JWT to get org_id
      const claims = this.decodeJWT(session.access_token);
      if (!claims.org_id) {
        log.error('No organization context for getTemplates');
        throw new Error('User organization context required');
      }

      let query = (client as any)
        .from('medication_templates')
        .select('*')
        .eq('organization_id', claims.org_id);

      // Apply filters
      if (options?.searchTerm) {
        query = query.or(
          `name.ilike.%${options.searchTerm}%,medication_name.ilike.%${options.searchTerm}%`
        );
      }

      if (options?.isActive !== undefined) {
        query = query.eq('is_active', options.isActive);
      }

      if (options?.tags && options.tags.length > 0) {
        query = query.contains('tags', options.tags);
      }

      // Apply sorting
      const sortBy = options?.sortBy || 'name';
      const sortOrder = options?.sortOrder || 'asc';

      switch (sortBy) {
        case 'usageCount':
          query = query.order('usage_count', { ascending: sortOrder === 'asc' });
          break;
        case 'lastUsed':
          query = query.order('last_used_at', { ascending: sortOrder === 'asc' });
          break;
        case 'created':
          query = query.order('created_at', { ascending: sortOrder === 'asc' });
          break;
        default:
          query = query.order('name', { ascending: sortOrder === 'asc' });
      }

      // Apply pagination
      if (options?.limit) {
        query = query.limit(options.limit);
      }
      if (options?.offset) {
        query = query.range(options.offset, options.offset + (options.limit || 10) - 1);
      }

      const { data, error } = await query;

      if (error) {
        log.error('Failed to get templates', error);
        throw error;
      }

      return data as MedicationTemplate[];
    } catch (error) {
      log.error('Error getting templates', error);
      throw error;
    }
  }

  /**
   * Get a single template by ID
   */
  async getTemplate(templateId: string): Promise<MedicationTemplate | null> {
    try {
      const client = await supabaseService.getClient();
      const { data, error } = await (client as any)
        .from('medication_templates')
        .select('*')
        .eq('id', templateId)
        .single();

      if (error) {
        if (error.code === 'PGRST116') {
          return null; // Not found
        }
        throw error;
      }

      return data as MedicationTemplate;
    } catch (error) {
      log.error('Error getting template', error);
      throw error;
    }
  }

  /**
   * Apply a template to create medication data
   */
  async applyTemplate(templateId: string): Promise<ApplyTemplateResult> {
    try {
      const template = await this.getTemplate(templateId);
      if (!template) {
        throw new Error('Template not found');
      }

      // Update usage statistics
      await this.updateUsageStats(templateId);

      // Return pre-filled data and required fields
      return {
        // Pre-filled from template
        medicationName: template.medicationName,
        genericName: template.genericName,
        brandName: template.brandName,
        categories: template.categories,
        flags: template.flags,
        form: template.form,
        route: template.route,
        strength: template.strength,
        frequency: template.frequency,
        timings: template.timings,
        foodConditions: template.foodConditions,
        specialRestrictions: template.specialRestrictions,

        // Fields that user needs to fill
        requiredFields: [
          {
            field: 'clientId',
            label: 'Client',
            type: 'select',
            required: true
          },
          {
            field: 'dosageAmount',
            label: 'Dosage Amount',
            type: 'number',
            required: true
          },
          {
            field: 'startDate',
            label: 'Start Date',
            type: 'date',
            required: true
          },
          {
            field: 'prescriber',
            label: 'Prescribing Doctor',
            type: 'text',
            required: true
          },
          {
            field: 'pharmacyName',
            label: 'Pharmacy Name',
            type: 'text',
            required: false
          },
          {
            field: 'pharmacyPhone',
            label: 'Pharmacy Phone',
            type: 'text',
            required: false
          }
        ]
      };
    } catch (error) {
      log.error('Error applying template', error);
      throw error;
    }
  }

  /**
   * Update template
   */
  async updateTemplate(
    templateId: string,
    updates: Partial<MedicationTemplate>
  ): Promise<MedicationTemplate> {
    try {
      const client = await supabaseService.getClient();

      // Don't allow updating certain fields
      delete updates.id;
      delete updates.organizationId;
      delete updates.createdBy;
      delete updates.createdAt;
      delete updates.usageCount;

      updates.updatedAt = new Date();

      const { data, error } = await (client as any)
        .from('medication_templates')
        .update(updates)
        .eq('id', templateId)
        .select()
        .single();

      if (error) {
        log.error('Failed to update template', error);
        throw error;
      }

      return data as MedicationTemplate;
    } catch (error) {
      log.error('Error updating template', error);
      throw error;
    }
  }

  /**
   * Delete (soft) a template
   */
  async deleteTemplate(templateId: string): Promise<void> {
    try {
      await this.updateTemplate(templateId, { isActive: false });
      log.info('Template deactivated', { templateId });
    } catch (error) {
      log.error('Error deleting template', error);
      throw error;
    }
  }

  /**
   * Get template statistics for the organization
   */
  async getTemplateStats(): Promise<TemplateStats> {
    try {
      const client = supabaseService.getClient();

      // Get session from Supabase client (already authenticated)
      const { data: { session } } = await client.auth.getSession();
      if (!session) {
        log.error('No authenticated session for getTemplateStats');
        throw new Error('User organization context required');
      }

      // Decode JWT to get org_id
      const claims = this.decodeJWT(session.access_token);
      if (!claims.org_id) {
        log.error('No organization context for getTemplateStats');
        throw new Error('User organization context required');
      }

      // Get all templates for stats
      const { data: templates, error } = await (client as any)
        .from('medication_templates')
        .select('*')
        .eq('organization_id', claims.org_id);

      if (error) {
        throw error;
      }

      // Calculate statistics
      const totalTemplates = templates.length;
      const activeTemplates = templates.filter((t: MedicationTemplate) => t.isActive).length;

      // Most used templates
      const mostUsedTemplates = templates
        .sort((a: MedicationTemplate, b: MedicationTemplate) => b.usageCount - a.usageCount)
        .slice(0, 5)
        .map((t: MedicationTemplate) => ({
          templateId: t.id,
          name: t.name,
          usageCount: t.usageCount
        }));

      // Recently used templates
      const recentlyUsedTemplates = templates
        .filter((t: MedicationTemplate) => t.lastUsedAt)
        .sort((a: MedicationTemplate, b: MedicationTemplate) =>
          new Date(b.lastUsedAt!).getTime() - new Date(a.lastUsedAt!).getTime()
        )
        .slice(0, 5)
        .map((t: MedicationTemplate) => ({
          templateId: t.id,
          name: t.name,
          lastUsedAt: t.lastUsedAt!
        }));

      // Category counts
      const categoryCounts: Record<string, number> = {};
      templates.forEach((t: MedicationTemplate) => {
        const category = t.categories.broad;
        categoryCounts[category] = (categoryCounts[category] || 0) + 1;
      });

      return {
        totalTemplates,
        activeTemplates,
        mostUsedTemplates,
        recentlyUsedTemplates,
        categoryCounts
      };
    } catch (error) {
      log.error('Error getting template stats', error);
      throw error;
    }
  }

  /**
   * Update usage statistics for a template
   */
  private async updateUsageStats(templateId: string): Promise<void> {
    try {
      const client = await supabaseService.getClient();

      // Increment usage count and update last used date
      const { error } = await (client as any)
        .from('medication_templates')
        .update({
          usage_count: (client as any).raw('usage_count + 1'),
          last_used_at: new Date().toISOString()
        })
        .eq('id', templateId);

      if (error) {
        log.warn('Failed to update usage stats', error);
        // Don't throw - this is not critical
      }
    } catch (error) {
      log.warn('Error updating usage stats', error);
    }
  }

  /**
   * Get source medication details
   */
  private async getSourceMedication(_medicationId: string): Promise<MedicationHistory | null> {
    // This would fetch from the actual medication records
    // For now, returning null as we don't have the full medication service yet
    log.warn('getSourceMedication not fully implemented');
    return null;
  }

  /**
   * Get client initials from medication
   */
  private async getClientInitials(_medicationId: string): Promise<string | undefined> {
    // This would fetch client initials from the medication's client
    // For now, returning undefined
    log.warn('getClientInitials not fully implemented');
    return undefined;
  }

  /**
   * Extract strength from dosage info
   */
  private extractStrength(dosageInfo: DosageInfo): string | undefined {
    if (dosageInfo.amount && dosageInfo.unit) {
      return `${dosageInfo.amount}${dosageInfo.unit}`;
    }
    return undefined;
  }
}

// Export singleton instance
export const medicationTemplateService = MedicationTemplateService.getInstance();