-- Migration: PII sanitization for domain_events.processing_error
--
-- HIPAA-relevant fix. Pattern A v2 RPCs return processing_error to authenticated callers,
-- and the dispatcher trigger today concatenates MESSAGE_TEXT || ' - ' || PG_EXCEPTION_DETAIL.
-- PG_EXCEPTION_DETAIL carries row data (Key (col)=(value), Failing row contains (...)) which
-- in this multi-tenant medication-management platform leaks cross-tenant PHI.
--
-- This migration:
--   A. Adds processing_error_detail column for forensic recovery (PHI-bearing).
--   B. Seeds permission platform.view_event_details to gate access.
--   C. Creates api.get_failed_events_with_detail() RPC with permission gate (matches
--      api.get_failed_events convention — RPC-level authorization).
--   D. Updates process_domain_event() trigger to split MESSAGE_TEXT and PG_EXCEPTION_DETAIL
--      into separate columns. processing_error gets MESSAGE_TEXT only (visible via existing
--      api.get_failed_events to platform.admin holders); processing_error_detail gets the
--      raw PG_EXCEPTION_DETAIL (gated by the new permission).
--   E. Chunked historical backfill — moves concatenated detail from existing rows into the
--      new gated column. LIMIT 1000 + FOR UPDATE SKIP LOCKED + 50ms sleep between batches
--      keeps locks short on potentially large tables. RAISE WARNING in PG logs unchanged.
--   F. Fixes 6 identifier-leaking RAISE EXCEPTION statements in handlers/RPCs:
--        - api.bulk_assign_role (line 373 of baseline_v4)
--        - api.sync_role_assignments (line 5582)
--        - public.retry_failed_bootstrap (line 11579)
--        - public.switch_organization (line 11737)
--        - public.validate_role_scope_path_active (lines 12240 + 12254)
--
-- See documentation/architecture/decisions/adr-rpc-readback-pattern.md (PII handling section)
-- and dev/active/rpc-error-pii-sanitization/ for the full design.

-- =====================================================================================
-- A. Add forensic detail column on domain_events
-- =====================================================================================

ALTER TABLE public.domain_events
    ADD COLUMN IF NOT EXISTS processing_error_detail text;

COMMENT ON COLUMN public.domain_events.processing_error_detail IS
  'Raw PG_EXCEPTION_DETAIL captured at handler-failure time. PHI-bearing. Access only via api.get_failed_events_with_detail() gated on platform.view_event_details. Service role (workflows) bypasses RLS — direct table reads acceptable for server-side forensic queries.';

-- =====================================================================================
-- B. Permission seed via CQRS — emit permission.defined event.
--    Pattern matches 20260406221739_client_permissions_seed.sql + 20260422052825 §1h.1.
--    handle_permission_defined() populates permissions_projection.
-- =====================================================================================

DO $$ BEGIN
    INSERT INTO public.domain_events (stream_id, stream_type, stream_version, event_type, event_data, event_metadata)
    VALUES (
        gen_random_uuid(), 'permission', 1, 'permission.defined',
        '{"applet": "platform", "action": "view_event_details", "description": "View raw PG_EXCEPTION_DETAIL on failed events for forensic recovery (PHI-bearing)", "scope_type": "global", "requires_mfa": false}'::jsonb,
        '{"user_id": "00000000-0000-0000-0000-000000000000", "reason": "Seed: gate forensic detail visibility on processing_error_detail column"}'::jsonb
    );
EXCEPTION WHEN unique_violation THEN NULL;
END $$;

-- =====================================================================================
-- C. Permission-gated RPC for admin UI to fetch detail.
--    Matches api.get_failed_events convention (RPC-level authorization, not column RLS).
-- =====================================================================================

CREATE OR REPLACE FUNCTION api.get_failed_events_with_detail(
    p_limit integer DEFAULT 50,
    p_offset integer DEFAULT 0
) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $$
DECLARE
    v_events jsonb;
