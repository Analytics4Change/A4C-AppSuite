-- =============================================================================
-- Migration: Dynamic Bootstrap Progress Tracking
--
-- Replaces hardcoded stage lists in the Edge Function and database RPC with a
-- CTE-based step manifest. The workflow emits organization.bootstrap.step_completed
-- events to the org stream, and the RPC reads them to build a stages JSONB array.
--
-- Changes:
--   1. Router CASE: no-op for organization.bootstrap.step_completed
--   2. Rewrite public.get_bootstrap_status() with CTE manifest + stages JSONB
--   3. Rewrite api.get_bootstrap_status() with updated RETURNS TABLE signature
--   4. Seed organization.bootstrap.step_completed in event_types
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Router: Add no-op CASE for organization.bootstrap.step_completed
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.process_organization_event(p_event record)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
BEGIN
  CASE p_event.event_type
    WHEN 'organization.created' THEN PERFORM handle_organization_created(p_event);
    WHEN 'organization.updated' THEN PERFORM handle_organization_updated(p_event);
    WHEN 'organization.subdomain_status.changed' THEN PERFORM handle_organization_subdomain_status_changed(p_event);
    WHEN 'organization.activated' THEN PERFORM handle_organization_activated(p_event);
    WHEN 'organization.deactivated' THEN PERFORM handle_organization_deactivated(p_event);
    WHEN 'organization.reactivated' THEN PERFORM handle_organization_reactivated(p_event);
    WHEN 'organization.deleted' THEN PERFORM handle_organization_deleted(p_event);
    WHEN 'organization.subdomain.verified' THEN PERFORM handle_organization_subdomain_verified(p_event);
    WHEN 'organization.subdomain.dns_created' THEN PERFORM handle_organization_subdomain_dns_created(p_event);
    WHEN 'organization.subdomain.failed' THEN PERFORM handle_organization_subdomain_failed(p_event);
    WHEN 'organization.direct_care_settings_updated' THEN PERFORM handle_organization_direct_care_settings_updated(p_event);
    WHEN 'organization.bootstrap.initiated' THEN NULL;
    WHEN 'organization.bootstrap.completed' THEN PERFORM handle_bootstrap_completed(p_event);
    WHEN 'organization.bootstrap.failed' THEN PERFORM handle_bootstrap_failed(p_event);
    WHEN 'organization.bootstrap.cancelled' THEN PERFORM handle_bootstrap_cancelled(p_event);
    WHEN 'organization.bootstrap.step_completed' THEN
      NULL;  -- Progress tracking event, queried at read time by get_bootstrap_status()
    -- Deletion workflow events (no projection update needed)
    WHEN 'organization.deletion.initiated' THEN NULL; -- Temporal workflow tracking
    WHEN 'organization.deletion.completed' THEN NULL; -- org already marked deleted by organization.deleted
    -- Forwarding CASE: invitation.resent events were emitted with stream_type='organization'
    -- by invite-user Edge Function (pre-v15). Forward to the correct handler.
    WHEN 'invitation.resent' THEN PERFORM handle_invitation_resent(p_event);
    -- Forwarding CASE: invitation.email.sent events emitted with stream_type='organization'
    -- by Temporal activities. Informational only, no projection needed.
    WHEN 'invitation.email.sent' THEN NULL;
    ELSE
      RAISE EXCEPTION 'Unhandled event type "%" in process_organization_event', p_event.event_type
        USING ERRCODE = 'P9001';
  END CASE;
END;
$function$;

-- -----------------------------------------------------------------------------
-- 2. Rewrite public.get_bootstrap_status() — CTE manifest + stages JSONB
-- -----------------------------------------------------------------------------

-- DROP first because RETURNS TABLE signature is changing (adding stages JSONB)
DROP FUNCTION IF EXISTS public.get_bootstrap_status(uuid);

