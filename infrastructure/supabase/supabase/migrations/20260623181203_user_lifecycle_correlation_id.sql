-- =============================================================================
-- User-lifecycle correlation_id foundation (cross-tenant grant rollout sibling;
-- invite-user epic PR 1).
-- =============================================================================
--
-- Card: dev/active/invite-user-route-existing-users-to-role-assign/
-- Architect verdict (software-architect-dbc, 2026-06-23): APPROVE WITH BLOCKING
-- FIXES (all folded). Decision record: ~/.claude/plans/fizzy-jingling-puppy-agent-a394162c2d976d382.md
--
-- PROBLEM: correlation_id is chained for the INVITATION entity
-- (invitations_projection.correlation_id, reused by accept-invitation) but NOT
-- for the USER entity — `users` has no correlation_id, so every user-mutation
-- RPC mints a fresh request-scoped id, breaking the lifecycle chain the spec
-- (event-metadata-schema.md) already mandates (user.created → role.assigned →
-- deactivated → ...).
--
-- FIX: add users.correlation_id; anchor it at user.created (replay-safe
-- keep-existing); BACKFILL synthesizing where no source exists (so it is NEVER
-- NULL → "one chain per user" is a true invariant); and chain the
-- IDENTITY/MEMBERSHIP emitters to it. Boundary (LOCKED 2026-06-23): chain
-- modify_user_roles / deactivate_user / delete_user / update_user_access_dates
-- (+ reactivate_user in the next PR). EXCLUDED as documented sub-entity edits:
-- phone/address/notification-pref/client-assignment RPCs (each keeps its own
-- per-op correlation).
--
-- MECHANISM (chaining): each emitter sets the transaction-local session var
-- `app.correlation_id` to the user's stored id once near its top. Every
-- api.emit_domain_event() call below it then inherits that id via emit's
-- documented session-var fallback (baseline_v4: metadata > app.correlation_id >
-- generate), which also enriches event_metadata.correlation_id AND the top-level
-- domain_events.correlation_id column. This achieves the architect's DBC
-- postcondition (every emitted event carries the user's id) WITHOUT surgically
-- editing each metadata block — minimizing pitfall-#6 risk on the large
-- modify_user_roles body (its two FOREACH emit blocks inherit it automatically).
--
-- Pitfall #6: every CREATE OR REPLACE below is the deployed body verbatim with
-- ONLY the correlation additions (search "PR1 correlation"). Pitfall #8: column
-- existence asserted in Section 1. Replay-safe.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- Section 1 — schema: users.correlation_id + fail-loud existence assertion.
-- -----------------------------------------------------------------------------
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS correlation_id uuid;

COMMENT ON COLUMN public.users.correlation_id IS
  'Business-scoped correlation_id for the user''s identity/membership lifecycle. '
  'Anchored at user.created; reused by identity/membership emitters '
  '(modify_user_roles, deactivate_user, reactivate_user, delete_user, '
  'update_user_access_dates). Sub-entity edits (phone/address/notif-pref/client) '
  'are NOT chained. See documentation/workflows/reference/event-metadata-schema.md.';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='users' AND column_name='correlation_id'
  ) THEN
    RAISE EXCEPTION 'users.correlation_id missing after ADD COLUMN' USING ERRCODE='P9099';
  END IF;
END $$;