BEGIN
    -- Permission gate. RAISE EXCEPTION here is permitted (RPC entry guard, not handler-driven).
    IF NOT public.has_permission('platform.view_event_details') THEN
        RAISE EXCEPTION 'Access denied'
            USING ERRCODE = '42501';
    END IF;

    SELECT jsonb_agg(sub.e ORDER BY (sub.e->>'created_at') DESC)
    INTO v_events
    FROM (
        SELECT jsonb_build_object(
            'id', id,
            'stream_id', stream_id,
            'stream_type', stream_type,
            'event_type', event_type,
            'processing_error', processing_error,
            'processing_error_detail', processing_error_detail,
            'created_at', created_at
        ) AS e
        FROM public.domain_events
        WHERE processing_error IS NOT NULL
        ORDER BY created_at DESC
        LIMIT p_limit OFFSET p_offset
    ) sub;

    RETURN jsonb_build_object(
        'success', true,
        'events', COALESCE(v_events, '[]'::jsonb)
    );
END;
$$;

GRANT EXECUTE ON FUNCTION api.get_failed_events_with_detail(integer, integer) TO authenticated;

COMMENT ON FUNCTION api.get_failed_events_with_detail(integer, integer) IS
    'Admin RPC for failed-event forensic detail. Gated by platform.view_event_details. Returns processing_error AND raw PG_EXCEPTION_DETAIL captured at handler-failure time.';

-- =====================================================================================
-- D. Update process_domain_event() trigger: split MESSAGE_TEXT vs PG_EXCEPTION_DETAIL.
--    Body identical to handlers/trigger/process_domain_event.sql except for the EXCEPTION
--    block that now writes to two columns.
-- =====================================================================================

CREATE OR REPLACE FUNCTION public.process_domain_event()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
    v_error_msg TEXT;
    v_error_detail TEXT;
BEGIN
    -- Skip already-processed events (idempotency)
    IF NEW.processed_at IS NOT NULL THEN
        RETURN NEW;
    END IF;

    BEGIN
        IF (NEW.event_type LIKE '%.linked' OR NEW.event_type LIKE '%.unlinked')
           AND NEW.event_type NOT IN ('contact.user.linked', 'contact.user.unlinked') THEN
            PERFORM process_junction_event(NEW);
        ELSE
            CASE NEW.stream_type
                WHEN 'role'              THEN PERFORM process_rbac_event(NEW);
                WHEN 'permission'        THEN PERFORM process_rbac_event(NEW);
                WHEN 'user'              THEN PERFORM process_user_event(NEW);
                WHEN 'organization'      THEN PERFORM process_organization_event(NEW);
                WHEN 'organization_unit' THEN PERFORM process_organization_unit_event(NEW);
                WHEN 'schedule'          THEN PERFORM process_schedule_event(NEW);
                WHEN 'contact'           THEN PERFORM process_contact_event(NEW);
                WHEN 'address'           THEN PERFORM process_address_event(NEW);
                WHEN 'phone'             THEN PERFORM process_phone_event(NEW);
                WHEN 'email'             THEN PERFORM process_email_event(NEW);
                WHEN 'invitation'        THEN PERFORM process_invitation_event(NEW);
                WHEN 'access_grant'      THEN PERFORM process_access_grant_event(NEW);
                WHEN 'impersonation'            THEN PERFORM process_impersonation_event(NEW);
                WHEN 'client_field_definition'  THEN PERFORM process_client_field_definition_event(NEW);
                WHEN 'client_field_category'    THEN PERFORM process_client_field_category_event(NEW);
                WHEN 'client'                   THEN PERFORM process_client_event(NEW);
                -- Administrative stream_types — No projection needed
                WHEN 'platform_admin'    THEN NULL;
                WHEN 'workflow_queue'    THEN NULL;
                WHEN 'test'              THEN NULL;
                ELSE
                    RAISE EXCEPTION 'Unknown stream_type "%" for event %', NEW.stream_type, NEW.id
                        USING ERRCODE = 'P9002';
            END CASE;
        END IF;

        NEW.processed_at = clock_timestamp();
        NEW.processing_error = NULL;
        NEW.processing_error_detail = NULL;

    EXCEPTION
        WHEN OTHERS THEN
            GET STACKED DIAGNOSTICS v_error_msg = MESSAGE_TEXT, v_error_detail = PG_EXCEPTION_DETAIL;
            -- RAISE WARNING preserves operator-debug visibility in PG logs.
            RAISE WARNING 'Event processing error for event %: % - %', NEW.id, v_error_msg, COALESCE(v_error_detail, '');
            -- Persisted columns: MESSAGE_TEXT visible to platform.admin via api.get_failed_events;
            -- PG_EXCEPTION_DETAIL gated behind platform.view_event_details via api.get_failed_events_with_detail.
            NEW.processing_error = v_error_msg;
            NEW.processing_error_detail = v_error_detail;
    END;

    RETURN NEW;
