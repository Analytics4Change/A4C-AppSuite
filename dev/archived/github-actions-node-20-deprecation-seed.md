# Upgrade pinned GitHub Actions still running on Node.js 20

**Status**: seed (not yet planned)
**Priority**: Low (deadline-driven; non-blocking until 2026-06-02 default flip, fully blocking 2026-09-16)
**Origin**: PR #67 post-merge `supabase-migrations.yml` run (2026-05-21) — deprecation annotation on `supabase/setup-cli@v1`:

> Node.js 20 actions are deprecated. The following actions are running on Node.js 20 and may not work as expected: supabase/setup-cli@v1. Actions will be forced to run with Node.js 24 by default starting June 2nd, 2026. Node.js 20 will be removed from the runner on September 16th, 2026.

Source: [GitHub changelog 2025-09-19](https://github.blog/changelog/2025-09-19-deprecation-of-node-20-on-github-actions-runners/)

## Timeline

| Date | Effect |
|---|---|
| 2026-06-02 | Node 24 becomes the default; Node-20-pinned actions may stop working unless they ship a Node-24 release. Opt-out flag `ACTIONS_ALLOW_USE_UNSECURE_NODE_VERSION=true` temporarily restores Node 20. |
| 2026-09-16 | Node 20 removed from the runner entirely. Any still-pinned Node-20 actions hard-fail. |

We have ~10 weeks of cushion before the default flip and ~17 weeks before the hard removal.

## Action inventory (2026-05-21, all 10 workflows in `.github/workflows/`)

Actions still on a major that may carry a Node-20 release:

| Action | Pinned version | Workflows |
|---|---|---|
| `supabase/setup-cli@v1` | **v1** (Node 20) | `supabase-migrations.yml` (2 uses), `rpc-registry-sync.yml`, `edge-functions-deploy.yml` |
| `denoland/setup-deno@v1` | **v1** (Node 20) | `supabase-edge-functions-test.yml` |
| `actions/setup-node@v4` | v4 | `rpc-registry-sync.yml` |

Actions already on a modern major (cited for completeness, no action needed unless a sub-major flags Node 20):

- `actions/checkout@v5` — fleet-wide
- `actions/setup-node@v5` — most workflows
- `denoland/setup-deno@v2` — `edge-functions-deploy.yml`
- `azure/setup-kubectl@v4`, `docker/*@v4-v7` — fleet-wide

## Why this matters

- **`supabase/setup-cli`** appears in our load-bearing migration path (`supabase-migrations.yml` is the workflow that runs on every push to `main` and deploys SQL to dev Supabase). A hard fail on 2026-09-16 stops migration deploys.
- **`denoland/setup-deno@v1`** is in the Edge Function test workflow; failure would break the CI gate on EF changes.
- **`actions/setup-node@v4`** in `rpc-registry-sync.yml` — the rpc-registry CI gate. Failure would prevent merging any PR that touches an `api.*` RPC.

All three are well-maintained upstream; v2 / v5 releases likely exist already. The work is "bump the pin, smoke the workflow, confirm green".

## Steps

1. Check upstream for current major versions:
   - https://github.com/supabase/setup-cli/releases — look for v2+ on Node 24
   - https://github.com/denoland/setup-deno/releases — already shipped v2 (used in `edge-functions-deploy.yml`)
   - https://github.com/actions/setup-node/releases — v5 widely used in repo already
2. For each pin found, bump in-place and let CI run. Most likely zero behavior change; the action's contract is "install the CLI".
3. If `supabase/setup-cli` does not yet have a Node-24 release, file an upstream issue and pin `ACTIONS_ALLOW_USE_UNSECURE_NODE_VERSION=true` at the workflow level as a temporary measure until 2026-09-16.
4. Verify `actions/setup-node@v4` → `@v5` on `rpc-registry-sync.yml` is safe (the rest of the fleet is already on v5).
5. After the bumps, watch the next merge to `main` for any new deprecation annotations across all four affected workflows.

## Out of scope

- Bumping minor versions of already-modern actions (`@v5`, `@v6`, `@v7`) unless an annotation surfaces.
- Pinning to SHAs for supply-chain hardening (separate concern; not driven by the Node-20 deprecation).
- Auditing Temporal worker Docker images for Node 20 — those are runtime images, not GitHub Actions, and not affected by this deprecation.

## Files involved

- `.github/workflows/supabase-migrations.yml:43,86`
- `.github/workflows/rpc-registry-sync.yml:36,41`
- `.github/workflows/edge-functions-deploy.yml:144`
- `.github/workflows/supabase-edge-functions-test.yml:32`

## Trigger to start

Any of:

- A deprecation annotation escalates to a failure in CI.
- 2026-05-26 (one week before the 2026-06-02 default flip) — work this card as preventive maintenance.
- Free-bandwidth between feature PRs; this is a ~30-minute change with high-confidence smoke testing (re-run an existing workflow on a no-op commit).