-- -----------------------------------------------------------------------------
-- Section 2 — anchor: handle_user_created populates users.correlation_id from
-- the user.created event. Replay-safe: INSERT sets it; the ON CONFLICT arm uses
-- COALESCE(keep-existing) so a replayed user.created cannot overwrite the
-- established anchor (mirrors handle_user_invited's correlation_id handling).
-- Body is the deployed 3-projection UPSERT verbatim + the two "PR1 correlation"
-- additions only.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_user_created(p_event record)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  v_user_id UUID;
  v_org_id UUID;
  v_sms_enabled BOOLEAN;
  v_sms_phone_id UUID;
  v_in_app_enabled BOOLEAN;
  v_email_enabled BOOLEAN;
BEGIN
  v_user_id := (p_event.event_data->>'user_id')::UUID;
  v_org_id := (p_event.event_data->>'organization_id')::UUID;

  -- Insert user record
  INSERT INTO users (
    id, email, name, first_name, last_name, current_organization_id,
    accessible_organizations, roles, metadata, is_active, correlation_id, created_at, updated_at  -- PR1 correlation: anchor column
  ) VALUES (
    v_user_id,
    p_event.event_data->>'email',
    COALESCE(
      NULLIF(TRIM(CONCAT(p_event.event_data->>'first_name', ' ', p_event.event_data->>'last_name')), ''),
      p_event.event_data->>'name',
      p_event.event_data->>'email'
    ),
    p_event.event_data->>'first_name',
    p_event.event_data->>'last_name',
    v_org_id,
    ARRAY[v_org_id],
    '{}',
    jsonb_build_object(
      'auth_method', p_event.event_data->>'auth_method',
      'invited_via', p_event.event_data->>'invited_via'
    ),
    true,
    p_event.correlation_id,  -- PR1 correlation: anchor from the user.created event
    p_event.created_at,
    p_event.created_at
  )
  ON CONFLICT (id) DO UPDATE SET
    email = EXCLUDED.email,
    name = EXCLUDED.name,
    first_name = COALESCE(EXCLUDED.first_name, users.first_name),
    last_name = COALESCE(EXCLUDED.last_name, users.last_name),
    current_organization_id = COALESCE(users.current_organization_id, EXCLUDED.current_organization_id),
    accessible_organizations = ARRAY(
      SELECT DISTINCT unnest(users.accessible_organizations || EXCLUDED.accessible_organizations)
    ),
    correlation_id = COALESCE(users.correlation_id, EXCLUDED.correlation_id),  -- PR1 correlation: keep-existing on replay
    updated_at = p_event.created_at;

  -- Create user_organizations_projection record (access dates only, NO notification_preferences)
  INSERT INTO user_organizations_projection (
    user_id, org_id, access_start_date, access_expiration_date, created_at, updated_at
  ) VALUES (
    v_user_id,
    v_org_id,
    (p_event.event_data->>'access_start_date')::DATE,
    (p_event.event_data->>'access_expiration_date')::DATE,
    p_event.created_at,
    p_event.created_at
  )
  ON CONFLICT (user_id, org_id) DO UPDATE SET
    access_start_date = COALESCE(EXCLUDED.access_start_date, user_organizations_projection.access_start_date),
    access_expiration_date = COALESCE(EXCLUDED.access_expiration_date, user_organizations_projection.access_expiration_date),
    updated_at = p_event.created_at;

  -- Create user_notification_preferences_projection record (normalized columns)
  -- Parse from nested JSONB with backwards compatibility for camelCase
  v_email_enabled := COALESCE(
    (p_event.event_data->'notification_preferences'->>'email')::BOOLEAN,
    true  -- Default to email enabled
  );
  v_sms_enabled := COALESCE(
    (p_event.event_data->'notification_preferences'->'sms'->>'enabled')::BOOLEAN,
    false
  );
  v_sms_phone_id := COALESCE(
    (p_event.event_data->'notification_preferences'->'sms'->>'phone_id')::UUID,
    (p_event.event_data->'notification_preferences'->'sms'->>'phoneId')::UUID  -- camelCase fallback
  );
  v_in_app_enabled := COALESCE(
    (p_event.event_data->'notification_preferences'->>'in_app')::BOOLEAN,
    (p_event.event_data->'notification_preferences'->>'inApp')::BOOLEAN,  -- camelCase fallback
    false
  );

  INSERT INTO user_notification_preferences_projection (
    user_id, organization_id, email_enabled, sms_enabled, sms_phone_id, in_app_enabled,
    created_at, updated_at
  ) VALUES (
    v_user_id,
    v_org_id,
    v_email_enabled,
    v_sms_enabled,
    v_sms_phone_id,
    v_in_app_enabled,
    p_event.created_at,
    p_event.created_at
  )
  ON CONFLICT (user_id, organization_id) DO UPDATE SET
    email_enabled = COALESCE(EXCLUDED.email_enabled, user_notification_preferences_projection.email_enabled),
    sms_enabled = COALESCE(EXCLUDED.sms_enabled, user_notification_preferences_projection.sms_enabled),
    sms_phone_id = COALESCE(EXCLUDED.sms_phone_id, user_notification_preferences_projection.sms_phone_id),
    in_app_enabled = COALESCE(EXCLUDED.in_app_enabled, user_notification_preferences_projection.in_app_enabled),
    updated_at = p_event.created_at;
END;
$function$;


-- -----------------------------------------------------------------------------
-- Section 3 — chain api.deactivate_user. Deployed body verbatim + v_corr decl,
-- correlation_id added to the existing users SELECT, and the set_config chain
-- (search "PR1 correlation").
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION api.deactivate_user(p_user_id uuid, p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
    v_claims jsonb := current_setting('request.jwt.claims', true)::jsonb;
    v_caller_id uuid := public.get_current_user_id();
    v_org_id uuid := NULLIF(v_claims ->> 'org_id', '')::uuid;
    v_access_blocked boolean := COALESCE((v_claims ->> 'access_blocked')::boolean, false);
    v_target_org_id uuid;
    v_existing_is_active boolean;
    v_existing_deleted_at timestamptz;
    v_corr uuid;  -- PR1 correlation
    v_event_id uuid;
    v_processing_error text;
    v_now timestamptz := now();
BEGIN
    -- =====================================================================
    -- PRE-EMIT GUARDS (RAISE EXCEPTION; no audit row yet)
    -- =====================================================================

    IF v_caller_id IS NULL OR v_org_id IS NULL THEN
        RAISE EXCEPTION 'Access denied' USING ERRCODE = '42501';
    END IF;

    IF v_access_blocked THEN
        RAISE EXCEPTION 'Access blocked: organization is deactivated'
            USING ERRCODE = '42501';
    END IF;

    -- Permission: unscoped user.update (per PR #36/#39/#40 pattern;
    -- adr-edge-function-vs-sql-rpc.md Rollout 2026-04-27 course correction).
    -- The deactivate operation requires `user.update` per the Edge Function's
    -- pre-pivot permission check.
    IF NOT public.has_permission('user.update') THEN
        RAISE EXCEPTION 'Permission denied' USING ERRCODE = '42501';
    END IF;

    -- =====================================================================
    -- TENANCY + IDEMPOTENCY (envelope, not RAISE)
    -- =====================================================================

    SELECT current_organization_id, is_active, deleted_at, correlation_id  -- PR1 correlation
    INTO v_target_org_id, v_existing_is_active, v_existing_deleted_at, v_corr
    FROM public.users
    WHERE id = p_user_id;

    -- Tenancy guard: target must be in caller's tenant. Same envelope shape
    -- as not-found to avoid leaking user-existence across tenants.
    IF NOT FOUND OR v_target_org_id IS DISTINCT FROM v_org_id THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'User not found in this organization'
        );
    END IF;

    -- Idempotency: already-inactive target returns success-false envelope.
    IF v_existing_is_active = false THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'User is already deactivated'
        );
    END IF;

    -- Idempotency: deleted target can't be deactivated.
    IF v_existing_deleted_at IS NOT NULL THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'User is deleted'
        );
    END IF;

    -- PR1 correlation: chain this op's events to the user's lifecycle id.
    IF v_corr IS NOT NULL THEN
        PERFORM set_config('app.correlation_id', v_corr::text, true);
    END IF;

    -- =====================================================================
    -- EMIT user.deactivated EVENT
    -- =====================================================================

    v_event_id := api.emit_domain_event(
        p_stream_id := p_user_id,
        p_stream_type := 'user',
        p_event_type := 'user.deactivated',
        p_event_data := jsonb_build_object(
            'user_id', p_user_id,
            'org_id', v_org_id,
            'deactivated_at', v_now,
            'reason', p_reason
        ),
        p_event_metadata := jsonb_build_object(
            'user_id', v_caller_id,
            'organization_id', v_org_id,
            'source', 'api.deactivate_user',
            'reason', COALESCE(p_reason, 'Manual deactivate')
        )
    );

    -- =====================================================================
    -- PATTERN A v2 READ-BACK (BOTH checks per Rule 13)
    -- =====================================================================

    -- Check 1: IF NOT FOUND on the projection read-back (predicate
    -- requires is_active = false, so absence means handler didn't update)
    PERFORM 1
    FROM public.users
    WHERE id = p_user_id AND is_active = false;

    IF NOT FOUND THEN
        SELECT processing_error INTO v_processing_error
        FROM public.domain_events WHERE id = v_event_id;
        RETURN jsonb_build_object(
            'success', false,
            'error', 'Event processing failed: ' ||
                COALESCE(v_processing_error, 'projection read-back returned no row'),
            'eventId', v_event_id
        );
    END IF;

    -- Check 2: processing_error on captured event_id (race-safe)
    SELECT processing_error INTO v_processing_error
    FROM public.domain_events WHERE id = v_event_id;
    IF v_processing_error IS NOT NULL THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'Event processing failed: ' || v_processing_error,
            'eventId', v_event_id
        );
    END IF;

    RETURN jsonb_build_object(
        'success', true,
        'eventId', v_event_id,
        'userId', p_user_id
    );
