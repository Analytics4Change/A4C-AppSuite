# Tasks — fix-nginx-large-client-header-buffers

## Investigation

- [ ] Confirm Ingress controller distribution:
  ```bash
  kubectl get pods -A -l app.kubernetes.io/name=ingress-nginx
  kubectl describe pod -n ingress-nginx <pod-name> | grep -i image
  ```
- [ ] Locate the wildcard / frontend Ingress:
  ```bash
  kubectl get ingress -A
  kubectl get ingress -A -o yaml | grep -B2 firstovertheline
  ```
- [ ] If Ingress not tracked in repo, capture current YAML for diff baseline:
  ```bash
  kubectl get ingress -n <ns> <name> -o yaml > /tmp/ingress-before.yaml
  ```

## Patch

- [ ] Add annotation to the wildcard Ingress:
  ```bash
  kubectl annotate ingress -n <ns> <name> \
    nginx.ingress.kubernetes.io/large-client-header-buffers="4 32k"
  ```
- [ ] If per-org Ingresses are bootstrap-generated, also patch the generator:
  - [ ] Locate the activity that creates per-org Ingress (likely `workflows/src/activities/`)
  - [ ] Bake the annotation into the generated YAML
  - [ ] Backfill all existing per-org Ingresses (loop kubectl annotate)

## Verify

- [ ] `kubectl describe ingress -n <ns> <name>` shows annotation
- [ ] Reload super_admin browser tab on `a4c.firstovertheline.com` (cookies will be re-issued via session refresh if needed)
- [ ] Navigate to `liveforlife.firstovertheline.com` → expect 200 page load
- [ ] Navigate to `testorg-20260329.firstovertheline.com/users/manage` → expect 200 page load
- [ ] DevTools → Network → first request's `Cookie` header is large (>4KB), status 200

## Follow-up (separate cards if needed)

- [ ] **GitOps gap**: if Ingress not in repo, decide whether to migrate to tracked-IaC (separate card)
- [ ] **JWT size reduction**: if super_admin JWT keeps growing as permissions are added, consider compressing or moving permissions server-side (separate card)

## PR shape

- [ ] Branch `fix/nginx-large-client-header-buffers`
- [ ] If Ingress is in repo: patch the YAML, commit, run-deploy
- [ ] If Ingress is NOT in repo: kubectl-only fix; commit a note documenting the manual action in `documentation/infrastructure/operations/` (and surface the GitOps gap in the PR description)

## Definition of done

- [ ] super_admin can log in on any subdomain and navigate freely between subdomains without hitting 400
- [ ] PR #64 UAT T1 can be run via the UI (not curl) as originally specified
- [ ] Annotation present on production Ingress
- [ ] Memory file `cross-provider-invitation-rejected.md` "PR #64 closeout" section updated to note UAT was completed via UI after this fix shipped
