-- =============================================================================
-- Cross-tenant grant Phase 3: make api.list_users grant-aware (Model M).
-- =============================================================================
--
-- Card: dev/active/cross-tenant-access-grant-rollout/ (Phase 3)
-- Architect re-adjudication (software-architect-dbc, 2026-06-22) decision record:
--   ~/.claude/plans/fizzy-jingling-puppy-agent-a9866ddd44acd09e3.md
--
-- PROBLEM: api.list_users rejects cross-tenant consultants. Its tenancy guard
-- checks `p_org_id = get_current_org_id()` — the caller's SESSION/home org from
-- the JWT — but a consultant holding an active grant to a provider org keeps
-- their JWT org_id at their HOME org. So a grant-bearer who legitimately has the
-- provider org in public.users.accessible_organizations (the Phase-1 triggers
-- fold active in-window grants into that array) is still turned away at the
-- guard, even though the query body ALREADY filters on
-- `accessible_organizations @> ARRAY[p_org_id]`.
--
-- FIX (Model M — membership-oracle tenancy guard): replace the session-org
-- equality with an EXISTS against the caller's own accessible_organizations.
-- The guard now references the SAME oracle as the query predicate, so "may you
-- ask" and "what you see" can never disagree. Backward-compatible superset:
-- platform admins and org-internal callers (their session org is in their own
-- accessible_organizations via direct membership) are still admitted; grant-
-- bearers are net-new (the Phase 3 goal). RETURN-empty (Bucket A) semantics
-- preserved — a denied caller is indistinguishable from an org with no members.
--
-- WHY NOT the prior handoff's "three-step perm-gated skeleton": (1) it violates
-- the scoped-vs-unscoped rule (users-as-identities have no org location finer
-- than tenant → tenancy guard, NOT has_effective_permission(perm, path) —
-- infrastructure/supabase/CLAUDE.md); (2) it is inert — no grant template
-- confers user.view, so a has_effective_permission('user.view', path) gate
-- would enable zero consultants. has_cross_tenant_access(...) is also a deployed
-- stub returning FALSE, so reading accessible_organizations directly is the only
-- grant-aware mechanism that works today.
--
-- Body fetched verbatim via Mgmt API pg_get_functiondef (codified pitfall #6);
-- the ONLY change is the guard block (search "Model M"). Signature UNCHANGED →
-- CREATE OR REPLACE preserves OID; the COMMENT (M3 @a4c-rpc-shape + reachability
-- tags) is re-issued below to flip @a4c-consultant-callable. No TS regen (return
-- shape unchanged), no AsyncAPI change.
-- =============================================================================

CREATE OR REPLACE FUNCTION api.list_users(p_org_id uuid, p_status text DEFAULT NULL::text, p_search_term text DEFAULT NULL::text, p_sort_by text DEFAULT 'name'::text, p_sort_desc boolean DEFAULT false, p_page integer DEFAULT 1, p_page_size integer DEFAULT 20)
 RETURNS TABLE(id uuid, email text, first_name text, last_name text, name text, is_active boolean, deleted_at timestamp with time zone, created_at timestamp with time zone, updated_at timestamp with time zone, last_login timestamp with time zone, roles jsonb, total_count bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'api'
AS $function$
BEGIN
  -- Tenancy guard (Model M — Phase 3, cross-tenant-grant rollout): platform
  -- admins OR any caller who is a MEMBER of p_org_id. Membership is read from
  -- public.users.accessible_organizations — the canonical oracle that the
  -- Phase-1 triggers maintain as the UNION of direct user_organizations_projection
  -- membership AND active in-window cross_tenant_access_grants_projection grants.
  -- Replaces the prior `p_org_id = get_current_org_id()` session-org check, which
  -- rejected grant-bearers (their JWT org_id stays at their home org). The guard
  -- now references the SAME oracle as the query predicate below, so they can
  -- never disagree. RETURN-empty (Bucket A) semantics preserved: a denied caller
  -- is indistinguishable from an org with no members (no existence leak).
  -- NB: alias the table (caller) — this function RETURNS TABLE(id uuid, ...),
  -- so an unqualified `id` here is ambiguous with the OUT column (SQLSTATE 42702).
  IF NOT (
    public.has_platform_privilege()
    OR EXISTS (
      SELECT 1 FROM public.users caller
      WHERE caller.id = public.get_current_user_id()
        AND caller.accessible_organizations @> ARRAY[p_org_id]::uuid[]
    )
  ) THEN
    RETURN;
  END IF;

  -- Single-pass query: predicate lives in ONE place. COUNT(*) OVER ()
  -- computes the total over the filtered rowset BEFORE LIMIT/OFFSET so
  -- pagination math stays correct.
  RETURN QUERY
  SELECT
    u.id,
    u.email,
    u.first_name,
    u.last_name,
    u.name,
    u.is_active,
    u.deleted_at,
    u.created_at,
    u.updated_at,
    u.last_login,
    COALESCE(
      (SELECT jsonb_agg(jsonb_build_object(
        'role_id',   ur.role_id,
        'role_name', r.name
      ))
      FROM public.user_roles_projection ur
      JOIN public.roles_projection r ON r.id = ur.role_id
      WHERE ur.user_id = u.id
        AND ur.organization_id = p_org_id),
      '[]'::jsonb
    ) AS roles,
    COUNT(*) OVER () AS total_count
  FROM public.users u
  WHERE u.accessible_organizations @> ARRAY[p_org_id]::uuid[]
  AND (
    CASE
      WHEN p_status = 'active'      THEN u.is_active = TRUE  AND u.deleted_at IS NULL
      WHEN p_status = 'deactivated' THEN u.is_active = FALSE AND u.deleted_at IS NULL
      WHEN p_status = 'deleted'     THEN u.deleted_at IS NOT NULL
      ELSE u.deleted_at IS NULL  -- default: exclude soft-deleted
    END
  )
  AND (p_search_term IS NULL
       OR u.email ILIKE '%' || p_search_term || '%'
       OR u.name  ILIKE '%' || p_search_term || '%')
  ORDER BY
    CASE WHEN NOT p_sort_desc THEN
      CASE p_sort_by
        WHEN 'name'       THEN u.name
        WHEN 'email'      THEN u.email
        WHEN 'created_at' THEN u.created_at::TEXT
        ELSE u.name
      END
    END ASC NULLS LAST,
    CASE WHEN p_sort_desc THEN
      CASE p_sort_by
        WHEN 'name'       THEN u.name
        WHEN 'email'      THEN u.email
        WHEN 'created_at' THEN u.created_at::TEXT
        ELSE u.name
      END
    END DESC NULLS LAST
  LIMIT p_page_size
  OFFSET (p_page - 1) * p_page_size;
END;
$function$;


-- -----------------------------------------------------------------------------
-- Re-issue COMMENT (OID preserved by CREATE OR REPLACE, but the tag VALUES must
-- be updated explicitly). Flips @a4c-consultant-callable pending-phase3-refactor
-- → yes and @a4c-phase-target 3 → none. @a4c-rpc-shape (read) + @a4c-bucket (A)
-- unchanged — still a p_org_id tenancy-guard RPC, now grant-aware.
-- -----------------------------------------------------------------------------
COMMENT ON FUNCTION api.list_users(uuid, text, text, text, boolean, integer, integer) IS
$comment$List users in an organization with pagination and filtering. Membership gated by users.accessible_organizations (the canonical membership oracle, post-Phase-1 the UNION of direct user_organizations_projection membership AND active in-window cross_tenant_access_grants_projection grants). Tenancy guard (Model M, Phase 3): has_platform_privilege() OR caller is a member of p_org_id via accessible_organizations @> [p_org_id]. Status values: active, deactivated, deleted (or NULL for all non-deleted).

@a4c-rpc-shape: read

@a4c-bucket: A
@a4c-consultant-callable: yes
@a4c-consultant-callable-reason: Grant-derived membership via accessible_organizations (Model M, Phase 3): a consultant holding an active in-window grant to p_org_id has it in accessible_organizations and is admitted by the membership-oracle tenancy guard. RETURN-empty for non-members (no existence leak).
@a4c-phase-target: none$comment$;
