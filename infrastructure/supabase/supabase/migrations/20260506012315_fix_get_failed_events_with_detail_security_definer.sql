-- =====================================================================
-- Fix: api.get_failed_events_with_detail must run as SECURITY DEFINER
-- =====================================================================
--
-- Latent defect of the same class as PR #47 (api.update_role,
-- migration 20260506010451). `api.get_failed_events_with_detail` was
-- created in migration 20260430002824 as `SECURITY INVOKER` but reads
-- from `public.domain_events`. The `authenticated` Postgres role has
-- no table-level grants on `domain_events` (only `postgres` does), so
-- the SELECT raises SQLSTATE 42501 ("permission denied for table
-- domain_events") on the first invocation by any caller, surfacing as
-- HTTP 403.
--
-- Status: latent, not yet observed in production. Repo grep
-- (2026-05-06) shows zero call sites — `EventMonitoringService.ts`
-- consumes only `api.get_failed_events`, not `_with_detail`. The RPC
-- was added in 20260430002824 anticipating a future detail-view UI
-- that has not yet been wired. Closing the defect now prevents the
-- 403 from ever being observed by an end user.
--
-- Discovery: cross-product audit (2026-05-06) following the
-- `api.update_role` defect (PR #47). Audit query identified all
-- `api.*` SECURITY INVOKER functions whose `prosrc` references
-- `domain_events`; this RPC was the lone remaining offender after
-- `api.update_role` was fixed.
--
-- Why this is the safer of the two SECURITY mode flips
-- (architect review, software-architect-dbc, 2026-05-06):
--
--   1. The function's first executable statement is an explicit
--      permission gate:
--          IF NOT public.has_permission('platform.view_event_details')
--          THEN RAISE EXCEPTION ...
--      That gate reads JWT claims (session-bound, not role-bound) so
--      it survives the SECURITY mode flip unchanged.
--
--   2. The function has no tenancy dimension to lose. By design it
--      scans `domain_events` cross-tenant — it is a platform-admin
--      forensic tool. There is no RLS policy on `domain_events` that
--      a permission-passing caller was relying on for tenancy
--      isolation; `processing_error` rows already cross tenant
--      boundaries by virtue of the admin's role.
--
--   3. Unlike `api.update_role`, this RPC is read-only. There is no
--      subset-only delegation guard or projection write to reason
--      about under DEFINER.
--
-- Therefore, no in-body tenancy guard is required (compare PR #47
-- migration `20260506011954_add_update_role_tenancy_guard.sql`).
--
-- Fix: change `SECURITY INVOKER` to `SECURITY DEFINER`. Function body
-- and signature unchanged. The DEFINER (postgres role) has all
-- table-level grants on `domain_events` and `rolbypassrls=true`, so
-- the SELECT succeeds. The permission gate at line 1 of the body
-- continues to gate access via JWT claims.
--
-- Idempotency: `CREATE OR REPLACE FUNCTION` preserves the function's
-- OID. The existing `COMMENT ON FUNCTION` (carrying the
-- `@a4c-rpc-shape: envelope` tag from migration `20260430172625`'s
-- M3 backfill) is keyed to OID and therefore preserved
-- automatically. Per Rule 17 of `.claude/skills/infrastructure-
-- guidelines/SKILL.md`, the DROP+CREATE re-tag rule does NOT apply
-- here because we are NOT changing the function signature.
--
-- See:
--   - PR #47 (sibling fix): infrastructure/supabase/supabase/
--     migrations/20260506010451_fix_update_role_security_definer.sql
--   - documentation/architecture/decisions/adr-rpc-readback-pattern.md
--     §"PII handling"
--   - infrastructure/supabase/CLAUDE.md § Critical Rules
-- =====================================================================

CREATE OR REPLACE FUNCTION api.get_failed_events_with_detail(
    p_limit integer DEFAULT 50,
    p_offset integer DEFAULT 0
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
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
