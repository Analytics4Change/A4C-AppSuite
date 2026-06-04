-- ============================================================================
-- Phase 2 — Cross-tenant access grant write-side (VAR partnerships + grant
-- lifecycle emit RPCs).
--
-- Card: dev/active/cross-tenant-grant-phase-2-write-side/
-- Branch: feat/cross-tenant-grant-phase-2-write-side
-- ADR: documentation/architecture/decisions/adr-cross-tenant-access-grant-jwt-shape.md
--      Decisions C.1-C.5 (lines 177-367)
-- Parent card: dev/active/cross-tenant-access-grant-rollout/
--
-- Plan-mode architect review 2026-06-04: APPROVE WITH IN-PR FIXES;
-- 5 must-fix F1-F5 + 6 should-fix S1-S6 + 3 nits + 5 sub-decisions G-K.
-- All folded same-day; user-facing G/H/J answered via AskUserQuestion.
--
-- 18 manifest steps in this single transactional migration. Steps within
-- the same chunk land before architect review of that chunk per Phase 1
-- cadence.
--
-- Chunk 1 (this commit): Steps 1-3 schema cluster.
-- ============================================================================

-- Migration-session search_path: defensive for any future steps that
-- introduce extension-typed function parameters (ltree, etc.). Pre-codified
-- pitfall from PR #67 (function-attribute SET does not apply during
-- CREATE-time parameter parsing).
SET search_path TO 'public', 'extensions', 'pg_temp';

-- ============================================================================
-- Step 1 — CREATE TABLE public.var_partnerships_projection
-- ============================================================================
-- Per ADR Decision C.3 (lines 262-286) + sub-decision G (partial UNIQUE).
--
-- v1 scope: VAR partnerships only (per Phase 0.4 user-confirmed decision 1
-- — court/agency/family deferred to Phase N). VAR is provider <-> partner
-- (provider_partner org_type) business relationship that gates the
-- `_validate_authorization_var_contract` helper at Step 6.
--
-- 21 columns total: 13 business + 2 created/updated_at + 6 audit
-- (3 termination + 3 suspension).
--
-- IMPORTANT for downstream Steps 11-15 (VAR emit RPCs): all writes to this
-- table go through the event-sourced router (Step 4). No direct
-- INSERT/UPDATE/DELETE RLS policies (per Decision C.3 line 313).
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.var_partnerships_projection (
    -- Identity
    id                       uuid PRIMARY KEY,

    -- Partnership parties (FK to organizations_projection; denormalized
    -- names for display ergonomics per Decision C.3 line 289).
    -- F2 architect fold-in 2026-06-04: ON DELETE CASCADE matches the
    -- cross_tenant_access_grants_projection precedent at baseline_v4:14949
    -- + :14954. Projection rows are recomputable; the audit trail lives
    -- in domain_events (event-sourced).
    partner_org_id           uuid NOT NULL
                             REFERENCES public.organizations_projection(id)
                             ON DELETE CASCADE,
    partner_org_name         text NOT NULL,
    provider_org_id          uuid NOT NULL
                             REFERENCES public.organizations_projection(id)
                             ON DELETE CASCADE,
    provider_org_name        text NOT NULL,

    -- Business terms
    partnership_type         text NOT NULL
                             CHECK (partnership_type IN ('standard', 'white_label')),
    contract_number          text,
    contract_start_date      date NOT NULL,
    contract_end_date        date,
    revenue_share_percentage numeric(5,2),
    support_level            text
                             CHECK (support_level IN ('tier1', 'tier1_tier2', 'full')),
    -- F3 architect fold-in 2026-06-04: NOT NULL dropped to match ADR L274
    -- and cross_tenant_access_grants_projection.terms precedent
    -- (baseline_v4:12468). DEFAULT '{}' prevents bare-null INSERTs from
    -- event handlers that omit the column entirely.
    terms                    jsonb DEFAULT '{}'::jsonb,

    -- Lifecycle status. 4-value CHECK locked at Phase 0.4 decision 10.
    -- 'expired' is included as a future-reachable state — Phase 2 ships NO
    -- expired-event handler per user-locked decision 1 (2026-06-04);
    -- emitter for `var_partnership.expired` deferred to a follow-up card
    -- (which will also handle `access_grant.expired`).
    status                   text NOT NULL DEFAULT 'active'
                             CHECK (status IN ('active', 'expired', 'terminated', 'suspended')),

    -- Audit timestamps
    created_at               timestamptz NOT NULL DEFAULT now(),
    updated_at               timestamptz NOT NULL DEFAULT now(),

    -- Termination audit (populated on `var_partnership.terminated` event)
    terminated_at            timestamptz,
    terminated_by            uuid,
    termination_reason       text,

    -- Suspension audit (populated on `var_partnership.suspended` event;
    -- cleared on `var_partnership.reactivated`)
    suspended_at             timestamptz,
    suspended_by             uuid,
    suspension_reason        text
);

