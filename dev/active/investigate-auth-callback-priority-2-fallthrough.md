# Investigate AuthCallback Priority-2 fall-through to platform subdomain

**Status**: seed (not yet planned) — **reproducibility data captured 2026-05-19** via PR #64 UAT T6
**Priority**: Medium
**Origin**: 2026-05-13 follow-up from `dev/active/reject-cross-provider-invitations/` planning investigation
**Predecessor**: PR #63 UAT Test 5 (dakaratekid@gmail.com)

## Reproducibility evidence (2026-05-19)

During PR #64 UAT T6, dakaratekid was logged out and back in across **4 login cycles**:

- **3 out of 4 cycles**: landed correctly on `liveforlife.firstovertheline.com` (Priority-2 happy path)
- **1 out of 4 cycles**: fell through to `a4c.firstovertheline.com` (Priority-3 default — the bug)
- **Reproducibility**: ~25%, intermittent, NOT deterministic

**Key implication**: this is almost certainly a **race condition**, not a configuration / data issue. Possible root causes (in order of plausibility):

1. **Stale JWT decoded before refresh completes** — the AuthCallback decodes the JWT from `freshSession` obtained via `auth.getSession()`, but on a fast OAuth callback the session might still be the prior-tab's session if `handleOAuthCallback()` hasn't fully completed when `determineRedirectUrl()` runs. The comment at `AuthCallback.tsx:200-203` explicitly acknowledges this: "This avoids the stale closure problem where `handleOAuthCallback()` updates Supabase's internal state but the React state closure captured at render time still has the old (null) session." The fix may not be complete — there could still be a race between Supabase's internal-state update and the next `getSession()` call.
2. **Async timing in `getOrganizationSubdomainInfo`** — RPC may occasionally time out or return a delayed response; the catch-block falls through to Priority 3 without distinguishing "RPC failed" from "RPC said no verified subdomain."
3. **Cloudflare or CDN caching** — unlikely but possible; could cache a stale 401 from the RPC under certain conditions.
4. **Subdomain DNS propagation lag** — unlikely on liveforlife specifically since `subdomain_status='verified'` and the org has existed for weeks.

## Suggested investigation order (updated 2026-05-19)

1. **Add structured logging to AuthCallback** to capture, per cycle:
   - What was in `freshSession?.access_token` at decode time (just first 16 chars + presence-check, not full token)
   - What `orgId` was decoded
   - What `getOrganizationSubdomainInfo(orgId)` returned (full response, including error)
   - Which Priority branch fired (2 vs 3)
   - Time deltas between `handleOAuthCallback()` start, session-fetch, RPC call, redirect
2. **Reproduce the 1-in-4 rate** with logging enabled. Capture at least 5 fall-through cases + 15 successful cases to compare.
3. **Hypothesis test**: if the bug is the "stale JWT before refresh," fall-through cases should show `freshSession?.access_token` either NULL or matching a *prior* session — observable from log analysis.
4. **If the bug is RPC failure**, fall-through cases should show non-null error in the `getOrganizationSubdomainInfo` response.
5. **Frontend fix candidates** depend on root cause:
   - For race condition: add a retry loop or `await` until session token is the OAuth-callback-provisioned one
   - For RPC failure: distinguish "RPC error" (retry / show error) from "no verified subdomain" (Priority 3 is legitimate)
   - Both: improve the Priority-3 fallback path to NOT silently swallow the situation — log it, surface it to error tracking

## Problem

After dakaratekid logged out and logged back in via Google OAuth, she landed on `https://a4c.firstovertheline.com/clients` (the platform-owner subdomain's `/clients` route) instead of `https://liveforlife.firstovertheline.com/dashboard` (her home org's subdomain). The data state at the time of the landing:

- `users.current_organization_id` = liveforlife UUID (correct)
- liveforlife `organizations_projection.subdomain_status` = `'verified'` (correct)
- JWT `org_id` claim = liveforlife UUID (correct, computed by `custom_access_token_hook`)
- AuthCallback routing logic at `frontend/src/pages/auth/AuthCallback.tsx:204-255` SHOULD have:
  1. Decoded JWT → got `orgId = liveforlife`
  2. Called `getOrganizationSubdomainInfo(orgId)`
  3. Received `{slug: 'liveforlife', subdomain_status: 'verified'}` back
  4. Built `https://liveforlife.firstovertheline.com/dashboard`
  5. `window.location.href = subdomainUrl`
- Instead, control fell through to **Priority 3** (`return '/clients'`) and the browser stayed on the host it came from (`a4c.firstovertheline.com`).

## What the gate-repair work confirmed

This symptom is NOT caused by `users.accessible_organizations` drift. The frontend routing reads `org_id` from the JWT claim, NOT the `accessible_organizations` array. The seed `fix-handle-user-role-assigned-update-accessible-organizations-seed.md` was misframed; the denormalization gap is unrelated to this routing bug.

## Hypotheses

1. **`getOrganizationSubdomainInfo` RPC failure** — `api.get_organization_by_id` may have denied her access to read liveforlife's row. Check RLS on `organizations_projection`: do `provider_admin` callers have a SELECT policy that covers their own org?
2. **`subdomain_status !== 'verified'`** at the moment of the lookup — could have been a transient state during testing. (Currently verified per DB query 2026-05-13; check the historic state at the time of the bug.)
3. **Thrown exception inside `getOrganizationSubdomainInfo`** — caught by the outer try/catch which logs but falls through to Priority 3.
4. **`sanitizeRedirectUrl` rejected the Priority-1 invitation flow's `auth_return_to`** — but that branch shouldn't fire on a normal logout/login (only on invitation acceptance).
5. **Stale closure / fresh-session race** — the AuthCallback comments mention this class of bug. Possibly the JWT was not yet decoded correctly when the redirect fired.

## Suggested investigation order

1. Read `frontend/src/services/organization/getOrganizationSubdomainInfo.ts` and the underlying RPC's RLS policies.
2. Read `frontend/src/pages/auth/AuthCallback.tsx:204-255` (`determineRedirectUrl`) end-to-end.
3. Query the deployed dev project's PostgREST logs (Supabase Dashboard → Logs → API) for the time window of dakaratekid's OAuth callback. Look for `get_organization_by_id` calls returning errors or empty results.
4. Reproduce: log in as a clean `provider_admin` user in liveforlife with no extra roles. Verify routing lands them on `liveforlife.firstovertheline.com/dashboard`.
5. If reproducible, add structured logging on the AuthCallback Priority-2 path to surface which step failed.

## Out of scope

- Rewriting the AuthCallback routing logic itself. The fix should be the smallest possible change that closes the Priority-2 fall-through.
- The cross-provider invitation gate (closed by `reject-cross-provider-invitations`).

## Why this matters

- Multi-org users (post `reject-cross-provider-invitations` shipping, this means partner-org users with future cross-tenant grants OR single-org users with verified subdomains) need reliable redirect-to-home-subdomain on login.
- If Priority-2 silently fails, users land on the platform-owner subdomain with the wrong tenant context. Beyond the UX bump, this could cause RLS surprises if any code reads JWT `org_id` while the URL host says otherwise.

## Files likely involved

- `frontend/src/pages/auth/AuthCallback.tsx` (routing logic)
- `frontend/src/pages/auth/LoginPage.tsx` (similar routing logic at the login redirect path)
- `frontend/src/services/organization/getOrganizationSubdomainInfo.ts`
- `api.get_organization_by_id` RPC (RLS / permission check)
- `organizations_projection` RLS policies (`baseline_v4.sql`)
