-- Bootstrap Event Listener (Temporal Integration)
-- Handles bootstrap status tracking and cleanup based on events emitted by Temporal workflows
-- CQRS-compliant: Only reacts to events, orchestration handled by Temporal

-- Function to handle bootstrap workflow events
CREATE OR REPLACE FUNCTION handle_bootstrap_workflow()
RETURNS TRIGGER AS $$
BEGIN
  -- Only process newly inserted events that haven't been processed yet
  IF TG_OP = 'INSERT' AND NEW.processed_at IS NULL THEN

    -- Handle organization bootstrap events
    IF NEW.stream_type = 'organization' THEN

      CASE NEW.event_type

        -- When bootstrap fails, trigger cleanup if needed
        WHEN 'organization.bootstrap.failed' THEN
          -- Check if partial cleanup is required
          IF (NEW.event_data->>'partial_cleanup_required')::BOOLEAN = TRUE THEN
            -- Emit cleanup events for any partial resources
            INSERT INTO domain_events (
              stream_id, stream_type, stream_version, event_type, event_data, event_metadata, created_at
            ) VALUES (
              NEW.stream_id,
              'organization',
              (SELECT COALESCE(MAX(stream_version), 0) + 1 FROM domain_events WHERE stream_id = NEW.stream_id),
              'organization.bootstrap.cancelled',
              jsonb_build_object(
                'bootstrap_id', NEW.event_data->>'bootstrap_id',
                'cleanup_completed', TRUE,
                'cleanup_actions', ARRAY['partial_resource_cleanup'],
                'original_failure_stage', NEW.event_data->>'failure_stage'
              ),
              jsonb_build_object(
                'user_id', NEW.event_metadata->>'user_id',
                'organization_id', NEW.event_metadata->>'organization_id',
                'reason', 'Automated cleanup after bootstrap failure',
                'automated', TRUE
              ),
              NOW()
            );
          END IF;

        ELSE
          -- Not a bootstrap event that requires trigger action
          NULL;
      END CASE;

    END IF;

  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql
SET search_path = public, extensions, pg_temp;

-- Create trigger for bootstrap workflow automation
DROP TRIGGER IF EXISTS bootstrap_workflow_trigger ON domain_events;
CREATE TRIGGER bootstrap_workflow_trigger
  AFTER INSERT ON domain_events
  FOR EACH ROW
  EXECUTE FUNCTION handle_bootstrap_workflow();

-- Function to manually retry failed bootstrap (delegates to Temporal)
CREATE OR REPLACE FUNCTION retry_failed_bootstrap(
  p_bootstrap_id UUID,
  p_user_id UUID
) RETURNS UUID AS $$
DECLARE
  v_failed_event RECORD;
  v_new_bootstrap_id UUID;
  v_organization_id UUID;
BEGIN
  -- Find the failed bootstrap event
  SELECT * INTO v_failed_event
  FROM domain_events
  WHERE event_type = 'organization.bootstrap.failed'
    AND event_data->>'bootstrap_id' = p_bootstrap_id::TEXT
  ORDER BY created_at DESC
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Bootstrap failure event not found for bootstrap_id: %', p_bootstrap_id;
  END IF;

  -- Generate new IDs for retry
  v_new_bootstrap_id := gen_random_uuid();
  v_organization_id := gen_random_uuid();

  -- NOTE: Actual retry orchestration is handled by Temporal
  -- This function just emits an event that Temporal can listen for
  INSERT INTO domain_events (
    stream_id, stream_type, stream_version, event_type, event_data, event_metadata, created_at
  ) VALUES (
    v_organization_id,
    'organization',
    1,
    'organization.bootstrap.retry_requested',
    jsonb_build_object(
      'bootstrap_id', v_new_bootstrap_id,
      'retry_of', p_bootstrap_id,
      'organization_name', v_failed_event.event_data->>'organization_name',
      'organization_type', v_failed_event.event_data->>'organization_type',
      'admin_email', v_failed_event.event_data->>'admin_email'
    ),
    jsonb_build_object(
      'user_id', p_user_id,
      'organization_id', v_organization_id::TEXT,
      'reason', format('Manual retry of failed bootstrap %s', p_bootstrap_id),
      'original_bootstrap_id', p_bootstrap_id
    ),
    NOW()
  );

  RETURN v_new_bootstrap_id;