CREATE OR REPLACE FUNCTION public.get_bootstrap_status(p_organization_id uuid)
RETURNS TABLE(
  bootstrap_id uuid,
  organization_id uuid,
  status text,
  current_stage text,
  stages jsonb,
  error_message text,
  created_at timestamptz,
  completed_at timestamptz,
  domain text,
  dns_configured boolean,
  invitations_sent integer
)
LANGUAGE plpgsql STABLE
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $$
BEGIN
  RETURN QUERY
  WITH
  -- Step manifest: single source of truth for bootstrap workflow steps.
  -- Must be synchronized with: frontend/src/constants/bootstrap-steps.ts
  step_manifest(step_order, step_key, display_name, is_conditional) AS (
    VALUES
      (1, 'create_organization',    'Create Organization',      false),
      (2, 'grant_permissions',      'Grant Admin Permissions',   false),
      (3, 'seed_field_definitions', 'Seed Field Definitions',    false),
      (4, 'configure_dns',         'Configure DNS',             true),
      (5, 'generate_invitations',  'Generate Invitations',      false),
      (6, 'send_invitation_emails','Send Invitation Emails',    false),
      (7, 'activate_organization', 'Activate Organization',     false)
  ),
  org_events AS (
    SELECT DISTINCT de.event_type
    FROM domain_events de
    WHERE de.stream_id = p_organization_id
  ),
  completed_steps AS (
    -- Steps completed via explicit progress events (new workflow versions)
    SELECT (de.event_data->>'step_key')::text AS step_key,
           MIN(de.created_at) AS completed_at
    FROM domain_events de
    WHERE de.stream_id = p_organization_id
      AND de.event_type = 'organization.bootstrap.step_completed'
    GROUP BY de.event_data->>'step_key'
  ),
  has_step_events AS (
    SELECT COUNT(*) > 0 AS has_events FROM completed_steps
  ),
  -- Determine if DNS step should be shown (conditional step — m4)
  has_dns AS (
    SELECT EXISTS (
      SELECT 1 FROM org_events WHERE event_type = 'organization.subdomain.dns_created'
    ) OR EXISTS (
      SELECT 1 FROM completed_steps WHERE step_key = 'configure_dns'
    ) AS show_dns
  ),
  -- Build the filtered step manifest (exclude conditional steps when not applicable)
  filtered_manifest AS (
    SELECT sm.*
    FROM step_manifest sm, has_dns
    WHERE NOT sm.is_conditional OR has_dns.show_dns
  ),
  -- Build stages JSONB array
  -- Legacy orgs (pre-step_completed events) show status='completed' with empty stages.
  -- This is acceptable: status page is only visible during active bootstrap.
  stage_array AS (
    SELECT CASE
      WHEN hse.has_events THEN
        jsonb_agg(
          jsonb_build_object(
            'name', fm.display_name,
            'key', fm.step_key,
            'status', CASE
              WHEN cs.step_key IS NOT NULL THEN 'completed'
              WHEN fm.step_order = (
                SELECT MIN(fm2.step_order)
                FROM filtered_manifest fm2
                LEFT JOIN completed_steps cs2 ON cs2.step_key = fm2.step_key
                WHERE cs2.step_key IS NULL
              ) THEN 'in_progress'
              ELSE 'pending'
            END
          ) ORDER BY fm.step_order
        )
      ELSE '[]'::jsonb
    END AS stages
    FROM filtered_manifest fm
    CROSS JOIN has_step_events hse
    LEFT JOIN completed_steps cs ON cs.step_key = fm.step_key
    GROUP BY hse.has_events
  ),
  first_event AS (
    SELECT MIN(de.created_at) AS ts
    FROM domain_events de
    WHERE de.stream_id = p_organization_id
  ),
  completion_event AS (
    SELECT de.created_at AS ts, de.event_data->>'error_message' AS error_msg
    FROM domain_events de
    WHERE de.stream_id = p_organization_id
      AND de.event_type IN ('organization.bootstrap.completed', 'organization.bootstrap.failed', 'organization.activated')
    ORDER BY de.created_at DESC
    LIMIT 1
  ),
  dns_event AS (
    SELECT COALESCE(de.event_data->>'full_subdomain', de.event_data->>'fqdn') AS fqdn
    FROM domain_events de
    WHERE de.stream_id = p_organization_id
      AND de.event_type = 'organization.subdomain.dns_created'
    LIMIT 1
  ),
  invitation_count AS (
    SELECT COUNT(*)::INTEGER AS cnt
    FROM domain_events de
    WHERE de.stream_id = p_organization_id
      AND de.event_type = 'invitation.email.sent'
  )
  SELECT
    p_organization_id AS bootstrap_id,
    p_organization_id AS organization_id,
    -- Determine overall status (same logic as before)
    CASE
      WHEN EXISTS (SELECT 1 FROM org_events WHERE event_type = 'organization.activated') THEN 'completed'
      WHEN EXISTS (SELECT 1 FROM org_events WHERE event_type = 'organization.bootstrap.completed') THEN 'completed'
      WHEN EXISTS (SELECT 1 FROM org_events WHERE event_type = 'organization.bootstrap.failed') THEN 'failed'
      WHEN EXISTS (SELECT 1 FROM org_events WHERE event_type = 'organization.bootstrap.cancelled') THEN 'cancelled'
      WHEN EXISTS (SELECT 1 FROM org_events) THEN 'running'
      ELSE 'unknown'
    END::TEXT,
    -- current_stage: highest completed step key (backward compat)
    COALESCE(
      (SELECT cs.step_key FROM completed_steps cs
       JOIN step_manifest sm ON sm.step_key = cs.step_key
       ORDER BY sm.step_order DESC LIMIT 1),
      -- Legacy fallback: derive from old event types
      CASE
        WHEN EXISTS (SELECT 1 FROM org_events WHERE event_type = 'organization.activated') THEN 'completed'
        WHEN EXISTS (SELECT 1 FROM org_events WHERE event_type = 'organization.bootstrap.completed') THEN 'completed'
        WHEN EXISTS (SELECT 1 FROM org_events WHERE event_type = 'organization.subdomain.verified') THEN 'dns_verification'
        WHEN EXISTS (SELECT 1 FROM org_events WHERE event_type = 'organization.subdomain.dns_created') THEN 'dns_provisioning'
        WHEN EXISTS (SELECT 1 FROM org_events WHERE event_type = 'organization.created') THEN 'organization_creation'
        WHEN EXISTS (SELECT 1 FROM org_events WHERE event_type LIKE 'organization.bootstrap.%') THEN 'temporal_workflow_started'
        ELSE 'temporal_workflow_started'
      END
    )::TEXT,
    -- stages JSONB array (new)
    COALESCE(sa.stages, '[]'::jsonb),
    ce.error_msg::TEXT,
    fe.ts,
    CASE
      WHEN EXISTS (SELECT 1 FROM org_events WHERE event_type IN ('organization.activated', 'organization.bootstrap.completed')) THEN ce.ts
      ELSE NULL
    END,
    dns.fqdn::TEXT,
    EXISTS (SELECT 1 FROM org_events WHERE event_type = 'organization.subdomain.dns_created'),
    COALESCE(ic.cnt, 0)
  FROM first_event fe
  LEFT JOIN completion_event ce ON TRUE
  LEFT JOIN dns_event dns ON TRUE
  LEFT JOIN invitation_count ic ON TRUE
  LEFT JOIN stage_array sa ON TRUE
  WHERE fe.ts IS NOT NULL;
