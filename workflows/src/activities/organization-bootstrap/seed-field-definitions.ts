/**
 * SeedFieldDefinitionsActivity
 *
 * Seeds client field definitions for a new organization from the
 * client_field_definition_templates table. Called during org bootstrap
 * after permissions are granted, before DNS configuration.
 *
 * Each template row becomes a client_field_definition.created event,
 * which the synchronous handler inserts into client_field_definitions_projection.
 *
 * Idempotency:
 * - Checks if field definitions already exist for this org
 * - If any exist, returns early (already seeded)
 * - ON CONFLICT in handler handles event replay
 *
 * Events Emitted:
 * - client_field_definition.created: One per template row (~66 fields)
 *
 * Compensation:
 * - deleteFieldDefinitions: Deactivates all field definitions for the org
 */

import { getSupabaseClient, getLogger } from '@shared/utils';
import type { WorkflowTracingParams } from '@shared/types';

const log = getLogger('SeedFieldDefinitions');

// Type definitions for tables not yet in generated Supabase types
interface FieldDefinitionTemplate {
  field_key: string;
  category_slug: string;
  display_name: string;
  field_type: string;
  is_visible: boolean;
  is_required: boolean;
  is_dimension: boolean;
  sort_order: number;
  configurable_label: string | null;
  conforming_dimension_mapping: string | null;
}

interface FieldCategory {
  id: string;
  slug: string;
}

export interface SeedFieldDefinitionsParams {
  orgId: string;
  tracing?: WorkflowTracingParams;
}

export interface SeedFieldDefinitionsResult {
  definitionsSeeded: number;
  alreadySeeded: boolean;
}

/**
 * Seed client field definitions from templates for a new organization.
 *
 * Reads client_field_definition_templates and client_field_categories,
 * then emits a client_field_definition.created event per template row.
 * The handler's ON CONFLICT ensures idempotency on replay.
 */
export async function seedFieldDefinitions(
  params: SeedFieldDefinitionsParams
): Promise<SeedFieldDefinitionsResult> {
  const { orgId, tracing } = params;
  const supabase = getSupabaseClient();

  log.info('Starting field definitions seed', { orgId });

  // Layer 2 Idempotency: Check if already seeded
  // Note: New tables not yet in generated Supabase types — cast through unknown
  /* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access */
  const { data: existing, error: checkError } = await (supabase as any)
    .from('client_field_definitions_projection')
    .select('id')
    .eq('organization_id', orgId)
    .limit(1) as { data: { id: string }[] | null; error: { message: string } | null };
  /* eslint-enable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access */

  if (checkError) {
    throw new Error(`Failed to check existing field definitions: ${checkError.message}`);
  }

  if (existing && existing.length > 0) {
    log.info('Field definitions already seeded, skipping', { orgId });
    return { definitionsSeeded: 0, alreadySeeded: true };
  }

  // Load templates
  /* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access */
  const { data: templates, error: templateError } = await (supabase as any)
    .from('client_field_definition_templates')
    .select('*')
    .eq('is_active', true)
    .order('category_slug')
    .order('sort_order') as { data: FieldDefinitionTemplate[] | null; error: { message: string } | null };
  /* eslint-enable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access */

  if (templateError) {
    throw new Error(`Failed to load field definition templates: ${templateError.message}`);
  }

  if (!templates || templates.length === 0) {
    log.warn('No field definition templates found', { orgId });
    return { definitionsSeeded: 0, alreadySeeded: false };
  }

  // Load system categories to resolve slug → id
  /* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access */
  const { data: categories, error: catError } = await (supabase as any)
    .from('client_field_categories')
    .select('id, slug')
    .is('organization_id', null) as { data: FieldCategory[] | null; error: { message: string } | null };
  /* eslint-enable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access */

  if (catError) {
    throw new Error(`Failed to load field categories: ${catError.message}`);
  }

  const categoryMap = new Map<string, string>();
  for (const cat of categories || []) {
    categoryMap.set(cat.slug, cat.id);
  }

  // Emit one event per template row
  let seededCount = 0;
  const correlationId = tracing?.correlationId || crypto.randomUUID();

  for (const tmpl of templates) {
    const categoryId = categoryMap.get(tmpl.category_slug);
    if (!categoryId) {
      log.warn('Unknown category slug in template, skipping', {
        fieldKey: tmpl.field_key,
        categorySlug: tmpl.category_slug
      });
      continue;
    }

    const fieldId = crypto.randomUUID();

    const { error: emitError } = await supabase
      .from('domain_events')
      .insert({
        stream_id: fieldId,
        stream_type: 'client_field_definition',
        stream_version: 1,
        event_type: 'client_field_definition.created',
        event_data: {
          field_id: fieldId,
          organization_id: orgId,
          category_id: categoryId,
          field_key: tmpl.field_key,
          display_name: tmpl.display_name,
          field_type: tmpl.field_type,
          is_visible: tmpl.is_visible,
          is_required: tmpl.is_required,
          is_dimension: tmpl.is_dimension,
          sort_order: tmpl.sort_order,
          configurable_label: tmpl.configurable_label,
          conforming_dimension_mapping: tmpl.conforming_dimension_mapping
        },
        event_metadata: {
          user_id: 'system',
          organization_id: orgId,
          reason: 'Organization bootstrap: seed field definitions from templates',
          correlation_id: correlationId,
          source: 'seedFieldDefinitions'
        }
      });

    if (emitError) {
      throw new Error(`Failed to emit field definition event for ${tmpl.field_key}: ${emitError.message}`);
    }

    seededCount++;
  }

  log.info('Field definitions seeded successfully', {
    orgId,
    definitionsSeeded: seededCount,
    correlationId
  });

  return { definitionsSeeded: seededCount, alreadySeeded: false };
}

/**
 * Compensation: Delete (deactivate) all field definitions for an org.
 * Used during Saga rollback if a later bootstrap step fails.
 */
export async function deleteFieldDefinitions(
  params: { orgId: string; tracing?: WorkflowTracingParams }
): Promise<void> {
  const logComp = getLogger('DeleteFieldDefinitions');

  logComp.info('Compensating: deactivating field definitions', { orgId: params.orgId });

  const supabase = getSupabaseClient();

  /* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access */
  const { error } = await (supabase as any)
    .from('client_field_definitions_projection')
    .update({ is_active: false, updated_at: new Date().toISOString() })
    .eq('organization_id', params.orgId) as { error: { message: string } | null };
  /* eslint-enable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access */

  if (error) {
    logComp.error('Failed to deactivate field definitions', {
      orgId: params.orgId,
      error: error.message
    });
    throw new Error(`Failed to deactivate field definitions: ${error.message}`);
  }

  logComp.info('Field definitions deactivated', { orgId: params.orgId });
}
