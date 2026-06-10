-- ============================================================================
-- HOTFIX: align cross_tenant_access_grants_projection schema with the names
-- the deployed process_access_grant_event router writes.
-- ============================================================================
--
-- Origin: surfaced during Phase 2 UAT execution 2026-06-09. Probe L8
-- (api.revoke_access_grant happy path) returned PROCESSING_FAILED with
-- `column "revocation_reason" of relation "cross_tenant_access_grants_projection"
-- does not exist`. Audit of all router arms revealed 3 of 5 lifecycle arms
-- write to columns that don't exist:
--
--   revoked arm     — writes `revocation_reason` + `revocation_details`
--                     schema has `revoked_reason`, no `_details`
--
--   expired arm     — writes `expired_at` + `expiration_type`
--                     schema has neither
--
--   reactivated arm — writes `resolution_details`
--                     schema has `reactivation_notes` (different name,
--                     same semantic field)
--
--   suspended arm   — works (schema + handler aligned)
--   policy_override — works (only touches `permissions` jsonb)
--
-- Defect predates Phase 2 — handler was built against a different schema
-- shape than what landed in baseline_v4. Surfaced now because Phase 2's
-- cascade-revoke (terminate_var_partnership Step 13) is the first
-- production-path that emits access_grant.revoked at scale; PR #73 +
-- Phase 2 UAT C1 + L8 surfaced it.
--
-- Direction (per Phase 2 UAT findings + AsyncAPI contract review):
-- The handler/AsyncAPI/event_data side all use the `<aggregate>_<noun>`
-- naming convention (`revocation_reason`, `revocation_details`,
-- `expiration_type`, `resolution_details`). The PROJECTION SCHEMA is
-- the outlier. Aligning the schema to the handler is therefore the
-- minimal-blast-radius fix:
--   1. No handler / AsyncAPI / event_data changes.
--   2. No consumer code changes (callers read these columns only via
--      Pattern A v2 read-back which returns Pattern A envelopes — the
--      consumer-side field names mirror schema, but post-fix the
--      schema field names match what consumers already expected from
--      the event_data side).
--
-- Pre-existing PHI / audit invariants preserved: no row-level data
-- changes; only DDL renames + adds + COMMENT refreshes.
--
-- Per codified pitfall #6: the handler body was fetched via Mgmt API
-- pg_get_functiondef before drafting this fix to verify which columns
-- it actually writes (not just what reference files say). All 5 missing/
-- mis-named column references confirmed against the deployed body.
-- ============================================================================

-- ============================================================================
-- Section 1 — Idempotent column renames + adds
-- ============================================================================
-- Standard PG has no `ALTER TABLE ... RENAME COLUMN IF EXISTS`. Use DO blocks
-- guarded by information_schema lookups so the migration is safe to re-run.

-- 1.1 — Rename revoked_reason → revocation_reason
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'cross_tenant_access_grants_projection'
      AND column_name  = 'revoked_reason'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'cross_tenant_access_grants_projection'
      AND column_name  = 'revocation_reason'
  ) THEN
    ALTER TABLE public.cross_tenant_access_grants_projection
      RENAME COLUMN revoked_reason TO revocation_reason;
    RAISE NOTICE 'Renamed revoked_reason -> revocation_reason';
  ELSE
    RAISE NOTICE 'Skipping rename: revoked_reason does not exist OR revocation_reason already present (idempotent)';
  END IF;
END $$;

-- 1.2 — Add revocation_details column (idempotent)
ALTER TABLE public.cross_tenant_access_grants_projection
  ADD COLUMN IF NOT EXISTS revocation_details text;

-- 1.3 — Add expired_at column (idempotent)
ALTER TABLE public.cross_tenant_access_grants_projection
  ADD COLUMN IF NOT EXISTS expired_at timestamptz;

-- 1.4 — Add expiration_type column (idempotent)
ALTER TABLE public.cross_tenant_access_grants_projection
  ADD COLUMN IF NOT EXISTS expiration_type text;

-- 1.5 — Rename reactivation_notes → resolution_details
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'cross_tenant_access_grants_projection'
      AND column_name  = 'reactivation_notes'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'cross_tenant_access_grants_projection'
      AND column_name  = 'resolution_details'
  ) THEN
    ALTER TABLE public.cross_tenant_access_grants_projection
      RENAME COLUMN reactivation_notes TO resolution_details;
    RAISE NOTICE 'Renamed reactivation_notes -> resolution_details';
  ELSE
    RAISE NOTICE 'Skipping rename: reactivation_notes does not exist OR resolution_details already present (idempotent)';
  END IF;
