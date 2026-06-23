-- =============================================================================
-- Anchor users.correlation_id on the user.synced_from_auth path (PR #83 Finding 1).
-- =============================================================================
--
-- PR #83 added users.correlation_id and anchored it in handle_user_created, but
-- NOT in handle_user_synced_from_auth — a LIVE path (OAuth signups; 3 events on
-- dev). Since the column is nullable/no-DEFAULT and the one-time backfill only
-- filled migration-time rows, any user created via auth-sync AFTER PR #83's
-- deploy would get correlation_id = NULL, falsifying the documented "never NULL /
-- one chain per user" invariant for that path. A DEFAULT would make it non-NULL
-- but NOT correctly chained (a random default ≠ the signup event's id), so the
-- anchor is required. This forward migration mirrors handle_user_created's anchor
-- into handle_user_synced_from_auth (the original migration is already applied
-- and immutable). Architect review: software-architect-dbc 2026-06-23.
--
-- Pitfall #6: body is the deployed pg_get_functiondef verbatim (a single users
-- upsert, no idempotency/PII/fan-out semantics) + ONLY the 3 anchor additions
-- (search "correlation"). Pitfall #8: column-existence assertion below.
-- =============================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='users' AND column_name='correlation_id'
  ) THEN
    RAISE EXCEPTION 'users.correlation_id missing (PR #83 prerequisite)' USING ERRCODE='P9099';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.handle_user_synced_from_auth(p_event record)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
BEGIN
  INSERT INTO users (
    id, email, name, is_active, correlation_id, created_at, updated_at  -- correlation: anchor column
  ) VALUES (
    (p_event.event_data->>'auth_user_id')::UUID,
    p_event.event_data->>'email',
    COALESCE(p_event.event_data->>'name', p_event.event_data->>'email'),
    COALESCE((p_event.event_data->>'is_active')::BOOLEAN, true),
    p_event.correlation_id,  -- correlation: anchor from the user.synced_from_auth event
    p_event.created_at,
    p_event.created_at
  )
  ON CONFLICT (id) DO UPDATE SET
    email = EXCLUDED.email,
    name = COALESCE(EXCLUDED.name, users.name),
    is_active = EXCLUDED.is_active,
    correlation_id = COALESCE(users.correlation_id, EXCLUDED.correlation_id),  -- correlation: keep-existing on replay
    updated_at = p_event.created_at;
END;
$function$;