END;
$function$;


-- -----------------------------------------------------------------------------
-- Section 4 — chain api.delete_user. Deployed body verbatim + correlation additions.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION api.delete_user(p_user_id uuid, p_reason text DEFAULT 'Manual delete'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
    v_claims jsonb := current_setting('request.jwt.claims', true)::jsonb;
    v_caller_id uuid := public.get_current_user_id();
    v_org_id uuid := NULLIF(v_claims ->> 'org_id', '')::uuid;
    v_access_blocked boolean := COALESCE((v_claims ->> 'access_blocked')::boolean, false);
    v_target_org_id uuid;
    v_existing_deleted_at timestamptz;
    v_corr uuid;  -- PR1 correlation
    v_event_id uuid;
    v_processing_error text;
BEGIN
    -- =====================================================================
    -- PRE-EMIT GUARDS (RAISE EXCEPTION; no audit row yet)
    -- =====================================================================

    -- Caller auth + tenant context
    IF v_caller_id IS NULL OR v_org_id IS NULL THEN
        RAISE EXCEPTION 'Access denied' USING ERRCODE = '42501';
    END IF;

    -- access_blocked JWT-claim guard
    IF v_access_blocked THEN
        RAISE EXCEPTION 'Access blocked: organization is deactivated'
            USING ERRCODE = '42501';
    END IF;

    -- Permission: unscoped user.delete (per PR #36/#39 pattern; see
    -- adr-edge-function-vs-sql-rpc.md Rollout course correction for why
    -- scoped checks are not warranted for user-identity targets in A4C).
    IF NOT public.has_permission('user.delete') THEN
        RAISE EXCEPTION 'Permission denied' USING ERRCODE = '42501';
    END IF;

    -- =====================================================================
    -- TENANCY + IDEMPOTENCY (envelope, not RAISE)
    -- =====================================================================

    -- Look up target user's tenant + delete state in one read.
    SELECT current_organization_id, deleted_at, correlation_id  -- PR1 correlation
    INTO v_target_org_id, v_existing_deleted_at, v_corr
    FROM public.users
    WHERE id = p_user_id;

    -- Tenancy guard: target must be in caller's tenant. Same envelope as
    -- not-found to avoid leaking user-existence across tenants.
    IF NOT FOUND OR v_target_org_id IS DISTINCT FROM v_org_id THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'User not found in this organization'
        );
    END IF;

    -- Idempotency: already-deleted target returns success-false envelope
    -- (avoids audit-log noise from no-op events).
    IF v_existing_deleted_at IS NOT NULL THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'User is already deleted'
        );
    END IF;

    -- PR1 correlation: chain this op's events to the user's lifecycle id.
    IF v_corr IS NOT NULL THEN
        PERFORM set_config('app.correlation_id', v_corr::text, true);
    END IF;

    -- =====================================================================
    -- EMIT user.deleted EVENT
    -- =====================================================================

    v_event_id := api.emit_domain_event(
        p_stream_id := p_user_id,
        p_stream_type := 'user',
        p_event_type := 'user.deleted',
        p_event_data := jsonb_build_object(
            'user_id', p_user_id,
            'org_id', v_org_id,
            'deleted_at', now(),
            'reason', p_reason
        ),
        p_event_metadata := jsonb_build_object(
            'user_id', v_caller_id,
            'organization_id', v_org_id,
            'source', 'api.delete_user',
            'reason', p_reason
        )
    );

    -- =====================================================================
    -- PATTERN A v2 READ-BACK (BOTH checks per Rule 13)
    -- =====================================================================

    -- Check 1: IF NOT FOUND on the projection read-back (predicate
    -- requires deleted_at IS NOT NULL, so absence means handler didn't update)
    PERFORM 1
    FROM public.users
    WHERE id = p_user_id AND deleted_at IS NOT NULL;

    IF NOT FOUND THEN
        SELECT processing_error INTO v_processing_error
        FROM public.domain_events WHERE id = v_event_id;
        RETURN jsonb_build_object(
            'success', false,
            'error', 'Event processing failed: ' ||
                COALESCE(v_processing_error, 'projection read-back returned no row')
        );
    END IF;

    -- Check 2: processing_error on captured event_id
    SELECT processing_error INTO v_processing_error
    FROM public.domain_events WHERE id = v_event_id;
    IF v_processing_error IS NOT NULL THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'Event processing failed: ' || v_processing_error
        );
    END IF;

    -- =====================================================================
    -- SUCCESS
    -- =====================================================================
    RETURN jsonb_build_object(
        'success', true,
        'eventId', v_event_id,
        'userId', p_user_id
    );
