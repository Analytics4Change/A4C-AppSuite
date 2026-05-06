-- Migration: Drop stale Zitadel reference from public.users.roles COMMENT
--
-- Why: baseline_v4 (20260212010625) carried over a column COMMENT that read
-- 'Array of role names from Zitadel (super_admin, administrator, ...)'. Zitadel
-- was deprecated October 2025 and replaced by Supabase Auth; the column itself
-- remains operational (RBAC handlers write/read it), but the COMMENT was a
-- documentation drift.
--
-- This migration is metadata-only (no data, structure, or behavior change).
-- Idempotent: COMMENT ON COLUMN unconditionally replaces any prior comment.
--
-- Architect F2 follow-up from PR #51.

COMMENT ON COLUMN "public"."users"."roles"
  IS 'Array of role names assigned to the user';
