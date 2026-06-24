-- =============================================================================
-- api.check_user_has_any_role — zombie-detection for invite-user routing.
-- =============================================================================
--
-- Card: dev/active/invite-user-route-existing-users-to-role-assign/ (epic PR 3).
--
-- invite-user's checkEmailStatus needs to distinguish an existing user who holds
-- a role somewhere (route: cross-provider gate then assign) from a "zombie" —
-- a users row with ZERO role assignments anywhere (route: direct assign). The
-- existing api.check_user_exists returns only user_id (no role signal), so this
-- read RPC supplies the missing boolean.
--
-- Correctness note: user_roles_projection has NO status column; role revocation
-- HARD-DELETEs the row (handle_user_role_revoked). So a zombie genuinely has
-- zero rows and a plain EXISTS is the correct, status-filter-free check.
--
-- Read-shape (returns a bare boolean, not a Pattern A envelope). Reachability
-- tags mirror api.check_user_exists (bucket E, no tenancy context).
-- =============================================================================

CREATE OR REPLACE FUNCTION api.check_user_has_any_role(p_user_id uuid)
 RETURNS boolean
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
    SELECT EXISTS (
        SELECT 1 FROM public.user_roles_projection WHERE user_id = p_user_id
    );
$function$;

GRANT EXECUTE ON FUNCTION api.check_user_has_any_role(uuid) TO authenticated;

COMMENT ON FUNCTION api.check_user_has_any_role(uuid) IS
$comment$Returns true if the user holds at least one role assignment in any organization.

Zombie-detection helper for invite-user's checkEmailStatus: a users row with zero
user_roles_projection rows is an existing-but-roleless user that should be routed
to direct role assignment, not a new invitation token. Revocation hard-deletes
role rows, so a plain EXISTS (no status filter) is correct.

Consumers:
- invite-user Edge Function (checkEmailStatus smart-email-lookup)

@a4c-rpc-shape: read

@a4c-bucket: E
@a4c-consultant-callable: yes
@a4c-consultant-callable-reason: No tenancy context; grant-irrelevant by default. Mirror of api.check_user_exists.
@a4c-phase-target: none$comment$;
