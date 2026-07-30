# Plan — Edge Function Deno Test Harness

## Phases

| Phase | Description |
|-------|-------------|
| 0 | Decide test runner: built-in `Deno.test` (zero dep, native to deno.land) vs `@std/testing/bdd` (Jest-style). Lean: `Deno.test` to start; minimize tooling spread. |
| 1 | Decide CI integration: extend `.github/workflows/supabase-edge-functions-lint.yml` to also run tests, OR create `supabase-edge-functions-test.yml`. Lean: extend the existing workflow to keep the Edge Function CI surface unified. |
| 2 | Establish a `infrastructure/supabase/supabase/functions/_shared/__tests__/` directory convention (or per-function colocated `*.test.ts`). Lean: per-function colocation matches the project's other test conventions (`SupabaseUserCommandService.mapping.test.ts` et al.). |
| 3 | Author tests for `resolveInvitationPhonePlaceholder` (6 cases per its docblock — first target). |
| 4 | Document the pattern in `infrastructure/supabase/CLAUDE.md` § Edge Function testing. Make it the new floor: pure helpers extracted in future Edge Function fixes ship with tests. |

## Open questions

- **Q1**: Should tests run against the `_shared/` modules first (most leverage), or per-function helpers (closer to active code)? Lean: `_shared/` first — establishes the harness with the highest-reuse code.
- **Q2**: How to handle helpers that take Supabase client mocks? Lean: defer; pure helpers are sufficient first target.
- **Q3**: How to handle helpers that import from `https://deno.land/...`? Lean: tests use the same imports; CI runs `deno test --no-check` to skip type-checking remote modules.

## Critical files (read-only until Phase 1)

- `.github/workflows/supabase-edge-functions-lint.yml` — existing CI workflow to extend.
- `infrastructure/supabase/supabase/functions/accept-invitation/index.ts:58-163` — first target helper.
- `infrastructure/supabase/CLAUDE.md` — destination for the new pattern documentation.

## Verification

- `deno test` runs locally and passes 6/6 cases for `resolveInvitationPhonePlaceholder`.
- CI workflow runs the tests on PR open/push to `infrastructure/supabase/supabase/functions/**`.
- A future Edge Function PR uses the harness to ship a pure-helper fix with tests, confirming the pattern is self-serviceable.
