-- Phase 0: Fix 4 organization event handler bugs
--
-- Bug 1 (CRITICAL): handle_organization_deactivated sets deleted_at (should only deactivate)
--                    and doesn't populate deactivation_reason
-- Bug 2 (MAJOR):    handle_organization_reactivated doesn't clear deactivated_at/deactivation_reason
-- Bug 3 (CRITICAL): handle_organization_updated uses v3 column names (subdomain, organization_type)
--                    and is missing display_name, tax_number, phone_number, timezone
-- Bug 4 (MINOR):    handle_organization_deleted doesn't populate deletion_reason

-- =============================================================================
-- Bug 1: Fix handle_organization_deactivated
-- - Remove deleted_at assignment (deactivation ≠ deletion)
-- - Add deactivation_reason from event_data.deactivation_type (AsyncAPI field name)
-- - Use effective_date for deactivated_at timestamp (AsyncAPI field name)
-- =============================================================================
CREATE OR REPLACE FUNCTION public.handle_organization_deactivated(p_event record)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
BEGIN
  UPDATE organizations_projection SET
    is_active = false,
    deactivated_at = COALESCE(
      safe_jsonb_extract_timestamp(p_event.event_data, 'effective_date'),
      p_event.created_at
    ),
    deactivation_reason = safe_jsonb_extract_text(p_event.event_data, 'deactivation_type'),
    updated_at = p_event.created_at
  WHERE id = p_event.stream_id;
END;
$function$;

-- =============================================================================
-- Bug 2: Fix handle_organization_reactivated
-- - Clear deactivated_at and deactivation_reason on reactivation
-- =============================================================================
CREATE OR REPLACE FUNCTION public.handle_organization_reactivated(p_event record)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
BEGIN
  UPDATE organizations_projection SET
    is_active = true,
    deactivated_at = NULL,
    deactivation_reason = NULL,
    updated_at = p_event.created_at
  WHERE id = p_event.stream_id;
END;
$function$;

-- =============================================================================
-- Bug 3: Fix handle_organization_updated
-- - Rename subdomain -> slug (v3 -> v4 column name)
-- - Rename organization_type -> type (v3 -> v4 column name, remove enum cast)
-- - Add display_name, tax_number, phone_number, timezone fields
-- =============================================================================
CREATE OR REPLACE FUNCTION public.handle_organization_updated(p_event record)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
BEGIN
  UPDATE organizations_projection SET
    name = COALESCE(safe_jsonb_extract_text(p_event.event_data, 'name'), name),
    display_name = COALESCE(safe_jsonb_extract_text(p_event.event_data, 'display_name'), display_name),
    slug = COALESCE(safe_jsonb_extract_text(p_event.event_data, 'slug'), slug),
    type = COALESCE(safe_jsonb_extract_text(p_event.event_data, 'type'), type),
    tax_number = COALESCE(safe_jsonb_extract_text(p_event.event_data, 'tax_number'), tax_number),
    phone_number = COALESCE(safe_jsonb_extract_text(p_event.event_data, 'phone_number'), phone_number),
    timezone = COALESCE(safe_jsonb_extract_text(p_event.event_data, 'timezone'), timezone),
    subdomain_status = COALESCE(
      safe_jsonb_extract_text(p_event.event_data, 'subdomain_status'),
      subdomain_status
    ),
    metadata = CASE
      WHEN p_event.event_data ? 'metadata' THEN p_event.event_data->'metadata'
      ELSE metadata
    END,
    tags = CASE
      WHEN p_event.event_data ? 'tags' THEN
        COALESCE(
          ARRAY(SELECT jsonb_array_elements_text(p_event.event_data->'tags')),
          '{}'::TEXT[]
        )
      ELSE tags
    END,
    updated_at = p_event.created_at
  WHERE id = p_event.stream_id;
END;
$function$;

-- =============================================================================
-- Bug 4: Fix handle_organization_deleted
-- - Add deletion_reason from event_data.deletion_strategy (AsyncAPI field name)
-- - Use event_data.deleted_at if provided, fallback to p_event.created_at
-- =============================================================================
CREATE OR REPLACE FUNCTION public.handle_organization_deleted(p_event record)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
BEGIN
  UPDATE organizations_projection SET
    deleted_at = COALESCE(
      safe_jsonb_extract_timestamp(p_event.event_data, 'deleted_at'),
      p_event.created_at
    ),
    deletion_reason = safe_jsonb_extract_text(p_event.event_data, 'deletion_strategy'),
    is_active = false,
    updated_at = p_event.created_at
  WHERE id = p_event.stream_id;
END;
$function$;

-- =============================================================================
-- Data Remediation: Fix organizations incorrectly marked as deleted by Bug 1
-- Clear deleted_at on orgs that were deactivated but never actually deleted
-- (no organization.deleted event exists for that stream_id)
-- =============================================================================
UPDATE organizations_projection op
SET deleted_at = NULL
WHERE op.deactivated_at IS NOT NULL
  AND op.deleted_at IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM domain_events de
    WHERE de.stream_id = op.id
      AND de.event_type = 'organization.deleted'
  );