END $$;

-- 1.6 — COMMENT refreshes on the renamed/new columns for self-documenting schema
COMMENT ON COLUMN public.cross_tenant_access_grants_projection.revocation_reason IS
  'Business reason for the revocation. Matches access_grant.revoked event_data.revocation_reason. Renamed from revoked_reason 2026-06-09 to align with handler + AsyncAPI contract.';
COMMENT ON COLUMN public.cross_tenant_access_grants_projection.revocation_details IS
  'Additional context / operator notes for the revocation. Matches access_grant.revoked event_data.revocation_details. Added 2026-06-09 (was missing — caused PROCESSING_FAILED on every revoke since grant ship).';
COMMENT ON COLUMN public.cross_tenant_access_grants_projection.expired_at IS
  'When the grant transitioned to expired status. Matches access_grant.expired event_data.expired_at. Added 2026-06-09.';
COMMENT ON COLUMN public.cross_tenant_access_grants_projection.expiration_type IS
  'How the grant expired (time_based / contract_based / automatic_cleanup). Matches access_grant.expired event_data.expiration_type. Added 2026-06-09.';
COMMENT ON COLUMN public.cross_tenant_access_grants_projection.resolution_details IS
  'How the suspension was resolved. Matches access_grant.reactivated event_data.resolution_details. Renamed from reactivation_notes 2026-06-09 to align with handler + AsyncAPI contract.';


-- ============================================================================
-- Section 2 — Fail-loud assertions
-- ============================================================================
-- Every column the deployed process_access_grant_event router writes MUST
-- exist on the projection. Fail-loud at deploy time so this category of
-- defect cannot land silently again.

-- 2.1 — Affirmative: all handler-written columns exist
DO $$
DECLARE
  v_handler_writes_columns text[] := ARRAY[
    -- access_grant.created arm
    'id', 'consultant_org_id', 'consultant_user_id', 'provider_org_id',
    'scope', 'scope_id', 'authorization_type', 'authorization_reference',
    'legal_reference', 'granted_by', 'granted_at', 'expires_at',
    'permissions', 'terms', 'status', 'created_at', 'updated_at',
    -- access_grant.revoked arm (post-rename + post-add)
    'revoked_at', 'revoked_by', 'revocation_reason', 'revocation_details',
    -- access_grant.expired arm (post-add)
    'expired_at', 'expiration_type',
    -- access_grant.suspended arm
    'suspended_at', 'suspended_by', 'suspension_reason', 'suspension_details',
    'expected_resolution_date',
    -- access_grant.reactivated arm (post-rename)
    'reactivated_at', 'reactivated_by', 'resolution_details'
  ];
  v_col text;
  v_missing text[] := '{}';
BEGIN
  FOREACH v_col IN ARRAY v_handler_writes_columns
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name   = 'cross_tenant_access_grants_projection'
        AND column_name  = v_col
    ) THEN
      v_missing := array_append(v_missing, v_col);
    END IF;
  END LOOP;

  IF array_length(v_missing, 1) > 0 THEN
    RAISE EXCEPTION 'Hotfix assertion failed: handler writes to columns that do not exist post-migration: %', v_missing
      USING ERRCODE = 'P9099';
  END IF;
  RAISE NOTICE 'Hotfix assertion PASS: all % handler-written columns exist on cross_tenant_access_grants_projection', array_length(v_handler_writes_columns, 1);
END $$;

-- 2.2 — Cross-check: the columns we renamed FROM should no longer exist
DO $$
DECLARE
  v_legacy text[] := ARRAY['revoked_reason', 'reactivation_notes'];
  v_col text;
  v_still_present text[] := '{}';
BEGIN
  FOREACH v_col IN ARRAY v_legacy
  LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name   = 'cross_tenant_access_grants_projection'
        AND column_name  = v_col
    ) THEN
      v_still_present := array_append(v_still_present, v_col);
    END IF;
  END LOOP;

  IF array_length(v_still_present, 1) > 0 THEN
    RAISE EXCEPTION 'Hotfix assertion failed: legacy column names still present (rename did not take): %', v_still_present
      USING ERRCODE = 'P9099';
  END IF;
  RAISE NOTICE 'Hotfix assertion PASS: legacy column names (revoked_reason, reactivation_notes) no longer present';
END $$;
