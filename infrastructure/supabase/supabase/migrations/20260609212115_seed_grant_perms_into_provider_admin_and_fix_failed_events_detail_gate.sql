-- ============================================================================
-- Followup from PR #71 (Phase 2 cross-tenant grant write-side) + PR #72
-- (docs-only seed cards + architect review N1 sibling defect)
--
-- This migration bundles two related authz fixes surfaced during Phase 2 UAT
-- prerequisite validation (dev probe 2026-06-09):
--
--   Section A — `grant.create` / `grant.revoke` / `grant.view` permissions
--   were seeded in `permissions_projection` by PR #70 (Phase 1) but never
--   extended into any `role_permission_templates`. The Phase 2 grant write-
--   side RPCs (`api.create_access_grant`, `api.revoke_access_grant`) gate on
--   `has_platform_privilege() OR has_effective_permission('grant.<x>', ...)`,
--   so the right-hand side never matches and only the platform-privilege
--   fallback works — provider admins (the intended authority per ADR
--   Decision C.1) are blocked. Card:
--   dev/active/seed-grant-create-grant-revoke-into-provider-admin-role-seed.md
--
--   Section B — `api.get_failed_events_with_detail` (PR #43-era admin RPC)
--   gates on `has_permission('platform.view_event_details')` ALONE with no
--   `has_platform_privilege()` fallback. The permission is in zero role
--   templates AND there's no implication chain from `platform.admin` to it,
--   so the RPC is currently uncallable by ANY caller including super_admin
--   (who holds `platform.admin` via direct seeding into
--   `role_permissions_projection`, no template). Architect N1 finding from
--   PR #72 review. **Architectural consolidation per user direction
--   2026-06-09**: retire `platform.view_event_details` (PR #43-era YAGNI
--   that never wired) and consolidate the gate to `has_platform_privilege()`
--   only — uniform with the other platform-tier RPCs
--   (`revoke_permission_across_grants`, `get_orphaned_deletions`,
--   `retry_deletion_workflow`). Post-migration `platform.*` family reduces
--   to `{platform.admin}` only. This closes 2 open seed cards
--   (`seed-platform-view-event-details-permission-seed.md` archived,
--   `seed-grant-create-grant-revoke-into-provider-admin-role-seed.md`
--   sibling-defect Out-of-scope note retired).
--
-- Section A is idempotent (ON CONFLICT DO NOTHING). Section B is
-- non-idempotent for the DELETE (re-running this migration after the row
-- is gone would be a no-op DELETE, which is fine, but the assertion would
-- fail on a fresh container before B's DELETE runs — the assertion is
-- specifically structured to allow this).
-- ============================================================================


-- ============================================================================
-- Section A — Seed grant.create / grant.revoke / grant.view into
--             provider_admin role template + backfill existing instances
-- ============================================================================
-- Mirrors PR #71 Step 7b L879-894 precedent verbatim: template INSERT followed
-- by direct INSERT into role_permissions_projection ON CONFLICT DO NOTHING.
-- Audit trail is the migration commit itself; events are the wrong layer for
-- bulk template-extension work.
--
-- Phase 1 seed reminder: the 3 grant.* permissions were created with
-- scope_type='global' in `permissions_projection`, but the gating RPCs call
-- has_effective_permission(perm, <ltree_path>) — scope-typed at runtime. This
-- works because compute_effective_permissions derives the per-grant scope from
-- user_roles_projection.scope_path regardless of permissions_projection.scope_type.
-- The catalog/runtime divergence is documented in
-- dev/active/seed-grant-create-grant-revoke-into-provider-admin-role-seed.md
-- per PR #72 architect S2 fold-in.

-- A.1 — Extend role_permission_templates (idempotent)
INSERT INTO public.role_permission_templates (role_name, permission_name, is_active)
VALUES
  ('provider_admin', 'grant.create', true),
  ('provider_admin', 'grant.revoke', true),
  ('provider_admin', 'grant.view',   true)
ON CONFLICT (role_name, permission_name) DO NOTHING;

-- A.2 — Backfill existing provider_admin role instances via direct INSERT
INSERT INTO public.role_permissions_projection (role_id, permission_id, granted_at)
SELECT rp.id AS role_id, pp.id AS permission_id, now() AS granted_at
FROM public.roles_projection rp
CROSS JOIN public.permissions_projection pp
WHERE rp.name = 'provider_admin' AND rp.deleted_at IS NULL
  AND pp.applet = 'grant' AND pp.action IN ('create', 'revoke', 'view')
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- A.3 — Assertion (parametric per PR #72 N2 architect fold-in)
-- Expected post-migration: every active provider_admin instance has
-- (3 new grant.* + 1 pre-existing partnership.manage) = 4 perms from these
-- two waves. Asserting both for fail-loud regression coverage.
DO $$
DECLARE
  v_instance_count int;
  v_grant_perm_rows int;
  v_partnership_perm_rows int;
BEGIN
  SELECT COUNT(*) INTO v_instance_count
  FROM public.roles_projection
  WHERE name='provider_admin' AND deleted_at IS NULL;

  SELECT COUNT(*) INTO v_grant_perm_rows
  FROM public.roles_projection r
  JOIN public.role_permissions_projection rp ON rp.role_id = r.id
  JOIN public.permissions_projection p ON p.id = rp.permission_id
  WHERE r.name='provider_admin' AND r.deleted_at IS NULL
    AND p.applet='grant' AND p.action IN ('create','revoke','view');

  SELECT COUNT(*) INTO v_partnership_perm_rows
  FROM public.roles_projection r
  JOIN public.role_permissions_projection rp ON rp.role_id = r.id
  JOIN public.permissions_projection p ON p.id = rp.permission_id
  WHERE r.name='provider_admin' AND r.deleted_at IS NULL
    AND p.applet='partnership' AND p.action='manage';

  IF v_grant_perm_rows <> 3 * v_instance_count THEN
    RAISE EXCEPTION 'Section A assertion failed: expected % grant.* rows (3 x % instances), got %',
      3 * v_instance_count, v_instance_count, v_grant_perm_rows
      USING ERRCODE = 'P9099';
  END IF;
  IF v_partnership_perm_rows <> v_instance_count THEN
    RAISE EXCEPTION 'Section A assertion failed: expected % partnership.manage rows (1 x % instances), got %',
      v_instance_count, v_instance_count, v_partnership_perm_rows
      USING ERRCODE = 'P9099';
  END IF;

  RAISE NOTICE 'Section A assertion PASS: provider_admin instances=%, grant.* rows=%, partnership.manage rows=%',
    v_instance_count, v_grant_perm_rows, v_partnership_perm_rows;
END $$;


-- ============================================================================
-- Section B — Consolidate api.get_failed_events_with_detail to uniform
--             has_platform_privilege() gating + retire platform.view_event_details
-- ============================================================================
-- Per codified pitfall #6 (PR #71 Chunk 2 architect finding): BEFORE
-- CREATE OR REPLACE on a pre-existing function, the deployed body was fetched
-- via Mgmt API pg_get_functiondef. The body below preserves every line of the
-- deployed version verbatim EXCEPT the IF check on the permission gate.
-- CREATE OR REPLACE with the same signature (p_limit int, p_offset int)
-- preserves the OID — but we REFRESH COMMENT ON FUNCTION explicitly below
-- because the old comment text claimed "Gated by platform.view_event_details"
-- which is no longer true under Design B.
--
-- Architectural rationale: All sibling platform-tier RPCs gate uniformly on
-- has_platform_privilege() (revoke_permission_across_grants,
-- get_orphaned_deletions, retry_deletion_workflow). platform.view_event_details
-- was PR #43-era YAGNI — defined but never extended into any role template,
-- never derived via implication chain, granted to zero callers. The gate's
-- design intent ("PHI-sensitive detail view gated separately from generic
-- platform-admin access") never reached implementation. Trade-off accepted:
-- ALL platform admins now see the failed-event detail view; the
-- platform-admin set is small (super_admin on dev) and the PHI risk is
-- considered acceptable under uniform platform-tier gating.

-- B.1 — Update function body (gate consolidated to has_platform_privilege())
CREATE OR REPLACE FUNCTION api.get_failed_events_with_detail(p_limit integer DEFAULT 50, p_offset integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
    v_events jsonb;
BEGIN
    -- Permission gate. RAISE EXCEPTION here is permitted (RPC entry guard, not handler-driven).
    -- 2026-06-09 architectural consolidation (PR #72 architect N1 + user direction):
    -- gate uniformly to has_platform_privilege(); platform.view_event_details retired
    -- (PR #43-era YAGNI). Matches sibling platform-tier RPCs
    -- (revoke_permission_across_grants, get_orphaned_deletions, retry_deletion_workflow).
    IF NOT public.has_platform_privilege() THEN
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
$function$;

-- B.2 — Refresh COMMENT ON FUNCTION (CREATE OR REPLACE preserved OID + comment,
-- but the OLD text claimed "Gated by platform.view_event_details" which is now
-- wrong. We preserve the @a4c-* tags from the original deployed comment
-- (fetched via pg_description.description); only the prose changes.)
COMMENT ON FUNCTION api.get_failed_events_with_detail(integer, integer) IS
$comment$Admin RPC for failed-event forensic detail. Platform-admin gated (has_platform_privilege()). Returns processing_error AND raw PG_EXCEPTION_DETAIL captured at handler-failure time.

@a4c-rpc-shape: envelope

@a4c-bucket: E
@a4c-consultant-callable: yes
@a4c-consultant-callable-reason: No tenancy context; grant-irrelevant by default. Per-RPC sub-classification ([admin-only] / [service-role-only] / [pre-auth] / [emitter-primitive]) deferred to follow-up.
@a4c-phase-target: none$comment$;

-- B.3 — Refresh COMMENT ON COLUMN public.domain_events.processing_error_detail
-- (the old text from migration 20260430002824:38 claimed "Access only via
-- api.get_failed_events_with_detail() gated on platform.view_event_details"
-- which is now misleading).
COMMENT ON COLUMN public.domain_events.processing_error_detail IS
  'Raw PG_EXCEPTION_DETAIL captured at handler-failure time. PHI-bearing. Access via api.get_failed_events_with_detail() (platform-admin gated via has_platform_privilege()). Service role (workflows) bypasses RLS — direct table reads acceptable for server-side forensic queries.';

-- B.4 — Retire platform.view_event_details permission via direct DELETE.
-- Audit-trail caveat: there is no permission.deleted event family in the
-- rbac router (handlers/routers/process_rbac_event.sql L15-16 has only
-- permission.defined + permission.updated). Emitting permission.deleted
-- would fall through to the router ELSE and raise P9001 (codified pitfall).
-- Direct DELETE is acceptable for registry-tier cleanup where:
--   (a) the row has never been granted to any role template (verified
--       2026-06-09 dev probe: 0 rows in role_permission_templates),
--   (b) no implications reference it (0 rows in permission_implications),
--   (c) no role_permissions_projection rows depend on it (0 rows),
--   (d) the only gate that referenced it has been updated in B.1 above,
--   (e) the audit trail is the migration commit itself.
-- Pattern is analogous to dropping an unused enum value or column — registry
-- maintenance, not user-tier auditable state.
DELETE FROM public.permissions_projection
WHERE applet='platform' AND action='view_event_details';

-- B.5 — Assertions (fail-loud) for Section B consolidation
DO $$
BEGIN
  -- Gate change verified: old gate string MUST NOT be present
  IF pg_get_functiondef('api.get_failed_events_with_detail(integer, integer)'::regprocedure)
     ~ 'has_permission\(''platform\.view_event_details''\)' THEN
    RAISE EXCEPTION 'Section B.1 assertion failed: gate still references retired platform.view_event_details permission'
      USING ERRCODE = 'P9099';
  END IF;
  -- Gate change verified: new gate string MUST be present
  IF NOT pg_get_functiondef('api.get_failed_events_with_detail(integer, integer)'::regprocedure)
         ~ 'IF NOT public\.has_platform_privilege\(\)' THEN
    RAISE EXCEPTION 'Section B.1 assertion failed: has_platform_privilege() gate not present in deployed body'
      USING ERRCODE = 'P9099';
  END IF;
  -- COMMENT ON FUNCTION refresh verified: old prose gone
  IF (SELECT d.description FROM pg_proc p
        JOIN pg_namespace n ON p.pronamespace=n.oid
        LEFT JOIN pg_description d ON d.objoid=p.oid AND d.objsubid=0
        WHERE n.nspname='api' AND p.proname='get_failed_events_with_detail')
     ~ 'Gated by platform\.view_event_details' THEN
    RAISE EXCEPTION 'Section B.2 assertion failed: COMMENT ON FUNCTION still claims old gate'
      USING ERRCODE = 'P9099';
  END IF;
  -- @a4c-* tags preserved in refreshed comment
  IF NOT (SELECT d.description FROM pg_proc p
            JOIN pg_namespace n ON p.pronamespace=n.oid
            LEFT JOIN pg_description d ON d.objoid=p.oid AND d.objsubid=0
            WHERE n.nspname='api' AND p.proname='get_failed_events_with_detail')
         ~ '@a4c-rpc-shape:\s*envelope' THEN
    RAISE EXCEPTION 'Section B.2 assertion failed: @a4c-rpc-shape tag lost during COMMENT refresh (M3 regression)'
      USING ERRCODE = 'P9099';
  END IF;
  -- B.3 — COMMENT ON COLUMN refresh verified (S2 architect fold-in 2026-06-09):
  -- symmetric to the COMMENT ON FUNCTION assertions above. If a future copy-paste
  -- or downstream migration accidentally re-applies the PR #43 column comment,
  -- this assertion fails-loud rather than letting the stale prose silently re-appear
  -- in pg_description.
  IF col_description(
       (SELECT oid FROM pg_class
         WHERE relnamespace=(SELECT oid FROM pg_namespace WHERE nspname='public')
           AND relname='domain_events'),
       (SELECT attnum FROM pg_attribute
         WHERE attrelid=(SELECT oid FROM pg_class
                          WHERE relnamespace=(SELECT oid FROM pg_namespace WHERE nspname='public')
                            AND relname='domain_events')
           AND attname='processing_error_detail')
     ) ~ 'platform\.view_event_details' THEN
    RAISE EXCEPTION 'Section B.3 assertion failed: COMMENT ON COLUMN processing_error_detail still references retired permission'
      USING ERRCODE = 'P9099';
  END IF;
  -- Permission removed from registry
  IF EXISTS (SELECT 1 FROM public.permissions_projection
             WHERE applet='platform' AND action='view_event_details') THEN
    RAISE EXCEPTION 'Section B.4 assertion failed: platform.view_event_details still present in permissions_projection'
      USING ERRCODE = 'P9099';
  END IF;
  -- Sanity: platform.admin (the magic permission) MUST still be present
  IF NOT EXISTS (SELECT 1 FROM public.permissions_projection
                 WHERE applet='platform' AND action='admin') THEN
    RAISE EXCEPTION 'Section B.4 assertion failed: platform.admin missing from permissions_projection (DELETE overscoped?)'
      USING ERRCODE = 'P9099';
  END IF;
  RAISE NOTICE 'Section B assertion PASS: gate consolidated to has_platform_privilege(); platform.view_event_details retired; @a4c-* tags preserved; platform.admin intact';
END $$;
