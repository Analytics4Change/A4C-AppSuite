# Tasks — fix-nginx-large-client-header-buffers

## Investigation (completed 2026-05-19)

- [x] Confirm Ingress controller distribution
  - **Result**: Cluster runs **Traefik 3.3.6** (k3s default helm-installed), NOT nginx-ingress. The card's original assumption was wrong.
- [x] Locate the wildcard / frontend Ingress
  - **Result**: 3 Traefik Ingresses found (a4c-frontend-ingress with TLS, tenant-wildcard-ingress HTTP-only, temporal-api-ingress). None apply — the nginx producing the 400 is NOT in the ingress tier.
- [x] Identify the actual source of `nginx/1.31.0`
  - **Result**: The frontend SPA container itself runs `nginx:alpine` (`frontend/Dockerfile:5`). The 400 originates inside that pod's nginx because `frontend/nginx/default.conf` has no `large_client_header_buffers` directive and inherits nginx's default of `4 8k`.

## Patch

- [x] Add `large_client_header_buffers 4 32k;` to the `server` block in `frontend/nginx/default.conf` with a one-line comment explaining the JWT/chunked-cookie origin.

## Verify (post-deploy)

- [ ] CI: `frontend-deploy.yml` builds and deploys after merge to main
- [ ] `kubectl exec -n default <a4c-frontend-pod> -- nginx -T | grep large_client_header_buffers` shows `4 32k`
- [ ] Reload super_admin browser tab on `a4c.firstovertheline.com`
- [ ] Navigate to `liveforlife.firstovertheline.com` → expect 200 page load (was 400)
- [ ] Navigate to `testorg-20260329.firstovertheline.com/users/manage` → expect 200 page load (was 400)
- [ ] DevTools → Network → first request's `Cookie` header is >4KB and response is 200

## Follow-up (separate cards if needed)

- [ ] **GitOps gap (still real, separate scope)**: `a4c-frontend-ingress` and `tenant-wildcard-ingress` are NOT tracked in `infrastructure/k8s/` — only `temporal-api/ingress.yaml` is. Worth surfacing in a follow-up card; not in scope here because this fix doesn't touch Ingress YAML.
- [ ] **JWT size reduction**: if super_admin JWT keeps growing as permissions are added, consider compressing or moving permissions server-side (separate card).

## PR shape

- [x] Branch `feat/fix-nginx-large-client-header-buffers` (off main)
- [x] Single-file change to `frontend/nginx/default.conf`
- [ ] PR description explains the investigation surprise (Traefik vs in-container nginx) so future readers don't repeat the assumption

## Definition of done

- [ ] super_admin can log in on any subdomain and navigate freely between subdomains without hitting 400
- [ ] PR #64 UAT T1 can be run via the UI (not curl) as originally specified
- [ ] Directive present in deployed frontend pod's nginx config (verified via `nginx -T`)
- [ ] Memory file `cross-provider-invitation-rejected.md` "PR #64 closeout" section updated to note UAT becomes UI-runnable after this fix ships
