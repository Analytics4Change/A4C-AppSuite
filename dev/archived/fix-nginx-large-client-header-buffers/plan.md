# Bump nginx-ingress `large-client-header-buffers` to fit super_admin's JWT cookies

**Status**: seed (not yet planned)
**Priority**: **HIGH** — blocks any UI-tier testing as super_admin (or any account whose JWT exceeds ~4KB when chunked). Discovered while preparing UAT for PR #64.
**Origin**: 2026-05-14 PR #64 UAT prep — `lars.tice@gmail.com` logged into `https://a4c.firstovertheline.com` successfully, but navigating to `https://testorg-20260329.firstovertheline.com/users/manage` returned:
```
400 Bad Request
Request Header Or Cookie Too Large
nginx/1.31.0
```

## Why super_admin trips this

The JWT custom-claims hook at `infrastructure/supabase/supabase/migrations/20260212010625_baseline_v4.sql:7124-7138` materializes the entire permissions catalogue for super_admin:

```sql
-- Super admins get all permissions at root scope (empty string = global)
SELECT jsonb_agg(jsonb_build_object('p', p.name, 's', ''))
INTO v_effective_permissions
FROM public.permissions_projection p;
```

Measured 2026-05-14 against deployed dev: hook output is **4,353 bytes** of pretty-printed JSON for super_admin (43 permissions × ~60 bytes per `{"p","s"}` entry + claim envelope). Once Supabase-js wraps this into a JWT (base64, signature, header) and chunks it into cookies (`sb-<projectref>-auth-token.0`, `.1`, …), the combined `Cookie` header line exceeds nginx's default `large_client_header_buffers` (typically `4 8k`).

Add Cloudflare's `__cf_bm` and `cf_clearance` cookies on each subdomain, plus the cross-subdomain `domain=.firstovertheline.com` Supabase auth cookie that travels everywhere, and crossing from one subdomain to another pushes the request header line over 8KB → nginx returns 400.

## What works today / what doesn't

| Scenario | Outcome |
|---|---|
| super_admin login on `a4c.firstovertheline.com` | ✅ Works (only a4c's own cookies, fits in buffer) |
| super_admin navigates to a second subdomain | ❌ 400 Request Header Or Cookie Too Large |
| provider_admin login on a single subdomain | ✅ Works (verified 2026-05-19 via PR #64 UAT T6 with `dakaratekid@gmail.com`, Aspen Program Manager / 14 perms) |
| provider_admin crossing subdomains | Likely OK in steady state — but NOT empirically tested cross-subdomain. **Note**: even a 14-permission JWT chunks across 2 cookies (`sb-<ref>-auth-token.0` + `.1`), so the threshold is not super_admin-specific. Users with more permissions or in environments with more Cloudflare cookies could plausibly cross 8KB. |
| Org bootstrap workflow creating new subdomains | Unaffected (workflow uses service-role, not user JWT) |

## Threshold refinement (2026-05-19, via PR #64 UAT T6)

Empirical observation: `dakaratekid@gmail.com` (single-role provider_admin-equivalent, 14 effective permissions) has her JWT chunked across 2 Supabase cookies. This means **Supabase-js chunks any JWT > ~4KB**, and the chunking trigger is hit by even moderate permission sets (not just super_admin's 43-permission god-mode claim).

Implications:
1. The nginx buffer fix isn't a "super_admin-only" workaround — it benefits all role-bearing users once their permission sets grow or scope-permission-implications fire.
2. As the permission catalog grows (new applets, new permissions), the chunking will hit more roles.
3. The fix is **structurally correct** for the long term, not just a tactical workaround.

## Investigation finding (2026-05-19) — the nginx is NOT in the ingress tier

The card originally assumed the 400 came from an nginx-ingress controller and prescribed an `nginx.ingress.kubernetes.io/large-client-header-buffers` annotation. **That diagnosis was wrong.** Cluster reality:

- Ingress controller: **Traefik 3.3.6** (k3s default, helm-installed). All 3 cluster Ingresses (`a4c-frontend-ingress`, `tenant-wildcard-ingress`, `temporal-api-ingress`) use `ingressClassName: traefik`. There is no nginx-ingress installation anywhere in the cluster.
- The `nginx/1.31.0` error string comes from the **frontend SPA container's own nginx** (`nginx:alpine` per `frontend/Dockerfile:5`). The SPA pod IS the upstream that Traefik forwards to. Its config (`frontend/nginx/default.conf`) had no `large_client_header_buffers` directive, so it inherited nginx's default of `4 8k`.
- Request path: browser → Cloudflare → Cloudflare Tunnel → Traefik (port 80/443) → `a4c-frontend-service` → `nginx:alpine` pod → 400.

This means the fix is much simpler than the card initially scoped — and it ships through the standard frontend CI/CD pipeline.

## Fix

Add `large_client_header_buffers 4 32k;` to the `server` block in `frontend/nginx/default.conf`. 32k is overkill for a 4.3 KB JWT chunked across cookies but gives headroom for future permission-catalog growth. Single-file diff; `frontend-deploy.yml` rebuilds the image and rolls the pod on merge to main.

```nginx
server {
    listen 80;
    server_name _;
    # ...
    large_client_header_buffers 4 32k;
    # ...
}
```

## Open questions (resolved during investigation)

1. ~~**Where is the Ingress resource defined?**~~ → Resolved: not relevant to this fix. (Still a real GitOps gap: `a4c-frontend-ingress` and `tenant-wildcard-ingress` are NOT tracked in `infrastructure/k8s/`. Recommend a separate card.)
2. ~~**Is the Ingress controller nginx or traefik?**~~ → Resolved: **Traefik 3.3.6**. The nginx in the error is in-container.
3. ~~**Per-org vs wildcard Ingress?**~~ → Resolved: single wildcard `tenant-wildcard-ingress` fans out to `a4c-frontend-service`. Bootstrap workflow doesn't generate per-org Ingresses. Not relevant — the fix is in the SPA container, not Ingress YAML.

## Verification

After PR merges and `frontend-deploy.yml` completes:

1. `kubectl exec -n default <a4c-frontend-pod> -- nginx -T | grep large_client_header_buffers` shows `4 32k`
2. Login as super_admin on `a4c.firstovertheline.com`
3. Navigate to a provider subdomain (`liveforlife.firstovertheline.com`, `testorg-20260329.firstovertheline.com`)
4. Expected: page loads (no 400)
5. DevTools → Network → request `Cookie` header is >4KB, response is 200

## Out of scope

- Reducing super_admin's JWT size (e.g., compressing `effective_permissions` or moving it server-side). That's a deeper architecture change; the simple fix is the buffer bump.
- Tracking the Ingress YAML in the repo / moving to GitOps. Worth a follow-up card if Q1 above confirms the gap.

## Related

- **PR #64 UAT blocker** — this is what prompted the discovery. UAT T1 currently has to be run via curl (bypassing the UI) as a workaround. Memory file `cross-provider-invitation-rejected.md` should reference this card under "known UAT friction."
- **Routing card** `dev/active/investigate-auth-callback-priority-2-fallthrough.md` — separately seeded for a different symptom on the same auth flow; not the same root cause.
- **Impersonation feature** documented at `documentation/architecture/authentication/impersonation-architecture.md` — could potentially mitigate by letting super_admin take on a smaller-JWT context, but that's also out of scope.
