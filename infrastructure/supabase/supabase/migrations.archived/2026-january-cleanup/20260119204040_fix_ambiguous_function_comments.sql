-- ============================================================================
-- Migration: Fix Ambiguous Function Comments
-- Purpose: Fix COMMENT ON FUNCTION statements that are ambiguous when multiple
--          function overloads exist
-- Issue: Running migrations from scratch creates both 9-param and 10-param
--        versions of phone CRUD functions, causing COMMENT to fail
-- ============================================================================

-- Strategy:
-- 1. Drop the 9-param versions (they were created by 20260115223503 but should
--    not exist - the 10-param versions with p_reason are canonical)
-- 2. Add explicit signatures to COMMENT statements

-- ============================================================================
-- Drop 9-param versions (if they exist)
-- ============================================================================

-- These were accidentally created because CREATE OR REPLACE only replaces
-- functions with the SAME signature. Different param count = different function.

DROP FUNCTION IF EXISTS api.add_user_phone(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, BOOLEAN, BOOLEAN, UUID);
DROP FUNCTION IF EXISTS api.update_user_phone(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, BOOLEAN, BOOLEAN, UUID);
DROP FUNCTION IF EXISTS api.remove_user_phone(UUID, UUID, BOOLEAN);

-- ============================================================================
-- Re-apply COMMENT with explicit signatures (10-param versions)
-- ============================================================================

-- These are the canonical versions with p_reason parameter for audit context

COMMENT ON FUNCTION api.add_user_phone(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, BOOLEAN, BOOLEAN, UUID, TEXT) IS
'Add a new phone for a user. p_org_id=NULL creates global phone, set creates org-specific.
p_reason provides optional audit context (e.g., "Admin added phone during onboarding").
Authorization: Platform admin, org admin, or user adding their own phone.';

COMMENT ON FUNCTION api.update_user_phone(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, BOOLEAN, BOOLEAN, UUID, TEXT) IS
'Update an existing user phone. p_reason provides optional audit context.
Authorization: Platform admin, org admin, or user updating their own phone.';

COMMENT ON FUNCTION api.remove_user_phone(UUID, UUID, BOOLEAN, TEXT) IS
'Remove (soft delete) or permanently delete a user phone. p_hard_delete=true for permanent deletion.
p_reason provides optional audit context.
Authorization: Platform admin, org admin, or user removing their own phone.';