END;
$function$;


-- -----------------------------------------------------------------------------
-- Section 5 — chain api.modify_user_roles. Deployed body verbatim + correlation
-- additions. The single set_config (after validation) chains BOTH the revoke
-- and add FOREACH emit loops — no edits inside the loops (architect-preferred
-- low-risk form for this 9KB body).
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION api.modify_user_roles(p_user_id uuid, p_role_ids_to_add uuid[] DEFAULT '{}'::uuid[], p_role_ids_to_remove uuid[] DEFAULT '{}'::uuid[], p_reason text DEFAULT 'Roles modified via User Management'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
    v_claims          jsonb := current_setting('request.jwt.claims', true)::jsonb;
    v_caller_id       uuid  := public.get_current_user_id();
    v_org_id          uuid  := NULLIF(v_claims ->> 'org_id', '')::uuid;
    v_access_blocked  boolean := COALESCE((v_claims ->> 'access_blocked')::boolean, false);
    v_target_org_id   uuid;
    v_target_deleted  timestamptz;
    v_target_active   boolean;
    v_corr            uuid;  -- PR1 correlation
    v_validation      jsonb;
    v_role_id         uuid;
    v_event_id        uuid;
    v_added_ids       uuid[] := '{}'::uuid[];
    v_removed_ids     uuid[] := '{}'::uuid[];
    v_processing_error text;
    v_loop_index      int;
    v_failure_section text;
    v_present_count   int;
    v_absent_count    int;
BEGIN
    -- =====================================================================
    -- PRE-EMIT GUARDS (RAISE EXCEPTION; no audit row yet)
    -- =====================================================================

    -- Caller auth + tenant context
    IF v_caller_id IS NULL OR v_org_id IS NULL THEN
        RAISE EXCEPTION 'Access denied' USING ERRCODE = '42501';
    END IF;

    -- access_blocked JWT-claim guard
    IF v_access_blocked THEN
        RAISE EXCEPTION 'Access blocked: organization is deactivated'
            USING ERRCODE = '42501';
    END IF;

    -- Permission: unscoped user.role_assign
    -- Per the post-2026-04-27 codified rule (infrastructure/supabase/CLAUDE.md
    -- § Critical Rules): A4C user-identities have no organizational location
    -- finer than tenant. Per-role delegation + scope handled by
    -- validate_role_assignment below.
    IF NOT public.has_permission('user.role_assign') THEN
        RAISE EXCEPTION 'Permission denied' USING ERRCODE = '42501';
    END IF;

    -- =====================================================================
    -- INPUT VALIDATION (envelope; not RAISE)
    -- =====================================================================

    p_role_ids_to_add    := COALESCE(p_role_ids_to_add,    '{}'::uuid[]);
    p_role_ids_to_remove := COALESCE(p_role_ids_to_remove, '{}'::uuid[]);

    IF array_length(p_role_ids_to_add, 1) IS NULL
       AND array_length(p_role_ids_to_remove, 1) IS NULL THEN
        RETURN jsonb_build_object(
            'success', false,
            'error',   'INVALID_INPUT',
            'errorDetails', jsonb_build_object(
                'code',    'INVALID_INPUT',
                'message', 'At least one of roleIdsToAdd or roleIdsToRemove must be non-empty'
            )
        );
    END IF;

    -- =====================================================================
    -- TENANCY + TARGET PRECONDITIONS (envelope, not RAISE)
    -- =====================================================================

    SELECT current_organization_id, deleted_at, is_active, correlation_id  -- PR1 correlation
    INTO   v_target_org_id, v_target_deleted, v_target_active, v_corr
    FROM   public.users
    WHERE  id = p_user_id;

    -- Tenancy guard: same envelope as not-found to avoid leaking existence
    IF NOT FOUND OR v_target_org_id IS DISTINCT FROM v_org_id THEN
        RETURN jsonb_build_object(
            'success', false,
            'error',   'NOT_FOUND',
            'errorDetails', jsonb_build_object(
                'code',    'NOT_FOUND',
                'message', 'User not found in this organization'
            )
        );
    END IF;

    -- Already-deleted
    IF v_target_deleted IS NOT NULL THEN
        RETURN jsonb_build_object(
            'success', false,
            'error',   'NOT_FOUND',
            'errorDetails', jsonb_build_object(
                'code',    'NOT_FOUND',
                'message', 'User has been deleted'
            )
        );
    END IF;

    -- Deactivated
    IF v_target_active IS NOT TRUE THEN
        RETURN jsonb_build_object(
            'success', false,
            'error',   'TARGET_DEACTIVATED',
            'errorDetails', jsonb_build_object(
                'code',    'TARGET_DEACTIVATED',
                'message', 'Cannot modify roles on a deactivated user'
            )
        );
    END IF;

    -- =====================================================================
    -- DELEGATION + SCOPE (validate_role_assignment on UNION of adds+removes)
    -- =====================================================================

    v_validation := api.validate_role_assignment(
        p_role_ids := array_cat(p_role_ids_to_add, p_role_ids_to_remove)
    );

    IF NOT (v_validation ->> 'valid')::boolean THEN
        RETURN jsonb_build_object(
            'success',    false,
            'error',      'VALIDATION_FAILED',
            'violations', v_validation -> 'violations'
        );
    END IF;

    -- PR1 correlation: chain BOTH emit loops below to the user's lifecycle id.
    IF v_corr IS NOT NULL THEN
        PERFORM set_config('app.correlation_id', v_corr::text, true);
    END IF;

    -- =====================================================================
    -- EMIT REVOKES (loop-with-failure-capture)
    -- =====================================================================

    v_failure_section := 'remove';
    v_loop_index := 0;
    FOREACH v_role_id IN ARRAY p_role_ids_to_remove
    LOOP
        BEGIN
            v_event_id := api.emit_domain_event(
                p_stream_id   := p_user_id,
                p_stream_type := 'user',
                p_event_type  := 'user.role.revoked',
                p_event_data  := jsonb_build_object(
                    'user_id',     p_user_id,
                    'role_id',     v_role_id,
                    'org_id',      v_org_id,
                    'revoked_at',  now()
                ),
                p_event_metadata := jsonb_build_object(
                    'user_id',         v_caller_id,
                    'organization_id', v_org_id,
                    'reason',          p_reason,
                    'source',          'api.modify_user_roles',
                    'idempotency_key', concat('revoke:', p_user_id::text, ':', v_role_id::text)
                )
            );
            v_removed_ids := v_removed_ids || v_event_id;
        EXCEPTION WHEN OTHERS THEN
            -- Mid-loop failure: short-circuit and surface partial state.
            -- NO RAISE — would roll back audit rows already persisted with
            -- processing_error. Re-running with same inputs converges
            -- (handlers are idempotent on the projection unique key).
            RETURN jsonb_build_object(
                'success',             false,
                'partial',             true,
                'error',               'PARTIAL_FAILURE',
                'userId',              p_user_id,
                'addedRoleEventIds',   to_jsonb(v_added_ids),
                'removedRoleEventIds', to_jsonb(v_removed_ids),
                'failureIndex',        v_loop_index,
                'failureSection',      v_failure_section,
                'processingError',     SQLERRM
            );
        END;
        v_loop_index := v_loop_index + 1;
    END LOOP;

    -- =====================================================================
    -- EMIT ADDS (loop-with-failure-capture)
    -- =====================================================================

    v_failure_section := 'add';
    v_loop_index := 0;
    FOREACH v_role_id IN ARRAY p_role_ids_to_add
    LOOP
        BEGIN
            v_event_id := api.emit_domain_event(
                p_stream_id   := p_user_id,
                p_stream_type := 'user',
                p_event_type  := 'user.role.assigned',
                p_event_data  := jsonb_build_object(
                    'user_id',     p_user_id,
                    'role_id',     v_role_id,
                    'org_id',      v_org_id,
                    'assigned_at', now()
                ),
                p_event_metadata := jsonb_build_object(
                    'user_id',         v_caller_id,
                    'organization_id', v_org_id,
                    'reason',          p_reason,
                    'source',          'api.modify_user_roles',
                    'idempotency_key', concat('assign:', p_user_id::text, ':', v_role_id::text)
                )
            );
            v_added_ids := v_added_ids || v_event_id;
        EXCEPTION WHEN OTHERS THEN
            RETURN jsonb_build_object(
                'success',             false,
                'partial',             true,
                'error',               'PARTIAL_FAILURE',
                'userId',              p_user_id,
                'addedRoleEventIds',   to_jsonb(v_added_ids),
                'removedRoleEventIds', to_jsonb(v_removed_ids),
                'failureIndex',        v_loop_index,
                'failureSection',      v_failure_section,
                'processingError',     SQLERRM
            );
        END;
        v_loop_index := v_loop_index + 1;
    END LOOP;

    -- =====================================================================
    -- PATTERN A v2 READ-BACK (multi-event aggregate)
    -- =====================================================================

    -- Removes must be absent in current tenant
    IF array_length(p_role_ids_to_remove, 1) IS NOT NULL THEN
        SELECT COUNT(*) INTO v_present_count
        FROM   public.user_roles_projection
        WHERE  user_id = p_user_id
          AND  role_id = ANY(p_role_ids_to_remove)
          AND  organization_id = v_org_id;

        IF v_present_count > 0 THEN
            SELECT string_agg(processing_error, ' | ')
            INTO   v_processing_error
            FROM   public.domain_events
            WHERE  id = ANY(v_removed_ids)
              AND  processing_error IS NOT NULL;

            RETURN jsonb_build_object(
                'success',             false,
                'error',               'PROCESSING_ERROR',
                'userId',              p_user_id,
                'addedRoleEventIds',   to_jsonb(v_added_ids),
                'removedRoleEventIds', to_jsonb(v_removed_ids),
                'errorDetails', jsonb_build_object(
                    'code',    'PROCESSING_ERROR',
                    'message', COALESCE(
                        v_processing_error,
                        'Revoke read-back failed: ' || v_present_count::text || ' role(s) still present'
                    )
                )
            );
        END IF;
    END IF;

    -- Adds must be present in current tenant
    IF array_length(p_role_ids_to_add, 1) IS NOT NULL THEN
        SELECT COUNT(*) INTO v_absent_count
        FROM   unnest(p_role_ids_to_add) AS expected(role_id)
        WHERE  NOT EXISTS (
            SELECT 1 FROM public.user_roles_projection
            WHERE  user_id = p_user_id
              AND  role_id = expected.role_id
              AND  organization_id = v_org_id
        );

        IF v_absent_count > 0 THEN
            SELECT string_agg(processing_error, ' | ')
            INTO   v_processing_error
            FROM   public.domain_events
            WHERE  id = ANY(v_added_ids)
              AND  processing_error IS NOT NULL;

            RETURN jsonb_build_object(
                'success',             false,
                'error',               'PROCESSING_ERROR',
                'userId',              p_user_id,
                'addedRoleEventIds',   to_jsonb(v_added_ids),
                'removedRoleEventIds', to_jsonb(v_removed_ids),
                'errorDetails', jsonb_build_object(
                    'code',    'PROCESSING_ERROR',
                    'message', COALESCE(
                        v_processing_error,
                        'Assign read-back failed: ' || v_absent_count::text || ' role(s) not present'
                    )
                )
            );
        END IF;
    END IF;

    -- =====================================================================
    -- SUCCESS
    -- =====================================================================
    RETURN jsonb_build_object(
        'success',             true,
        'userId',              p_user_id,
        'addedRoleEventIds',   to_jsonb(v_added_ids),
        'removedRoleEventIds', to_jsonb(v_removed_ids)
    );
END;
$function$;


-- -----------------------------------------------------------------------------
-- Section 6 — chain api.update_user_access_dates. Deployed body verbatim + a
-- correlation lookup (it does not otherwise read public.users) + set_config.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION api.update_user_access_dates(p_user_id uuid, p_org_id uuid, p_access_start_date date, p_access_expiration_date date)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_old_record record;
  v_corr uuid;  -- PR1 correlation
BEGIN
  -- Authorization: Three-tier check
  IF NOT (
    -- Tier 1: Platform admin (cross-tenant access)
    public.has_platform_privilege()
    -- Tier 2: Org admin for this org
    OR public.has_org_admin_permission()
  ) THEN
    RAISE EXCEPTION 'Access denied' USING ERRCODE = '42501';
  END IF;

  -- Validate dates
  IF p_access_start_date IS NOT NULL
     AND p_access_expiration_date IS NOT NULL
     AND p_access_start_date > p_access_expiration_date THEN
    RAISE EXCEPTION 'Start date must be before expiration date' USING ERRCODE = '22023';
  END IF;

  -- Get old values for event AND verify record exists
  SELECT access_start_date, access_expiration_date
  INTO v_old_record
  FROM public.user_organizations_projection
  WHERE user_id = p_user_id AND org_id = p_org_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'User organization access record not found' USING ERRCODE = 'P0002';
  END IF;

  -- PR1 correlation: chain this op's event to the user's lifecycle id.
  SELECT correlation_id INTO v_corr FROM public.users WHERE id = p_user_id;
  IF v_corr IS NOT NULL THEN
    PERFORM set_config('app.correlation_id', v_corr::text, true);
  END IF;

  -- Emit domain event
  -- Handler handle_user_access_dates_updated updates projection
  -- synchronously via BEFORE INSERT trigger on domain_events
  PERFORM api.emit_domain_event(
    p_stream_type := 'user',
    p_stream_id := p_user_id,
    p_event_type := 'user.access_dates_updated',
    p_event_data := jsonb_build_object(
      'user_id', p_user_id,
      'org_id', p_org_id,
      'access_start_date', p_access_start_date,
      'access_expiration_date', p_access_expiration_date,
      'previous_start_date', v_old_record.access_start_date,
      'previous_expiration_date', v_old_record.access_expiration_date
    ),
    p_event_metadata := jsonb_build_object(
      'user_id', public.get_current_user_id()
    )
  );

  -- REMOVED: Direct write to user_organizations_projection
  -- REMOVED: IF NOT FOUND check (moved above, before event emission)
END;
$function$;


-- -----------------------------------------------------------------------------
-- Section 7 — backfill (synthesize, never NULL). For every user with a NULL
-- correlation_id, set it from the earliest user.created/user.synced_from_auth
-- event (else earliest event for that stream), else a fresh uuid. Idempotent
-- (only fills NULLs). Makes users.correlation_id a NOT-NULL-in-practice invariant.
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  v_filled int := 0;
  v_synth  int := 0;
BEGIN
  WITH src AS (
    SELECT u.id AS user_id,
           COALESCE(
             (SELECT de.correlation_id
              FROM public.domain_events de
              WHERE de.stream_id = u.id
                AND de.event_type IN ('user.created','user.synced_from_auth')
                AND de.correlation_id IS NOT NULL
              ORDER BY de.created_at ASC LIMIT 1),
             (SELECT de.correlation_id
              FROM public.domain_events de
              WHERE de.stream_id = u.id
                AND de.correlation_id IS NOT NULL
              ORDER BY de.created_at ASC LIMIT 1)
           ) AS found_corr
    FROM public.users u
    WHERE u.correlation_id IS NULL
  )
  UPDATE public.users u
  SET correlation_id = COALESCE(src.found_corr, gen_random_uuid())
  FROM src
  WHERE u.id = src.user_id;

  GET DIAGNOSTICS v_filled = ROW_COUNT;
  SELECT count(*) INTO v_synth FROM public.users WHERE correlation_id IS NULL;  -- expect 0
  RAISE NOTICE 'user correlation_id backfill: % rows filled; % remaining NULL (expect 0)', v_filled, v_synth;
END $$;