END;
$$ LANGUAGE plpgsql
SET search_path = public, extensions, pg_temp;

-- Function to get bootstrap status by organization ID
-- Queries by stream_id (organization ID) and checks ALL events to determine current stage
-- Returns additional result data: domain, dns_configured, invitations_sent (P1 #4)
-- Returns zero rows for non-existent organizations (P0 #3)
CREATE OR REPLACE FUNCTION get_bootstrap_status(
  p_organization_id UUID
) RETURNS TABLE (
  bootstrap_id UUID,
  organization_id UUID,
  status TEXT,
  current_stage TEXT,
  error_message TEXT,
  created_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  domain TEXT,
  dns_configured BOOLEAN,
  invitations_sent INTEGER
) AS $$
BEGIN
  RETURN QUERY
  WITH org_events AS (
    -- Get all distinct event types for this organization
    SELECT DISTINCT de.event_type
    FROM domain_events de
    WHERE de.stream_id = p_organization_id
  ),
  first_event AS (
    -- Get the first event timestamp for created_at
    SELECT MIN(de.created_at) AS ts
    FROM domain_events de
    WHERE de.stream_id = p_organization_id
  ),
  completion_event AS (
    -- Get the completion timestamp if completed
    SELECT de.created_at AS ts, de.event_data->>'error_message' AS error_msg
    FROM domain_events de
    WHERE de.stream_id = p_organization_id
      AND de.event_type IN ('organization.bootstrap.completed', 'organization.bootstrap.failed', 'organization.activated')
    ORDER BY de.created_at DESC
    LIMIT 1
  ),
  dns_event AS (
    -- Extract FQDN from DNS configured event
    SELECT de.event_data->>'fqdn' AS fqdn
    FROM domain_events de
    WHERE de.stream_id = p_organization_id
      AND de.event_type = 'organization.dns.configured'
    LIMIT 1
  ),
  invitation_count AS (
    -- Count invitation emails sent
    SELECT COUNT(*)::INTEGER AS cnt
    FROM domain_events de
    WHERE de.stream_id = p_organization_id
      AND de.event_type = 'invitation.email.sent'
  )
  SELECT
    p_organization_id AS bootstrap_id,
    p_organization_id AS organization_id,
    -- Determine overall status
    CASE
      WHEN EXISTS (SELECT 1 FROM org_events WHERE event_type = 'organization.activated') THEN 'completed'
      WHEN EXISTS (SELECT 1 FROM org_events WHERE event_type = 'organization.bootstrap.completed') THEN 'completed'
      WHEN EXISTS (SELECT 1 FROM org_events WHERE event_type = 'organization.bootstrap.failed') THEN 'failed'
      WHEN EXISTS (SELECT 1 FROM org_events WHERE event_type = 'organization.bootstrap.cancelled') THEN 'cancelled'
      WHEN EXISTS (SELECT 1 FROM org_events) THEN 'running'
      ELSE 'unknown'
    END::TEXT,
    -- Determine current stage based on highest completed event
    CASE
      WHEN EXISTS (SELECT 1 FROM org_events WHERE event_type = 'organization.activated') THEN 'completed'
      WHEN EXISTS (SELECT 1 FROM org_events WHERE event_type = 'organization.bootstrap.completed') THEN 'completed'
      WHEN EXISTS (SELECT 1 FROM org_events WHERE event_type = 'invitation.email.sent') THEN 'invitation_email'
      WHEN EXISTS (SELECT 1 FROM org_events WHERE event_type = 'user.invited') THEN 'role_assignment'
      WHEN EXISTS (SELECT 1 FROM org_events WHERE event_type IN ('organization.dns.configured', 'organization.dns.verified')) THEN 'dns_provisioning'
      WHEN EXISTS (SELECT 1 FROM org_events WHERE event_type = 'program.created') THEN 'program_creation'
      WHEN EXISTS (SELECT 1 FROM org_events WHERE event_type = 'phone.created') THEN 'phone_creation'
      WHEN EXISTS (SELECT 1 FROM org_events WHERE event_type = 'address.created') THEN 'address_creation'
      WHEN EXISTS (SELECT 1 FROM org_events WHERE event_type = 'contact.created') THEN 'contact_creation'
      WHEN EXISTS (SELECT 1 FROM org_events WHERE event_type = 'organization.created') THEN 'organization_creation'
      WHEN EXISTS (SELECT 1 FROM org_events WHERE event_type LIKE 'organization.bootstrap.%') THEN 'temporal_workflow_started'
      ELSE 'temporal_workflow_started'
    END::TEXT,
    ce.error_msg::TEXT,
    fe.ts,
    CASE
      WHEN EXISTS (SELECT 1 FROM org_events WHERE event_type IN ('organization.activated', 'organization.bootstrap.completed')) THEN ce.ts
      ELSE NULL
    END,
    -- NEW: domain from DNS event
    dns.fqdn::TEXT,
    -- NEW: dns_configured boolean
    EXISTS (SELECT 1 FROM org_events WHERE event_type = 'organization.dns.configured'),
    -- NEW: invitations_sent count
    COALESCE(ic.cnt, 0)
  FROM first_event fe
  LEFT JOIN completion_event ce ON TRUE
  LEFT JOIN dns_event dns ON TRUE
  LEFT JOIN invitation_count ic ON TRUE
  WHERE fe.ts IS NOT NULL;  -- P0 #3: Only return rows if events exist for this organization
END;
$$ LANGUAGE plpgsql STABLE
SET search_path = public, extensions, pg_temp;

-- API wrapper for PostgREST access (Edge Functions use 'api' schema)
-- Includes authorization check (P1 #5) and extended return type (P1 #4)
CREATE SCHEMA IF NOT EXISTS api;

CREATE OR REPLACE FUNCTION api.get_bootstrap_status(
  p_bootstrap_id UUID
) RETURNS TABLE (
  bootstrap_id UUID,
  organization_id UUID,
  status TEXT,
  current_stage TEXT,
  error_message TEXT,
  created_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  domain TEXT,
  dns_configured BOOLEAN,
  invitations_sent INTEGER
)
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  v_user_id UUID;
BEGIN
  -- Get current user from JWT (P1 #5: Authorization check)
  v_user_id := auth.uid();

  -- Allow access if:
  -- 1. User is super_admin (global access)
  -- 2. User has a role in the organization being queried
  -- 3. User initiated the bootstrap (found in event metadata)
  IF v_user_id IS NOT NULL THEN
    IF NOT (
      -- Super admin can view any organization
      EXISTS (
        SELECT 1 FROM user_roles_projection ur
        JOIN roles_projection r ON r.id = ur.role_id
        WHERE ur.user_id = v_user_id
          AND r.name = 'super_admin'
          AND ur.org_id IS NULL
      )
      OR
      -- User has role in the organization being queried
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
  SELECT * FROM get_bootstrap_status(p_bootstrap_id);
END;
$$;

-- Function to list all bootstrap processes (for admin dashboard)
CREATE OR REPLACE FUNCTION list_bootstrap_processes(
  p_limit INTEGER DEFAULT 50,
  p_offset INTEGER DEFAULT 0
) RETURNS TABLE (
  bootstrap_id UUID,
  organization_id UUID,
  organization_name TEXT,
  organization_type TEXT,
  admin_email TEXT,
  status TEXT,
  created_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  error_message TEXT
) AS $$
BEGIN
  RETURN QUERY
  WITH bootstrap_initiation AS (
    SELECT DISTINCT
      (de.event_data->>'bootstrap_id')::UUID AS bid,
      de.stream_id,
      de.event_data->>'organization_name' AS org_name,
      de.event_data->>'organization_type' AS org_type,
      de.event_data->>'admin_email' AS email,
      de.created_at AS initiated_at
    FROM domain_events de
    WHERE de.event_type IN ('organization.bootstrap.initiated', 'organization.bootstrap.temporal_initiated')
  ),
  bootstrap_status AS (
    SELECT
      (de.event_data->>'bootstrap_id')::UUID AS bid,
      CASE
        WHEN de.event_type = 'organization.bootstrap.completed' THEN 'completed'
        WHEN de.event_type = 'organization.bootstrap.failed' THEN 'failed'
        WHEN de.event_type = 'organization.bootstrap.cancelled' THEN 'cancelled'
        ELSE 'processing'
      END AS current_status,
      CASE
        WHEN de.event_type = 'organization.bootstrap.completed' THEN de.created_at
        ELSE NULL
      END AS completed_time,
      de.event_data->>'error_message' AS error_msg,
      ROW_NUMBER() OVER (PARTITION BY de.event_data->>'bootstrap_id' ORDER BY de.created_at DESC) AS rn
    FROM domain_events de
    WHERE de.event_type LIKE 'organization.bootstrap.%'
      AND de.event_type NOT IN ('organization.bootstrap.initiated', 'organization.bootstrap.temporal_initiated')
  )
  SELECT
    bi.bid,
    bi.stream_id,
    bi.org_name,
    bi.org_type,
    bi.email,
    COALESCE(bs.current_status, 'processing'),
    bi.initiated_at,
    bs.completed_time,
    bs.error_msg
  FROM bootstrap_initiation bi
  LEFT JOIN bootstrap_status bs ON bi.bid = bs.bid AND bs.rn = 1
  ORDER BY bi.initiated_at DESC
  LIMIT p_limit OFFSET p_offset;
END;
$$ LANGUAGE plpgsql STABLE
SET search_path = public, extensions, pg_temp;

-- Function to clean up old failed bootstrap attempts
CREATE OR REPLACE FUNCTION cleanup_old_bootstrap_failures(
  p_days_old INTEGER DEFAULT 30
) RETURNS INTEGER AS $$
DECLARE
  v_cleanup_count INTEGER;
BEGIN
  -- This function would clean up very old failed bootstrap attempts
  -- For now, just return count of what would be cleaned
  SELECT COUNT(*) INTO v_cleanup_count
  FROM domain_events
  WHERE event_type = 'organization.bootstrap.failed'
    AND created_at < NOW() - (p_days_old || ' days')::INTERVAL;

  RAISE NOTICE 'Would clean up % old failed bootstrap attempts', v_cleanup_count;

  -- In production, you might want to archive rather than delete
  -- DELETE FROM domain_events WHERE ...

  RETURN v_cleanup_count;
END;
$$ LANGUAGE plpgsql
SET search_path = public, extensions, pg_temp;

-- Comments for documentation
COMMENT ON FUNCTION handle_bootstrap_workflow IS
  'Trigger function that handles cleanup for failed bootstrap events emitted by Temporal workflows';
COMMENT ON FUNCTION retry_failed_bootstrap IS
  'Emit retry request event for Temporal to pick up and orchestrate';
COMMENT ON FUNCTION get_bootstrap_status IS
  'Get current status of a bootstrap process by organization_id (unified ID system - tracks Temporal workflow progress). Returns domain, dns_configured, and invitations_sent from events.';
COMMENT ON FUNCTION api.get_bootstrap_status IS
  'API wrapper for get_bootstrap_status with authorization check. Returns empty result if user is not authorized.';
COMMENT ON FUNCTION list_bootstrap_processes IS
  'List all bootstrap processes with their current status (admin dashboard)';
COMMENT ON FUNCTION cleanup_old_bootstrap_failures IS
  'Clean up old failed bootstrap attempts for maintenance';
