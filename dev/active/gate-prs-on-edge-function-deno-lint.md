---
status: partial
last_updated: 2026-07-30
---

# Seed: Gate PRs on Edge Function `deno lint` (and `deno check`)

> ## ⚠️ PARTIAL — one of two halves shipped
>
> | half | state |
> |---|---|
> | **(1) PR-time `deno lint` / `deno check` gate for Edge Functions** | **STILL OPEN** — this is the remaining work |
> | **(2) `push: [main]` on `frontend-ci.yml`** | **SHIPPED** — PR #104, `527284eb` |
>
> **(2) did not do what this card originally said it would.** It was framed as
> "closes the required-check reporting gap so direct pushes stop needing a bypass".
> That premise is false — see the CORRECTION section below. It shipped for a
> different, better reason (`strict: false` left merge commits unverified), and the
> bypass-elimination decision is **RE-OPENED**.
>
> Verified in production on `527284eb`: the push run resolved a real
> `deeff7b5..527284eb` range, ran the full suite, and attached
> `Type-check, lint, test, build: success` to the merge commit — the first time
> `main` has carried that record.
>
> **Read the CORRECTION section before implementing (1).** It contains the two traps
> that would otherwise bite: `github.base_ref` is also empty on push events, and the
> required-check-vs-path-filter interaction.

**Original framing (kept for provenance)**: (1) add the missing PR-time lint gate,
and (2) close the required-check reporting gap on direct pushes to `main`. They were
to ship together because (1) adds a second required check that would otherwise
inherit the same gap — that reasoning still holds for (1).

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

**Copy `frontend-ci.yml` (PR #97). Do not re-derive this.** Its header states the
rule and the reason:

> NOTE: this job is intended to be a REQUIRED status check. It therefore triggers
> on EVERY pull request with NO `paths:` filter — a path-filtered workflow is
> *skipped* on PRs that don't touch frontend/, and a skipped required check never
> reports, which wedges the merge box. Instead we always run (so the check always
> reports) and gate the expensive steps on whether frontend / CI files actually
> changed.

Concretely: `on: pull_request` with no `paths:`, a `Detect changes` step, and
`if: steps.changes.outputs.<x> == 'true'` on every expensive step. Cost on an
unrelated PR is a checkout plus a diff.

### Residual gap: direct pushes to `main` (observed 2026-07-29)

`frontend-ci.yml` triggers on `pull_request` **only**. Branch protection requires
`Type-check, lint, test, build` on `main`, so a **direct push** to `main` produces
no run, the required check never reports, and the push needs a bypass:

```
remote: Bypassed rule violations for refs/heads/main:
remote: - Required status check "Type-check, lint, test, build" is expected.
```

Hit twice while seeding this card and its follow-up — both docs-only commits, both
bypassed. This is **not** a defect in PR #97's design (which is correct for its
trigger); it is that branch protection expects a check on a path the workflow was
never wired to cover.

### ⚠️ CORRECTION (2026-07-29, dbc review of PR #104): (b) does NOT remove the bypass

This card originally framed the choice as (a) route everything through PRs vs
(b) add `push: branches: [main]`, and recommended (b) as "the smaller change".
**(b) cannot work for that purpose, and the recommendation was wrong.**

Required status checks under classic branch protection are evaluated **at push
time, against the incoming head SHA** — which is why the warning comes from the
remote during `git push`. GitHub's ordering is explicit: checks pass *first*, then
the push. So a `push`-triggered workflow can only start **after** the ref update is
accepted:

1. `git push origin main` → pre-receive evaluates the required context against a
   SHA GitHub has never seen → no check runs exist → `Required status check … is expected.`
2. Bypass (`enforce_admins: false`) lets the ref update land.
3. *Only now* does the `push` run start and attach — **after** the bypass.

PR #104 shipped that trigger anyway, for a **different and better reason** (see
below), and its header comment now says plainly that it does not remove the bypass.

**Options that actually eliminate it** — this decision is **RE-OPENED**:

- **(i) Docs commits via PR + auto-merge.** Works: a PR merged via the merge button
  is evaluated against the PR head SHA, which carries the check. Costs a PR per
  two-line card edit; cuts against the `feedback-branch-on-decision` carve-out.
- **(ii) Temp-branch → checks → fast-forward** (GitHub's documented workaround).
  Requires broadening the push trigger beyond `[main]` — use a narrow explicit
  namespace like `branches: [main, 'ci-precheck/**']`, never `'**'` (that would
  double-run every PR-branch push).
- **(iii) Migrate to a ruleset with the maintainer as a named `bypass_actor`,** so
  the carve-out is an audited policy decision rather than an accident that trains
  the wrong reflex. The honest option if the carve-out is genuinely wanted.

### What PR #104 actually bought (the real justification)

Branch protection has **`strict: false`** — "require branches to be up to date
before merging" is OFF. The required check therefore validates the **PR head** and
never the **merge result**. Verified: `deeff7b5` (the PR #103 squash-merge, which
rewrote a service, deleted two test files and changed `eslint.config.js`) carries
**no** `Type-check, lint, test, build` run at all. Before #104, `main` held no
evidence it typechecked, linted or passed tests.

That is the **same failure class as this card's own origin story** — the `deno lint`
error that sat on `main` for two months. Work verified somewhere other than where
it ships.

**Implication for the lint gate this card proposes:** copy `frontend-ci.yml`'s
always-run + detect-changes shape for the PR trigger (unchanged advice), and add
`push: [main]` for the `strict: false` reason — *not* to avoid a bypass.

**Why this matters beyond tidiness**: routine bypassing trains the reflex that a
red or unreported required check is normal. That reflex is precisely how a `deno
lint` failure survived on `main` for two months.

## Verification

- Open a PR touching an Edge Function with a deliberate unused import → the new
  check FAILS on the PR, not after merge.
- Open a PR touching **no** Edge Function → the check does not sit `pending`
  (the trap above).
- **Push a docs-only commit directly to `main`** → a `Frontend CI` run appears on
  that commit with event `push`, its detect step logs a real `before..after` range,
  and it reports. **The "Bypassed rule violations" message STILL APPEARS — that is
  expected, not a failure** (see the correction above; the run attaches after the
  push). What this verifies is that `main` commits now carry a verification record,
  not that the gate blocks.
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
- `.github/workflows/frontend-ci.yml` — the always-run + detect-changes exemplar
  to copy; its header comment is the canonical statement of the rule
- PR #97 — where that pattern was established
- PR #104 — added `push: [main]` for the `strict: false` reason; corrected this card

### Two traps for whoever implements the lint gate

1. **Do NOT blanket-add `push:` triggers.** `supabase-edge-functions-lint.yml:33-36`
   uses `github.base_ref`, which is **empty on a push event** — adding a push
   trigger there re-creates the exact empty-SHA bug PR #104 just fixed for
   `base.sha`. Same pitfall, different field.
2. **`rpc-registry-sync.yml` and `rpc-reachability-matrix-sync.yml` want
   `push: [main]` too** — for the `strict: false` reason (a migration can land and
   generated-registry/matrix drift go undetected post-merge), NOT the bypass
   reason. They are not required checks, so they may keep their `paths:` filters.
