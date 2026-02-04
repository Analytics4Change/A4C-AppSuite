-- =============================================================================
-- Migration: Fix Function Search Paths
-- Purpose: Add SET search_path = public, extensions, pg_temp to all functions
--          that are missing it to prevent privilege escalation attacks
-- Reference: Supabase advisor - "Function Search Path Mutable" warning
-- =============================================================================

-- =============================================================================
-- API SCHEMA FUNCTIONS (SECURITY DEFINER - HIGH PRIORITY)
-- =============================================================================

-- api.get_events_by_correlation
CREATE OR REPLACE FUNCTION api.get_events_by_correlation(p_correlation_id uuid, p_limit integer DEFAULT 100)
 RETURNS TABLE(id uuid, event_type text, stream_id uuid, stream_type text, event_data jsonb, event_metadata jsonb, correlation_id uuid, session_id uuid, trace_id text, span_id text, parent_span_id text, created_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path = public, extensions, pg_temp
AS $function$
BEGIN
  RETURN QUERY
  SELECT
    de.id,
    de.event_type,
    de.stream_id,
    de.stream_type,
    de.event_data,
    de.event_metadata,
    de.correlation_id,
    de.session_id,
    de.trace_id,
    de.span_id,
    de.parent_span_id,
    de.created_at
  FROM domain_events de
  WHERE de.correlation_id = p_correlation_id
  ORDER BY de.created_at DESC
  LIMIT p_limit;
END;
$function$;

-- api.get_events_by_session
CREATE OR REPLACE FUNCTION api.get_events_by_session(p_session_id uuid, p_limit integer DEFAULT 100)
 RETURNS TABLE(id uuid, event_type text, stream_id uuid, stream_type text, event_data jsonb, event_metadata jsonb, correlation_id uuid, session_id uuid, trace_id text, span_id text, parent_span_id text, created_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path = public, extensions, pg_temp
AS $function$
BEGIN
  RETURN QUERY
  SELECT
    de.id,
    de.event_type,
    de.stream_id,
    de.stream_type,
    de.event_data,
    de.event_metadata,
    de.correlation_id,
    de.session_id,
    de.trace_id,
    de.span_id,
    de.parent_span_id,
    de.created_at
  FROM domain_events de
  WHERE de.session_id = p_session_id
  ORDER BY de.created_at DESC
  LIMIT p_limit;
END;
$function$;

-- =============================================================================
-- PUBLIC SCHEMA FUNCTIONS - SECURITY DEFINER (HIGH PRIORITY)
-- =============================================================================

-- public.notify_workflow_worker_bootstrap (TRIGGER, SECURITY DEFINER)
-- NOTE: This is NOT a duplicate - it's for pg_notify to Temporal workers
CREATE OR REPLACE FUNCTION public.notify_workflow_worker_bootstrap()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public, extensions, pg_temp
AS $function$
DECLARE
  notification_payload jsonb;
BEGIN
  -- Only notify for organization.bootstrap.initiated events
  -- Note: This runs BEFORE the CQRS projection trigger, so processed_at is always NULL
  IF NEW.event_type = 'organization.bootstrap.initiated' THEN

    -- Build notification payload with all necessary data for workflow start
    notification_payload := jsonb_build_object(
      'event_id', NEW.id,
      'event_type', NEW.event_type,
      'stream_id', NEW.stream_id,
      'stream_type', NEW.stream_type,
      'event_data', NEW.event_data,
      'event_metadata', NEW.event_metadata,
      'created_at', NEW.created_at
    );

    -- Send notification to workflow_events channel
    -- Worker subscribes to this channel and receives payload
    PERFORM pg_notify('workflow_events', notification_payload::text);

    -- Log for debugging (visible in Supabase logs)
    RAISE NOTICE 'Notified workflow worker: event_id=%, stream_id=%',
      NEW.id, NEW.stream_id;

  END IF;

  RETURN NEW;
END;
$function$;

-- NOTE: The no-parameter trigger versions of process_invitation_event() and
-- process_user_event() are LEGACY DUPLICATES that cause double-processing.
-- They will be removed in a separate migration (remove_duplicate_event_triggers.sql)
-- along with their triggers. See event-handler-pattern.md for correct architecture.

-- =============================================================================
-- PUBLIC SCHEMA FUNCTIONS - REGULAR (MEDIUM PRIORITY)
-- =============================================================================

-- public.check_scope_containment (IMMUTABLE)
CREATE OR REPLACE FUNCTION public.check_scope_containment(p_target_scope ltree, p_user_scopes ltree[])
 RETURNS boolean
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path = public, extensions, pg_temp
AS $function$
BEGIN
  -- If user has NULL in their scopes, they have global access
  IF NULL = ANY(p_user_scopes) THEN
    RETURN TRUE;
  END IF;

  -- If target scope is NULL, it means no scope restriction (global role)
  -- Only users with global access (NULL scope) can assign such roles
  IF p_target_scope IS NULL THEN
    RETURN FALSE;
  END IF;

  -- Check if any user scope contains the target scope
  -- Using ltree @> operator: parent @> child means parent contains child
  RETURN EXISTS (
    SELECT 1 FROM unnest(p_user_scopes) AS user_scope
    WHERE user_scope @> p_target_scope
  );
END;
$function$;

-- public.is_role_active (STABLE)
CREATE OR REPLACE FUNCTION public.is_role_active(p_role_valid_from date, p_role_valid_until date)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE
 SET search_path = public, extensions, pg_temp
AS $function$
BEGIN
    RETURN (p_role_valid_from IS NULL OR p_role_valid_from <= CURRENT_DATE)
       AND (p_role_valid_until IS NULL OR p_role_valid_until >= CURRENT_DATE);
END;
$function$;

-- public.is_user_on_schedule (STABLE)
CREATE OR REPLACE FUNCTION public.is_user_on_schedule(p_user_id uuid, p_org_id uuid, p_org_unit_id uuid DEFAULT NULL::uuid, p_check_time timestamp with time zone DEFAULT now())
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE
 SET search_path = public, extensions, pg_temp
AS $function$
DECLARE
  v_schedule jsonb;
  v_day_of_week text;
  v_current_time time;
  v_day_schedule jsonb;
  v_org_timezone text;
  v_local_time timestamptz;
BEGIN
  -- Get organization timezone
  SELECT COALESCE(timezone, 'America/New_York')
  INTO v_org_timezone
  FROM organizations_projection
  WHERE id = p_org_id;

  -- Convert check time to org's local timezone
  v_local_time := p_check_time AT TIME ZONE v_org_timezone;

  -- Get day name (lowercase, no trailing spaces)
  v_day_of_week := lower(trim(to_char(v_local_time, 'day')));
  v_current_time := v_local_time::time;

  -- Find applicable schedule (prefer OU-specific, fall back to org-wide)
  SELECT schedule INTO v_schedule
  FROM user_schedule_policies_projection
  WHERE user_id = p_user_id
    AND organization_id = p_org_id
    AND (org_unit_id IS NULL OR org_unit_id = p_org_unit_id)
    AND is_active = true
    AND (effective_from IS NULL OR effective_from <= p_check_time::date)
    AND (effective_until IS NULL OR effective_until >= p_check_time::date)
  ORDER BY org_unit_id NULLS LAST  -- Prefer OU-specific schedule
  LIMIT 1;

  -- No schedule found = not on schedule
  IF v_schedule IS NULL THEN
    RETURN false;
  END IF;

  -- Get schedule for current day
  v_day_schedule := v_schedule->v_day_of_week;

  -- Day not in schedule or explicitly null = not scheduled today
  IF v_day_schedule IS NULL OR v_day_schedule = 'null'::jsonb THEN
    RETURN false;
  END IF;

  -- Parse begin/end times and check if current time falls within
  -- Times are stored as HHMM strings (e.g., "0800", "1600")
  DECLARE
    v_begin_time time;
    v_end_time time;
  BEGIN
    v_begin_time := to_timestamp(v_day_schedule->>'begin', 'HH24MI')::time;
    v_end_time := to_timestamp(v_day_schedule->>'end', 'HH24MI')::time;

    RETURN v_current_time >= v_begin_time AND v_current_time <= v_end_time;
  EXCEPTION WHEN OTHERS THEN
    -- Invalid time format - treat as not on schedule
    RETURN false;
  END;
END;
$function$;

-- =============================================================================
-- PUBLIC SCHEMA FUNCTIONS - EVENT HANDLERS (VOLATILE)
-- =============================================================================

-- public.handle_organization_direct_care_settings_updated
CREATE OR REPLACE FUNCTION public.handle_organization_direct_care_settings_updated(p_event record)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path = public, extensions, pg_temp
AS $function$
BEGIN
  UPDATE organizations_projection SET
    direct_care_settings = p_event.event_data->'settings',
    updated_at = now()
  WHERE id = p_event.aggregate_id;
END;
$function$;

-- public.handle_user_client_assigned
CREATE OR REPLACE FUNCTION public.handle_user_client_assigned(p_event record)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path = public, extensions, pg_temp
AS $function$
BEGIN
  INSERT INTO user_client_assignments_projection (
    id,
    user_id,
    client_id,
    organization_id,
    assigned_by,
    notes,
    assigned_until,
    last_event_id
  ) VALUES (
    COALESCE((p_event.event_data->>'assignment_id')::uuid, gen_random_uuid()),
    p_event.aggregate_id,
    (p_event.event_data->>'client_id')::uuid,
    (p_event.event_data->>'organization_id')::uuid,
    (p_event.event_metadata->>'user_id')::uuid,
    p_event.event_data->>'notes',
    (p_event.event_data->>'assigned_until')::timestamptz,
    p_event.id
  ) ON CONFLICT (user_id, client_id)
  DO UPDATE SET
    is_active = true,
    assigned_until = EXCLUDED.assigned_until,
    notes = EXCLUDED.notes,
    updated_at = now(),
    last_event_id = p_event.id;
END;
$function$;

-- public.handle_user_client_unassigned
CREATE OR REPLACE FUNCTION public.handle_user_client_unassigned(p_event record)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path = public, extensions, pg_temp
AS $function$
BEGIN
  UPDATE user_client_assignments_projection SET
    is_active = false,
    assigned_until = now(),
    updated_at = now(),
    last_event_id = p_event.id
  WHERE user_id = p_event.aggregate_id
    AND client_id = (p_event.event_data->>'client_id')::uuid;
END;
$function$;

-- public.handle_user_schedule_created
CREATE OR REPLACE FUNCTION public.handle_user_schedule_created(p_event record)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path = public, extensions, pg_temp
AS $function$
BEGIN
  INSERT INTO user_schedule_policies_projection (
    id,
    user_id,
    organization_id,
    schedule,
    org_unit_id,
    effective_from,
    effective_until,
    created_by,
    last_event_id
  ) VALUES (
    COALESCE((p_event.event_data->>'schedule_id')::uuid, gen_random_uuid()),
    p_event.aggregate_id,
    (p_event.event_data->>'organization_id')::uuid,
    p_event.event_data->'schedule',
    (p_event.event_data->>'org_unit_id')::uuid,
    (p_event.event_data->>'effective_from')::date,
    (p_event.event_data->>'effective_until')::date,
    (p_event.event_metadata->>'user_id')::uuid,
    p_event.id
  ) ON CONFLICT (user_id, organization_id, org_unit_id) DO NOTHING;
END;
$function$;

-- public.handle_user_schedule_deactivated
CREATE OR REPLACE FUNCTION public.handle_user_schedule_deactivated(p_event record)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path = public, extensions, pg_temp
AS $function$
BEGIN
  UPDATE user_schedule_policies_projection SET
    is_active = false,
    updated_at = now(),
    last_event_id = p_event.id
  WHERE user_id = p_event.aggregate_id
    AND organization_id = (p_event.event_data->>'organization_id')::uuid
    AND (
      (org_unit_id IS NULL AND (p_event.event_data->>'org_unit_id') IS NULL)
      OR org_unit_id = (p_event.event_data->>'org_unit_id')::uuid
    );
END;
$function$;

-- public.handle_user_schedule_updated
CREATE OR REPLACE FUNCTION public.handle_user_schedule_updated(p_event record)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path = public, extensions, pg_temp
AS $function$
BEGIN
  UPDATE user_schedule_policies_projection SET
    schedule = COALESCE(p_event.event_data->'schedule', schedule),
    effective_from = COALESCE((p_event.event_data->>'effective_from')::date, effective_from),
    effective_until = COALESCE((p_event.event_data->>'effective_until')::date, effective_until),
    updated_at = now(),
    last_event_id = p_event.id
  WHERE user_id = p_event.aggregate_id
    AND organization_id = (p_event.event_data->>'organization_id')::uuid
    AND (
      (org_unit_id IS NULL AND (p_event.event_data->>'org_unit_id') IS NULL)
      OR org_unit_id = (p_event.event_data->>'org_unit_id')::uuid
    );
END;
$function$;

-- =============================================================================
-- PUBLIC SCHEMA FUNCTIONS - TRIGGER FUNCTIONS (VOLATILE)
-- =============================================================================

-- public.enqueue_workflow_from_bootstrap_event
CREATE OR REPLACE FUNCTION public.enqueue_workflow_from_bootstrap_event()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path = public, extensions, pg_temp
AS $function$
DECLARE
    v_pending_event_id UUID;
BEGIN
    -- Only process organization.bootstrap.initiated events
    IF NEW.event_type = 'organization.bootstrap.initiated' THEN
        -- Emit workflow.queue.pending event
        -- This will be caught by update_workflow_queue_projection trigger
        SELECT api.emit_domain_event(
            p_stream_id := NEW.stream_id,
            p_stream_type := 'workflow_queue',
            -- NOTE: p_stream_version removed - function auto-calculates it
            p_event_type := 'workflow.queue.pending',
            p_event_data := jsonb_build_object(
                'event_id', NEW.id,              -- Link to bootstrap event
                'event_type', NEW.event_type,    -- Original event type
                'event_data', NEW.event_data,    -- Original event payload
                'stream_id', NEW.stream_id,      -- Original stream ID
                'stream_type', NEW.stream_type   -- Original stream type
            ),
            p_event_metadata := jsonb_build_object(
                'triggered_by', 'enqueue_workflow_from_bootstrap_event',
                'source_event_id', NEW.id
            )
        ) INTO v_pending_event_id;

        -- Log for debugging (appears in Supabase logs)
        RAISE NOTICE 'Enqueued workflow job: event_id=%, pending_event_id=%',
            NEW.id, v_pending_event_id;
    END IF;

    RETURN NEW;
END;
$function$;

-- public.update_timestamp
CREATE OR REPLACE FUNCTION public.update_timestamp()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path = public, extensions, pg_temp
AS $function$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$function$;

-- public.update_workflow_queue_projection_from_event
CREATE OR REPLACE FUNCTION public.update_workflow_queue_projection_from_event()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path = public, extensions, pg_temp
AS $function$
BEGIN
    -- Process workflow.queue.pending event
    -- Creates new queue entry with status='pending'
    IF NEW.event_type = 'workflow.queue.pending' THEN
        INSERT INTO workflow_queue_projection (
            event_id,
            event_type,
            event_data,
            stream_id,
            stream_type,
            status,
            created_at,
            updated_at
        )
        VALUES (
            (NEW.event_data->>'event_id')::UUID,  -- Original bootstrap.initiated event ID
            NEW.event_data->>'event_type',         -- Original event type
            (NEW.event_data->'event_data')::JSONB, -- Original event payload
            NEW.stream_id,
            NEW.stream_type,
            'pending',
            NOW(),
            NOW()
        )
        ON CONFLICT (event_id) DO NOTHING;  -- Idempotent: skip if already exists

    -- Process workflow.queue.claimed event
    -- Updates status to 'processing' and records worker info
    ELSIF NEW.event_type = 'workflow.queue.claimed' THEN
        UPDATE workflow_queue_projection
        SET
            status = 'processing',
            worker_id = NEW.event_data->>'worker_id',
            claimed_at = (NEW.event_data->>'claimed_at')::TIMESTAMPTZ,
            workflow_id = NEW.event_data->>'workflow_id',
            updated_at = NOW()
        WHERE event_id = (NEW.event_data->>'event_id')::UUID
          AND status = 'pending';  -- Only update if still pending (prevent race conditions)

    -- Process workflow.queue.completed event
    -- Updates status to 'completed' and records completion info
    ELSIF NEW.event_type = 'workflow.queue.completed' THEN
        UPDATE workflow_queue_projection
        SET
            status = 'completed',
            completed_at = (NEW.event_data->>'completed_at')::TIMESTAMPTZ,
            workflow_run_id = NEW.event_data->>'workflow_run_id',
            result = (NEW.event_data->'result')::JSONB,
            updated_at = NOW()
        WHERE event_id = (NEW.event_data->>'event_id')::UUID
          AND status = 'processing';  -- Only update if currently processing

    -- Process workflow.queue.failed event
    -- Updates status to 'failed' and records error info
    ELSIF NEW.event_type = 'workflow.queue.failed' THEN
        UPDATE workflow_queue_projection
        SET
            status = 'failed',
            failed_at = (NEW.event_data->>'failed_at')::TIMESTAMPTZ,
            error_message = NEW.event_data->>'error_message',
            error_stack = NEW.event_data->>'error_stack',
            retry_count = COALESCE((NEW.event_data->>'retry_count')::INTEGER, 0),
            updated_at = NOW()
        WHERE event_id = (NEW.event_data->>'event_id')::UUID
          AND status = 'processing';  -- Only update if currently processing

    END IF;

    RETURN NEW;
END;
$function$;

-- public.update_workflow_queue_projection_updated_at
CREATE OR REPLACE FUNCTION public.update_workflow_queue_projection_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path = public, extensions, pg_temp
AS $function$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$function$;

-- =============================================================================
-- END OF MIGRATION
-- =============================================================================
