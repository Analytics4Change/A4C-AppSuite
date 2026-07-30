-- ============================================================================
-- PR E follow-on — correct the dedup rationale in api.check_user_org_membership
-- ============================================================================
--
-- `20260730125034` added `uq_users_email_normalized`, which falsifies the load-
-- bearing sentence in this function's comment: "There is no unique index on
-- email on this table."
--
-- The source card expected that to RETIRE the `ORDER BY u.is_active DESC,
-- u.created_at` mitigation entirely. It does not, and shipping that retirement
-- would have reintroduced the exact bug the ORDER BY was added for. Two
-- duplicate sources survive the index:
--
--   1. `uq_users_email_normalized` is PARTIAL — `WHERE deleted_at IS NULL`. That
--      is deliberate (`handle_user_deleted` soft-deletes and RETAINS the email,
--      so re-signup at the same address is a supported flow). This query does
--      NOT filter `deleted_at`, so a soft-deleted row and a live row can still
--      share an address and both match. 2 soft-deleted rows exist on dev today.
--   2. The `INNER JOIN user_roles_projection` fans out: a member holding three
--      roles in one org yields three rows. Same user, so `is_active` agrees —
--      harmless, but `LIMIT 1` is still doing real work.
--
-- So the mitigation stays and only its justification changes. Body is otherwise
-- byte-identical to the deployed definition (fetched via `pg_get_functiondef`
-- and diffed before editing, per the CREATE-OR-REPLACE rule).
--
-- No DO-block assertion here on purpose: this migration's only effect is the
-- text of a comment inside a body it writes itself, and a block that greps a
-- body written in the same transaction cannot fail. That is not an assertion.
-- ============================================================================

CREATE OR REPLACE FUNCTION api.check_user_org_membership(p_email text, p_org_id uuid)
 RETURNS TABLE(user_id uuid, is_active boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
BEGIN
  -- Tenancy guard (20260729184125), verbatim. Alias the table: this function
  -- RETURNS TABLE(user_id uuid, ...), so an unqualified column reference inside
  -- the EXISTS risks ambiguity with an OUT parameter (SQLSTATE 42702).
  IF NOT (
    current_setting('role', true) = 'service_role'
    OR COALESCE(NULLIF(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
         ->> 'role' = 'service_role'
    OR public.has_platform_privilege()
    OR EXISTS (
      SELECT 1
      FROM public.users caller
      WHERE caller.id = public.get_current_user_id()
        AND caller.accessible_organizations @> ARRAY[p_org_id]::uuid[]
    )
  ) THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT u.id as user_id, u.is_active
  FROM users u
  INNER JOIN user_roles_projection urp ON u.id = urp.user_id
  -- Symmetric: the column expression matches idx_users_email_lower exactly.
  WHERE btrim(lower(u.email)) = btrim(lower(p_email))
    AND urp.organization_id = p_org_id
  -- Deterministic pick. uq_users_email_normalized (20260730125034) now makes a
  -- duplicate LIVE email impossible, but two sources of multiple rows remain:
  -- that index is partial (WHERE deleted_at IS NULL) and this query does not
  -- filter deleted_at, so a soft-deleted row can share an address with a live
  -- one; and the INNER JOIN fans out one row per role held in the org. Without
  -- ORDER BY, LIMIT 1 could return a soft-deleted row's is_active and render
  -- "deactivated" for an active member. Prefer the active row, then the oldest.
  ORDER BY u.is_active DESC, u.created_at
  LIMIT 1;
END;
$function$;