COMMENT ON TABLE public.var_partnerships_projection IS
$comment$VAR (Value-Added Reseller) partnership projection — read model for the
provider <-> provider_partner business relationship that gates cross-tenant
grants of authorization_type='var_contract'.

Write path: event-sourced via `var_partnership.*` event family
(created/updated/terminated/suspended/reactivated; NO `expired` per Phase 2
deferred decision). Handler is `public.process_var_partnership_event`
(Step 4 of this migration). No direct INSERT/UPDATE/DELETE — RLS posture
mirrors cross_tenant_access_grants_projection.

Pattern is forward-compatible with court/agency/family authorization types
(Phase N) — those types ship parallel `*_projection` tables under the same
template.

ADR: documentation/architecture/decisions/adr-cross-tenant-access-grant-jwt-shape.md
Decision C.3.$comment$;

-- ============================================================================
-- Step 1 (continued) — Partial UNIQUE per sub-decision G
-- ============================================================================
-- Architect-reviewed: full UNIQUE per ADR L285 would block re-establishment
-- of a terminated/expired partnership. Partial UNIQUE WHERE status IN
-- ('active', 'suspended') allows re-establishment via a NEW row while
-- preserving the terminated/expired audit trail. ADR addendum needed in
-- Stage D documenting this departure from L285.
--
-- Mirrors the idx_grant_role_templates_active partial-index precedent
-- from Phase 1.
-- ----------------------------------------------------------------------------

CREATE UNIQUE INDEX IF NOT EXISTS idx_var_partnerships_pair_active
    ON public.var_partnerships_projection (partner_org_id, provider_org_id)
    WHERE status IN ('active', 'suspended');

COMMENT ON INDEX idx_var_partnerships_pair_active IS
$comment$Partial UNIQUE constraint per sub-decision G (architect plan-review
2026-06-04). Departs from ADR L285's full UNIQUE to allow re-establishment
of a terminated/expired partnership via a new row. Terminated rows preserved
in the audit trail (status='terminated' indefinitely).

S2 architect fold-in 2026-06-04: this partial UNIQUE is enforced at row
INSERT time. Any future multi-event RPC that simultaneously terminates an
old row AND creates a new row for the same (partner_org_id, provider_org_id)
pair within the SAME transaction MUST sequence the UPDATE (status flip to
'terminated') BEFORE the INSERT, or the index will fire a uniqueness
violation. Phase 2 does NOT have any such RPC — termination
(api.terminate_var_partnership) and re-establishment
(api.create_var_partnership) are separate RPCs called by separate
transactions.$comment$;

-- ============================================================================
-- Step 2 — Row-Level Security (3 SELECT policies; NO write policies)
-- ============================================================================
-- Per ADR Decision C.3 lines 308-313. RLS posture mirrors
-- cross_tenant_access_grants_projection:
-- - Org-admin SELECT: caller has organization.view at partner_org OR provider_org
-- - Platform-admin SELECT: global via has_platform_privilege()
-- - service_role SELECT: explicit policy (service_role bypasses RLS by
--   default but explicit policy is documentation + defense-in-depth)
-- - NO consultant-direct table access — consultants only see partnership
--   context through their grant via Phase N read RPC (out of scope here)
-- - NO INSERT/UPDATE/DELETE policy — writes exclusively via SECURITY DEFINER
--   handler invoked by process_domain_event trigger
-- ----------------------------------------------------------------------------

ALTER TABLE public.var_partnerships_projection ENABLE ROW LEVEL SECURITY;

-- 2.a — org-admin SELECT (either side of the partnership)
DROP POLICY IF EXISTS var_partnerships_projection_org_admin_select
    ON public.var_partnerships_projection;
