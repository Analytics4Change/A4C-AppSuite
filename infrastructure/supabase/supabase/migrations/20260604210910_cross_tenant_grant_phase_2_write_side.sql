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
-- ============================================================================

-- ============================================================================
-- Step 4.0 — safe_jsonb_extract_numeric helper (F2 architect fold-in 2026-06-04)
-- ============================================================================
-- The existing safe_jsonb_extract_* family has 6 helpers (boolean, date,
-- organization_id, text, timestamp, uuid) but NO numeric variant. Phase 2
-- introduces the first numeric column (revenue_share_percentage) consumed
-- via event_data. Per architect F2: adding the 7th helper closes a
-- forward-incompatibility pitfall — using inline `NULLIF(..., '')::numeric`
-- would silently coerce empty-string to NULL, hiding malformed-numeric
-- errors. The helper matches the safe_jsonb_extract_date precedent
-- (COALESCE-with-default; throws on malformed input, caught by
-- process_domain_event's WHEN OTHERS → persisted to processing_error).
--
-- Column-level precision (numeric(5,2)) is enforced at assignment, NOT in
-- the helper signature (the helper is generic; the column is typed).
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.safe_jsonb_extract_numeric(
    p_data    jsonb,
    p_key     text,
    p_default numeric DEFAULT NULL
)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
  SELECT COALESCE((p_data->>p_key)::numeric, p_default);
$function$;

COMMENT ON FUNCTION public.safe_jsonb_extract_numeric(jsonb, text, numeric) IS
$comment$7th member of the safe_jsonb_extract_* helper family (added Phase 2
2026-06-04 per architect F2). Returns the value of p_key as numeric, or
p_default if missing/null. Throws on malformed numeric input (caught
upstream by process_domain_event's WHEN OTHERS handler — fail-loud is the
correct behavior; silent empty-string-to-NULL coercion is anti-canonical).

Symmetric with safe_jsonb_extract_date body shape. Column-level precision
(e.g., numeric(5,2)) is enforced at column assignment, not in the helper
signature.$comment$;

-- ============================================================================
-- Step 4 — process_var_partnership_event router (5-arm INLINE CASE)
-- ============================================================================
-- Per ADR Decision C.3 line 304 + sub-decision F (inline handlers, no
-- delegated handle_* functions, matches process_access_grant_event
-- precedent).
--
-- 5 event types per user-locked decision 1 (2026-06-04): NO `expired` arm.
-- The 'expired' status remains valid in Step 1's CHECK constraint as a
-- future-reachable state; the emitter ships in a follow-up card (which
-- also covers access_grant.expired).
--
-- Event payload schemas (handler input contract) per plan.md § "Event
-- payload schemas":
--   created      — 11 keys: partner/provider_org_id+name (4), partnership_
--                  type, contract_number, contract_start_date,
--                  contract_end_date, revenue_share_percentage,
--                  support_level, terms
--   updated      — PATCH semantics; only non-null keys overwrite; immutable
--                  fields excluded (id, partner_org_id, provider_org_id,
--                  contract_start_date)
--   terminated   — terminated_by (uuid, falls back to event_metadata.user_id),
--                  termination_reason (text)
--   suspended    — suspended_by, suspension_reason
--   reactivated  — clears suspension fields; status flips to 'active'.
--                  (No reactivated_at/by columns on the projection per
--                  ADR L262-286; the audit lives in domain_events.)
--
-- Codified pitfall #4: NEVER use `EXCEPTION WHEN unique_violation` inside
-- handler bodies — process_domain_event's WHEN OTHERS catches the violation
-- upstream and persists a stale failed event. For the `created` handler,
-- the partial UNIQUE on (partner_org_id, provider_org_id) WHERE status IN
-- ('active','suspended') is enforced by the emit RPC's precondition check
-- (Step 11), NOT by handler-level exception handling.
--
-- Lifecycle UPDATE handlers (updated/terminated/suspended/reactivated)
-- check IF NOT FOUND after the UPDATE and RAISE EXCEPTION P0002 if the
-- target row is missing — proper Pattern A v2 propagation back to the
-- emit RPC's readback.
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.process_var_partnership_event(p_event record)
RETURNS void
LANGUAGE plpgsql
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
BEGIN
  CASE p_event.event_type

    WHEN 'var_partnership.created' THEN
      -- F1 architect fold-in 2026-06-04: idempotency guard on stream_id
      -- replay. The Step 11 emit RPC enforces the duplicate-business-key
      -- precondition (partner_org_id, provider_org_id) via partial UNIQUE;
      -- this guard handles the orthogonal axis (same stream_id replay
      -- under retry / baseline rebuild). Without this, retry produces a
      -- stale failed event per codified pitfall #4 (EXCEPTION WHEN
      -- unique_violation is dead code).
      --
      -- N1 architect fold-in: created_at + updated_at use p_event.created_at
      -- per access_grant.created precedent (handlers/routers/
      -- process_access_grant_event.sql:36). Column DEFAULT now() at Step 1
      -- is a belt-and-suspenders guard against the never-permitted
      -- direct-INSERT path.
      IF EXISTS (
        SELECT 1 FROM public.var_partnerships_projection
        WHERE id = p_event.stream_id
      ) THEN
        RETURN;
      END IF;
      INSERT INTO public.var_partnerships_projection (
        id,
        partner_org_id, partner_org_name,
        provider_org_id, provider_org_name,
        partnership_type, contract_number,
        contract_start_date, contract_end_date,
        revenue_share_percentage, support_level,
        terms, status,
        created_at, updated_at
      ) VALUES (
        p_event.stream_id,
        public.safe_jsonb_extract_uuid(p_event.event_data, 'partner_org_id'),
        public.safe_jsonb_extract_text(p_event.event_data, 'partner_org_name'),
        public.safe_jsonb_extract_uuid(p_event.event_data, 'provider_org_id'),
        public.safe_jsonb_extract_text(p_event.event_data, 'provider_org_name'),
        public.safe_jsonb_extract_text(p_event.event_data, 'partnership_type'),
        public.safe_jsonb_extract_text(p_event.event_data, 'contract_number'),
        public.safe_jsonb_extract_date(p_event.event_data, 'contract_start_date'),
        public.safe_jsonb_extract_date(p_event.event_data, 'contract_end_date'),
        public.safe_jsonb_extract_numeric(p_event.event_data, 'revenue_share_percentage'),
        public.safe_jsonb_extract_text(p_event.event_data, 'support_level'),
        COALESCE(p_event.event_data->'terms', '{}'::jsonb),
        'active',
        p_event.created_at,
        p_event.created_at
      );

    WHEN 'var_partnership.updated' THEN
      -- PATCH semantics: only non-null keys overwrite. Immutable fields
      -- (id, partner_org_id, provider_org_id, contract_start_date) are
      -- not included.
      --
      -- S1 architect fold-in 2026-06-04: an `updated` event with no
      -- mutable keys still advances updated_at = p_event.created_at. This
      -- is intentional — the event itself IS the change-record; the
      -- projection's substantive columns may legitimately be stable
      -- (e.g., audit-only update). The Step 12 api.update_var_partnership
      -- emit RPC SHOULD reject empty-payload calls at the precondition
      -- layer.
      UPDATE public.var_partnerships_projection
      SET
        partner_org_name = COALESCE(
          public.safe_jsonb_extract_text(p_event.event_data, 'partner_org_name'),
          partner_org_name
        ),
        provider_org_name = COALESCE(
          public.safe_jsonb_extract_text(p_event.event_data, 'provider_org_name'),
          provider_org_name
        ),
        partnership_type = COALESCE(
          public.safe_jsonb_extract_text(p_event.event_data, 'partnership_type'),
          partnership_type
        ),
        contract_number = COALESCE(
          public.safe_jsonb_extract_text(p_event.event_data, 'contract_number'),
          contract_number
        ),
        contract_end_date = COALESCE(
          public.safe_jsonb_extract_date(p_event.event_data, 'contract_end_date'),
          contract_end_date
        ),
        revenue_share_percentage = COALESCE(
          public.safe_jsonb_extract_numeric(p_event.event_data, 'revenue_share_percentage'),
          revenue_share_percentage
        ),
        support_level = COALESCE(
          public.safe_jsonb_extract_text(p_event.event_data, 'support_level'),
          support_level
        ),
        terms = COALESCE(p_event.event_data->'terms', terms),
        updated_at = p_event.created_at
      WHERE id = p_event.stream_id;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'Partnership not found for var_partnership.updated'
          USING ERRCODE = 'P0002';
      END IF;

    WHEN 'var_partnership.terminated' THEN
      UPDATE public.var_partnerships_projection
      SET status = 'terminated',
          terminated_at = p_event.created_at,
          terminated_by = COALESCE(
            public.safe_jsonb_extract_uuid(p_event.event_data, 'terminated_by'),
            public.safe_jsonb_extract_uuid(p_event.event_metadata, 'user_id')
          ),
          termination_reason = public.safe_jsonb_extract_text(p_event.event_data, 'termination_reason'),
          updated_at = p_event.created_at
      WHERE id = p_event.stream_id;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'Partnership not found for var_partnership.terminated'
          USING ERRCODE = 'P0002';
      END IF;

    WHEN 'var_partnership.suspended' THEN
      UPDATE public.var_partnerships_projection
      SET status = 'suspended',
          suspended_at = p_event.created_at,
          suspended_by = COALESCE(
            public.safe_jsonb_extract_uuid(p_event.event_data, 'suspended_by'),
            public.safe_jsonb_extract_uuid(p_event.event_metadata, 'user_id')
          ),
          suspension_reason = public.safe_jsonb_extract_text(p_event.event_data, 'suspension_reason'),
          updated_at = p_event.created_at
      WHERE id = p_event.stream_id;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'Partnership not found for var_partnership.suspended'
          USING ERRCODE = 'P0002';
      END IF;

    WHEN 'var_partnership.reactivated' THEN
      -- Clear suspension fields, restore status='active'. No reactivated_at
      -- column on the projection (per ADR L262-286); audit lives in
      -- domain_events.
      UPDATE public.var_partnerships_projection
      SET status = 'active',
          suspended_at = NULL,
          suspended_by = NULL,
          suspension_reason = NULL,
          updated_at = p_event.created_at
      WHERE id = p_event.stream_id;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'Partnership not found for var_partnership.reactivated'
          USING ERRCODE = 'P0002';
      END IF;

    ELSE
      -- Codified pattern: router ELSE must RAISE EXCEPTION (NOT WARNING).
      -- WHEN OTHERS in process_domain_event catches this and persists the
      -- error to domain_events.processing_error. ERRCODE P9001 follows
      -- the access_grant router precedent.
      RAISE EXCEPTION 'Unhandled event type "%" in process_var_partnership_event',
        p_event.event_type
        USING ERRCODE = 'P9001';
  END CASE;
END;
$function$;

COMMENT ON FUNCTION public.process_var_partnership_event(record) IS
$comment$Event router for the var_partnership.* event family.

Handles 5 event types via inline CASE (no delegation to handle_* functions
per sub-decision F mirroring process_access_grant_event precedent):
  created      — INSERT row from event_data
  updated      — UPDATE with PATCH semantics (non-null keys overwrite)
  terminated   — UPDATE status + audit columns
  suspended    — UPDATE status + audit columns
  reactivated  — UPDATE status='active'; clear suspension audit fields

NO `expired` handler (deferred to follow-up card per user-locked
decision 1, 2026-06-04). The 'expired' status remains valid in the
CHECK constraint as a future-reachable state.

Invariant: ELSE clause raises P9001 (codified rule: router ELSE never
RAISE WARNING — that would mark the event silently processed).

Phase 2 manifest Step 4 — branched from process_domain_event dispatcher
via Step 5.$comment$;

-- ============================================================================
-- Step 5 — Dispatcher CASE extension (add var_partnership branch)
-- ============================================================================
-- Per ADR Decision C.3 line 304. Extends public.process_domain_event() to
-- route stream_type='var_partnership' events to the router defined above.
--
-- Reference file divergence (per observations.md sub-decision E): the
-- canonical reference at handlers/trigger/process_domain_event.sql has
-- 8 additional stream_types vs baseline_v4 (`schedule`,
-- `client_field_definition`, `client_field_category`, `client`, plus
-- refined junction exclusion). The reference file is canonical for
-- post-migration state. Phase 2 adds `var_partnership` to BOTH the
-- baseline diff (this Step) AND the reference file (Stage D). Pre-existing
-- 8-stream-type drift remains out of scope.
--
-- Implementation: full CREATE OR REPLACE of the dispatcher to add the
-- new branch. Body matches the reference file at
-- infrastructure/supabase/handlers/trigger/process_domain_event.sql
-- (post-Phase-1 state) plus the new WHEN 'var_partnership' arm.
-- ----------------------------------------------------------------------------

