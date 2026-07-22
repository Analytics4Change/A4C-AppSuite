---
status: seed
last_updated: 2026-07-22
---

# Seed: Command-feedback for settings client-fields tabs (Categories + CustomFields)

**Origin**: command-feedback Phase 3 Tier-2 rollout (PR 3). These two tabs were **intentionally deferred** from PR 3 because they need a success-surface *design*, not a mechanical migration — see below.

## Why deferred (not a defect)
`CategoriesTab.tsx` / `CustomFieldsTab.tsx` (`src/pages/settings/client-fields/`) already surface failures as **contextual** `role="alert"` blocks placed right next to each form/row — create error in the create form, update error in the edit row, lifecycle error at the top (driven by `ClientFieldSettingsViewModel` computeds: `createCategoryError`/`updateCategoryError`/`categoryLifecycleError` and the `*Field*` equivalents). That contextual placement is **good UX** — do **not** consolidate it onto a single top banner (that would regress it).

The real gaps are:
1. **No success feedback at all** — every mutation (`createCategory`/`updateCategory`/`deactivateCategory`/`reactivateCategory`/`deleteCategory` and the `*CustomField*` set) resolves silently (form closes / dialog closes). Adding a `role="status"` success confirmation is the main value.
2. **Errors are not sanitized** — the VM sets several from raw `result.error ?? '…'` / `error.message` (`ClientFieldSettingsViewModel.ts` ~L464/478/507/546/584/642/679/717). Some paths already build a `friendlyError`; others can leak handler internals.

## Proposed
- **Success**: add a `role="status"` confirmation per tab (a small banner at the top of the tabpanel `CardContent`, or a transient per-row check) set on each successful mutation — e.g. "Category created", "Field deactivated". Decide banner-at-top vs inline-per-row (banner-at-top is simplest and matches the standard's success surface).
- **Sanitize**: wrap each displayed VM error string in `sanitizeCommandError(raw, '<friendly op fallback>').display` (or sanitize inside the VM once, at the `this.xError = …` assignment sites — preferred, single choke point). Confirm the existing `friendlyError` path still passes through.
- **Keep** the contextual error placement. Optionally add one `aria-hidden` `CommandFeedbackEcho` per tab for scroll-independence on the lifecycle error.
- **INV-1 note**: multiple contextual `role="alert"` regions (create + lifecycle) can co-mount; low-risk (rarely co-occur), but if tightened, ensure at most one announces per action.

## Verification
- `tsc`/`eslint`/`build` green; existing `tabpanel-categories` / client-field settings tests still pass.
- Force a create/update/lifecycle failure with an internal-looking error → friendly text shown, raw `log`'d.
- Confirm a success confirmation appears for each mutation.

## Not started. LOW-MED (additive; contextual errors already work). Companion to the other command-feedback follow-ups: [[seed-sanitize-load-path-errors-command-banner]] (Users load-path).
