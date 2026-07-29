---
status: seed
last_updated: 2026-07-29
---

# Seed: Gate PRs on Edge Function `deno lint` (and `deno check`)

**Origin**: PR #103 (email-lookup PR A), 2026-07-29. Found while investigating why
`edge-functions-deploy` was red.

**Priority**: Medium. Low effort, but it silently blocked all Edge Function
deployment for two months and would have blocked PR #103's own change.

## Problem

`deno lint` and `deno check` for Edge Functions run **only in the deploy
workflow, only on push to `main`**. No PR check covers them.

`.github/workflows/edge-functions-deploy.yml`:

```yaml
on:
  push:
    branches: [main]
    paths: ['infrastructure/supabase/supabase/functions/**', ...]
  workflow_dispatch:
```

Its `validate` job holds three steps that belong on PRs:
- **Lint Edge Functions** (`:50`, runs `deno lint` per function at `:67`)
- **Type-check Edge Functions** (`:78`)
- **Check for required files** (`:104`)

The `deploy` job depends on `validate`, so a lint error blocks deployment —
and because it only surfaces post-merge on `main`, nobody is watching.

### What it cost

A single unused import sat in `manage-user/index.ts:36` from 2026-06-23:

```
error[no-unused-vars]: `AnySchemaSupabaseClient` is never used
```

`edge-functions-deploy` was red from **2026-06-23 to 2026-07-29** (fixed in PR
#103, commit `f3a25377`). Every Edge Function change in that window had to be
deployed by hand — confirmed by comparing deployed bundles against the repo:
`invite-user` v106 (2026-06-24 15:34) and `manage-user` v103 (2026-06-23 20:00)
both carry current code, but neither came from CI.

Manual deploys are the real cost. They work, but they break the link between
"what is deployed" and "what commit produced it", and they mean a red pipeline
stops being informative — the failure had been red so long that PR #103's Edge
Function change would have merged and silently never deployed.

## What already exists (do not duplicate)

Two workflows already trigger on `pull_request` with the right path filter:

| workflow | `name:` | covers |
|---|---|---|
| `supabase-edge-functions-lint.yml` | **Edge Function ADR Citation Check** | new-EF-file ADR citation only — despite the filename, it does NOT run `deno lint` |
| `supabase-edge-functions-test.yml` | **Edge Function Deno Tests** | `deno test` |

Both use:

```yaml
on:
  pull_request:
    paths: ['infrastructure/supabase/supabase/functions/**']
```

The filename of `supabase-edge-functions-lint.yml` is actively misleading — it
implies lint coverage that does not exist. Worth renaming as part of this.

## Proposed

Add `deno lint` + `deno check` to PR CI. Cheapest correct option: extend
`supabase-edge-functions-test.yml`, which already has the trigger, path filter,
and Deno setup. Alternative: add `pull_request` to the deploy workflow's
`validate` job — but that runs Supabase CLI setup the PR does not need.

Reuse the loop body from `edge-functions-deploy.yml:50-103` rather than writing
a new one, so PR and deploy enforce identical rules. Divergence there is how you
get a green PR that fails on merge.

## ⚠️ Required-check + path-filter interaction

If this is made a **required** status check, a path-filtered workflow never runs
on PRs that do not touch `infrastructure/supabase/supabase/functions/**`, and
the required check sits `pending` forever — blocking merge on every unrelated PR.

**This repo has already solved this once**: PR #97 added the `frontend-ci`
required check "path-filter-safe". Copy that arrangement rather than re-deriving
it. Options are (a) drop the path filter and let the job no-op fast, or (b) the
always-run skip-job pattern that reports success when no relevant paths changed.

## Verification

- Open a PR touching an Edge Function with a deliberate unused import → the new
  check FAILS on the PR, not after merge.
- Open a PR touching **no** Edge Function → the check does not sit `pending`
  (the trap above).
- Confirm PR lint and deploy-time lint agree: same Deno version, same flags,
  same per-function loop.

## Follow-on worth doing at the same time

- **Rename `supabase-edge-functions-lint.yml`** to match what it does
  (`supabase-edge-functions-adr-citation.yml`), or fold the ADR check into the
  new lint job. The current name is a trap for the next person looking for lint
  coverage.

**Deployed-vs-repo reconciliation is deliberately NOT tracked here.** It is a
post-merge check on PR #103 specifically — does `invite-user` bump past v106? —
and it lives in that PR's body under "⚠️ POST-MERGE" so whoever merges sees it
at the moment it matters, plus in session memory so it survives. A second copy
here is how one of them goes stale.

## Related

- `.github/workflows/edge-functions-deploy.yml` — where lint lives today
- `.github/workflows/supabase-edge-functions-test.yml` — the natural host
- PR #103 commit `f3a25377` — the one-line fix that unblocked deploys
- PR #97 — the `frontend-ci` path-filter-safe required-check precedent
