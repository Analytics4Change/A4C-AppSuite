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

## Verify (post-deploy, 2026-05-19)

- [x] CI: `frontend-deploy.yml` run [26119425607](https://github.com/Analytics4Change/A4C-AppSuite/actions/runs/26119425607) — `Build and Push` 1m 9s, `Deploy to Kubernetes` 49s, rollout clean. Image `ghcr.io/analytics4change/a4c-appsuite-frontend:b9a0d8d` (digest `sha256:c8779cc8…`).
- [x] `kubectl exec -n default a4c-frontend-84f6db87c9-gpg4m -- nginx -T | grep large_client_header_buffers` shows `large_client_header_buffers 4 32k;` + companion `client_header_buffer_size 4k;`. Both replicas Running 1/1.
- [x] Wire-level curl probe (`liveforlife.firstovertheline.com`): 8 KB Cookie → 200; 21 KB → 200; 32 KB → 200; 40 KB → 400. Sharp boundary at the new 32k ceiling confirms the directive is the active limit (~7× headroom over super_admin's 4.3 KB JWT).
- [x] Super_admin browser session: logged in to `a4c.firstovertheline.com`, navigated to `liveforlife.firstovertheline.com` and `testorg-20260329.firstovertheline.com/users/manage` — both load HTTP 200 (were 400 pre-fix). DevTools confirmed 3 chunked `sb-tmrjlswbsxmbglmaclxu-auth-token.0/.1/.2` cookies traveled and reached the EF.

## Bonus UAT — T1 re-run as super_admin (2026-05-19)

Pre-flight + post-flight DB state captured to `/tmp/pr64-t1-superadmin-{pre,post}flight.json` (compared via diff — all state-relevant fields byte-identical).

- **UI inviter**: lars.tice@gmail.com (super_admin) on `testorg-20260329.firstovertheline.com/users/manage`
- **Invitee**: dakaratekid@gmail.com (current liveforlife member)
- **Outcome**: HTTP **403** `{"error":"No organization context in token"}` — **the cross-provider gate was NOT reached.** Request rejected at the EF's preflight org-context check because super_admin's `users.current_organization_id IS NULL` makes the JWT `org_id` claim absent.
- **Correlation ID**: `8dc9de62-5c26-4b68-9e4c-e2fe4dbb7ca1` — `domain_events` query returned `[]` (no event emitted; EF rejected before any write).
- **DB invariants confirmed**: invitation count and `user.invited` event count both stayed 0; dakaratekid identity unchanged (`current_organization_id=liveforlife`, `accessible_organizations=[liveforlife]`, `roles=[Aspen Program Manager]`).

**Implication**: nginx fix is fully verified (request reached the EF; pre-fix it would have died at nginx with 400). The cross-provider gate's correctness was already proved via johnltice@yahoo.com on 2026-05-15. The 403 surfaces an orthogonal known-issue (the "super_admin role-validation quirk" alluded to in the PR #64 UAT note) — seeded as a new card: `dev/active/superadmin-no-org-context-on-tenant-subdomain/`.

## Follow-up (separate cards)

- [x] **Role-validation quirk** seeded: `dev/active/superadmin-no-org-context-on-tenant-subdomain/`
- [ ] **GitOps gap**: `a4c-frontend-ingress` and `tenant-wildcard-ingress` not tracked in `infrastructure/k8s/` (only `temporal-api/ingress.yaml`). Not seeded as a card yet — open question on whether to migrate cluster-direct ingress to IaC.
- [ ] **JWT size reduction**: if super_admin JWT keeps growing as permissions are added, consider compressing or moving permissions server-side (separate card; not yet seeded).

## PR shape

- [x] Branch `feat/fix-nginx-large-client-header-buffers` merged via PR #65 (commit `b9a0d8d5`).
- [x] Single-file source change to `frontend/nginx/default.conf`.
- [x] PR description explained the investigation surprise (Traefik vs in-container nginx).

## Definition of done

- [x] super_admin can log in on any subdomain and navigate freely between subdomains without hitting nginx 400 (verified via UI walkthrough).
- [x] PR #64 UAT T1 can be run via the UI as super_admin without nginx 400 (the gate itself isn't reached due to orthogonal quirk, but the nginx scope is closed; the original UAT pass via johnltice@yahoo.com remains the gate-correctness evidence).
- [x] Directive present in deployed frontend pod's nginx config (`nginx -T` confirmed).
- [x] Memory file `cross-provider-invitation-rejected.md` "PR #64 closeout" section updated with the nginx-fix-shipped + bonus-UAT findings.

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
