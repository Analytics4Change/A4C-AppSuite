---
status: seed
last_updated: 2026-07-31
---

# Seed: Temporal deploy writes a live DB password into a Kubernetes secret nobody reads

**Origin**: PR A commit 3 (2026-07-31). While retiring `api.resend_invitation` I had to
run the RPC codegens against the remote DB, which surfaced that the codegen scripts
logged the connection string verbatim (fixed in that commit). Auditing who else holds
that password turned this up.

**Priority**: MEDIUM as security hygiene. Low risk to change — nothing consumes the
secret. It is not urgent, but it is the kind of thing that quietly becomes urgent.

## Problem

`.github/workflows/temporal-deploy.yml:150-168` has a step **"Update Supabase Database
URL Secret"** that, on every Temporal deploy:

1. builds `postgresql://postgres.${PROJECT_REF}:${{ secrets.SUPABASE_DB_PASSWORD }}@aws-1-us-west-1.pooler.supabase.com:5432/postgres`
2. base64-encodes it
3. `kubectl patch secret workflow-worker-secrets -n temporal` with key `SUPABASE_DB_URL`

**Nothing reads that key.** The config file says so explicitly —
`infrastructure/k8s/temporal/workflow-worker-config.yaml:25-32`:

```
# Phase 2 Architecture Simplification (Option C):
# REMOVED: SUPABASE_DB_URL (no longer needed)
# - Worker no longer uses PostgreSQL LISTEN/NOTIFY
# - Worker no longer subscribes to Supabase Realtime
# - Workflows triggered via direct Temporal RPC from Edge Function
```

Confirmed by grep: **zero** references to `SUPABASE_DB_URL` anywhere under `workflows/`.

So each deploy re-writes a live database password into the cluster for a consumer that
was removed in Phase 2. Base64 is encoding, not encryption — anyone with `get secret` in
the `temporal` namespace can read it.

## Also stale: the comment contradicts the code

The step's comment claims a **direct** connection is required because "Session pooler
(port 6543) does NOT support LISTEN/NOTIFY". But the URL it builds points at
`aws-1-us-west-1.pooler.supabase.com` — that *is* the pooler (session mode on 5432). The
justification is doubly moot since the LISTEN/NOTIFY design was removed in Phase 2.

## Who else holds this password (audited 2026-07-31)

| Consumer | Uses `SUPABASE_DB_PASSWORD`? | Notes |
|---|---|---|
| `temporal-deploy.yml` | **yes** | the only CI consumer — this card |
| `supabase-migrations.yml` | no | `SUPABASE_ACCESS_TOKEN` only for link / db push / db lint / migration list |
| `rpc-registry-sync.yml` | no | throwaway local container, `postgres:postgres@127.0.0.1:54322` |
| local dev (`_sec supabase-db-password`) | yes | needed to run the RPC codegens against remote; **keep this one** |

## Proposed

1. **Delete the step** from `temporal-deploy.yml`.
2. **Remove the existing key from the cluster** — deleting the step stops *future* writes
   but leaves the current value in place:
   ```bash
   kubectl patch secret workflow-worker-secrets -n temporal \
     --type=json -p='[{"op":"remove","path":"/data/SUPABASE_DB_URL"}]'
   ```
3. **Consider retiring the `SUPABASE_DB_PASSWORD` GitHub secret** once (1) lands — the
   audit above shows no other workflow uses it. ⚠️ Re-run the audit before deleting;
   a workflow added after 2026-07-31 could have picked it up.
4. Keep the **vault** entry (`supabase-db-password`, folder `shell-env`). Developers need
   it to run `gen:rpc-registry` / `gen:rpc-reachability-matrix` against the remote, which
   is a supported workflow.

## Verification

- Deploy a Temporal worker after the change; workers start and process a workflow.
  (Safe by construction — nothing read the key — but prove it rather than assert it.)
- `kubectl get secret workflow-worker-secrets -n temporal -o json | jq '.data | keys'`
  no longer lists `SUPABASE_DB_URL`.
- `grep -rn "SUPABASE_DB_URL" workflows/ .github/workflows/` returns only the codegen
  scripts' env var, never a password-bearing construction.

## Related

- PR A commit 3 (`c7c826fa`) — fixed both codegen scripts logging the password via a
  `redactDbUrl` helper. That closed the *logging* leak; this card closes the *storage* one.
- **Pending action**: the dev DB password was exposed in an agent transcript on
  2026-07-31 and should be rotated (Supabase dashboard → GitHub secret → vault entry).
  Rotation is low-risk: migrations and the codegen CI both authenticate by other means.
- `documentation/infrastructure/operations/resend-key-rotation.md` — precedent for how a
  key-rotation runbook is written here; there is no DB-password equivalent yet.
