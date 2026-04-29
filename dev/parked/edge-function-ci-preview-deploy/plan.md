# Plan — Edge Function CI Preview Deploy

## Design space (high-level; resume when prioritized)

| Option | Mechanism | Cost |
|---|---|---|
| **A — Supabase preview branches** | Use Supabase's built-in branching feature; CI creates a preview branch on PR open and deploys there | Lowest engineering cost; depends on Supabase Branches GA / pricing |
| **B — Dedicated preview project** | Maintain a separate Supabase project for PRs; CI deploys there on PR open | Higher operational cost; full env isolation |
| **C — Deploy-on-label** | CI deploys to the dev project on PR when a `deploy-preview` label is applied; no automatic divergence | Lowest infrastructure cost; reintroduces manual gating |

## Open questions (when activated)

- **Q1**: Which projects need preview deploys? (Edge Functions yes; frontend / workers separate)
- **Q2**: How to reconcile preview deploys with the dev project's role as the smoke-test environment?
- **Q3**: How to handle JWT / auth secrets in preview environments without leaking dev credentials?

## Verification (when activated)

- A representative Edge Function PR triggers preview deploy automatically; smoke testing proceeds without local CLI invocations.
- Merging the PR replaces the preview deploy with the main-deployed version cleanly.
