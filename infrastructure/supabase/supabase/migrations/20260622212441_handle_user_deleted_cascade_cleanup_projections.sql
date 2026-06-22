-- =============================================================================
-- handle_user_deleted: cascade-cleanup FK-dependent membership/identity projections
-- =============================================================================
--
-- Card: dev/active/handle-user-deleted-cascade-cleanup-projections/
-- Architect verdict (software-architect-dbc, 2026-06-22): APPROVE WITH IN-PR FIXES.
--   Decision record: ~/.claude/plans/fizzy-jingling-puppy-agent-ad12fa238108e55da.md
--
-- PROBLEM: handle_user_deleted only tombstones the user (deleted_at/is_active);
-- it leaves stale rows in membership/identity projections, so soft-deleted users
-- still resolve as members (e.g. check_user_org_membership) and consumers must add
-- ad-hoc deleted_at IS NULL filters. Dev today: 9 stale rows across 2 users.
--
-- FIX (two layers, per architect F1):
--   1. BEFORE handler handle_user_deleted: hard-DELETE the 7 membership/identity
--      projections + NULL the contacts user-linkage. Order is LOAD-BEARING — the
--      tombstone UPDATE runs FIRST so the recompute_user_accessible_organizations
--      that fires on user_organizations_projection DELETE self-guards
--      (WHERE deleted_at IS NULL) to a clean no-op. Audit-reference columns
--      (*_by/created_by/...) are preserved everywhere.
--   2. Grant-revoke is an AFTER-INSERT trigger (NOT a nested emit from the BEFORE
--      handler): a nested emit_domain_event buries an inner failure in the INNER
--      event's processing_error, which api.delete_user's outer Pattern-A-v2
--      read-back never inspects -> a failed revoke would return {success:true}
--      silently. The AFTER-INSERT trigger emits access_grant.revoked per active
--      grant; any failure surfaces as a normal retryable processing_error.
--
-- Pitfall #6: deployed handle_user_deleted body (COALESCE tombstone + IF NOT FOUND
-- RAISE P0002) is preserved verbatim; the cascade is appended. Pitfall #4 N/A
-- (no INSERTs here). Pitfall #8 column-existence assertion included (Section 3).
-- Idempotent/replay-safe: DELETE/NULL are no-ops on re-processing.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- Section 1 — handle_user_deleted: tombstone (preserved) + cascade DELETEs.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_user_deleted(p_event record)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
BEGIN
    -- TOMBSTONE FIRST (load-bearing: must precede the projection DELETEs so the
    -- accessible_organizations recompute triggered by the user_organizations_
    -- projection DELETE self-guards on deleted_at IS NULL to a no-op).
    -- COALESCE order: existing tombstone wins (replay-safe), then event payload's
    -- deleted_at, then event creation time as final fallback.
    UPDATE public.users
       SET deleted_at = COALESCE(
             deleted_at,
             (p_event.event_data->>'deleted_at')::timestamptz,
             p_event.created_at
           ),
           is_active = false,
           updated_at = p_event.created_at
     WHERE id = p_event.stream_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'User not found' USING ERRCODE = 'P0002';
    END IF;

    -- CASCADE: hard-DELETE membership/identity projections anchored on user_id.
    -- These are derived "membership state" facts that no longer hold once the
    -- user is tombstoned; reversibility on undelete is via re-onboarding. The
    -- domain_events stream remains the audit trail. Audit-reference columns
    -- (assigned_by, created_by, granted_by, ...) live on OTHER rows and are
    -- untouched. NOTE: grant-revoke is handled by the AFTER-INSERT trigger in
    -- Section 2, NOT here (no emit_domain_event in this synchronous body).
    DELETE FROM public.user_roles_projection                    WHERE user_id = p_event.stream_id;
    DELETE FROM public.user_organizations_projection            WHERE user_id = p_event.stream_id;
    DELETE FROM public.user_notification_preferences_projection WHERE user_id = p_event.stream_id;
    DELETE FROM public.user_addresses                           WHERE user_id = p_event.stream_id;
    DELETE FROM public.user_phones                              WHERE user_id = p_event.stream_id;
    DELETE FROM public.user_client_assignments_projection       WHERE user_id = p_event.stream_id;
    DELETE FROM public.schedule_user_assignments_projection     WHERE user_id = p_event.stream_id;

    -- contacts_projection: preserve the contact entity (it may be referenced by
    -- other domain entities), drop only the user linkage. user_id is nullable;
    -- the partial UNIQUE index idx_contacts_unique_user_id WHERE user_id IS NOT
    -- NULL tolerates NULLs.
    UPDATE public.contacts_projection SET user_id = NULL WHERE user_id = p_event.stream_id;
END;
$function$;


-- -----------------------------------------------------------------------------
-- Section 2 — AFTER-INSERT trigger: revoke active grants whose consultant_user_id
-- is the deleted user. Event-chaining via AFTER-INSERT (sanctioned carve-out;
-- mirrors enqueue_workflow_from_bootstrap_event / bootstrap_workflow_trigger).
-- Runs after the outer user.deleted row is durable, so an inner emit failure
-- surfaces as processing_error on its OWN event row (retryable), not swallowed.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.emit_grant_revocations_on_user_deleted()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
    v_grant record;