END;
$function$;

-- =====================================================================================
-- E. Chunked historical backfill — moves leak-window detail into the gated column.
--    Production-safe: LIMIT 1000 + FOR UPDATE SKIP LOCKED + 50ms inter-batch sleep.
-- =====================================================================================

DO $$
DECLARE
    v_total_rows bigint;
    v_updated_rows bigint;
    v_grand_total bigint := 0;
    v_batch_size integer := 1000;
BEGIN
    SELECT count(*) INTO v_total_rows
    FROM public.domain_events
    WHERE processing_error LIKE '% - %' AND processing_error_detail IS NULL;

    RAISE NOTICE 'Backfill: % candidate rows', v_total_rows;

    IF v_total_rows = 0 THEN
        RAISE NOTICE 'Backfill: no rows to process; skipping loop';
        RETURN;
    END IF;

    LOOP
        WITH batch AS (
            SELECT id FROM public.domain_events
            WHERE processing_error LIKE '% - %'
              AND processing_error_detail IS NULL
            LIMIT v_batch_size FOR UPDATE SKIP LOCKED
        )
        UPDATE public.domain_events de
        SET processing_error_detail = substring(de.processing_error from ' - (.*)$'),
            processing_error        = split_part(de.processing_error, ' - ', 1)
        FROM batch
        WHERE de.id = batch.id;

        GET DIAGNOSTICS v_updated_rows = ROW_COUNT;
        v_grand_total := v_grand_total + v_updated_rows;
        EXIT WHEN v_updated_rows = 0;
        PERFORM pg_sleep(0.05);  -- Yield between batches.
    END LOOP;

    RAISE NOTICE 'Backfill complete: % rows updated', v_grand_total;
END;
$$;

-- =====================================================================================
-- F.1. Fix api.bulk_assign_role — replace 'Role not found: %' with opaque code.
-- =====================================================================================