-- IMPORTANT: this CREATE OR REPLACE preserves the FULL deployed body verbatim
-- and adds only the WHEN 'var_partnership' branch + the dispatcher version
-- COMMENT. The deployed body includes:
--   (a) processed_at idempotency guard at top
--   (b) PII three-layer model (PR #43): MESSAGE_TEXT → processing_error,
--       PG_EXCEPTION_DETAIL → processing_error_detail (gated read via
--       api.get_failed_events_with_detail behind platform.view_event_details)
--   (c) RAISE WARNING in EXCEPTION handler for operator debug visibility
--   (d) clock_timestamp() (NOT now() — clock_timestamp is the "wall clock"
--       reading; now() is transaction-start)
--   (e) ERRCODE P9002 for unknown stream_type (NOT P9001 — distinct from
--       router-internal ELSE ERRCODE)
-- Source: pg_proc body of deployed process_domain_event on dev verified
-- 2026-06-04 via Mgmt API SQL endpoint.

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
                WHEN 'role'                     THEN PERFORM process_rbac_event(NEW);
                WHEN 'permission'               THEN PERFORM process_rbac_event(NEW);
                WHEN 'user'                     THEN PERFORM process_user_event(NEW);
                WHEN 'organization'             THEN PERFORM process_organization_event(NEW);
                WHEN 'organization_unit'        THEN PERFORM process_organization_unit_event(NEW);
                WHEN 'schedule'                 THEN PERFORM process_schedule_event(NEW);
                WHEN 'contact'                  THEN PERFORM process_contact_event(NEW);
                WHEN 'address'                  THEN PERFORM process_address_event(NEW);
                WHEN 'phone'                    THEN PERFORM process_phone_event(NEW);
                WHEN 'email'                    THEN PERFORM process_email_event(NEW);
                WHEN 'invitation'               THEN PERFORM process_invitation_event(NEW);
                WHEN 'access_grant'             THEN PERFORM process_access_grant_event(NEW);
                WHEN 'impersonation'            THEN PERFORM process_impersonation_event(NEW);
                WHEN 'client_field_definition'  THEN PERFORM process_client_field_definition_event(NEW);
                WHEN 'client_field_category'    THEN PERFORM process_client_field_category_event(NEW);
                WHEN 'client'                   THEN PERFORM process_client_event(NEW);
                -- Phase 2 (this migration) — VAR partnership lifecycle events
                WHEN 'var_partnership'          THEN PERFORM process_var_partnership_event(NEW);
                -- Administrative stream_types — No projection needed
                WHEN 'platform_admin'           THEN NULL;
                WHEN 'workflow_queue'           THEN NULL;
                WHEN 'test'                     THEN NULL;
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

COMMENT ON FUNCTION public.process_domain_event() IS
$comment$Single dispatcher for the domain_events BEFORE INSERT/UPDATE
trigger. Routes by stream_type to one of the per-aggregate routers, or
absorbs administrative types silently.

Phase 2 (2026-06-04): added WHEN 'var_partnership' branch for VAR
partnership lifecycle events.

Per codified guard rail (CLAUDE.md § Event Processing Architecture):
- Single trigger; never create per-event-type triggers
- Dispatcher ELSE raises P9002 (unknown stream_type) — RAISE EXCEPTION,
  never WARNING. Distinct ERRCODE from router ELSEs (P9001 = unknown
  event_type within a known stream_type — see process_var_partnership_event
  and process_access_grant_event precedent). N2 architect fold-in 2026-06-04.
- WHEN OTHERS sets processing_error so the trigger persists the row even
  on handler failure (Pattern A v2 audit-preservation contract)
- Junction pre-route ($linked/$unlinked) excludes contact.user.{linked,
  unlinked} per the 2026-02-20 exclusion list

Reference file (canonical post-migration state):
infrastructure/supabase/handlers/trigger/process_domain_event.sql$comment$;

-- ============================================================================
-- End Chunk 2 (Steps 4-5 event-processing cluster).
-- ============================================================================

-- ============================================================================
-- Step 6 — public._validate_authorization_var_contract helper
-- ============================================================================
-- Per ADR Decision C.1 line 205 + sub-decision A (underscore-prefix
-- private-helper convention codified Phase 2).
--
-- Called by api.create_access_grant (Step 8) via dispatcher CASE on
-- p_authorization_type. Verifies that the (consultant_org, provider_org,
-- partnership_ref) triple corresponds to an ACTIVE VAR partnership row.
-- Returns FALSE if no active row matches (api.create_access_grant raises
-- a typed envelope error in that case).
--
-- Architect-approved naming convention (Phase 2 architect plan-mode review
-- 2026-06-04 + sub-decision A + Stage B S1 verification — zero pre-existing
-- public._* functions on prod): the underscore prefix signals "private; do
-- not call directly from frontend or Edge Functions; call via the
-- documented api.* RPC that wraps the helper". Codified in
-- infrastructure/supabase/CLAUDE.md as part of Phase 2 Stage D documentation.
--
-- Hard GRANT posture (architect S1): REVOKE ALL FROM PUBLIC, anon,
-- authenticated; GRANT EXECUTE TO service_role ONLY.
--
-- SECURITY DEFINER is FUNCTIONALLY REDUNDANT under the service_role-only
-- GRANT (service_role bypasses RLS at the engine level on Supabase, so
-- INVOKER would produce identical behavior). Retained for: (a) future-
-- flexibility if the GRANT widens to other roles, (b) symmetry with Step 7
-- and Phase N validators that share the same shape, (c) defense-in-depth —
-- explicit authority is documented in the function definition.
-- (S1.a architect fold-in 2026-06-04 Chunk 3 review — original comment
-- falsely implied SECURITY DEFINER was load-bearing for RLS bypass.)
--
-- NOTE on status filter: 'suspended' partnerships are NOT accepted (a
-- suspended partnership is an explicit pause; new grant issuance against
-- it would defeat the suspension intent). Only 'active' qualifies.
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public._validate_authorization_var_contract(
    p_reference         uuid,
    p_consultant_org_id uuid,
    p_provider_org_id   uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.var_partnerships_projection
    WHERE id = p_reference
      AND partner_org_id = p_consultant_org_id
      AND provider_org_id = p_provider_org_id
      AND status = 'active'
  );
$function$;

REVOKE ALL ON FUNCTION public._validate_authorization_var_contract(uuid, uuid, uuid)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._validate_authorization_var_contract(uuid, uuid, uuid)
    TO service_role;

COMMENT ON FUNCTION public._validate_authorization_var_contract(uuid, uuid, uuid) IS
$comment$Private helper invoked by api.create_access_grant when
p_authorization_type='var_contract'. Validates that an ACTIVE VAR
partnership row exists matching the triple (id, partner_org_id,
provider_org_id). Returns FALSE when no active row qualifies.

Underscore-prefix convention (Phase 2): signals "private SQL helper; not
exposed via PostgREST; call via wrapping api.* RPC". GRANT posture:
service_role ONLY (REVOKE ALL FROM PUBLIC, anon, authenticated).

The 'suspended' status is intentionally EXCLUDED — a suspended
partnership is a paused state; new grant issuance against it would
defeat the suspension semantic. Re-establishing the partnership
(api.reactivate_var_partnership) is the prerequisite for new grant
creation.

ADR Decision C.1 line 205.$comment$;

-- ============================================================================
-- Step 7 — public._validate_authorization_emergency_access helper
-- ============================================================================
-- Per ADR Decision C.1 line 205. Emergency-access grants do NOT require
-- a backing partnership/authorization record — they are explicit one-off
-- HIPAA emergency-access events (e.g., breach response, immediate clinical
-- need). The helper accepts NULL p_reference and unconditionally returns
-- TRUE.
--
-- The api.create_access_grant body (Step 8) enforces additional invariants
-- for emergency_access: p_authorization_reference MUST be NULL (the CHECK
-- constraint at cross_tenant_access_grants_projection_authorization_
-- reference_check from Phase 1 Step 14 enforces this at the projection
-- layer too).
--
-- Same GRANT posture + SECURITY DEFINER as Step 6 for symmetry.
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public._validate_authorization_emergency_access(
    p_reference         uuid,
    p_consultant_org_id uuid,
    p_provider_org_id   uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
  -- Emergency-access does not require backing record validation; accepts
  -- NULL p_reference. p_consultant_org_id + p_provider_org_id are kept
  -- in the signature for uniformity with sibling validators
  -- (Phase N may add court/agency/family helpers with the same signature).
  SELECT TRUE;
$function$;

REVOKE ALL ON FUNCTION public._validate_authorization_emergency_access(uuid, uuid, uuid)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._validate_authorization_emergency_access(uuid, uuid, uuid)
    TO service_role;

COMMENT ON FUNCTION public._validate_authorization_emergency_access(uuid, uuid, uuid) IS
$comment$Private helper invoked by api.create_access_grant when
p_authorization_type='emergency_access'. Unconditionally returns TRUE —
emergency-access grants do not require a backing partnership/authorization
record (the HIPAA-emergency semantic is the justification, captured in
p_reason + audit metadata).

Signature uniformity with _validate_authorization_var_contract (Phase N
court/agency/family helpers will share this shape). p_consultant_org_id
+ p_provider_org_id parameters are intentionally unused; the helper is
a typed sentinel. ADR Decision C.1 line 205 codifies the signature
`(p_reference uuid, p_consultant_org_id uuid, p_provider_org_id uuid)
RETURNS boolean` as the contract; court/agency/family helpers MUST
conform. (N2 architect fold-in 2026-06-04 Chunk 3 review.)

Underscore-prefix convention (Phase 2). GRANT posture: service_role ONLY.

ADR Decision C.1 line 205.$comment$;

-- ============================================================================
-- Step 7b — Seed partnership.manage permission via permission.defined event
-- ============================================================================
-- Per sub-decision J (architect plan-mode review 2026-06-04 + S2
-- recommendation). New permission gating VAR partnership lifecycle RPCs
-- (Steps 11-15) and forward-compat for delegation to non-clinical
-- contracts officers.
--
-- Authority shape: scope_type='org' (gates at the provider org's path),
-- requires_mfa=false. Distinct from grant.create which authorizes PHI
-- release — partnership.manage authorizes the BUSINESS RELATIONSHIP that
-- future grants can be issued against. Today's holders are typically
-- the same set (provider-admin role), but separating the authorities
-- preserves future delegation flexibility (contracts officer manages
-- partnerships without PHI-release authority).
--
-- Emit pattern mirrors Phase 1 Step 10 (precedent at L3345-3357):
-- IF NOT EXISTS precondition guard (codified pitfall #4 — NEVER
-- EXCEPTION WHEN unique_violation), DO block, INSERT INTO domain_events
-- with stream_type='permission' + event_type='permission.defined' +
-- event_data JSON shape that handle_permission_defined inserts into
-- permissions_projection.
--
-- F1 architect fold-in 2026-06-04 (Chunk 3 review): plan.md sub-decision J
-- says "Default-bundle into provider-admin role template" — must implement.
-- Without bundling, Phase 2 ships with provider-admin-targeted RPCs that
-- no provider admin can call (platform admins via has_platform_privilege()
-- short-circuit only; provider admins blocked).
--
-- Three-part emit per canonical Phase 1 + 20260422052825 precedent:
--   (a) permission.defined event → handler INSERTs into permissions_projection
--   (b) INSERT INTO role_permission_templates (provider_admin, partnership.manage)
--       — future bootstraps grant it to new provider_admin role assignments
--   (c) BACKFILL INTO role_permissions_projection for EXISTING provider_admin
--       roles — closes the gap for existing prod tenants. Canonical precedent
--       at 20260422052825_client_ou_placement_and_edit_support.sql:670-680
--       (the client.transfer rollout pattern).
-- ----------------------------------------------------------------------------

-- 7b.a — Emit permission.defined event (Phase 1 Step 10 precedent verbatim)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.permissions_projection
    WHERE applet = 'partnership' AND action = 'manage'
  ) THEN
    INSERT INTO public.domain_events (
        stream_id, stream_type, stream_version, event_type,
        event_data, event_metadata
    )
    VALUES (
      gen_random_uuid(), 'permission', 1, 'permission.defined',
      '{"applet": "partnership", "action": "manage", "description": "Manage VAR partnership lifecycle (create/update/terminate/suspend/reactivate). Distinct from grant.create — partnership.manage authorizes the BUSINESS RELATIONSHIP; grant.create authorizes PHI release against it.", "scope_type": "org", "requires_mfa": false}'::jsonb,
      '{"user_id": "00000000-0000-0000-0000-000000000000", "reason": "Phase 2 step 7b: seed partnership.manage (architect sub-decision J — forward-compat for contracts-officer delegation)"}'::jsonb
    );
  END IF;
END $$;

-- 7b.b — Add to provider_admin role_permission_templates so future bootstraps
-- grant partnership.manage to new provider_admin role assignments. Pattern
-- from 20260422052825_client_ou_placement_and_edit_support.sql:653-655.
INSERT INTO public.role_permission_templates (role_name, permission_name, is_active)
VALUES ('provider_admin', 'partnership.manage', true)
ON CONFLICT (role_name, permission_name) DO NOTHING;

-- 7b.c — Backfill: grant partnership.manage to all EXISTING provider_admin
-- role assignments. Closes the gap for prod tenants whose provider_admin
-- roles already exist (without backfill, only NEW orgs bootstrapped after
-- Phase 2 would get the permission). Precondition: 7b.a already INSERTed
-- the row into permissions_projection (synchronous handler), so the JOIN
-- below resolves. Idempotent via ON CONFLICT DO NOTHING — re-runs are
-- byte-correct no-ops.
INSERT INTO public.role_permissions_projection (role_id, permission_id, granted_at)
SELECT rp.id AS role_id, pp.id AS permission_id, now() AS granted_at
FROM public.roles_projection rp
CROSS JOIN public.permissions_projection pp
WHERE rp.name = 'provider_admin'
  AND rp.deleted_at IS NULL
  AND pp.applet = 'partnership'
  AND pp.action = 'manage'
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- ============================================================================
-- End Chunk 3 (Steps 6-7-7b gates cluster).
-- ============================================================================

-- ============================================================================
-- CHUNK 4 — Step 8: api.create_access_grant (largest single RPC)
-- ============================================================================
-- ADR Decision C.1 lines 184-213 + Phase 2 plan-mode architect fold-ins:
--   F1 + K: 3-column UNIQUE template lookup (template_name + authorization_type +
--           is_active) — Phase 1 deployed 3-column constraint, NOT ADR's
--           2-column L232. Filter all template reads on the triple.
--   F2:     Provider-org path lookup with not-found RAISE; HIPAA gate on
--           v_provider_path. Org-move invariant: live-resolved at grant time;
--           hybrid-snapshot permissions don't change post-creation.
--   F5:     INTERSECT applies ONLY to LITERAL template permission names;
--           implications are NOT expanded at grant creation (HIPAA least-
--           authority). Stage E probe asserts the var_default 4-perm
--           guarantee.
--   S6:     Retain 13-parameter ADR signature; jsonb-bundle alternative
--           considered + rejected (TypeScript ergonomics + frontend codegen
--           per-parameter shape). PG parameter-order RULE: DEFAULTed params
--           must follow non-default params, so required params come first
--           (reorder is invisible to named-argument callers).
--
-- Pattern A v2 (envelope writes — adr-rpc-readback-pattern.md):
--   - PRE-EMIT GUARDS: RAISE EXCEPTION (no audit row yet)
--   - POST-EMIT FAILURES: jsonb envelope {success:false, error, errorDetails}
--     — NEVER RAISE EXCEPTION (would roll back the audit row that
--     process_domain_event just persisted with processing_error)
--
-- Bucket B (Phase 2 emit RPC; provider-admin only; not consultant-callable).
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION api.create_access_grant(
    -- Required params (no DEFAULT — must come first per PG syntax)
    p_consultant_org_id        uuid,
    p_provider_org_id          uuid,
    p_scope                    text,           -- 'organization_unit' | 'client_specific'
    p_scope_id                 uuid,
    p_authorization_type       text,           -- 5-value CHECK enforced
    p_grant_role_template_name text,
    -- Optional params (DEFAULTed)
    p_consultant_user_id       uuid        DEFAULT NULL,    -- NULL = org-wide grant
    p_authorization_reference  uuid        DEFAULT NULL,    -- NULL only for emergency_access
    p_legal_reference          text        DEFAULT NULL,
    p_permission_overrides     text[]      DEFAULT NULL,    -- INTERSECT narrowing only
    p_terms                    jsonb       DEFAULT '{}'::jsonb,  -- merged on top of template.default_terms
    p_expires_at               timestamptz DEFAULT NULL,
    p_reason                   text        DEFAULT 'Grant created via cross-tenant grant flow'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $$
DECLARE
    v_claims              jsonb       := current_setting('request.jwt.claims', true)::jsonb;
    v_caller_id           uuid        := public.get_current_user_id();
    v_org_id              uuid        := NULLIF(v_claims ->> 'org_id', '')::uuid;
    v_access_blocked      boolean     := COALESCE((v_claims ->> 'access_blocked')::boolean, false);
    v_provider_path       extensions.ltree;
    v_scope_path          extensions.ltree;
    v_client_ou_id        uuid;
    v_client_status       text;  -- S1 architect fold-in 2026-06-08 (Chunk 4 review)
    v_authorization_valid boolean;
    v_template_count      int;
    v_permissions_jsonb   jsonb;
    v_template_terms      jsonb       := '{}'::jsonb;
    v_final_terms         jsonb;
    v_grant_id            uuid;
    v_event_id            uuid;
    v_processing_error    text;
    v_now                 timestamptz := now();
    v_terms_row           record;
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

    -- Required-param presence
    IF p_consultant_org_id IS NULL OR p_provider_org_id IS NULL THEN
        RAISE EXCEPTION 'consultant_org_id and provider_org_id are required'
            USING ERRCODE = '22004';
    END IF;
    IF p_scope_id IS NULL THEN
        RAISE EXCEPTION 'scope_id is required' USING ERRCODE = '22004';
    END IF;
    IF p_grant_role_template_name IS NULL OR p_grant_role_template_name = '' THEN
        RAISE EXCEPTION 'grant_role_template_name is required'
            USING ERRCODE = '22004';
    END IF;

    -- S2 architect fold-in 2026-06-08 (Chunk 4 review): same-org guard.
    -- consultant_org_id = provider_org_id is semantic nonsense (org granting
    -- itself access to its own data) and would feed a redundant row to
    -- sync_accessible_organizations_from_grants. Reject pre-emit.
    IF p_consultant_org_id = p_provider_org_id THEN
        RAISE EXCEPTION 'consultant_org_id must differ from provider_org_id'
            USING ERRCODE = '22023';
    END IF;

    -- S3 architect fold-in 2026-06-08 (Chunk 4 review): expires_at must be
    -- in the future. Phase 1's grant_derived_perms CTE filters
    -- (expires_at IS NULL OR expires_at > now()), so a back-dated value
    -- would land an active projection row that JWT issuance immediately
    -- filters out — projection-state drift. Reject pre-emit.
    IF p_expires_at IS NOT NULL AND p_expires_at <= v_now THEN
        RAISE EXCEPTION 'expires_at must be in the future'
            USING ERRCODE = '22023';
    END IF;

    -- p_scope CHECK (matches cross_tenant_access_grants_projection_scope_check)
    IF p_scope NOT IN ('organization_unit', 'client_specific') THEN
        RAISE EXCEPTION 'Invalid scope: must be organization_unit or client_specific'
            USING ERRCODE = '22023';
    END IF;

    -- p_authorization_type CHECK (5-value enum mirrors
    -- cross_tenant_access_grants_projection_authorization_type_check
    -- at Phase 1 baseline_v4:3037-3071)
    IF p_authorization_type NOT IN (
        'var_contract', 'court_order', 'family_participation',
        'social_services_assignment', 'emergency_access'
    ) THEN
        RAISE EXCEPTION 'Invalid authorization_type: must be one of var_contract, court_order, family_participation, social_services_assignment, emergency_access'
            USING ERRCODE = '22023';
    END IF;

    -- authorization_reference NULL invariant
    -- (Phase 1 Step 14 CHECK: NULL only for emergency_access)
    IF p_authorization_type = 'emergency_access' THEN
        IF p_authorization_reference IS NOT NULL THEN
            RAISE EXCEPTION 'authorization_reference must be NULL for emergency_access'
                USING ERRCODE = '22023';
        END IF;
    ELSE
        IF p_authorization_reference IS NULL THEN
            RAISE EXCEPTION 'authorization_reference is required for non-emergency_access authorization_type'
                USING ERRCODE = '22023';
        END IF;
    END IF;

    -- Provider org path lookup (F2 architect fold-in)
    SELECT path
    INTO v_provider_path
    FROM public.organizations_projection
    WHERE id = p_provider_org_id
      AND deleted_at IS NULL;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Provider organization not found or deleted'
            USING ERRCODE = '42501';
    END IF;

    -- HIPAA permission gate (ADR L204 + F2 fold-in)
    -- Path-scoped check: provider-admin authority at the provider org path is
    -- load-bearing. has_platform_privilege() short-circuit for platform owners.
    IF NOT (
        public.has_platform_privilege()
        OR public.has_effective_permission('grant.create', v_provider_path)
    ) THEN
        RAISE EXCEPTION 'Permission denied: grant.create at provider organization scope'
            USING ERRCODE = '42501';
    END IF;

    -- =====================================================================
    -- PER-TYPE AUTHORIZATION VALIDATION (envelope-return, not RAISE)
    -- =====================================================================
    -- ADR L205: dispatch via CASE on p_authorization_type to the appropriate
    -- _validate_authorization_<type> private helper. Phase 2 ships
    -- var_contract + emergency_access; Phase N adds court/agency/family.

    CASE p_authorization_type
        WHEN 'var_contract' THEN
            v_authorization_valid := public._validate_authorization_var_contract(
                p_authorization_reference, p_consultant_org_id, p_provider_org_id
            );
        WHEN 'emergency_access' THEN
            -- N3 architect fold-in 2026-06-08: pre-emit guard above already
            -- enforces p_authorization_reference IS NULL for emergency_access,
            -- so the validator always receives NULL and returns TRUE
            -- unconditionally. Kept for signature uniformity with Phase N
            -- helpers per _validate_authorization_emergency_access docblock.
            v_authorization_valid := public._validate_authorization_emergency_access(
                p_authorization_reference, p_consultant_org_id, p_provider_org_id
            );
        ELSE
            -- Phase N types not yet implemented (court/agency/family).
            -- Envelope-return (not RAISE) so the caller gets a structured
            -- "not yet supported" response.
            RETURN jsonb_build_object(
                'success', false,
                'error',   'NOT_IMPLEMENTED',
                'errorDetails', jsonb_build_object(
                    'code',    'NOT_IMPLEMENTED',
                    'message', 'authorization_type not yet supported (Phase N work)'
                )
            );
    END CASE;

    IF NOT v_authorization_valid THEN
        RETURN jsonb_build_object(
            'success', false,
            'error',   'AUTHORIZATION_VALIDATION_FAILED',
            'errorDetails', jsonb_build_object(
                'code',    'AUTHORIZATION_VALIDATION_FAILED',
                'message', 'No active backing record found for the supplied authorization_type + reference'
            )
        );
    END IF;

    -- =====================================================================
    -- SCOPE PATH RESOLUTION (for permission-snapshot tuples)
    -- =====================================================================
    -- Each {p, s} permission tuple snapshots `s` at the grant's scope path
    -- — the narrowest legitimate scope under HIPAA least-authority. All
    -- permissions in one grant share this path (the grant is the
    -- delegation unit; per-permission scope-narrowing belongs on a future
    -- policy-override RPC, not on grant creation).
    --
    -- For p_scope='organization_unit': scope_id is the OU id directly.
    -- For p_scope='client_specific':   scope_id is the client id; resolve
    --                                   the client's current OU placement
    --                                   (clients_projection.organization_unit_id),
    --                                   then look up that OU's path.

    IF p_scope = 'organization_unit' THEN
        SELECT path INTO v_scope_path
        FROM public.organization_units_projection
        WHERE id = p_scope_id
          AND deleted_at IS NULL;
        IF NOT FOUND THEN
            RETURN jsonb_build_object(
                'success', false,
                'error',   'SCOPE_NOT_FOUND',
                'errorDetails', jsonb_build_object(
                    'code',    'SCOPE_NOT_FOUND',
                    'message', 'organization_unit referenced by scope_id not found or deleted'
                )
            );
        END IF;
    ELSIF p_scope = 'client_specific' THEN
        -- S1 architect fold-in 2026-06-08 (Chunk 4 review): also read status.
        -- clients_projection.status CHECK is ('active','inactive','discharged')
        -- per 20260327205738_clients_projection.sql:116. A grant issued over
        -- a 'discharged' client would silently extend consultant access to
        -- a discharged record — HIPAA post-discharge access must be an
        -- explicit, gated path, not a side-door via grant creation.
        SELECT organization_unit_id, status
        INTO v_client_ou_id, v_client_status
        FROM public.clients_projection
        WHERE id = p_scope_id;
        IF NOT FOUND OR v_client_ou_id IS NULL THEN
            RETURN jsonb_build_object(
                'success', false,
                'error',   'SCOPE_NOT_FOUND',
                'errorDetails', jsonb_build_object(
                    'code',    'SCOPE_NOT_FOUND',
                    'message', 'client referenced by scope_id not found or not placed in an organization_unit'
                )
            );
        END IF;
        IF v_client_status = 'discharged' THEN
            RETURN jsonb_build_object(
                'success', false,
                'error',   'CLIENT_DISCHARGED',
                'errorDetails', jsonb_build_object(
                    'code',    'CLIENT_DISCHARGED',
                    'message', 'Cannot create grant over a discharged client'
                )
            );
        END IF;
        SELECT path INTO v_scope_path
        FROM public.organization_units_projection
        WHERE id = v_client_ou_id
          AND deleted_at IS NULL;
        IF NOT FOUND THEN
            RETURN jsonb_build_object(
                'success', false,
                'error',   'SCOPE_NOT_FOUND',
                'errorDetails', jsonb_build_object(
                    'code',    'SCOPE_NOT_FOUND',
                    'message', 'organization_unit for client not found (data integrity issue)'
                )
            );
        END IF;
    END IF;

    -- =====================================================================
    -- TEMPLATE LOOKUP + PERMISSION SNAPSHOT (INTERSECT narrowing only)
    -- =====================================================================
    -- F1 + K architect fold-in: Phase 1 deployed grant_role_templates with
    -- 3-column UNIQUE (template_name, authorization_type, permission_name)
    -- — ADR L232 still shows 2-column (ADR addendum tracked in
    -- observations.md). Filter all template reads on the triple.

    -- Existence guard: at least one template row matches
    SELECT count(*) INTO v_template_count
    FROM public.grant_role_templates
    WHERE template_name      = p_grant_role_template_name
      AND authorization_type = p_authorization_type
      AND is_active          = true;
    IF v_template_count = 0 THEN
        RETURN jsonb_build_object(
            'success', false,
            'error',   'TEMPLATE_NOT_FOUND',
            'errorDetails', jsonb_build_object(
                'code',    'TEMPLATE_NOT_FOUND',
                'message', 'No active grant_role_templates row matches (template_name, authorization_type, is_active)'
            )
        );
    END IF;

    -- F5 fold-in: INTERSECT operates on LITERAL template permission names
    -- only. Implications are NOT expanded here — implications happen at JWT
    -- issuance via compute_effective_permissions, GATED on grant-source rows
    -- by permission_implications.propagate_through_grants (HIPAA least-
    -- authority; default FALSE blocks implication-widening for grant-derived
    -- perms). Stage E probe F5 asserts the var_default 4-perm guarantee.
    IF p_permission_overrides IS NULL THEN
        SELECT jsonb_agg(jsonb_build_object('p', permission_name, 's', v_scope_path::text))
        INTO v_permissions_jsonb
        FROM public.grant_role_templates
        WHERE template_name      = p_grant_role_template_name
          AND authorization_type = p_authorization_type
          AND is_active          = true;
    ELSE
        SELECT jsonb_agg(jsonb_build_object('p', perm_name, 's', v_scope_path::text))
        INTO v_permissions_jsonb
        FROM (
            SELECT permission_name AS perm_name
            FROM public.grant_role_templates
            WHERE template_name      = p_grant_role_template_name
              AND authorization_type = p_authorization_type
              AND is_active          = true
            INTERSECT
            SELECT unnest(p_permission_overrides)
        ) narrowed;
        -- INTERSECT may yield empty if overrides don't intersect with template
        IF v_permissions_jsonb IS NULL OR jsonb_array_length(v_permissions_jsonb) = 0 THEN
            RETURN jsonb_build_object(
                'success', false,
                'error',   'EMPTY_PERMISSION_SET',
                'errorDetails', jsonb_build_object(
                    'code',    'EMPTY_PERMISSION_SET',
                    'message', 'permission_overrides INTERSECT template yielded no permissions; grant would be empty'
                )
            );
        END IF;
    END IF;

    -- Merge template default_terms via jsonb concat fold. v1 var_default all
    -- rows share default_terms; the fold is forward-compatible if Phase N
    -- templates vary per-permission. Right-side wins on key overlap
    -- (PG jsonb || semantics). Deterministic ORDER BY permission_name for
    -- replay-stability — relies on grant_role_templates_unique
    -- (template_name, authorization_type, permission_name) per F1/K, which
    -- guarantees permission_name is a unique tie-break within the filtered
    -- triple (N4 architect fold-in 2026-06-08).
    FOR v_terms_row IN
        SELECT default_terms
        FROM public.grant_role_templates
        WHERE template_name      = p_grant_role_template_name
          AND authorization_type = p_authorization_type
          AND is_active          = true
        ORDER BY permission_name
    LOOP
        v_template_terms := v_template_terms || COALESCE(v_terms_row.default_terms, '{}'::jsonb);
    END LOOP;

    -- ADR L209: v_final_terms := template.default_terms || p_terms
    -- Right-side wins on key overlap — caller-supplied terms override
    -- template defaults when they conflict.
    v_final_terms := v_template_terms || COALESCE(p_terms, '{}'::jsonb);

    -- =====================================================================
    -- EMIT access_grant.created EVENT (stream_id = pre-generated v_grant_id)
    -- =====================================================================
    -- Handler at process_access_grant_event.sql:11-39 reads event_data:
    --   consultant_org_id, consultant_user_id, provider_org_id,
    --   scope, scope_id, authorization_type, legal_reference,
    --   granted_by, expires_at, permissions (TOP LEVEL), terms,
    --   authorization_reference

    v_grant_id := gen_random_uuid();

    v_event_id := api.emit_domain_event(
        p_stream_id   := v_grant_id,
        p_stream_type := 'access_grant',
        p_event_type  := 'access_grant.created',
        p_event_data  := jsonb_build_object(
            'consultant_org_id',       p_consultant_org_id,
            'consultant_user_id',      p_consultant_user_id,
            'provider_org_id',         p_provider_org_id,
            'scope',                   p_scope,
            'scope_id',                p_scope_id,
            'authorization_type',      p_authorization_type,
            'authorization_reference', p_authorization_reference,
            'legal_reference',         p_legal_reference,
            'granted_by',              v_caller_id,
            'expires_at',              p_expires_at,
            'permissions',             v_permissions_jsonb,
            'terms',                   v_final_terms
        ),
        p_event_metadata := jsonb_build_object(
            'user_id',         v_caller_id,
            'organization_id', v_org_id,
            'source',          'api.create_access_grant',
            'reason',          p_reason
        )
    );

    -- =====================================================================
    -- PATTERN A v2 READ-BACK (BOTH checks per infrastructure CLAUDE.md)
    -- =====================================================================

    -- Check 1: IF NOT FOUND on projection read-back
    PERFORM 1
    FROM public.cross_tenant_access_grants_projection
    WHERE id = v_grant_id;
    IF NOT FOUND THEN
        SELECT processing_error INTO v_processing_error
        FROM public.domain_events WHERE id = v_event_id;
        RETURN jsonb_build_object(
            'success', false,
            'error',   'PROCESSING_FAILED',
            'errorDetails', jsonb_build_object(
                'code',    'PROCESSING_FAILED',
                'message', 'Event processing failed: ' ||
                    COALESCE(v_processing_error, 'projection read-back returned no row')
            ),
            'eventId', v_event_id
        );
    END IF;

    -- Check 2: processing_error on captured event_id (race-safe)
    SELECT processing_error INTO v_processing_error
    FROM public.domain_events WHERE id = v_event_id;
    IF v_processing_error IS NOT NULL THEN
        RETURN jsonb_build_object(
            'success', false,
            'error',   'PROCESSING_FAILED',
            'errorDetails', jsonb_build_object(
                'code',    'PROCESSING_FAILED',
                'message', 'Event processing failed: ' || v_processing_error
            ),
            'eventId', v_event_id
        );
    END IF;

    -- =====================================================================
    -- SUCCESS ENVELOPE
    -- =====================================================================

    RETURN jsonb_build_object(
        'success', true,
        'eventId', v_event_id,
        'grant',   jsonb_build_object(
            'id',                      v_grant_id,
            'consultantOrgId',         p_consultant_org_id,
            'consultantUserId',        p_consultant_user_id,
            'providerOrgId',           p_provider_org_id,
            'scope',                   p_scope,
            'scopeId',                 p_scope_id,
            'authorizationType',       p_authorization_type,
            'authorizationReference',  p_authorization_reference,
            'permissions',             v_permissions_jsonb,
            'terms',                   v_final_terms,
            'expiresAt',               p_expires_at,
            'grantedBy',               v_caller_id,
            'grantedAt',               v_now
        )
    );
END;
$$;

-- GRANT posture: authenticated only (called from provider-admin UI / future
-- Edge Function). NOT consultant-callable (provider-admin authority is the
-- HIPAA gate — only the provider org can issue grants over its own data).
REVOKE ALL ON FUNCTION api.create_access_grant(
    uuid, uuid, text, uuid, text, text,
    uuid, uuid, text, text[], jsonb, timestamptz, text
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION api.create_access_grant(
    uuid, uuid, text, uuid, text, text,
    uuid, uuid, text, text[], jsonb, timestamptz, text
) TO authenticated;

-- NOTE: COMMENT ON FUNCTION with M3 + reachability tags is folded
-- with the rest of the batch at Step 17 to keep the tag wave atomic.

-- ============================================================================
-- End Chunk 4 (Step 8 api.create_access_grant — largest single RPC).
-- ============================================================================

-- ============================================================================
-- CHUNK 5 — Steps 9-10: revocation flow
-- ============================================================================
-- Step 9:  api.revoke_access_grant (single-event Pattern A v2)
-- Step 10: api.revoke_permission_across_grants (multi-event Pattern A v2
--          with partial-failure envelope, per F3+I+S5 fold-ins).
--
-- Architectural notes:
--   - Step 9 is provider-scoped: any provider admin with grant.revoke at
--     the grant's provider_org_id can revoke a specific grant.
--   - Step 10 is platform-scoped: ONLY platform admins can issue cross-
--     grant policy overrides (ADR sub-decision B; HIPAA cross-tenant
--     enforcement happens at the platform tier — provider admins use
--     Step 9 per-grant).
--   - JWT staleness window (ADR L361-367): revocation does NOT terminate
--     active sessions; in-flight requests during the staleness window
--     remain authorized. Operational SLA: cold-revoke is effective within
--     access_token_expiry_seconds. Emergency-revoke + auth.admin.signOut
--     pairing is documented in ADR; Phase 2 ships cold-revoke only.
-- ----------------------------------------------------------------------------

-- =====================================================================
-- Step 9 — api.revoke_access_grant (single-event Pattern A v2)
-- =====================================================================
-- ADR C.5 single-grant revocation. Handler at
-- handlers/routers/process_access_grant_event.sql § access_grant.revoked
-- arm reads event_data: grant_id, revoked_by, revocation_reason,
-- revocation_details.
--
-- Pattern A v2: stream_id := p_grant_id (the access_grant stream); the
-- handler also reads grant_id from event_data for symmetry with other
-- arms.
--
-- N2 architect fold-in 2026-06-08: PHI hygiene — p_revocation_details
-- is a free-form text field that flows to BOTH event_data.revocation_
-- details (audit trail) AND cross_tenant_access_grants_projection.
-- revocation_details (query surface). Callers MUST NOT include PHI in
-- p_revocation_details — it is an audit-layer FIELD only (legal/
-- procedural context: "court order rescinded", "VAR partnership
-- terminated"). The frontend caller (provider-admin UI) MUST surface
-- this constraint to the user via input validation. PII three-layer
-- model (PR #43): persistence is acceptable for audit fields IF SDK
-- boundary masker enforces no-PHI; verify the frontend caller-side
-- warning is in place before exposing this RPC.
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION api.revoke_access_grant(
    p_grant_id           uuid,
    p_reason             text,
    p_revocation_details text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $$
DECLARE
    v_claims           jsonb := current_setting('request.jwt.claims', true)::jsonb;
    v_caller_id        uuid  := public.get_current_user_id();
    v_org_id           uuid  := NULLIF(v_claims ->> 'org_id', '')::uuid;
    v_access_blocked   boolean := COALESCE((v_claims ->> 'access_blocked')::boolean, false);
    v_provider_org_id  uuid;
    v_provider_path    extensions.ltree;
    v_current_status   text;
    v_event_id         uuid;
    v_processing_error text;
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
    IF p_grant_id IS NULL THEN
        RAISE EXCEPTION 'grant_id is required' USING ERRCODE = '22004';
    END IF;
    IF p_reason IS NULL OR p_reason = '' THEN
        RAISE EXCEPTION 'reason is required for HIPAA audit trail'
            USING ERRCODE = '22004';
    END IF;

    -- =====================================================================
    -- LOOKUP + TENANCY GUARD (envelope, not RAISE — symmetric with
    -- api.deactivate_user pattern at 20260512194836:113-118)
    -- =====================================================================
    -- Same envelope shape as not-found to avoid leaking grant-existence
    -- across tenants (a provider admin from a different org should see
    -- the same response as if the grant didn't exist).

    SELECT provider_org_id, status
    INTO v_provider_org_id, v_current_status
    FROM public.cross_tenant_access_grants_projection
    WHERE id = p_grant_id;
    IF NOT FOUND THEN
        RETURN jsonb_build_object(
            'success', false,
            'error',   'GRANT_NOT_FOUND',
            'errorDetails', jsonb_build_object(
                'code',    'GRANT_NOT_FOUND',
                'message', 'grant not found'
            )
        );
    END IF;

    -- Provider-org path lookup for HIPAA gate
    SELECT path INTO v_provider_path
    FROM public.organizations_projection
    WHERE id = v_provider_org_id AND deleted_at IS NULL;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Provider organization not found or deleted'
            USING ERRCODE = '42501';
    END IF;

    -- HIPAA permission gate (mirror Step 8 shape; grant.revoke permission
    -- seeded by Phase 1 Step 10)
    IF NOT (
        public.has_platform_privilege()
        OR public.has_effective_permission('grant.revoke', v_provider_path)
    ) THEN
        RAISE EXCEPTION 'Permission denied: grant.revoke at provider organization scope'
            USING ERRCODE = '42501';
    END IF;

    -- Idempotency: already-revoked or already-expired grants return
    -- success-false envelope (mirrors api.deactivate_user idempotency
    -- pattern). 'suspended' is NOT short-circuited — revoking a suspended
    -- grant is a legitimate state transition.
    --
    -- S1 architect fold-in 2026-06-08: errorDetails.actionable=false flag
    -- signals to the SDK boundary (apiRpcEnvelope masker / frontend toast
    -- routing) that this envelope represents a benign terminal-state
    -- collision, not an error. Frontend should render as info-toast
    -- ("Grant was already revoked"), not error-toast.
    IF v_current_status IN ('revoked', 'expired') THEN
        RETURN jsonb_build_object(
            'success', false,
            'error',   'ALREADY_INACTIVE',
            'errorDetails', jsonb_build_object(
                'code',       'ALREADY_INACTIVE',
                'message',    format('grant is already %s; cannot revoke', v_current_status),
                'actionable', false
            )
        );
    END IF;

    -- =====================================================================
    -- EMIT access_grant.revoked EVENT
    -- =====================================================================

    v_event_id := api.emit_domain_event(
        p_stream_id   := p_grant_id,
        p_stream_type := 'access_grant',
        p_event_type  := 'access_grant.revoked',
        p_event_data  := jsonb_build_object(
            'grant_id',           p_grant_id,
            'revoked_by',         v_caller_id,
            'revocation_reason',  p_reason,
            'revocation_details', p_revocation_details
        ),
        p_event_metadata := jsonb_build_object(
            'user_id',         v_caller_id,
            'organization_id', v_org_id,
            'source',          'api.revoke_access_grant',
            'reason',          p_reason
        )
    );

    -- =====================================================================
    -- PATTERN A v2 READ-BACK (BOTH checks)
    -- =====================================================================

    -- Check 1: IF NOT FOUND on projection read-back. Predicate requires
    -- status='revoked' — absence means handler didn't update.
    PERFORM 1
    FROM public.cross_tenant_access_grants_projection
    WHERE id = p_grant_id AND status = 'revoked';
    IF NOT FOUND THEN
        SELECT processing_error INTO v_processing_error
        FROM public.domain_events WHERE id = v_event_id;
        RETURN jsonb_build_object(
            'success', false,
            'error',   'PROCESSING_FAILED',
            'errorDetails', jsonb_build_object(
                'code',    'PROCESSING_FAILED',
                'message', 'Event processing failed: ' ||
                    COALESCE(v_processing_error, 'projection read-back returned no row')
            ),
            'eventId', v_event_id
        );
    END IF;

    -- Check 2: processing_error on captured event_id (race-safe)
    SELECT processing_error INTO v_processing_error
    FROM public.domain_events WHERE id = v_event_id;
    IF v_processing_error IS NOT NULL THEN
        RETURN jsonb_build_object(
            'success', false,
            'error',   'PROCESSING_FAILED',
            'errorDetails', jsonb_build_object(
                'code',    'PROCESSING_FAILED',
                'message', 'Event processing failed: ' || v_processing_error
            ),
            'eventId', v_event_id
        );
    END IF;

    RETURN jsonb_build_object(
        'success', true,
        'eventId', v_event_id,
        'grantId', p_grant_id
    );
END;
$$;

REVOKE ALL ON FUNCTION api.revoke_access_grant(uuid, text, text)
    FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION api.revoke_access_grant(uuid, text, text)
    TO authenticated;


-- =====================================================================
-- Step 10 — api.revoke_permission_across_grants (multi-event Pattern A v2
--           with partial-failure envelope)
-- =====================================================================
-- ADR C.5 + sub-decision B + F3 + I + S5 fold-ins:
--   F3:  Handler (Phase 1) UPDATEs unconditionally — RPC MUST use
--        RPC-side filter (I-fold) to avoid emitting no-op events that
--        bloat domain_events.
--   I:   RPC-side filter — emit only when state will change. Computed
--        by EXISTS-on-jsonb_array_elements predicate + ACTIVE-only gate.
--   S5:  Partial-failure pattern (i) — per-event processing_error check
--        inside loop with short-circuit on first failure. Envelope
--        includes failedGrantId field.
--
-- Sub-decision B partial-failure shape (mirrors PR #44 modify_user_roles):
--   { success: false, partial: true, error: 'PARTIAL_FAILURE',
--     appliedGrantEventIds[], failureIndex, processingError,
--     failedGrantId, auditEventId }
--
-- Audit emit (sub-decision B): emit audit.high_risk_action_logged in the
-- partial-failure branch BEFORE returning the envelope, so ops alerting
-- has the event regardless of caller-side handling. stream_type =
-- 'platform_admin' (the catch-all absorbed admin type per dispatcher
-- process_domain_event.sql); no projection update needed.
--
-- F1 architect fold-in 2026-06-08 (Chunk 5 review): event_type naming
-- precedent — 'audit.high_risk_action_logged' uses the 2-level form
-- (aggregate.compound_event_name) matching organization.direct_care_
-- settings_updated precedent + the documented CLAUDE.md § "Event type
-- naming convention" rule (dots separate hierarchy levels; underscores
-- compound names within a level). This is the FIRST emitter of any
-- audit.* event family AND the first emitter on stream_type=
-- 'platform_admin'; the 2-level form becomes the precedent for all
-- future cross-grant/cross-tenant audit events. AsyncAPI registration
-- of this event lands in Chunk 8 (Step 16-17 batch) alongside
-- access_grant.policy_override_applied (PR #70 N1 carry-forward).
--
-- Platform-only HIPAA gate: cross-grant policy override is a platform-
-- tier authority. Per-grant revocation by provider admins uses Step 9.
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION api.revoke_permission_across_grants(
    p_permission_name  text,
    p_override_reason  text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $$
DECLARE
    v_claims              jsonb := current_setting('request.jwt.claims', true)::jsonb;
    v_caller_id           uuid  := public.get_current_user_id();
    v_org_id              uuid  := NULLIF(v_claims ->> 'org_id', '')::uuid;
    v_access_blocked      boolean := COALESCE((v_claims ->> 'access_blocked')::boolean, false);
    v_affected            record;
    v_new_permissions     jsonb;
    v_event_id            uuid;
    v_applied_event_ids   uuid[] := '{}'::uuid[];
    v_processing_error    text;
    v_loop_index          int := 0;
    v_failed_grant_id     uuid;
    v_audit_event_id      uuid;
    -- S2 architect fold-in 2026-06-08: separate "candidate" count to
    -- distinguish (a) zero-active-grants-carry-permission from (b)
    -- platform-admin typo case in the success envelope.
    v_candidate_count     int := 0;
BEGIN
    -- =====================================================================
    -- PRE-EMIT GUARDS (RAISE EXCEPTION)
    -- =====================================================================

    IF v_caller_id IS NULL OR v_org_id IS NULL THEN
        RAISE EXCEPTION 'Access denied' USING ERRCODE = '42501';
    END IF;
    IF v_access_blocked THEN
        RAISE EXCEPTION 'Access blocked: organization is deactivated'
            USING ERRCODE = '42501';
    END IF;
    IF p_permission_name IS NULL OR p_permission_name = '' THEN
        RAISE EXCEPTION 'permission_name is required' USING ERRCODE = '22004';
    END IF;
    IF p_override_reason IS NULL OR p_override_reason = '' THEN
        RAISE EXCEPTION 'override_reason is required for HIPAA audit trail'
            USING ERRCODE = '22004';
    END IF;

    -- HIPAA gate: platform-only. Cross-grant policy override is a
    -- platform-tier authority by ADR design (sub-decision B). Provider
    -- admins use api.revoke_access_grant (Step 9) per-grant.
    IF NOT public.has_platform_privilege() THEN
        RAISE EXCEPTION 'Permission denied: platform-level authority required for cross-grant policy override'
            USING ERRCODE = '42501';
    END IF;

    -- =====================================================================
    -- I FOLD-IN: RPC-SIDE FILTER (emit only when state will change)
    -- =====================================================================
    -- Affected = active grants whose permissions array contains an element
    -- with p = p_permission_name. EXISTS form avoids the ANY((SELECT))
    -- scalar-subquery trap (codified pitfall #3). new_permissions is
    -- pre-computed per grant via jsonb_agg filter; NULL → '[]' below.
    -- Deterministic ORDER BY g.id for replay-stability.

    -- S2 architect fold-in 2026-06-08: capture candidate count BEFORE the
    -- emit loop. Same predicate as the FOR-loop SELECT — verifies how many
    -- active grants the permission was searched against. Surfaced in the
    -- success envelope alongside appliedGrantCount so callers can
    -- distinguish "0 active grants carried the permission" (legitimate
    -- no-op) from "platform-admin typo'd the permission_name" (operator
    -- error). HIPAA observability invariant: platform-tier destructive
    -- cross-tenant ops must NOT silently no-op without confirmation.
    SELECT count(*) INTO v_candidate_count
    FROM public.cross_tenant_access_grants_projection g
    WHERE g.status = 'active'
      AND EXISTS (
          SELECT 1 FROM jsonb_array_elements(g.permissions) pe
          WHERE pe->>'p' = p_permission_name
      );

    FOR v_affected IN
        SELECT
            g.id AS grant_id,
            (
                SELECT jsonb_agg(p)
                FROM jsonb_array_elements(g.permissions) p
                WHERE p->>'p' <> p_permission_name
            ) AS new_permissions
        FROM public.cross_tenant_access_grants_projection g
        WHERE g.status = 'active'
          AND EXISTS (
              SELECT 1 FROM jsonb_array_elements(g.permissions) pe
              WHERE pe->>'p' = p_permission_name
          )
        ORDER BY g.id
    LOOP
        -- jsonb_agg returns NULL when no rows remain after the filter
        -- (e.g., the grant carried ONLY the targeted permission). The
        -- handler at process_access_grant_event.sql § access_grant.
        -- policy_override_applied arm requires a jsonb array
        -- (jsonb_typeof check) — coalesce to empty array.
        -- N1 architect fold-in 2026-06-08: stable section reference
        -- (line-number references rot with handler-file edits).
        v_new_permissions := COALESCE(v_affected.new_permissions, '[]'::jsonb);

        BEGIN
            v_event_id := api.emit_domain_event(
                p_stream_id   := v_affected.grant_id,
                p_stream_type := 'access_grant',
                p_event_type  := 'access_grant.policy_override_applied',
                p_event_data  := jsonb_build_object(
                    'grant_id',         v_affected.grant_id,
                    'permissions',      v_new_permissions,
                    'override_reason',  p_override_reason,
                    'applied_by',       v_caller_id
                ),
                p_event_metadata := jsonb_build_object(
                    'user_id',         v_caller_id,
                    'organization_id', v_org_id,
                    'source',          'api.revoke_permission_across_grants',
                    'reason',          p_override_reason
                )
            );

            -- S5 fold-in: per-event processing_error check inside loop
            -- with short-circuit on first failure. The trigger persists
            -- processing_error on the audit row if the handler raised;
            -- check that captured event_id and bail if non-NULL.
            SELECT processing_error INTO v_processing_error
            FROM public.domain_events WHERE id = v_event_id;
            IF v_processing_error IS NOT NULL THEN
                v_failed_grant_id := v_affected.grant_id;
                EXIT;  -- short-circuit; fall through to partial-failure branch
            END IF;

            v_applied_event_ids := v_applied_event_ids || v_event_id;
            v_loop_index := v_loop_index + 1;
        EXCEPTION WHEN OTHERS THEN
            -- emit raised (rare; would mean api.emit_domain_event itself
            -- failed before persisting an audit row). Capture and short-
            -- circuit; do NOT RAISE (would roll back any partially-
            -- persisted audit rows).
            v_failed_grant_id  := v_affected.grant_id;
            v_processing_error := SQLERRM;
            EXIT;
        END;
    END LOOP;

    -- =====================================================================
    -- PARTIAL-FAILURE BRANCH
    -- =====================================================================

    IF v_failed_grant_id IS NOT NULL THEN
        -- Sub-decision B: emit audit.high_risk_action_logged BEFORE
        -- returning the envelope (ops alerting has the event regardless
        -- of caller-side handling). stream_type='platform_admin' is the
        -- absorbed admin type per dispatcher (no projection update).
        -- Use a fresh BEGIN/EXCEPTION block — audit emit failure must
        -- NOT mask the original partial-failure signal to the caller.
        BEGIN
            v_audit_event_id := api.emit_domain_event(
                p_stream_id   := gen_random_uuid(),
                p_stream_type := 'platform_admin',
                p_event_type  := 'audit.high_risk_action_logged',
                p_event_data  := jsonb_build_object(
                    'action',            'revoke_permission_across_grants_partial_failure',
                    'permission_name',   p_permission_name,
                    'override_reason',   p_override_reason,
                    'failed_grant_id',   v_failed_grant_id,
                    'applied_event_ids', to_jsonb(v_applied_event_ids),
                    'failure_index',     v_loop_index,
                    'processing_error',  v_processing_error
                ),
                p_event_metadata := jsonb_build_object(
                    'user_id',         v_caller_id,
                    'organization_id', v_org_id,
                    'source',          'api.revoke_permission_across_grants',
                    'reason',          'High-risk action: partial-failure during cross-grant policy override'
                )
            );
        EXCEPTION WHEN OTHERS THEN
            -- S3 architect fold-in 2026-06-08: preserve the audit-emit
            -- failure trail in PG operator logs without masking the
            -- original partial-failure signal to the caller. RAISE
            -- WARNING is visible in PG logs, NOT visible to caller, NOT
            -- persisted to domain_events. v_audit_event_id stays NULL so
            -- the envelope honestly reflects audit-emit absence.
            RAISE WARNING 'audit emit failed during cross-grant policy override partial-failure: %', SQLERRM;
            v_audit_event_id := NULL;
        END;

        RETURN jsonb_build_object(
            'success',              false,
            'partial',              true,
            'error',                'PARTIAL_FAILURE',
            'permissionName',       p_permission_name,
            'appliedGrantEventIds', to_jsonb(v_applied_event_ids),
            'failureIndex',         v_loop_index,
            'failedGrantId',        v_failed_grant_id,
            'processingError',      v_processing_error,
            'auditEventId',         v_audit_event_id
        );
    END IF;

    -- =====================================================================
    -- SUCCESS ENVELOPE
    -- =====================================================================
    -- S2 architect fold-in 2026-06-08: include candidateGrantCount so the
    -- caller can distinguish "no active grants carried this permission"
    -- (legitimate no-op; candidateGrantCount=0) from "platform-admin typo
    -- on permission_name" (operator error; candidateGrantCount=0 too, but
    -- the caller knows their intent). The two cases are observationally
    -- equivalent in the data, but the CALLER's intent makes the
    -- distinction — exposing candidate vs applied counts gives the frontend
    -- the signal to render "no-op (intentional)" vs "no-op (suspicious)".
    --
    -- appliedGrantCount=candidateGrantCount → all targeted grants updated.
    -- appliedGrantCount=0, candidateGrantCount=0 → no active grants matched
    --   (verify permission_name; if user expected a non-zero candidate,
    --    surface this as a soft warning).
    -- appliedGrantCount<candidateGrantCount → impossible on success path
    --   (failure path returns partial-failure envelope above).

    RETURN jsonb_build_object(
        'success',              true,
        'permissionName',       p_permission_name,
        'appliedGrantEventIds', to_jsonb(v_applied_event_ids),
        'appliedGrantCount',    COALESCE(array_length(v_applied_event_ids, 1), 0),
        'candidateGrantCount',  v_candidate_count
    );
END;
$$;

REVOKE ALL ON FUNCTION api.revoke_permission_across_grants(text, text)
    FROM PUBLIC, anon;
-- Platform-only authority enforced by has_platform_privilege() SQL guard;
-- expose to authenticated so platform admins (logged in) can call it.
-- Non-platform-admins receive 42501 at the SQL gate.
GRANT EXECUTE ON FUNCTION api.revoke_permission_across_grants(text, text)
    TO authenticated;

-- NOTE: COMMENT ON FUNCTION with M3 + reachability tags folded at Step 17.

-- ============================================================================
-- End Chunk 5 (Steps 9-10 revocation flow).
-- ============================================================================

-- ============================================================================
-- CHUNK 6 — Steps 11-15: VAR partnership emit RPCs (5 RPCs)
-- ============================================================================
-- Homogeneous batch — 4 single-event Pattern A v2 (Steps 11/12/14/15) +
-- 1 multi-event partial-failure RPC (Step 13 cascade-revoke per
-- sub-decision H). All gate on `partnership.manage` (seeded Chunk 3
-- Step 7b) at the provider org path. ADR Decision C.3 lines 257-330.
--
-- Naming/structure conventions established earlier in this migration
-- carry through:
--   - PRE-EMIT GUARDS use RAISE EXCEPTION (no audit row yet)
--   - POST-EMIT FAILURES envelope-return (no RAISE — would roll back the
--     audit row)
--   - Pattern A v2 BOTH-checks (IF NOT FOUND + processing_error on
--     captured event_id)
--   - All 5 emit RPCs gate-reuse `partnership.manage` (per sub-decision J);
--     platform-admin short-circuit via has_platform_privilege()
--   - GRANT posture: REVOKE FROM PUBLIC, anon; GRANT TO authenticated
-- ----------------------------------------------------------------------------

-- =====================================================================
-- Step 11 — api.create_var_partnership (single-event Pattern A v2)
-- =====================================================================
-- Emits var_partnership.created. Handler at
-- handlers/routers/process_var_partnership_event.sql § var_partnership.
-- created arm INSERTs into var_partnerships_projection with idempotency
-- guard on stream_id (F1 fold-in from Chunk 2). Partial UNIQUE
-- (partner_org_id, provider_org_id) WHERE status IN ('active',
-- 'suspended') is enforced at projection layer; this RPC adds a pre-emit
-- check to surface DUPLICATE_PARTNERSHIP cleanly.
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION api.create_var_partnership(
    -- Required
    p_partner_org_id           uuid,
    p_provider_org_id          uuid,
    p_partnership_type         text,           -- 'standard' | 'white_label'
    p_contract_start_date      date,
    -- Optional
    p_contract_number          text        DEFAULT NULL,
    p_contract_end_date        date        DEFAULT NULL,
    p_revenue_share_percentage numeric     DEFAULT NULL,
    p_support_level            text        DEFAULT NULL,  -- tier1 | tier1_tier2 | full
    p_terms                    jsonb       DEFAULT '{}'::jsonb,
    p_reason                   text        DEFAULT 'VAR partnership created'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $$
DECLARE
    v_claims           jsonb := current_setting('request.jwt.claims', true)::jsonb;
    v_caller_id        uuid  := public.get_current_user_id();
    v_org_id           uuid  := NULLIF(v_claims ->> 'org_id', '')::uuid;
    v_access_blocked   boolean := COALESCE((v_claims ->> 'access_blocked')::boolean, false);
    v_partner_name     text;
    v_provider_name    text;
    v_provider_path    extensions.ltree;
    v_partnership_id   uuid;
    v_event_id         uuid;
    v_processing_error text;
BEGIN
    -- =====================================================================
    -- PRE-EMIT GUARDS (RAISE EXCEPTION)
    -- =====================================================================

    IF v_caller_id IS NULL OR v_org_id IS NULL THEN
        RAISE EXCEPTION 'Access denied' USING ERRCODE = '42501';
    END IF;
    IF v_access_blocked THEN
        RAISE EXCEPTION 'Access blocked: organization is deactivated'
            USING ERRCODE = '42501';
    END IF;
    IF p_partner_org_id IS NULL OR p_provider_org_id IS NULL THEN
        RAISE EXCEPTION 'partner_org_id and provider_org_id are required'
            USING ERRCODE = '22004';
    END IF;
    IF p_partner_org_id = p_provider_org_id THEN
        RAISE EXCEPTION 'partner_org_id must differ from provider_org_id'
            USING ERRCODE = '22023';
    END IF;
    IF p_partnership_type NOT IN ('standard', 'white_label') THEN
        RAISE EXCEPTION 'Invalid partnership_type: must be standard or white_label'
            USING ERRCODE = '22023';
    END IF;
    IF p_support_level IS NOT NULL
       AND p_support_level NOT IN ('tier1', 'tier1_tier2', 'full') THEN
        RAISE EXCEPTION 'Invalid support_level: must be tier1, tier1_tier2, or full'
            USING ERRCODE = '22023';
    END IF;
    IF p_contract_start_date IS NULL THEN
        RAISE EXCEPTION 'contract_start_date is required'
            USING ERRCODE = '22004';
    END IF;
    IF p_contract_end_date IS NOT NULL
       AND p_contract_end_date < p_contract_start_date THEN
        RAISE EXCEPTION 'contract_end_date must be on or after contract_start_date'
            USING ERRCODE = '22023';
    END IF;
    IF p_revenue_share_percentage IS NOT NULL
       AND (p_revenue_share_percentage < 0 OR p_revenue_share_percentage > 100) THEN
        RAISE EXCEPTION 'revenue_share_percentage must be between 0 and 100'
            USING ERRCODE = '22023';
    END IF;

    -- Lookup denormalized names for projection
    SELECT name INTO v_partner_name
    FROM public.organizations_projection
    WHERE id = p_partner_org_id AND deleted_at IS NULL;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Partner organization not found or deleted'
            USING ERRCODE = '42501';
    END IF;

    SELECT name, path INTO v_provider_name, v_provider_path
    FROM public.organizations_projection
    WHERE id = p_provider_org_id AND deleted_at IS NULL;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Provider organization not found or deleted'
            USING ERRCODE = '42501';
    END IF;

    -- HIPAA gate
    IF NOT (
        public.has_platform_privilege()
        OR public.has_effective_permission('partnership.manage', v_provider_path)
    ) THEN
        RAISE EXCEPTION 'Permission denied: partnership.manage at provider organization scope'
            USING ERRCODE = '42501';
    END IF;

    -- =====================================================================
    -- DUPLICATE-PARTNERSHIP PRECHECK (envelope, not RAISE)
    -- =====================================================================
    -- Partial UNIQUE (partner_org_id, provider_org_id) WHERE status IN
    -- ('active', 'suspended') is enforced at projection layer. Pre-check
    -- here surfaces it cleanly so the caller doesn't see a generic
    -- processing_error from the trigger's WHEN OTHERS catch.

    IF EXISTS (
        SELECT 1 FROM public.var_partnerships_projection
        WHERE partner_org_id = p_partner_org_id
          AND provider_org_id = p_provider_org_id
          AND status IN ('active', 'suspended')
    ) THEN
        RETURN jsonb_build_object(
            'success', false,
            'error',   'DUPLICATE_PARTNERSHIP',
            'errorDetails', jsonb_build_object(
                'code',    'DUPLICATE_PARTNERSHIP',
                'message', 'An active or suspended partnership already exists between these organizations'
            )
        );
    END IF;

    -- =====================================================================
    -- EMIT var_partnership.created
    -- =====================================================================

    v_partnership_id := gen_random_uuid();

    v_event_id := api.emit_domain_event(
        p_stream_id   := v_partnership_id,
        p_stream_type := 'var_partnership',
        p_event_type  := 'var_partnership.created',
        p_event_data  := jsonb_build_object(
            'partner_org_id',           p_partner_org_id,
            'partner_org_name',         v_partner_name,
            'provider_org_id',          p_provider_org_id,
            'provider_org_name',        v_provider_name,
            'partnership_type',         p_partnership_type,
            'contract_number',          p_contract_number,
            'contract_start_date',      p_contract_start_date,
            'contract_end_date',        p_contract_end_date,
            'revenue_share_percentage', p_revenue_share_percentage,
            'support_level',            p_support_level,
            'terms',                    p_terms
        ),
        p_event_metadata := jsonb_build_object(
            'user_id',         v_caller_id,
            'organization_id', v_org_id,
            'source',          'api.create_var_partnership',
            'reason',          p_reason
        )
    );

    -- =====================================================================
    -- PATTERN A v2 READ-BACK (BOTH checks)
    -- =====================================================================

    PERFORM 1
    FROM public.var_partnerships_projection
    WHERE id = v_partnership_id;
    IF NOT FOUND THEN
        SELECT processing_error INTO v_processing_error
        FROM public.domain_events WHERE id = v_event_id;
        RETURN jsonb_build_object(
            'success', false,
            'error',   'PROCESSING_FAILED',
            'errorDetails', jsonb_build_object(
                'code',    'PROCESSING_FAILED',
                'message', 'Event processing failed: ' ||
                    COALESCE(v_processing_error, 'projection read-back returned no row')
            ),
            'eventId', v_event_id
        );
    END IF;

    SELECT processing_error INTO v_processing_error
    FROM public.domain_events WHERE id = v_event_id;
    IF v_processing_error IS NOT NULL THEN
        RETURN jsonb_build_object(
            'success', false,
            'error',   'PROCESSING_FAILED',
            'errorDetails', jsonb_build_object(
                'code',    'PROCESSING_FAILED',
                'message', 'Event processing failed: ' || v_processing_error
            ),
            'eventId', v_event_id
        );
    END IF;

    RETURN jsonb_build_object(
        'success', true,
        'eventId', v_event_id,
        'partnership', jsonb_build_object(
            'id',                       v_partnership_id,
            'partnerOrgId',             p_partner_org_id,
            'providerOrgId',            p_provider_org_id,
            'partnershipType',          p_partnership_type,
            'contractStartDate',        p_contract_start_date,
            'contractEndDate',          p_contract_end_date,
            'revenueSharePercentage',   p_revenue_share_percentage,
            'supportLevel',             p_support_level
        )
    );
END;
$$;

REVOKE ALL ON FUNCTION api.create_var_partnership(
    uuid, uuid, text, date, text, date, numeric, text, jsonb, text
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION api.create_var_partnership(
    uuid, uuid, text, date, text, date, numeric, text, jsonb, text
) TO authenticated;


-- =====================================================================
-- Step 12 — api.update_var_partnership (single-event Pattern A v2)
-- =====================================================================
-- Emits var_partnership.updated. PATCH semantics: only non-null event_data
-- keys overwrite at the handler. Immutable fields (id, partner_org_id,
-- provider_org_id, contract_start_date) NEVER appear in event_data per
-- plan.md § "Event payload schemas (handler input contract)".
--
-- S1 architect fold-in 2026-06-08 (Chunk 6 review): PATCH NULL-clear
-- LIMITATION. The current builder pattern (IF p_X IS NOT NULL THEN
-- v_event_data := ... || jsonb_build_object('X', p_X)) makes it
-- impossible for callers to express "set nullable field back to NULL"
-- (e.g., convert fixed-term contract to open-ended by clearing
-- contract_end_date). Workarounds today: terminate + recreate (wrong
-- audit trail). Resolution path deferred to a follow-up card:
-- sentinel-based clear (p_clear_fields text[] DEFAULT '{}') + handler
-- key-presence semantics. See observations.md § "Chunk 6 carry-forward".
--
-- N1 architect fold-in 2026-06-08: partner_org_name and provider_org_name
-- are NOT exposed as RPC parameters here. They are MUTABLE handler-read
-- keys per plan.md S4 because a future cross-handler hook (Phase N) will
-- emit var_partnership.updated with name-only payloads on `org.updated`
-- cross-events. Do NOT add p_partner_org_name / p_provider_org_name
-- params to this RPC signature; names propagate via the cross-handler
-- hook, not via user-facing update calls.
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION api.update_var_partnership(
    p_partnership_id           uuid,
    p_partnership_type         text        DEFAULT NULL,  -- 'standard' | 'white_label'
    p_contract_number          text        DEFAULT NULL,
    p_contract_end_date        date        DEFAULT NULL,
    p_revenue_share_percentage numeric     DEFAULT NULL,
    p_support_level            text        DEFAULT NULL,  -- tier1 | tier1_tier2 | full
    p_terms                    jsonb       DEFAULT NULL,
    p_reason                   text        DEFAULT 'VAR partnership updated'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $$
DECLARE
    v_claims           jsonb := current_setting('request.jwt.claims', true)::jsonb;
    v_caller_id        uuid  := public.get_current_user_id();
    v_org_id           uuid  := NULLIF(v_claims ->> 'org_id', '')::uuid;
    v_access_blocked   boolean := COALESCE((v_claims ->> 'access_blocked')::boolean, false);
    v_provider_org_id  uuid;
    v_provider_path    extensions.ltree;
    v_current_status   text;
    v_contract_start   date;
    v_event_data       jsonb := '{}'::jsonb;
    v_event_id         uuid;
    v_processing_error text;
BEGIN
    -- PRE-EMIT GUARDS
    IF v_caller_id IS NULL OR v_org_id IS NULL THEN
        RAISE EXCEPTION 'Access denied' USING ERRCODE = '42501';
    END IF;
    IF v_access_blocked THEN
        RAISE EXCEPTION 'Access blocked: organization is deactivated'
            USING ERRCODE = '42501';
    END IF;
    IF p_partnership_id IS NULL THEN
        RAISE EXCEPTION 'partnership_id is required' USING ERRCODE = '22004';
    END IF;
    IF p_partnership_type IS NOT NULL
       AND p_partnership_type NOT IN ('standard', 'white_label') THEN
        RAISE EXCEPTION 'Invalid partnership_type'
            USING ERRCODE = '22023';
    END IF;
    IF p_support_level IS NOT NULL
       AND p_support_level NOT IN ('tier1', 'tier1_tier2', 'full') THEN
        RAISE EXCEPTION 'Invalid support_level'
            USING ERRCODE = '22023';
    END IF;
    IF p_revenue_share_percentage IS NOT NULL
       AND (p_revenue_share_percentage < 0 OR p_revenue_share_percentage > 100) THEN
        RAISE EXCEPTION 'revenue_share_percentage must be between 0 and 100'
            USING ERRCODE = '22023';
    END IF;

    -- Lookup partnership: provider_org_id + status + start_date
    SELECT provider_org_id, status, contract_start_date
    INTO v_provider_org_id, v_current_status, v_contract_start
    FROM public.var_partnerships_projection
    WHERE id = p_partnership_id;
    IF NOT FOUND THEN
        RETURN jsonb_build_object(
            'success', false,
            'error',   'PARTNERSHIP_NOT_FOUND',
            'errorDetails', jsonb_build_object(
                'code',    'PARTNERSHIP_NOT_FOUND',
                'message', 'partnership not found'
            )
        );
    END IF;

    -- Reject updates against non-active/non-suspended states
    IF v_current_status NOT IN ('active', 'suspended') THEN
        RETURN jsonb_build_object(
            'success', false,
            'error',   'PARTNERSHIP_INACTIVE',
            'errorDetails', jsonb_build_object(
                'code',       'PARTNERSHIP_INACTIVE',
                'message',    format('partnership is %s; cannot update', v_current_status),
                'actionable', false
            )
        );
    END IF;

    -- contract_end_date back-check vs immutable start_date
    IF p_contract_end_date IS NOT NULL
       AND p_contract_end_date < v_contract_start THEN
        RAISE EXCEPTION 'contract_end_date must be on or after contract_start_date'
            USING ERRCODE = '22023';
    END IF;

    -- HIPAA gate
    SELECT path INTO v_provider_path
    FROM public.organizations_projection
    WHERE id = v_provider_org_id AND deleted_at IS NULL;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Provider organization not found or deleted'
            USING ERRCODE = '42501';
    END IF;
    IF NOT (
        public.has_platform_privilege()
        OR public.has_effective_permission('partnership.manage', v_provider_path)
    ) THEN
        RAISE EXCEPTION 'Permission denied: partnership.manage at provider organization scope'
            USING ERRCODE = '42501';
    END IF;

    -- =====================================================================
    -- PATCH semantics: build event_data with ONLY non-null params.
    -- =====================================================================
    -- The handler at process_var_partnership_event.sql § var_partnership.
    -- updated arm uses COALESCE(safe_jsonb_extract_*, current_value) per
    -- column — only non-null event_data keys overwrite.

    IF p_partnership_type IS NOT NULL THEN
        v_event_data := v_event_data || jsonb_build_object('partnership_type', p_partnership_type);
    END IF;
    IF p_contract_number IS NOT NULL THEN
        v_event_data := v_event_data || jsonb_build_object('contract_number', p_contract_number);
    END IF;
    IF p_contract_end_date IS NOT NULL THEN
        v_event_data := v_event_data || jsonb_build_object('contract_end_date', p_contract_end_date);
    END IF;
    IF p_revenue_share_percentage IS NOT NULL THEN
        v_event_data := v_event_data || jsonb_build_object('revenue_share_percentage', p_revenue_share_percentage);
    END IF;
    IF p_support_level IS NOT NULL THEN
        v_event_data := v_event_data || jsonb_build_object('support_level', p_support_level);
    END IF;
    IF p_terms IS NOT NULL THEN
        v_event_data := v_event_data || jsonb_build_object('terms', p_terms);
    END IF;

    -- Reject empty-update (no mutable fields supplied).
    -- N1 architect fold-in 2026-06-09: surface the PATCH NULL-clear
    -- limitation in the envelope message so frontend devs trying to
    -- clear a nullable field (e.g., reset contract_end_date to NULL to
    -- convert a fixed-term contract to open-ended) get a hint that PATCH
    -- is by-design unable to do this — terminate + recreate is the
    -- workflow for that case. Underlying limitation is documented in
    -- observations.md (Chunk 6 S1 carry-forward).
    IF v_event_data = '{}'::jsonb THEN
        RETURN jsonb_build_object(
            'success', false,
            'error',   'EMPTY_UPDATE',
            'errorDetails', jsonb_build_object(
                'code',    'EMPTY_UPDATE',
                'message', 'no mutable fields provided (note: PATCH cannot clear fields to NULL — use terminate + recreate for that workflow)'
            )
        );
    END IF;

    -- =====================================================================
    -- EMIT var_partnership.updated
    -- =====================================================================

    v_event_id := api.emit_domain_event(
        p_stream_id      := p_partnership_id,
        p_stream_type    := 'var_partnership',
        p_event_type     := 'var_partnership.updated',
        p_event_data     := v_event_data,
        p_event_metadata := jsonb_build_object(
            'user_id',         v_caller_id,
            'organization_id', v_org_id,
            'source',          'api.update_var_partnership',
            'reason',          p_reason
        )
    );

    -- PATTERN A v2 READ-BACK. Handler RAISEs P0002 if row missing —
    -- captured in processing_error. The projection itself doesn't have a
    -- "was updated" predicate so we use the processing_error check as
    -- the canonical "did the handler succeed" signal.
    SELECT processing_error INTO v_processing_error
    FROM public.domain_events WHERE id = v_event_id;
    IF v_processing_error IS NOT NULL THEN
        RETURN jsonb_build_object(
            'success', false,
            'error',   'PROCESSING_FAILED',
            'errorDetails', jsonb_build_object(
                'code',    'PROCESSING_FAILED',
                'message', 'Event processing failed: ' || v_processing_error
            ),
            'eventId', v_event_id
        );
    END IF;

    RETURN jsonb_build_object(
        'success',       true,
        'eventId',       v_event_id,
        'partnershipId', p_partnership_id
    );
END;
$$;

REVOKE ALL ON FUNCTION api.update_var_partnership(
    uuid, text, text, date, numeric, text, jsonb, text
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION api.update_var_partnership(
    uuid, text, text, date, numeric, text, jsonb, text
) TO authenticated;


-- =====================================================================
-- Step 13 — api.terminate_var_partnership (MULTI-EVENT cascade-revoke)
-- =====================================================================
-- Sub-decision H + F4 fold-in (plan-mode architect review): termination
-- cascades to revoke all active var_contract grants citing this partnership.
-- Emit order: cascade-revoke access_grant.revoked FIRST (with
-- revocation_reason='var_partnership_terminated'), THEN the
-- var_partnership.terminated event. If any cascade-revoke fails, the
-- partnership termination event is NOT emitted (partnership stays active)
-- — leaves the system in a known consistent state for the operator to
-- diagnose.
--
-- S2 architect fold-in 2026-06-08 (HIPAA-rationale lock for emit order):
-- Cascade-FIRST ordering is HIPAA-load-bearing. Reversing it (terminate
-- partnership first, then revoke grants) would create a transient window
-- where: (a) partnership marked 'terminated' immediately blocks NEW
-- var_contract grant issuance via _validate_authorization_var_contract
-- (which accepts only 'active' partnerships), but (b) EXISTING grants
-- referencing this partnership remain active and continue authorizing
-- PHI access under a now-terminated business pretext. Cascade-first
-- preserves the invariant:
--     partnership active   ⟹ citing grants may be active
--     partnership terminated ⟹ all citing grants terminated
-- DO NOT flip this ordering in future refactors without re-evaluating
-- the HIPAA semantics. Partial-failure branch (below) explicitly leaves
-- partnership active so the operator can retry with idempotent semantics.
--
-- Partial-failure envelope shape (mirrors Step 10 + sub-decision B):
--   { success: false, partial: true, error: 'PARTIAL_FAILURE',
--     partnershipId, cascadedGrantEventIds[], failureIndex, failedGrantId,
--     processingError, auditEventId }
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION api.terminate_var_partnership(
    p_partnership_id     uuid,
    p_termination_reason text,
    p_reason             text DEFAULT 'VAR partnership terminated'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $$
DECLARE
    v_claims              jsonb := current_setting('request.jwt.claims', true)::jsonb;
    v_caller_id           uuid  := public.get_current_user_id();
    v_org_id              uuid  := NULLIF(v_claims ->> 'org_id', '')::uuid;
    v_access_blocked      boolean := COALESCE((v_claims ->> 'access_blocked')::boolean, false);
    v_provider_org_id     uuid;
    v_provider_path       extensions.ltree;
    v_current_status      text;
    v_grant_row           record;
    v_grant_event_id      uuid;
    v_cascade_event_ids   uuid[] := '{}'::uuid[];
    v_partnership_event_id uuid;
    v_loop_index          int := 0;
    v_failed_grant_id     uuid;
    v_processing_error    text;
    v_audit_event_id      uuid;
    v_candidate_count     int := 0;
BEGIN
    -- PRE-EMIT GUARDS
    IF v_caller_id IS NULL OR v_org_id IS NULL THEN
        RAISE EXCEPTION 'Access denied' USING ERRCODE = '42501';
    END IF;
    IF v_access_blocked THEN
        RAISE EXCEPTION 'Access blocked: organization is deactivated'
            USING ERRCODE = '42501';
    END IF;
    IF p_partnership_id IS NULL THEN
        RAISE EXCEPTION 'partnership_id is required' USING ERRCODE = '22004';
    END IF;
    IF p_termination_reason IS NULL OR p_termination_reason = '' THEN
        RAISE EXCEPTION 'termination_reason is required for HIPAA audit trail'
            USING ERRCODE = '22004';
    END IF;

    -- Lookup partnership
    SELECT provider_org_id, status
    INTO v_provider_org_id, v_current_status
    FROM public.var_partnerships_projection
    WHERE id = p_partnership_id;
    IF NOT FOUND THEN
        RETURN jsonb_build_object(
            'success', false,
            'error',   'PARTNERSHIP_NOT_FOUND',
            'errorDetails', jsonb_build_object(
                'code',    'PARTNERSHIP_NOT_FOUND',
                'message', 'partnership not found'
            )
        );
    END IF;

    -- Idempotency: already terminated/expired → envelope
    IF v_current_status IN ('terminated', 'expired') THEN
        RETURN jsonb_build_object(
            'success', false,
            'error',   'ALREADY_INACTIVE',
            'errorDetails', jsonb_build_object(
                'code',       'ALREADY_INACTIVE',
                'message',    format('partnership is already %s; cannot terminate', v_current_status),
                'actionable', false
            )
        );
    END IF;

    -- HIPAA gate
    SELECT path INTO v_provider_path
    FROM public.organizations_projection
    WHERE id = v_provider_org_id AND deleted_at IS NULL;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Provider organization not found or deleted'
            USING ERRCODE = '42501';
    END IF;
    IF NOT (
        public.has_platform_privilege()
        OR public.has_effective_permission('partnership.manage', v_provider_path)
    ) THEN
        RAISE EXCEPTION 'Permission denied: partnership.manage at provider organization scope'
            USING ERRCODE = '42501';
    END IF;

    -- Candidate-grants count for success envelope distinguishing
    SELECT count(*) INTO v_candidate_count
    FROM public.cross_tenant_access_grants_projection
    WHERE authorization_type      = 'var_contract'
      AND authorization_reference = p_partnership_id
      AND status                  = 'active';

    -- =====================================================================
    -- CASCADE-REVOKE LOOP (S5 pattern (i) per-event check + short-circuit)
    -- =====================================================================
    -- Emit access_grant.revoked for each active var_contract grant citing
    -- this partnership. Deterministic ORDER BY g.id for replay-stability.

    FOR v_grant_row IN
        SELECT id AS grant_id
        FROM public.cross_tenant_access_grants_projection
        WHERE authorization_type      = 'var_contract'
          AND authorization_reference = p_partnership_id
          AND status                  = 'active'
        ORDER BY id
    LOOP
        BEGIN
            v_grant_event_id := api.emit_domain_event(
                p_stream_id   := v_grant_row.grant_id,
                p_stream_type := 'access_grant',
                p_event_type  := 'access_grant.revoked',
                p_event_data  := jsonb_build_object(
                    'grant_id',           v_grant_row.grant_id,
                    'revoked_by',         v_caller_id,
                    'revocation_reason',  'var_partnership_terminated',
                    'revocation_details', format(
                        'Cascade-revoke triggered by termination of partnership %s: %s',
                        p_partnership_id, p_termination_reason
                    )
                ),
                p_event_metadata := jsonb_build_object(
                    'user_id',         v_caller_id,
                    'organization_id', v_org_id,
                    'source',          'api.terminate_var_partnership',
                    'reason',          p_reason
                )
            );

            SELECT processing_error INTO v_processing_error
            FROM public.domain_events WHERE id = v_grant_event_id;
            IF v_processing_error IS NOT NULL THEN
                v_failed_grant_id := v_grant_row.grant_id;
                EXIT;
            END IF;

            v_cascade_event_ids := v_cascade_event_ids || v_grant_event_id;
            v_loop_index := v_loop_index + 1;
        EXCEPTION WHEN OTHERS THEN
            v_failed_grant_id  := v_grant_row.grant_id;
            v_processing_error := SQLERRM;
            EXIT;
        END;
    END LOOP;

    -- =====================================================================
    -- PARTIAL-FAILURE BRANCH (do NOT emit partnership termination)
    -- =====================================================================

    IF v_failed_grant_id IS NOT NULL THEN
        -- audit emit (sub-decision B); same WARNING pattern as Step 10
        BEGIN
            v_audit_event_id := api.emit_domain_event(
                p_stream_id   := gen_random_uuid(),
                p_stream_type := 'platform_admin',
                p_event_type  := 'audit.high_risk_action_logged',
                p_event_data  := jsonb_build_object(
                    'action',             'terminate_var_partnership_partial_failure',
                    'partnership_id',     p_partnership_id,
                    'termination_reason', p_termination_reason,
                    'failed_grant_id',    v_failed_grant_id,
                    'cascade_event_ids',  to_jsonb(v_cascade_event_ids),
                    'failure_index',      v_loop_index,
                    'processing_error',   v_processing_error
                ),
                p_event_metadata := jsonb_build_object(
                    'user_id',         v_caller_id,
                    'organization_id', v_org_id,
                    'source',          'api.terminate_var_partnership',
                    'reason',          'High-risk action: partial-failure during cascade-revoke'
                )
            );
        EXCEPTION WHEN OTHERS THEN
            RAISE WARNING 'audit emit failed during partnership-termination partial-failure: %', SQLERRM;
            v_audit_event_id := NULL;
        END;

        RETURN jsonb_build_object(
            'success',              false,
            'partial',              true,
            'error',                'PARTIAL_FAILURE',
            'partnershipId',        p_partnership_id,
            'cascadedGrantEventIds', to_jsonb(v_cascade_event_ids),
            'failureIndex',         v_loop_index,
            'failedGrantId',        v_failed_grant_id,
            'processingError',      v_processing_error,
            'auditEventId',         v_audit_event_id
        );
    END IF;

    -- =====================================================================
    -- EMIT var_partnership.terminated (cascade complete)
    -- =====================================================================

    v_partnership_event_id := api.emit_domain_event(
        p_stream_id   := p_partnership_id,
        p_stream_type := 'var_partnership',
        p_event_type  := 'var_partnership.terminated',
        p_event_data  := jsonb_build_object(
            'terminated_by',      v_caller_id,
            'termination_reason', p_termination_reason
        ),
        p_event_metadata := jsonb_build_object(
            'user_id',         v_caller_id,
            'organization_id', v_org_id,
            'source',          'api.terminate_var_partnership',
            'reason',          p_reason
        )
    );

    -- PATTERN A v2 READ-BACK for partnership termination
    PERFORM 1
    FROM public.var_partnerships_projection
    WHERE id = p_partnership_id AND status = 'terminated';
    IF NOT FOUND THEN
        SELECT processing_error INTO v_processing_error
        FROM public.domain_events WHERE id = v_partnership_event_id;
        RETURN jsonb_build_object(
            'success', false,
            'error',   'PROCESSING_FAILED',
            'errorDetails', jsonb_build_object(
                'code',    'PROCESSING_FAILED',
                'message', 'Partnership termination event processing failed: ' ||
                    COALESCE(v_processing_error, 'projection read-back returned no row')
            ),
            'partnershipEventId',   v_partnership_event_id,
            'cascadedGrantEventIds', to_jsonb(v_cascade_event_ids)
        );
    END IF;

    SELECT processing_error INTO v_processing_error
    FROM public.domain_events WHERE id = v_partnership_event_id;
    IF v_processing_error IS NOT NULL THEN
        RETURN jsonb_build_object(
            'success', false,
            'error',   'PROCESSING_FAILED',
            'errorDetails', jsonb_build_object(
                'code',    'PROCESSING_FAILED',
                'message', 'Partnership termination event processing failed: ' || v_processing_error
            ),
            'partnershipEventId',   v_partnership_event_id,
            'cascadedGrantEventIds', to_jsonb(v_cascade_event_ids)
        );
    END IF;

    RETURN jsonb_build_object(
        'success',                true,
        'partnershipId',          p_partnership_id,
        'partnershipEventId',     v_partnership_event_id,
        'cascadedGrantEventIds',  to_jsonb(v_cascade_event_ids),
        'cascadedGrantCount',     COALESCE(array_length(v_cascade_event_ids, 1), 0),
        'candidateGrantCount',    v_candidate_count
    );
END;
$$;

REVOKE ALL ON FUNCTION api.terminate_var_partnership(uuid, text, text)
    FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION api.terminate_var_partnership(uuid, text, text)
    TO authenticated;


-- =====================================================================
-- Step 14 — api.suspend_var_partnership (single-event Pattern A v2)
-- =====================================================================
-- Emits var_partnership.suspended. No cascade — suspension is reversible
-- (api.reactivate_var_partnership). Citing grants stay active; the
-- VAR-validator helper accepts only 'active' partnerships, so new grant
-- issuance against a suspended partnership is blocked by Step 6's
-- _validate_authorization_var_contract.
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION api.suspend_var_partnership(
    p_partnership_id          uuid,
    p_suspension_reason       text,
    p_expected_resolution_date date DEFAULT NULL,
    p_reason                  text DEFAULT 'VAR partnership suspended'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $$
DECLARE
    v_claims           jsonb := current_setting('request.jwt.claims', true)::jsonb;
    v_caller_id        uuid  := public.get_current_user_id();
    v_org_id           uuid  := NULLIF(v_claims ->> 'org_id', '')::uuid;
    v_access_blocked   boolean := COALESCE((v_claims ->> 'access_blocked')::boolean, false);
    v_provider_org_id  uuid;
    v_provider_path    extensions.ltree;
    v_current_status   text;
    v_event_id         uuid;
    v_processing_error text;
BEGIN
    IF v_caller_id IS NULL OR v_org_id IS NULL THEN
        RAISE EXCEPTION 'Access denied' USING ERRCODE = '42501';
    END IF;
    IF v_access_blocked THEN
        RAISE EXCEPTION 'Access blocked: organization is deactivated'
            USING ERRCODE = '42501';
    END IF;
    IF p_partnership_id IS NULL THEN
        RAISE EXCEPTION 'partnership_id is required' USING ERRCODE = '22004';
    END IF;
    IF p_suspension_reason IS NULL OR p_suspension_reason = '' THEN
        RAISE EXCEPTION 'suspension_reason is required for HIPAA audit trail'
            USING ERRCODE = '22004';
    END IF;

    SELECT provider_org_id, status
    INTO v_provider_org_id, v_current_status
    FROM public.var_partnerships_projection
    WHERE id = p_partnership_id;
    IF NOT FOUND THEN
        RETURN jsonb_build_object(
            'success', false,
            'error',   'PARTNERSHIP_NOT_FOUND',
            'errorDetails', jsonb_build_object(
                'code',    'PARTNERSHIP_NOT_FOUND',
                'message', 'partnership not found'
            )
        );
    END IF;

    -- Only active partnerships can be suspended
    IF v_current_status <> 'active' THEN
        RETURN jsonb_build_object(
            'success', false,
            'error',   'INVALID_STATE_TRANSITION',
            'errorDetails', jsonb_build_object(
                'code',       'INVALID_STATE_TRANSITION',
                'message',    format('partnership is %s; only active partnerships can be suspended', v_current_status),
                'actionable', false
            )
        );
    END IF;

    SELECT path INTO v_provider_path
    FROM public.organizations_projection
    WHERE id = v_provider_org_id AND deleted_at IS NULL;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Provider organization not found or deleted'
            USING ERRCODE = '42501';
    END IF;
    IF NOT (
        public.has_platform_privilege()
        OR public.has_effective_permission('partnership.manage', v_provider_path)
    ) THEN
        RAISE EXCEPTION 'Permission denied: partnership.manage at provider organization scope'
            USING ERRCODE = '42501';
    END IF;

    v_event_id := api.emit_domain_event(
        p_stream_id   := p_partnership_id,
        p_stream_type := 'var_partnership',
        p_event_type  := 'var_partnership.suspended',
        p_event_data  := jsonb_build_object(
            'suspended_by',             v_caller_id,
            'suspension_reason',        p_suspension_reason,
            'expected_resolution_date', p_expected_resolution_date
        ),
        p_event_metadata := jsonb_build_object(
            'user_id',         v_caller_id,
            'organization_id', v_org_id,
            'source',          'api.suspend_var_partnership',
            'reason',          p_reason
        )
    );

    PERFORM 1
    FROM public.var_partnerships_projection
    WHERE id = p_partnership_id AND status = 'suspended';
    IF NOT FOUND THEN
        SELECT processing_error INTO v_processing_error
        FROM public.domain_events WHERE id = v_event_id;
        RETURN jsonb_build_object(
            'success', false,
            'error',   'PROCESSING_FAILED',
            'errorDetails', jsonb_build_object(
                'code',    'PROCESSING_FAILED',
                'message', 'Event processing failed: ' ||
                    COALESCE(v_processing_error, 'projection read-back returned no row')
            ),
            'eventId', v_event_id
        );
    END IF;

    SELECT processing_error INTO v_processing_error
    FROM public.domain_events WHERE id = v_event_id;
    IF v_processing_error IS NOT NULL THEN
        RETURN jsonb_build_object(
            'success', false,
            'error',   'PROCESSING_FAILED',
            'errorDetails', jsonb_build_object(
                'code',    'PROCESSING_FAILED',
                'message', 'Event processing failed: ' || v_processing_error
            ),
            'eventId', v_event_id
        );
    END IF;

    RETURN jsonb_build_object(
        'success',       true,
        'eventId',       v_event_id,
        'partnershipId', p_partnership_id
    );
END;
$$;

REVOKE ALL ON FUNCTION api.suspend_var_partnership(uuid, text, date, text)
    FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION api.suspend_var_partnership(uuid, text, date, text)
    TO authenticated;


-- =====================================================================
-- Step 15 — api.reactivate_var_partnership (single-event Pattern A v2)
-- =====================================================================
-- Emits var_partnership.reactivated. Transition: suspended → active.
-- Handler clears suspended_at / suspended_by / suspension_reason.
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION api.reactivate_var_partnership(
    p_partnership_id        uuid,
    p_new_contract_end_date date DEFAULT NULL,
    p_reason                text DEFAULT 'VAR partnership reactivated'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $$
DECLARE
    v_claims           jsonb := current_setting('request.jwt.claims', true)::jsonb;
    v_caller_id        uuid  := public.get_current_user_id();
    v_org_id           uuid  := NULLIF(v_claims ->> 'org_id', '')::uuid;
    v_access_blocked   boolean := COALESCE((v_claims ->> 'access_blocked')::boolean, false);
    v_provider_org_id  uuid;
    v_provider_path    extensions.ltree;
    v_current_status   text;
    v_contract_start   date;
    v_event_id         uuid;
    v_processing_error text;
BEGIN
    IF v_caller_id IS NULL OR v_org_id IS NULL THEN
        RAISE EXCEPTION 'Access denied' USING ERRCODE = '42501';
    END IF;
    IF v_access_blocked THEN
        RAISE EXCEPTION 'Access blocked: organization is deactivated'
            USING ERRCODE = '42501';
    END IF;
    IF p_partnership_id IS NULL THEN
        RAISE EXCEPTION 'partnership_id is required' USING ERRCODE = '22004';
    END IF;

    SELECT provider_org_id, status, contract_start_date
    INTO v_provider_org_id, v_current_status, v_contract_start
    FROM public.var_partnerships_projection
    WHERE id = p_partnership_id;
    IF NOT FOUND THEN
        RETURN jsonb_build_object(
            'success', false,
            'error',   'PARTNERSHIP_NOT_FOUND',
            'errorDetails', jsonb_build_object(
                'code',    'PARTNERSHIP_NOT_FOUND',
                'message', 'partnership not found'
            )
        );
    END IF;

    -- Only suspended partnerships can be reactivated
    IF v_current_status <> 'suspended' THEN
        RETURN jsonb_build_object(
            'success', false,
            'error',   'INVALID_STATE_TRANSITION',
            'errorDetails', jsonb_build_object(
                'code',       'INVALID_STATE_TRANSITION',
                'message',    format('partnership is %s; only suspended partnerships can be reactivated', v_current_status),
                'actionable', false
            )
        );
    END IF;

    -- new_contract_end_date back-check vs immutable start_date
    IF p_new_contract_end_date IS NOT NULL
       AND p_new_contract_end_date < v_contract_start THEN
        RAISE EXCEPTION 'new_contract_end_date must be on or after contract_start_date'
            USING ERRCODE = '22023';
    END IF;

    SELECT path INTO v_provider_path
    FROM public.organizations_projection
    WHERE id = v_provider_org_id AND deleted_at IS NULL;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Provider organization not found or deleted'
            USING ERRCODE = '42501';
    END IF;
    IF NOT (
        public.has_platform_privilege()
        OR public.has_effective_permission('partnership.manage', v_provider_path)
    ) THEN
        RAISE EXCEPTION 'Permission denied: partnership.manage at provider organization scope'
            USING ERRCODE = '42501';
    END IF;

    v_event_id := api.emit_domain_event(
        p_stream_id   := p_partnership_id,
        p_stream_type := 'var_partnership',
        p_event_type  := 'var_partnership.reactivated',
        p_event_data  := jsonb_build_object(
            'reactivated_by',         v_caller_id,
            'new_contract_end_date',  p_new_contract_end_date
        ),
        p_event_metadata := jsonb_build_object(
            'user_id',         v_caller_id,
            'organization_id', v_org_id,
            'source',          'api.reactivate_var_partnership',
            'reason',          p_reason
        )
    );

    PERFORM 1
    FROM public.var_partnerships_projection
    WHERE id = p_partnership_id AND status = 'active';
    IF NOT FOUND THEN
        SELECT processing_error INTO v_processing_error
        FROM public.domain_events WHERE id = v_event_id;
        RETURN jsonb_build_object(
            'success', false,
            'error',   'PROCESSING_FAILED',
            'errorDetails', jsonb_build_object(
                'code',    'PROCESSING_FAILED',
                'message', 'Event processing failed: ' ||
                    COALESCE(v_processing_error, 'projection read-back returned no row')
            ),
            'eventId', v_event_id
        );
    END IF;

    SELECT processing_error INTO v_processing_error
    FROM public.domain_events WHERE id = v_event_id;
    IF v_processing_error IS NOT NULL THEN
        RETURN jsonb_build_object(
            'success', false,
            'error',   'PROCESSING_FAILED',
            'errorDetails', jsonb_build_object(
                'code',    'PROCESSING_FAILED',
                'message', 'Event processing failed: ' || v_processing_error
            ),
            'eventId', v_event_id
        );
    END IF;

    RETURN jsonb_build_object(
        'success',       true,
        'eventId',       v_event_id,
        'partnershipId', p_partnership_id
    );
END;
$$;

REVOKE ALL ON FUNCTION api.reactivate_var_partnership(uuid, date, text)
    FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION api.reactivate_var_partnership(uuid, date, text)
    TO authenticated;

-- ============================================================================
-- End Chunk 6 (Steps 11-15 VAR partnership emit RPCs).
-- ============================================================================

-- ============================================================================
-- CHUNK 7 — Steps 16-17: read RPC + COMMENT ON FUNCTION tag wave
-- ============================================================================
-- Step 16: api.get_grant_role_templates — single read RPC mirroring
--          api.get_role_permission_templates signature; returns
--          (template_name, permission_name, default_terms) per F1 fold-in
--          (3-column UNIQUE means template_name disambiguates rows).
-- Step 17: COMMENT ON FUNCTION tag wave on all 9 new api.* RPCs.
--          M3 RPC shape registry tag (@a4c-rpc-shape) + reachability
--          matrix tags (@a4c-bucket, @a4c-consultant-callable,
--          @a4c-consultant-callable-reason, @a4c-phase-target) per
--          PR #70 Step 11 precedent.
--
-- Private helpers (_validate_authorization_*) are NOT in api schema; no
-- M3 or matrix tags. Router (process_var_partnership_event) and the
-- safe_jsonb_extract_numeric helper likewise out of scope (public schema).
-- ----------------------------------------------------------------------------

-- =====================================================================
-- Step 16 — api.get_grant_role_templates (read RPC)
-- =====================================================================
-- ADR Decision C.1 L255 + F1 fold-in. Returns the active template rows
-- for a given authorization_type. template_name is included because
-- Phase 1 deployed grant_role_templates with 3-column UNIQUE
-- (template_name, authorization_type, permission_name), so multiple
-- templates may share an authorization_type (e.g., var_default + future
-- var_enhanced under 'var_contract'). The caller groups by
-- template_name to render template selection UI.
--
-- No permission gate — template metadata is non-sensitive (it is the
-- LIST of available templates, not the bound grants). Bucket E
-- (grant-irrelevant by default). Consultant-callable yes.
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION api.get_grant_role_templates(p_authorization_type text)
RETURNS TABLE(
    template_name   text,
    permission_name text,
    default_terms   jsonb
)
LANGUAGE plpgsql
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $$
BEGIN
    -- Input validation mirrors Step 8 / 11 authorization_type 5-value enum.
    -- Invalid input returns empty resultset rather than RAISE (read RPCs
    -- generally don't RAISE on invalid input — the caller gets zero rows
    -- and can branch on count).
    IF p_authorization_type IS NULL OR p_authorization_type NOT IN (
        'var_contract', 'court_order', 'family_participation',
        'social_services_assignment', 'emergency_access'
    ) THEN
        RETURN;
    END IF;

    RETURN QUERY
    SELECT grt.template_name, grt.permission_name, grt.default_terms
    FROM public.grant_role_templates grt
    WHERE grt.authorization_type = p_authorization_type
      AND grt.is_active = true
    ORDER BY grt.template_name, grt.permission_name;
END;
$$;

REVOKE ALL ON FUNCTION api.get_grant_role_templates(text)
    FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION api.get_grant_role_templates(text)
    TO authenticated;
-- S1 architect fold-in 2026-06-08 (Chunk 7 review): GRANT to service_role
-- defensively for future bootstrap-workflow / Edge Function callers
-- enumerating available templates. Matches Phase 1's grant_role_templates
-- service_role RLS carve-out spirit.
GRANT EXECUTE ON FUNCTION api.get_grant_role_templates(text)
    TO service_role;


-- =====================================================================
-- Step 17 — COMMENT ON FUNCTION tag wave (9 new api.* RPCs)
-- =====================================================================
-- M3 RPC shape registry tag (@a4c-rpc-shape) + reachability matrix tags
-- (@a4c-bucket, @a4c-consultant-callable, @a4c-consultant-callable-reason,
-- @a4c-phase-target) per PR #70 Step 11 precedent. Tagging direct via
-- COMMENT ON FUNCTION (per-RPC explicit form) rather than mapping-DO-
-- loop because Phase 2 adds only 9 RPCs (vs Phase 1's 170-row backfill).
--
-- N1 architect fold-in 2026-06-08 (Chunk 7 review): 9 = 8 emit + 1 read.
-- The 5 private validators (`public._validate_authorization_*`), router
-- (`public.process_var_partnership_event`), and helper
-- (`public.safe_jsonb_extract_numeric`) are in `public` schema, NOT
-- `api`. The codegen SQL filter `WHERE n.nspname = 'api'` at
-- `gen-rpc-registry.cjs:69` + `gen-rpc-reachability-matrix.cjs` makes
-- them invisible to both registries; M3 + reachability matrix N/A by
-- design. Plan.md row 89's "14 new functions" count was inclusive of
-- those out-of-scope public functions for clarity, not as a tagging
-- requirement.
--
-- Tag rationale:
--   Emit RPCs (8 total — Steps 8/9/10/11/12/13/14/15):
--     @a4c-rpc-shape: envelope
--     @a4c-bucket: B (JWT-bound provider-admin operations)
--     @a4c-consultant-callable: no
--     @a4c-consultant-callable-reason: Provider-admin authority (HIPAA
--       gate at provider org path); consultant variant N/A by design —
--       grants are issued FOR consultants by provider admins, not BY
--       consultants.
--     @a4c-phase-target: none (canonical at deploy; matches Phase 1
--                                B-bucket convention — `phase-target` is
--                                a forward-refactor-target marker, not a
--                                "shipped this phase" tag. F2 architect
--                                fold-in 2026-06-08 Chunk 7 review.)
--
--   Read RPC (1 total — Step 16):
--     @a4c-rpc-shape: read
--     @a4c-bucket: E (no tenancy context; grant-irrelevant)
--     @a4c-consultant-callable: yes
--     @a4c-consultant-callable-reason: Template metadata — non-sensitive
--       list of available grant-role templates; consultant can read to
--       discover what authorization types and template names exist.
--     @a4c-phase-target: none (canonical at deploy; no further work)
--
-- Step 10 (api.revoke_permission_across_grants) is platform-only — the
-- consultant-callable tag is still "no" because the SQL gate enforces
-- has_platform_privilege(), but the reason text reflects platform-
-- tier authority.
-- ----------------------------------------------------------------------------

-- Step 8 — api.create_access_grant
COMMENT ON FUNCTION api.create_access_grant(
    uuid, uuid, text, uuid, text, text,
    uuid, uuid, text, text[], jsonb, timestamptz, text
) IS
$cmt$Emit access_grant.created event with hybrid-snapshot permission
resolution. Locks template (3-column UNIQUE filter per F1 fold-in),
applies INTERSECT narrowing on overrides (literals only, no implication
expansion — HIPAA least-authority), resolves scope_path per scope mode,
emits via Pattern A v2 with BOTH-checks readback.

@a4c-rpc-shape: envelope
@a4c-bucket: B
@a4c-consultant-callable: no
@a4c-consultant-callable-reason: Provider-admin authority (HIPAA gate at provider org path via has_effective_permission('grant.create', v_provider_path)); consultant variant N/A by design — grants are issued FOR consultants by provider admins, not BY consultants.
@a4c-phase-target: none$cmt$;

-- Step 9 — api.revoke_access_grant
COMMENT ON FUNCTION api.revoke_access_grant(uuid, text, text) IS
$cmt$Emit access_grant.revoked event for a single grant. HIPAA gate on
grant.revoke at the grant's provider_org_path; idempotency on revoked/
expired states (returns success-false envelope with actionable=false
flag); Pattern A v2 BOTH-checks readback against status='revoked'.

@a4c-rpc-shape: envelope
@a4c-bucket: B
@a4c-consultant-callable: no
@a4c-consultant-callable-reason: Provider-admin authority (HIPAA gate at provider org path via has_effective_permission('grant.revoke', v_provider_path)); consultant variant N/A by design — revocations are issued by the data-owner provider, not by the consultant.
@a4c-phase-target: none$cmt$;

-- Step 10 — api.revoke_permission_across_grants
COMMENT ON FUNCTION api.revoke_permission_across_grants(text, text) IS
$cmt$Cross-grant policy override: emit access_grant.policy_override_applied
for every active grant carrying the targeted permission. RPC-side filter
(I fold-in) avoids no-op events. Per-event processing_error check inside
loop with short-circuit on first failure (S5 pattern i). Partial-failure
envelope mirrors PR #44 modify_user_roles shape + emits
audit.high_risk_action_logged (stream_type='platform_admin') BEFORE
returning. candidateGrantCount in success envelope distinguishes no-op
from typo cases. Platform-only authority (has_platform_privilege()).

Multi-caller note: concurrent invocations on OVERLAPPING permission_names
use last-emit-wins semantics on the projection (handler REPLACES
permissions jsonb). Serial invocation is the assumed operational pattern.

F1+S3 architect fold-in 2026-06-08 (Chunk 7 review): bucket E (NOT B)
— this RPC has NO JWT-derived tenancy binding (no get_current_org_id
call). Phase 1 bucket taxonomy: E = "no tenancy context; grant-irrelevant
by default" — exactly the right classification for a platform-only
cross-grant operation. Disambiguates from ADR §B sub-decision lettering
(unrelated namespaces).

@a4c-rpc-shape: envelope
@a4c-bucket: E
@a4c-consultant-callable: no
@a4c-consultant-callable-reason: Platform-tier authority (has_platform_privilege() required); cross-grant policy override is a platform-level operation; not callable by providers OR consultants.
@a4c-phase-target: none$cmt$;

-- Step 11 — api.create_var_partnership
COMMENT ON FUNCTION api.create_var_partnership(
    uuid, uuid, text, date, text, date, numeric, text, jsonb, text
) IS
$cmt$Emit var_partnership.created event with denormalized name lookup +
DUPLICATE_PARTNERSHIP precheck against the partial UNIQUE constraint
(status IN active/suspended). HIPAA gate on partnership.manage at
provider org path. Pattern A v2 BOTH-checks readback.

@a4c-rpc-shape: envelope
@a4c-bucket: B
@a4c-consultant-callable: no
@a4c-consultant-callable-reason: Provider-admin authority + partnership.manage permission (org-scoped at provider path); consultant variant N/A — partnerships are business relationships established BY the provider org.
@a4c-phase-target: none$cmt$;

-- Step 12 — api.update_var_partnership
COMMENT ON FUNCTION api.update_var_partnership(
    uuid, text, text, date, numeric, text, jsonb, text
) IS
$cmt$Emit var_partnership.updated event with PATCH semantics (only
non-null params overwrite). EMPTY_UPDATE rejection. Immutable identity
fields (id, partner_org_id, provider_org_id, contract_start_date) NEVER
in payload. Reject updates against non-active/non-suspended state.
Reserved-keys note: partner_org_name and provider_org_name are HANDLER-
read keys reserved for future cross-handler hook on org.updated (Phase N);
NOT exposed as RPC parameters here.

Known limitation (S1 fold-in 2026-06-08): PATCH builder cannot clear
nullable fields back to NULL via current signature. Workaround = future
sentinel-based clear (p_clear_fields text[]) tracked in observations.md.

@a4c-rpc-shape: envelope
@a4c-bucket: B
@a4c-consultant-callable: no
@a4c-consultant-callable-reason: Provider-admin authority + partnership.manage permission; consultant variant N/A.
@a4c-phase-target: none$cmt$;

-- Step 13 — api.terminate_var_partnership (multi-event cascade)
COMMENT ON FUNCTION api.terminate_var_partnership(uuid, text, text) IS
$cmt$MULTI-EVENT cascade-revoke per sub-decision H. Emit cascade-revoke
access_grant.revoked FIRST (HIPAA-load-bearing ordering — see migration
header), THEN var_partnership.terminated. Partial-failure branch leaves
partnership active (operator-retry idempotent). audit.high_risk_action_
logged emit on partial failure. candidateGrantCount in success envelope.

@a4c-rpc-shape: envelope
@a4c-bucket: B
@a4c-consultant-callable: no
@a4c-consultant-callable-reason: Provider-admin authority + partnership.manage permission; cascade-revocation is a high-risk action initiated by the provider org, not the consultant.
@a4c-phase-target: none$cmt$;

-- Step 14 — api.suspend_var_partnership
COMMENT ON FUNCTION api.suspend_var_partnership(uuid, text, date, text) IS
$cmt$Emit var_partnership.suspended event. Transition guard: active →
suspended only. No cascade — suspension is reversible (api.reactivate_
var_partnership); citing grants stay active; new-grant issuance blocked
by Step 6 _validate_authorization_var_contract (accepts only 'active'
partnerships).

@a4c-rpc-shape: envelope
@a4c-bucket: B
@a4c-consultant-callable: no
@a4c-consultant-callable-reason: Provider-admin authority + partnership.manage permission; consultant variant N/A.
@a4c-phase-target: none$cmt$;

-- Step 15 — api.reactivate_var_partnership
COMMENT ON FUNCTION api.reactivate_var_partnership(uuid, date, text) IS
$cmt$Emit var_partnership.reactivated event. Transition guard: suspended
→ active only. Handler clears suspended_at / suspended_by /
suspension_reason. new_contract_end_date optional back-check vs immutable
contract_start_date.

@a4c-rpc-shape: envelope
@a4c-bucket: B
@a4c-consultant-callable: no
@a4c-consultant-callable-reason: Provider-admin authority + partnership.manage permission; consultant variant N/A.
@a4c-phase-target: none$cmt$;

-- Step 16 — api.get_grant_role_templates (read RPC)
COMMENT ON FUNCTION api.get_grant_role_templates(text) IS
$cmt$Return active grant_role_templates rows for a given authorization_
type. Mirrors api.get_role_permission_templates shape. F1 fold-in:
template_name returned for caller disambiguation under 3-column UNIQUE.
No permission gate — template metadata is non-sensitive (it is the
LIST of available templates, not the bound grants).

@a4c-rpc-shape: read
@a4c-bucket: E
@a4c-consultant-callable: yes
@a4c-consultant-callable-reason: Template metadata — non-sensitive list of available grant-role templates; consultants can read to discover what authorization types and templates exist (e.g., for UI rendering of "what templates does this VAR contract support").
@a4c-phase-target: none$cmt$;

-- =====================================================================
-- Step 17 assertion — Phase-2-scoped tag-presence safety net
-- =====================================================================
-- S2 architect fold-in 2026-06-08 (Chunk 7 review): re-fires the Phase 1
-- 0-untagged invariant on every Phase 2 apply. Catches drift introduced
-- by ANY prior migration (not just Phase 2) that added an api.* function
-- without tagging it. Defensive — CI gates `rpc-registry-sync.yml` +
-- `rpc-reachability-matrix-sync.yml` already catch this at PR time, but
-- a deploy-time assertion fails fast on any post-CI drift (e.g., manual
-- pg_proc edits, side-channel migrations).
--
-- Invariant: every `api.*` function carries @a4c-rpc-shape (envelope|read)
-- + @a4c-bucket (A|A-variant|B|C|D|D-variant|E|E-variant) + @a4c-phase-
-- target (non-empty token). Reuses Phase 1's assertion regexes including
-- the codified-pitfall #1 fix (\y vs \b for word-boundary).
-- ----------------------------------------------------------------------------

DO $$
DECLARE
    v_untagged_count integer;
    v_untagged_list  text;
BEGIN
    SELECT
        COUNT(*),
        string_agg(p.proname, ', ' ORDER BY p.proname)
    INTO v_untagged_count, v_untagged_list
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    LEFT JOIN pg_description d ON d.objoid = p.oid AND d.objsubid = 0
    WHERE n.nspname = 'api'
      AND p.prokind = 'f'
      AND (
            d.description IS NULL
         OR d.description !~ '@a4c-rpc-shape:\s*(envelope|read)\y'
         OR d.description !~ '@a4c-bucket:\s*(A-variant|A|B|C|D-variant|D|E-variant|E)\y'
         OR d.description !~ '@a4c-phase-target:\s*\S+'
      );

    IF v_untagged_count > 0 THEN
        RAISE EXCEPTION 'Phase 2 Step 17 assertion failed: % api.* function(s) lack one or more of @a4c-rpc-shape / @a4c-bucket / @a4c-phase-target tags. Untagged: %',
            v_untagged_count, COALESCE(v_untagged_list, '<none>')
            USING ERRCODE = 'P9001';
    END IF;

    RAISE NOTICE 'Phase 2 Step 17 assertion: all api.* functions carry the canonical tag set';
END $$;

-- ============================================================================
-- End Chunk 7 (Steps 16-17 read RPC + COMMENT ON FUNCTION tag wave).
-- ============================================================================
-- Stage C drafting complete. Stage D (post-migration deliverables) remains:
--   - AsyncAPI updates: var_partnership.yaml (NEW); access_grant.yaml
--     (+AccessGrantPolicyOverrideApplied per PR #70 N1); audit.yaml
--     (NEW for AuditHighRiskActionLogged per Chunk 5 F1); asyncapi.yaml
--     channel + stream_type enum.
--   - npm run generate:types + cp to frontend/src/types/generated/.
--   - Handler reference files already synced inline during Stage C.
--   - infrastructure/supabase/CLAUDE.md: codify underscore-prefix
--     private-helper convention (sub-decision A); event-naming addendum
--     per Chunk 5 F1 precedent.
--   - documentation/architecture/data/provider-partners-architecture.md:
--     verify no drift from locked ADR C.3.
--   - ADR addendum below Decision C.3 documenting partial UNIQUE per
--     sub-decision G; below Decision C.2 documenting 3-column UNIQUE per
--     F1.
-- Stage E (smoke + UAT) → Stage F (PR + ship) follow per Phase 1 cadence.
-- ============================================================================
