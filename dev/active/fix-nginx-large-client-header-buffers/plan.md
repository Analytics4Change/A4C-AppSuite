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

## Fix

Add an `nginx.ingress.kubernetes.io/large-client-header-buffers` annotation to the Ingress resource(s) serving `*.firstovertheline.com`. Suggested value: `"4 32k"` (4 buffers × 32KB each — generous headroom for super_admin's JWT plus future claim growth).

```yaml
metadata:
  annotations:
    nginx.ingress.kubernetes.io/large-client-header-buffers: "4 32k"
    # Or, if ingress-nginx variant:
    # nginx.ingress.kubernetes.io/proxy-buffer-size: "32k"
    # nginx.ingress.kubernetes.io/proxy-buffers-number: "4"
```

## Open questions for planning

1. **Where is the Ingress resource defined?**
   `infrastructure/k8s/` contains `temporal-api/ingress.yaml` but no Ingress for the frontend / wildcard subdomain. Grep shows it's not tracked in this repo:
   ```bash
   grep -rE "kind: Ingress" infrastructure/k8s/ 2>/dev/null
   # Only temporal-api/ingress.yaml
   ```
   The frontend / wildcard Ingress is likely defined in the cluster directly (kubectl apply against the k3s cluster) without IaC tracking — that's a separate hygiene gap worth surfacing in the same card.

2. **Is the Ingress controller `ingress-nginx` (Kubernetes community) or another distribution (nginx, traefik)?**
   The error format `nginx/1.31.0` suggests stock nginx, which matches `ingress-nginx`. Confirm by `kubectl describe pod -n ingress-nginx <pod>`.

3. **Is the bootstrap workflow (`workflows/src/activities/createIngressForOrgUnit.ts` or similar) creating per-org Ingress resources, OR a wildcard Ingress with TLS handling subdomains?**
   - Wildcard → one annotation patch fixes everything
   - Per-org → bootstrap activity needs the annotation baked into the generated YAML, and all existing per-org Ingresses need patching

## Verification

After applying the patch:

1. `kubectl describe ingress -n <namespace> <name>` shows the annotation
2. Login as super_admin on `a4c.firstovertheline.com`
3. Navigate to ANY provider subdomain (e.g., `liveforlife.firstovertheline.com`, `testorg-20260329.firstovertheline.com`)
4. Expected: page loads (no 400)
5. DevTools → Network → confirm request `Cookie` header is large (>4KB) and response is 200

## Out of scope

- Reducing super_admin's JWT size (e.g., compressing `effective_permissions` or moving it server-side). That's a deeper architecture change; the simple fix is the buffer bump.
- Tracking the Ingress YAML in the repo / moving to GitOps. Worth a follow-up card if Q1 above confirms the gap.

## Related

- **PR #64 UAT blocker** — this is what prompted the discovery. UAT T1 currently has to be run via curl (bypassing the UI) as a workaround. Memory file `cross-provider-invitation-rejected.md` should reference this card under "known UAT friction."
- **Routing card** `dev/active/investigate-auth-callback-priority-2-fallthrough.md` — separately seeded for a different symptom on the same auth flow; not the same root cause.
- **Impersonation feature** documented at `documentation/architecture/authentication/impersonation-architecture.md` — could potentially mitigate by letting super_admin take on a smaller-JWT context, but that's also out of scope.
