/**
 * usePlatformNoOrgContext
 *
 * Detects the "platform administrator with no active organization" state —
 * a super_admin whose JWT carries `org_type === 'platform_owner'` AND an empty
 * `org_id`. In that state every org-scoped write (invite a user, deactivate a
 * user, …) is rejected by the Edge Function preflight with a 403
 * `"No organization context in token"`, because `org_id` is minted from
 * `users.current_organization_id` (NULL for a global super_admin), never from
 * the subdomain.
 *
 * Callers use this to **state-gate** those write affordances (disable +
 * explanatory banner), per `frontend/CLAUDE.md` "Permission Gating" — a
 * super_admin *holds* every permission, so this is a context/state condition,
 * not a permission the user lacks.
 *
 * **The `&& !org_id` conjunct is load-bearing:** a real member of the a4c
 * platform-owner org also has `org_type === 'platform_owner'` but WITH a
 * non-empty `org_id`, and must NOT be gated. The JWT hook mints
 * `org_type = 'platform_owner'` precisely when `org_id IS NULL`
 * (see `frontend/src/contexts/CLAUDE.md` → JWT claims).
 *
 * **Fail-closed / fail-open contract:** returns `false` (i.e. "not the gated
 * state", affordances behave normally) whenever there is no session or the
 * claims are absent. The Edge Function 403 remains the load-bearing guard, so a
 * false negative here degrades to the pre-existing cryptic-403 behaviour rather
 * than silently permitting anything.
 *
 * @returns `true` only when the caller is a platform administrator with no
 *   active organization; `false` otherwise (including no session).
 *
 * @example
 *   const platformNoOrg = usePlatformNoOrgContext();
 *   // ...
 *   <Button disabled={platformNoOrg} aria-disabled={platformNoOrg}
 *           aria-describedby={platformNoOrg ? 'platform-no-org-banner' : undefined}>
 *     Invite New User
 *   </Button>
 */

import { useAuth } from '@/contexts/AuthContext';

export function usePlatformNoOrgContext(): boolean {
  const { session } = useAuth();
  const claims = session?.claims;
  if (!claims) return false;
  return claims.org_type === 'platform_owner' && !claims.org_id;
}
