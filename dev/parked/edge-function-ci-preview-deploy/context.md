# Edge Function CI Preview Deploy — Context

**Type**: CI / tooling
**Status**: 🅿️ PARKED — awaiting prioritization
**Priority**: Low-Medium — improves PR feedback velocity
**Origin**: Recommended by `software-architect-dbc` during PR #41 review (Issue 5).

## Capability target

Allow Edge Function PRs to deploy to a preview environment automatically (or behind a label) so that smoke testing can happen against the PR's code without requiring a manual `supabase functions deploy` invocation by the developer.

## Why now (concrete trigger)

PR #40 and PR #41 both required manual `supabase functions deploy --project-ref tmrjlswbsxmbglmaclxu` invocations during smoke testing because the existing "Deploy Edge Functions" CI workflow only fires on `main` push. This created a brief window where dev's deployed Edge Function diverged from `main`'s expected state.

Architect's framing in PR #41 review: "the manual deploy state is bounded and acceptable for this PR; CI preview-deploy is a real engineering investment that deserves its own scoped card."

## Trigger to start

- A third Edge Function PR pattern repeats the manual-deploy workaround, OR
- Supabase preview branches feature reaches GA, OR
- Compliance / process drives a "no manual production-tier deploys" policy

## Out of scope

- Migration deploys (the existing "Deploy Database Migrations" workflow already covers PR validation).
- Frontend deploys (the existing "Deploy Frontend" workflow + its main-only trigger is acceptable; frontend changes are reverted-by-deploy in <1 minute typically).

## References

- PR #41 review: software-architect-dbc Issue 5 adjudication.
- `.github/workflows/edge-function-deploy.yml` (or whichever workflow deploys Edge Functions on main push)
- Supabase Branches feature docs: https://supabase.com/docs/guides/platform/branching
