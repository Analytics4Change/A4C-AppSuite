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
 * - Checks if field definitions already exist for this org via api.list_field_definitions
 * - If any exist, returns early (already seeded)
 * - ON CONFLICT in handler handles event replay
 *
 * Events Emitted:
 * - client_field_definition.created: One per template row (~67 fields)
 *
 * Compensation:
 * - deleteFieldDefinitions: Deactivates all field definitions for the org via api RPC
 *
 * IMPORTANT: All queries use api.* schema RPCs — direct .from() queries
 * against public schema tables are rejected by PostgREST (only api schema exposed).
 */

import { getSupabaseClient, getLogger } from '@shared/utils';
import { emitEvent } from '@shared/utils/emit-event';
import type { WorkflowTracingParams } from '@shared/types';

const log = getLogger('SeedFieldDefinitions');

// Type definitions for RPC return types
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
 * Reads templates and categories via api.* RPCs, then emits a
 * client_field_definition.created event per template row via emitEvent().
 * The handler's ON CONFLICT ensures idempotency on replay.
 */
export async function seedFieldDefinitions(
  params: SeedFieldDefinitionsParams
): Promise<SeedFieldDefinitionsResult> {
  const { orgId, tracing } = params;
  const supabase = getSupabaseClient();

  log.info('Starting field definitions seed', { orgId });

  // Layer 2 Idempotency: Check if already seeded via api.check_field_definitions_exist
  // Uses explicit p_org_id since service_role has no JWT org context
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
  const { data: alreadyExists, error: checkError } = await (supabase.schema('api') as any).rpc(
    'check_field_definitions_exist',
    { p_org_id: orgId }
  ) as { data: boolean | null; error: { message: string } | null };

  if (checkError) {
    throw new Error(`Failed to check existing field definitions: ${checkError.message}`);
  }

  if (alreadyExists) {
    log.info('Field definitions already seeded, skipping', { orgId });
    return { definitionsSeeded: 0, alreadySeeded: true };
  }

  // Load templates via api.list_field_definition_templates()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
  const { data: templates, error: templateError } = await (supabase.schema('api') as any).rpc(
    'list_field_definition_templates'
  ) as { data: FieldDefinitionTemplate[] | null; error: { message: string } | null };

  if (templateError) {
    throw new Error(`Failed to load field definition templates: ${templateError.message}`);
  }

  if (!templates || templates.length === 0) {
    log.warn('No field definition templates found', { orgId });
    return { definitionsSeeded: 0, alreadySeeded: false };
  }

  // Load system categories via api.list_system_field_categories()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
  const { data: categories, error: catError } = await (supabase.schema('api') as any).rpc(
    'list_system_field_categories'
  ) as { data: FieldCategory[] | null; error: { message: string } | null };

  if (catError) {
    throw new Error(`Failed to load field categories: ${catError.message}`);
  }

  const categoryMap = new Map<string, string>();
  for (const cat of categories || []) {
    categoryMap.set(cat.slug, cat.id);
  }

  // Emit one event per template row via emitEvent()
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

    await emitEvent({
      event_type: 'client_field_definition.created',
      aggregate_type: 'client_field_definition',
      aggregate_id: fieldId,
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
      correlation_id: correlationId,
      user_id: 'system',
      reason: 'Organization bootstrap: seed field definitions from templates'
    });

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
 * Compensation: Deactivate all field definitions for an org.
 * Used during Saga rollback if a later bootstrap step fails.
 * Uses api.deactivate_all_field_definitions() RPC.
 */
export async function deleteFieldDefinitions(
  params: { orgId: string; tracing?: WorkflowTracingParams }
): Promise<void> {
  const logComp = getLogger('DeleteFieldDefinitions');

  logComp.info('Compensating: deactivating field definitions', { orgId: params.orgId });

  const supabase = getSupabaseClient();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
  const { data: deactivatedCount, error } = await (supabase.schema('api') as any).rpc(
    'deactivate_all_field_definitions',
    { p_org_id: params.orgId }
  ) as { data: number | null; error: { message: string } | null };

  if (error) {
    logComp.error('Failed to deactivate field definitions', {
      orgId: params.orgId,
      error: error.message
    });
    throw new Error(`Failed to deactivate field definitions: ${error.message}`);
  }

  logComp.info('Field definitions deactivated', {
    orgId: params.orgId,
    count: deactivatedCount
  });
}
