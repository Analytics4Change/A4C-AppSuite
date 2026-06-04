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
-- authenticated; GRANT EXECUTE TO service_role ONLY. SECURITY DEFINER
-- because the helper queries var_partnerships_projection which is RLS-
-- gated to org-admin SELECT; service_role bypasses RLS but we still set
-- SECURITY DEFINER for explicit-authority semantics + symmetry with
-- _validate_authorization_emergency_access (Step 7).
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
a typed sentinel.

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
-- Default-bundle into provider-admin role: DEFERRED to operator runbook
-- (or Phase 2.5 follow-up card). Reason: today's HIPAA gate
-- `has_platform_privilege() OR has_effective_permission('partnership.manage',
-- <provider_org_path>)` already admits platform admins, so VAR partnership
-- RPCs are immediately usable by platform admins without role-bundling.
-- Provider-org admins gain access via subsequent role assignment.
-- ----------------------------------------------------------------------------

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

-- ============================================================================
-- End Chunk 3 (Steps 6-7-7b gates cluster).
-- Next chunks: 8 (create_access_grant — largest RPC, alone),
-- 9-10 (revoke flow incl. multi-event partial-failure),
-- 11-15 (5 VAR emit RPCs incl. Step 13 cascade-revoke),
-- 16-17 (read RPC + COMMENT ON FUNCTION tags).
-- ============================================================================