CREATE OR REPLACE FUNCTION "api"."bulk_assign_role"("p_role_id" "uuid", "p_user_ids" "uuid"[], "p_scope_path" "extensions"."ltree", "p_correlation_id" "uuid" DEFAULT "gen_random_uuid"(), "p_reason" "text" DEFAULT 'Bulk role assignment'::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions', 'pg_temp'
    AS $$
DECLARE
  v_user_scope extensions.ltree;
  v_org_id UUID;
  v_role_name TEXT;
  v_user_id UUID;
  v_user_index INT := 0;
  v_total_users INT;
  v_successful UUID[] := ARRAY[]::UUID[];
  v_failed JSONB := '[]'::JSONB;
  v_event_data JSONB;
  v_event_metadata JSONB;
  v_assigned_by UUID;
BEGIN
  v_assigned_by := auth.uid();

  IF v_assigned_by IS NULL THEN
    RAISE EXCEPTION 'Authentication required'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  v_user_scope := public.get_permission_scope('user.role_assign');

  IF v_user_scope IS NULL THEN
    RAISE EXCEPTION 'Missing permission: user.role_assign'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF NOT (v_user_scope @> p_scope_path) THEN
    RAISE EXCEPTION 'Requested scope is outside your permission scope'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT r.name INTO v_role_name
  FROM roles_projection r
  WHERE r.id = p_role_id
    AND r.deleted_at IS NULL;

  IF v_role_name IS NULL THEN
    -- PII-safe: identifier removed; opaque code preserves callsite behavior.
    RAISE EXCEPTION 'Role not found'
      USING ERRCODE = 'P0002';
  END IF;

  SELECT o.id INTO v_org_id
  FROM organizations_projection o
  WHERE o.path = subpath(p_scope_path, 0, 1)
    AND o.deleted_at IS NULL;

  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'Organization not found for scope path'
      USING ERRCODE = 'P0002';
  END IF;

  v_total_users := array_length(p_user_ids, 1);

  IF v_total_users IS NULL OR v_total_users = 0 THEN
    RETURN jsonb_build_object(
      'successful', '[]'::JSONB,
      'failed', '[]'::JSONB,
      'totalRequested', 0,
      'totalSucceeded', 0,
      'totalFailed', 0,
      'correlationId', p_correlation_id
    );
  END IF;

  FOREACH v_user_id IN ARRAY p_user_ids LOOP
    v_user_index := v_user_index + 1;

    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM users u
        WHERE u.id = v_user_id
          AND u.current_organization_id = v_org_id
          AND u.deleted_at IS NULL
      ) THEN
        RAISE EXCEPTION 'User not found or not in organization';
      END IF;

      IF NOT EXISTS (
        SELECT 1 FROM users u
        WHERE u.id = v_user_id
          AND u.is_active = true
      ) THEN
        RAISE EXCEPTION 'User is not active';
      END IF;

      IF EXISTS (
        SELECT 1 FROM user_roles_projection ur
        WHERE ur.user_id = v_user_id
          AND ur.role_id = p_role_id
          AND ur.scope_path = p_scope_path
      ) THEN
        RAISE EXCEPTION 'User already has this role at this scope';
      END IF;

      v_event_data := jsonb_build_object(
        'role_id', p_role_id,
        'role_name', v_role_name,
        'org_id', v_org_id,
        'scope_path', p_scope_path::TEXT,
        'assigned_by', v_assigned_by
      );

      v_event_metadata := jsonb_build_object(
        'timestamp', NOW()::TEXT,
        'correlation_id', p_correlation_id,
        'user_id', v_assigned_by::TEXT,
        'reason', p_reason,
        'source', 'api',
        'tags', to_jsonb(ARRAY['bulk-assignment']::TEXT[]),
        'bulk_operation', true,
        'bulk_operation_id', p_correlation_id::TEXT,
        'user_index', v_user_index,
        'total_users', v_total_users
      );

      PERFORM api.emit_domain_event(
        v_user_id,
        'user',
        'user.role.assigned',
        v_event_data,
        v_event_metadata
      );

      v_successful := array_append(v_successful, v_user_id);

    EXCEPTION WHEN OTHERS THEN
      v_failed := v_failed || jsonb_build_object(
        'userId', v_user_id,
        'reason', SQLERRM,
        'sqlstate', SQLSTATE
      );
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'successful', to_jsonb(v_successful),
    'failed', v_failed,
    'totalRequested', v_total_users,
    'totalSucceeded', array_length(v_successful, 1),
    'totalFailed', jsonb_array_length(v_failed),
    'correlationId', p_correlation_id
  );
END;
$$;

-- =====================================================================================
-- F.2. Fix api.sync_role_assignments — same RAISE EXCEPTION pattern as F.1.
-- =====================================================================================