BEGIN
    FOR v_grant IN
        SELECT id
        FROM public.cross_tenant_access_grants_projection
        WHERE consultant_user_id = NEW.stream_id
          AND status = 'active'
    LOOP
        -- Handler process_access_grant_event keys its UPDATE on event_data->>'grant_id'
        -- (NOT stream_id); set both. revoked_by NULL = automated (contract made
        -- nullable in this PR's AsyncAPI change).
        PERFORM api.emit_domain_event(
            p_stream_id      := v_grant.id,
            p_stream_type    := 'access_grant',
            p_event_type     := 'access_grant.revoked',
            p_event_data     := jsonb_build_object(
                'grant_id',           v_grant.id,
                'revoked_by',         NULL,
                'revocation_reason',  'consultant_user_deleted',
                'revocation_details', 'Consultant user was soft-deleted; grant auto-revoked by handle_user_deleted cascade.'
            ),
            p_event_metadata := jsonb_build_object(
                'automated', true,
                'source',    'handle_user_deleted_cascade',
                'user_id',   NULL,
                'reason',    'consultant_user_deleted'
            )
        );
    END LOOP;

    RETURN NULL;  -- AFTER trigger: return value ignored
END;
$function$;

DROP TRIGGER IF EXISTS emit_grant_revocations_on_user_deleted_trigger ON public.domain_events;
CREATE TRIGGER emit_grant_revocations_on_user_deleted_trigger
    AFTER INSERT ON public.domain_events
    FOR EACH ROW
    WHEN (NEW.event_type = 'user.deleted')
    EXECUTE FUNCTION public.emit_grant_revocations_on_user_deleted();


-- -----------------------------------------------------------------------------
-- Section 3 — pitfall #8 fail-loud assertion: every column the cascade writes
-- must exist on its target table, else the handler would deploy and only fail
-- when a user.deleted event arrives.
-- -----------------------------------------------------------------------------
DO $$
DECLARE
    v_targets text[][] := ARRAY[
        ARRAY['user_roles_projection','user_id'],
        ARRAY['user_organizations_projection','user_id'],
        ARRAY['user_notification_preferences_projection','user_id'],
        ARRAY['user_addresses','user_id'],
        ARRAY['user_phones','user_id'],
        ARRAY['user_client_assignments_projection','user_id'],
        ARRAY['schedule_user_assignments_projection','user_id'],
        ARRAY['contacts_projection','user_id'],
        ARRAY['cross_tenant_access_grants_projection','consultant_user_id'],
        ARRAY['cross_tenant_access_grants_projection','status']
    ];
    v_row text[];
    v_missing text[] := '{}';
BEGIN
    FOREACH v_row SLICE 1 IN ARRAY v_targets LOOP
        IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = v_row[1]
              AND column_name = v_row[2]
        ) THEN
            v_missing := array_append(v_missing, v_row[1] || '.' || v_row[2]);
        END IF;
    END LOOP;
    IF array_length(v_missing, 1) > 0 THEN
        RAISE EXCEPTION 'Cascade references non-existent columns: %', v_missing
            USING ERRCODE = 'P9099';
    END IF;
END $$;


-- -----------------------------------------------------------------------------
-- Section 4 — backfill: clean already-tombstoned users so projection state
-- matches the historical user.deleted events. Direct DELETEs (the user.deleted
-- event already exists; re-emitting would add audit noise). Covers all 3 arms.
-- Migration context (not a trigger) -> emit_domain_event for grant-revoke is
-- safe here. Dev targets today: 9 membership rows, 0 contacts, 0 active grants.
-- -----------------------------------------------------------------------------
DO $$
DECLARE
    v_user record;
    v_grant record;
BEGIN
    FOR v_user IN SELECT id FROM public.users WHERE deleted_at IS NOT NULL LOOP
        DELETE FROM public.user_roles_projection                    WHERE user_id = v_user.id;
        DELETE FROM public.user_organizations_projection            WHERE user_id = v_user.id;
        DELETE FROM public.user_notification_preferences_projection WHERE user_id = v_user.id;
        DELETE FROM public.user_addresses                           WHERE user_id = v_user.id;
        DELETE FROM public.user_phones                              WHERE user_id = v_user.id;
        DELETE FROM public.user_client_assignments_projection       WHERE user_id = v_user.id;
        DELETE FROM public.schedule_user_assignments_projection     WHERE user_id = v_user.id;
        UPDATE public.contacts_projection SET user_id = NULL        WHERE user_id = v_user.id;

        FOR v_grant IN
            SELECT id FROM public.cross_tenant_access_grants_projection
            WHERE consultant_user_id = v_user.id AND status = 'active'
        LOOP
            PERFORM api.emit_domain_event(
                p_stream_id      := v_grant.id,
                p_stream_type    := 'access_grant',
                p_event_type     := 'access_grant.revoked',
                p_event_data     := jsonb_build_object(
                    'grant_id',           v_grant.id,
                    'revoked_by',         NULL,
                    'revocation_reason',  'consultant_user_deleted',
                    'revocation_details', 'Backfill: consultant user already soft-deleted; grant auto-revoked.'
                ),
                p_event_metadata := jsonb_build_object(
                    'automated', true,
                    'source',    'handle_user_deleted_cascade_backfill',
                    'user_id',   NULL,
                    'reason',    'consultant_user_deleted'
                )
            );
        END LOOP;
    END LOOP;
END $$;