END;
$$;

-- -----------------------------------------------------------------------------
-- 3. Rewrite api.get_bootstrap_status() — updated RETURNS TABLE with stages
-- -----------------------------------------------------------------------------

-- DROP first because RETURNS TABLE signature is changing
DROP FUNCTION IF EXISTS api.get_bootstrap_status(uuid);

CREATE OR REPLACE FUNCTION api.get_bootstrap_status(p_bootstrap_id uuid)
RETURNS TABLE(
  bootstrap_id uuid,
  organization_id uuid,
  status text,
  current_stage text,
  stages jsonb,
  error_message text,
  created_at timestamptz,
  completed_at timestamptz,
  domain text,
  dns_configured boolean,
  invitations_sent integer
)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_user_id UUID;
BEGIN
  -- Get current user from JWT
  v_user_id := auth.uid();

  -- Allow access if:
  -- 1. User has platform.admin permission (platform-wide access)
  -- 2. User has a role in the organization being queried
  -- 3. User initiated the bootstrap (found in event metadata)
  IF v_user_id IS NOT NULL THEN
    IF NOT (
      -- Tier 1: Platform admin can view any organization
      public.has_platform_privilege()
      OR
      -- Tier 3: User has role in the organization being queried
      EXISTS (
        SELECT 1 FROM user_roles_projection
        WHERE user_id = v_user_id
          AND org_id = p_bootstrap_id
      )
      OR
      -- User initiated the bootstrap (check event metadata)
      EXISTS (
        SELECT 1 FROM domain_events
        WHERE stream_id = p_bootstrap_id
          AND event_type = 'organization.bootstrap.initiated'
          AND event_metadata->>'user_id' = v_user_id::TEXT
      )
    ) THEN
      -- Not authorized - return empty result (consistent with "not found" behavior)
      RETURN;
    END IF;
  END IF;

  -- The p_bootstrap_id is now the organization_id (unified ID system)
  RETURN QUERY
  SELECT * FROM public.get_bootstrap_status(p_bootstrap_id);
END;
$$;

ALTER FUNCTION api.get_bootstrap_status(uuid) OWNER TO postgres;

COMMENT ON FUNCTION api.get_bootstrap_status(uuid) IS 'Get bootstrap workflow status for an organization.
Authorization:
- Platform admins (has_platform_privilege) can view any org
- Users with roles in the org can view
- Users who initiated the bootstrap can view';

GRANT EXECUTE ON FUNCTION api.get_bootstrap_status(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION api.get_bootstrap_status(uuid) TO service_role;

-- -----------------------------------------------------------------------------
-- 4. Seed organization.bootstrap.step_completed in event_types
-- -----------------------------------------------------------------------------

INSERT INTO event_types (event_type, stream_type, description, category)
VALUES (
  'organization.bootstrap.step_completed',
  'organization',
  'A bootstrap workflow step completed successfully (progress tracking)',
  'bootstrap'
)
ON CONFLICT (event_type) DO NOTHING;