CREATE OR REPLACE FUNCTION "api"."sync_role_assignments"("p_role_id" "uuid", "p_user_ids_to_add" "uuid"[], "p_user_ids_to_remove" "uuid"[], "p_scope_path" "extensions"."ltree", "p_correlation_id" "uuid" DEFAULT "gen_random_uuid"(), "p_reason" "text" DEFAULT 'Role assignment update'::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions', 'pg_temp'
    AS $$
DECLARE
  v_user_scope extensions.ltree;
  v_org_id UUID;
  v_role_name TEXT;
  v_user_id UUID;
  v_acting_user UUID;
  v_event_data JSONB;
  v_event_metadata JSONB;
  v_added_successful UUID[] := ARRAY[]::UUID[];
  v_added_failed JSONB := '[]'::JSONB;
  v_removed_successful UUID[] := ARRAY[]::UUID[];
  v_removed_failed JSONB := '[]'::JSONB;
  v_total_operations INT;
  v_current_index INT := 0;
BEGIN
  v_acting_user := auth.uid();

  IF v_acting_user IS NULL THEN
    RAISE EXCEPTION 'Authentication required'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  v_user_scope := public.get_permission_scope('user.role_assign');

  IF v_user_scope IS NULL THEN
    RAISE EXCEPTION 'Missing permission: user.role_assign'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF NOT (v_user_scope @> p_scope_path) THEN
    RAISE EXCEPTION 'Requested scope is outside your permission scope'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT r.name INTO v_role_name
  FROM roles_projection r
  WHERE r.id = p_role_id
    AND r.deleted_at IS NULL;

  IF v_role_name IS NULL THEN
    -- PII-safe: identifier removed; opaque code preserves callsite behavior.
    RAISE EXCEPTION 'Role not found'
      USING ERRCODE = 'P0002';
  END IF;

  SELECT o.id INTO v_org_id
  FROM organizations_projection o
  WHERE o.path = subpath(p_scope_path, 0, 1)
    AND o.deleted_at IS NULL;

  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'Organization not found for scope path'
      USING ERRCODE = 'P0002';
  END IF;

  v_total_operations := COALESCE(array_length(p_user_ids_to_add, 1), 0)
                      + COALESCE(array_length(p_user_ids_to_remove, 1), 0);

  IF v_total_operations = 0 THEN
    RETURN jsonb_build_object(
      'added', jsonb_build_object('successful', '[]'::JSONB, 'failed', '[]'::JSONB),
      'removed', jsonb_build_object('successful', '[]'::JSONB, 'failed', '[]'::JSONB),
      'correlationId', p_correlation_id
    );
  END IF;

  IF p_user_ids_to_add IS NOT NULL THEN
    FOREACH v_user_id IN ARRAY p_user_ids_to_add LOOP
      v_current_index := v_current_index + 1;

      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM users u
          WHERE u.id = v_user_id
            AND u.current_organization_id = v_org_id
            AND u.deleted_at IS NULL
        ) THEN
          RAISE EXCEPTION 'User not found or not in organization';
        END IF;

        IF NOT EXISTS (
          SELECT 1 FROM users u
          WHERE u.id = v_user_id
            AND u.is_active = true
        ) THEN
          RAISE EXCEPTION 'User is not active';
        END IF;

        IF EXISTS (
          SELECT 1 FROM user_roles_projection ur
          WHERE ur.user_id = v_user_id
            AND ur.role_id = p_role_id
            AND ur.scope_path = p_scope_path
        ) THEN
          RAISE EXCEPTION 'User already has this role at this scope';
        END IF;

        v_event_data := jsonb_build_object(
          'role_id', p_role_id,
          'role_name', v_role_name,
          'org_id', v_org_id,
          'scope_path', p_scope_path::TEXT,
          'assigned_by', v_acting_user
        );

        v_event_metadata := jsonb_build_object(
          'timestamp', NOW()::TEXT,
          'correlation_id', p_correlation_id,
          'user_id', v_acting_user::TEXT,
          'reason', p_reason,
          'source', 'api',
          'tags', to_jsonb(ARRAY['role-management', 'assignment']::TEXT[]),
          'bulk_operation', true,
          'bulk_operation_id', p_correlation_id::TEXT,
          'operation_index', v_current_index,
          'total_operations', v_total_operations
        );

        PERFORM api.emit_domain_event(
          v_user_id,
          'user',
          'user.role.assigned',
          v_event_data,
          v_event_metadata
        );

        v_added_successful := array_append(v_added_successful, v_user_id);

      EXCEPTION WHEN OTHERS THEN
        v_added_failed := v_added_failed || jsonb_build_object(
          'userId', v_user_id,
          'reason', SQLERRM,
          'sqlstate', SQLSTATE
        );
      END;
    END LOOP;
  END IF;

  IF p_user_ids_to_remove IS NOT NULL THEN
    FOREACH v_user_id IN ARRAY p_user_ids_to_remove LOOP
      v_current_index := v_current_index + 1;

      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM users u
          WHERE u.id = v_user_id
            AND u.current_organization_id = v_org_id
            AND u.deleted_at IS NULL
        ) THEN
          RAISE EXCEPTION 'User not found or not in organization';
        END IF;

        IF NOT EXISTS (
          SELECT 1 FROM user_roles_projection ur
          WHERE ur.user_id = v_user_id
            AND ur.role_id = p_role_id
            AND ur.scope_path = p_scope_path
        ) THEN
          RAISE EXCEPTION 'User does not have this role at this scope';
        END IF;

        v_event_data := jsonb_build_object(
          'role_id', p_role_id,
          'role_name', v_role_name,
          'org_id', v_org_id,
          'scope_path', p_scope_path::TEXT,
          'removed_by', v_acting_user
        );

        v_event_metadata := jsonb_build_object(
          'timestamp', NOW()::TEXT,
          'correlation_id', p_correlation_id,
          'user_id', v_acting_user::TEXT,
          'reason', p_reason,
          'source', 'api',
          'tags', to_jsonb(ARRAY['role-management', 'removal']::TEXT[]),
          'bulk_operation', true,
          'bulk_operation_id', p_correlation_id::TEXT,
          'operation_index', v_current_index,
          'total_operations', v_total_operations
        );

        PERFORM api.emit_domain_event(
          v_user_id,
          'user',
          'user.role.revoked',
          v_event_data,
          v_event_metadata
        );

        v_removed_successful := array_append(v_removed_successful, v_user_id);

      EXCEPTION WHEN OTHERS THEN
        v_removed_failed := v_removed_failed || jsonb_build_object(
          'userId', v_user_id,
          'reason', SQLERRM,
          'sqlstate', SQLSTATE
        );
      END;
    END LOOP;
  END IF;

  RETURN jsonb_build_object(
    'added', jsonb_build_object(
      'successful', to_jsonb(v_added_successful),
      'failed', v_added_failed
    ),
    'removed', jsonb_build_object(
      'successful', to_jsonb(v_removed_successful),
      'failed', v_removed_failed
    ),
    'correlationId', p_correlation_id
  );