CREATE POLICY var_partnerships_projection_org_admin_select
    ON public.var_partnerships_projection
    FOR SELECT
    TO authenticated
    USING (
      public.has_effective_permission(
          'organization.view',
          (SELECT o.path FROM public.organizations_projection o
           WHERE o.id = partner_org_id AND o.deleted_at IS NULL)
      )
      OR
      public.has_effective_permission(
          'organization.view',
          (SELECT o.path FROM public.organizations_projection o
           WHERE o.id = provider_org_id AND o.deleted_at IS NULL)
      )
    );

COMMENT ON POLICY var_partnerships_projection_org_admin_select
    ON public.var_partnerships_projection IS
$comment$Either side of the partnership can read it. Uses scope-bound
permission check (organization.view at the org's live ltree path) rather
than the get_current_org_id()-based pattern on
cross_tenant_grants_org_admin_select (baseline_v4:15255).

DELIBERATE DEPARTURE from baseline_v4 precedent (F1 architect fold-in
2026-06-04): get_current_org_id() returns the session-active org pointer,
NOT a cross-tenant membership oracle — a partner consultant with a valid
grant has accessible_organizations @> [home, providerA] but
get_current_org_id() stays at home. The scope-bound check correctly admits
that consultant via their grant-projected effective_permissions entry at
the provider org path.

This also closes the deferred concern from pr-67-close-out.md (a): PR #66's
api.list_users tenancy guard is grant-incompatible for the same reason;
this RLS policy intentionally adopts the post-Phase-1 canonical form.

LOAD-BEARING: this same authority model gates the partnership.manage
permission used by Steps 11-15 emit RPCs. SELECT-RLS and write-path
authority MUST remain consistent — both use
has_effective_permission(perm, organizations_projection.path) at the
relevant org.$comment$;

-- 2.b — platform-admin SELECT (global)
DROP POLICY IF EXISTS var_partnerships_projection_platform_admin_select
    ON public.var_partnerships_projection;
CREATE POLICY var_partnerships_projection_platform_admin_select
    ON public.var_partnerships_projection
    FOR SELECT
    TO authenticated
    USING (public.has_platform_privilege());

COMMENT ON POLICY var_partnerships_projection_platform_admin_select
    ON public.var_partnerships_projection IS
$comment$Platform administrators see all VAR partnerships globally. Mirrors
the *_platform_admin_select policy shape across projections.$comment$;

-- 2.c — service_role SELECT (explicit; defense-in-depth)
DROP POLICY IF EXISTS var_partnerships_projection_service_role_select
    ON public.var_partnerships_projection;
CREATE POLICY var_partnerships_projection_service_role_select
    ON public.var_partnerships_projection
    FOR SELECT
    TO service_role
    USING (true);

COMMENT ON POLICY var_partnerships_projection_service_role_select
    ON public.var_partnerships_projection IS
$comment$Explicit policy makes service_role read intent grep-able from
pg_policies for security audits. service_role bypasses RLS at the engine
level, so removing this policy would NOT affect runtime behavior — but
it would remove the documentary audit trail. Mirrors
grant_role_templates_service_role_select Phase 1 precedent. (S3 architect
fold-in 2026-06-04 — original COMMENT was internally contradictory.)$comment$;

-- ============================================================================
-- Step 3 — Indexes (3 secondary + 1 partial UNIQUE already in Step 1)
-- ============================================================================
-- Per ADR Decision C.3 implicit + Phase 1 partial-index precedent:
-- - Active-partner-org and active-provider-org partial indexes for the
--   `_validate_authorization_var_contract` helper's hot path
-- - contract_end partial index for the future expiry-emitter job
-- ----------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_var_partnerships_partner_org_active
    ON public.var_partnerships_projection (partner_org_id)
    WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_var_partnerships_provider_org_active
    ON public.var_partnerships_projection (provider_org_id)
    WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_var_partnerships_contract_end
    ON public.var_partnerships_projection (contract_end_date)
    WHERE status = 'active' AND contract_end_date IS NOT NULL;

-- ============================================================================
-- End Chunk 1 (Steps 1-3 schema cluster).
-- Next chunks: Step 4-5 (router + dispatcher), 6-7b (helpers + permission
-- seed), 8 (create_access_grant), 9-10 (revoke), 11-15 (VAR lifecycle),
-- 16-17 (read + tags).
-- ============================================================================
