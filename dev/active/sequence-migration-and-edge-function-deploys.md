---
status: seed
last_updated: 2026-07-31
---

# Seed: migration and Edge Function deploys race on merge, and drift is undetected

**Origin**: PR A (2026-07-31). I made the invitation token write-once — handler stops
writing `token`, `invite-user` stops minting one — in a single commit, then pushed the
migration to dev while the Edge Function was still at the previously merged version.
The old function kept generating a token and emailing it, the new handler ignored it, and
**every resend on dev emailed a link matching nothing**. Codified as the deploy-clock
pitfall in `infrastructure/supabase/CLAUDE.md`.

Investigating whether CI could have caught it showed CI has the same weakness.

**Priority**: MEDIUM. No current breakage — but the merge path can produce the same
silent mismatch, and nothing would report it.

## Problem 1 — the two deploys race on every merge

`.github/workflows/supabase-migrations.yml` and
`.github/workflows/edge-functions-deploy.yml` both trigger on `push: [main]` with path
filters. `needs:` sequences jobs *within* each workflow; there is no `workflow_run`
anywhere in `.github/workflows/`. So on a merge touching both, they run **in parallel,
in nondeterministic order**.

Two consequences:

- A coupled PR (PR A is one) deploys its halves in whichever order the runners happen to
  start. The window is short but real.
- **If the Edge Function workflow fails, migrations stay live against stale functions
  indefinitely, and nothing says so.** That is the same broken state reached manually,
  arrived at by a route nobody is watching.

## Problem 2 — no drift detection

Nothing compares what is deployed against what `main` expects. The mismatch is only
visible if someone thinks to look:

```bash
curl -sS "https://api.supabase.com/v1/projects/${SUPABASE_PROJECT_REF}/functions" \
  -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}" \
  | jq -r '.[] | "\(.slug) v\(.version) \(.updated_at)"'
```

## Proposed

1. **Sequence the deploys.** Gate Edge Function deploy on migration success — either
   `workflow_run` chaining (`edge-functions-deploy` triggered by
   `Deploy Database Migrations` completing successfully) or fold both into one workflow
   with `needs:`. Note the path filters make this non-trivial: a functions-only PR must
   still deploy when no migration workflow runs at all. A `workflow_run` chain would
   never fire for those, so the trigger needs to remain `push` with an *added* wait, not
   a replaced one.
2. **Post-deploy drift check.** For each directory under
   `infrastructure/supabase/supabase/functions/`, compare the deployed `updated_at` from
   the Management API against the last `main` commit touching that directory. Deployed
   older than the commit ⇒ fail. Fires only when a deploy actually failed or was skipped,
   so it should be quiet.

## Explicitly NOT proposed — and why

- **Warn when a PR touches both migrations and functions.** Most such PRs are correct;
  PR A is one. The false-positive rate buys alarm fatigue, and a check people reflexively
  dismiss is worse than no check.
- **Alert when dev has applied migrations absent from `main`.** That is the *sanctioned*
  workflow — `infrastructure/supabase/CLAUDE.md` instructs `db push --linked` then commit.
  It would fire constantly during normal development.

## What CI structurally cannot catch

The case that actually caused this: a **local** `db push` to dev while the paired Edge
Function change is unmerged. That happens before any CI run exists, so no workflow can
observe it. Mitigation is local discipline — the ritual documented in the pitfall
(`db push` immediately followed by `supabase functions deploy` for every affected
function), optionally nudged by a `pre-push` hook.

Worth stating plainly on the card so nobody later assumes items 1–2 cover it. **A check
that looks like it covers a case but does not is the failure mode this whole PR is about.**

## Verification when picked up

- Merge a PR touching both a migration and a function; confirm the function deploy starts
  only after the migration workflow succeeds.
- Force the function deploy to fail; confirm the drift check reports the mismatch on the
  next run rather than staying silent.
- Merge a functions-only PR; confirm it still deploys (the path-filter trap above).

## Related

- `infrastructure/supabase/CLAUDE.md` § "Migrations and Edge Functions deploy on
  DIFFERENT CLOCKS" — the pitfall, with the expand/contract shape and why naive
  reordering is worse than doing nothing.
- `gate-prs-on-edge-function-deno-lint.md` — separate, also EF-CI; do not conflate.