END;
$$;

-- =====================================================================================
-- F.3. Fix public.retry_failed_bootstrap — drop bootstrap_id from message.
-- =====================================================================================

CREATE OR REPLACE FUNCTION "public"."retry_failed_bootstrap"("p_bootstrap_id" "uuid", "p_user_id" "uuid") RETURNS "uuid"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'extensions', 'pg_temp'
    AS $$
DECLARE
  v_failed_event RECORD;
  v_new_bootstrap_id UUID;
  v_organization_id UUID;
BEGIN
  SELECT * INTO v_failed_event
  FROM domain_events
  WHERE event_type = 'organization.bootstrap.failed'
    AND event_data->>'bootstrap_id' = p_bootstrap_id::TEXT
  ORDER BY created_at DESC
  LIMIT 1;

  IF NOT FOUND THEN
    -- PII-safe: drop bootstrap_id from message (caller has it; opaque code suffices).
    RAISE EXCEPTION 'Bootstrap failure event not found'
      USING ERRCODE = 'P0002';
  END IF;

  v_new_bootstrap_id := gen_random_uuid();
  v_organization_id := gen_random_uuid();

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
$$;

-- =====================================================================================
-- F.4. Fix public.switch_organization — drop org_id from message + remove SQLERRM rewrap.
-- =====================================================================================

CREATE OR REPLACE FUNCTION "public"."switch_organization"("p_new_org_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions', 'pg_temp'
    AS $$
DECLARE
  v_user_id uuid;
  v_has_access boolean;
BEGIN
  v_user_id := auth.uid();

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated'
      USING ERRCODE = '42501';
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles_projection ur
    WHERE ur.user_id = v_user_id
      AND (ur.organization_id = p_new_org_id OR ur.organization_id IS NULL)
  ) INTO v_has_access;

  IF NOT v_has_access THEN
    -- PII-safe: drop org_id from message (caller knows what they asked for).
    RAISE EXCEPTION 'Access denied'
      USING ERRCODE = '42501';
  END IF;

  UPDATE public.users
  SET current_organization_id = p_new_org_id,
      updated_at = NOW()
  WHERE id = v_user_id;

  RETURN jsonb_build_object(
    'success', true,
    'org_id', p_new_org_id,
    'message', 'Organization context updated. Please refresh your session to get updated JWT claims.'
  );

-- Removed the catch-all "EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'Failed ... %', SQLERRM"
-- block. SQLERRM can carry handler-driven detail and rewrapping it loses the original ERRCODE.
END;
$$;

-- =====================================================================================
-- F.5. Fix public.validate_role_scope_path_active — both RAISE EXCEPTIONs (lines 12240 + 12254).
-- =====================================================================================

CREATE OR REPLACE FUNCTION "public"."validate_role_scope_path_active"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'extensions', 'pg_temp'
    AS $$
DECLARE
  v_scope_path LTREE;
  v_scope_depth INTEGER;
  v_inactive_ancestor_path LTREE;
  v_inactive_ancestor_name TEXT;
BEGIN
  v_scope_path := NEW.scope_path;

  IF v_scope_path IS NULL THEN
    RETURN NEW;
  END IF;

  v_scope_depth := nlevel(v_scope_path);

  IF v_scope_depth <= 2 THEN
    RETURN NEW;
  END IF;

  SELECT ou.path, ou.name
  INTO v_inactive_ancestor_path, v_inactive_ancestor_name
  FROM organization_units_projection ou
  WHERE v_scope_path <@ ou.path
    AND ou.is_active = false
    AND ou.deleted_at IS NULL
  ORDER BY ou.depth DESC
  LIMIT 1;

  IF FOUND THEN
    -- PII-safe: drop ancestor name and path from message (both can be facility identifiers).
    RAISE EXCEPTION 'Cannot assign role to inactive organization unit scope (deactivated ancestor)'
      USING ERRCODE = 'check_violation',
            HINT = 'Reactivate the organization unit before assigning roles to it or its descendants.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM organization_units_projection
    WHERE path = v_scope_path
      AND deleted_at IS NOT NULL
  ) THEN
    -- PII-safe: drop scope path from message.
    RAISE EXCEPTION 'Cannot assign role to deleted organization unit scope'
      USING ERRCODE = 'check_violation',
            HINT = 'The organization unit has been deleted and cannot receive role assignments.';
  END IF;

  RETURN NEW;
END;
$$;

-- =====================================================================================
-- End of migration. Verification queries (run separately):
--   SELECT count(*) FROM domain_events WHERE processing_error_detail IS NOT NULL;
--   SELECT api.get_failed_events_with_detail();  -- as authenticated user without permission → 42501
-- =====================================================================================
