# UAT runbook — invite-user EF HTTP behavior (PR #85)

**Date**: 2026-06-24 · **Driver**: Lars as `johnltice@yahoo.com` (provider_admin, TestOrg-20260329) · **Plan**: `~/.claude/plans/fizzy-jingling-puppy.md`

## Per-scenario steps
For **each** scenario: open a **fresh incognito window** → `https://a4c.firstovertheline.com` → log in (email/password) as `johnltice@yahoo.com` → Users management page → **Invite User** → enter the **Target email** + any First/Last name + pick role **"Aspen Med Viewer"** → Submit → note the toast/banner. **Tango-record** the flow; export screenshots/PDF and share. (Optional: pop devtools to capture `data-testid`.)

| # | Target email | Expect (toast / banner) |
|---|--------------|--------------------------|
| **S1** | `lars.tice+uat-greenfield@gmail.com` | ✅ green toast: **"Invitation sent to lars.tice+uat-greenfield@gmail.com"** |
| **S2** ⭐ | `lars.tice+test3@gmail.com` | ✅ green toast: **"{name you typed} added to the organization"** (NO "invitation sent") |
| **S3** | `lars.tice+uat-deactivated@gmail.com` | ✅ green toast: **"{name} reactivated and added to the organization"** |
| **S4** | `lars.tice+uat-xorg-zombie@gmail.com` | ✅ green toast: **"Invitation sent to lars.tice+uat-xorg-zombie@gmail.com"** (graceful fallback) |
| **S5** | `lars.tice+test2@gmail.com` | ⛔ red error banner: **"User already exists in organization"** (409) |
| **S6** | `lars.tice+uat-xorg-member@gmail.com` | ⛔ red error banner: **cross-provider blocked** (422) |

⭐ S2 is the headline — the original PR #64 T2 bug (a same-org roleless user must be added directly, NOT issued a token).

## Notes
- The form may warn "this email already exists" for S2/S3/S5/S6 — **submit anyway**; the routing happens server-side.
- The toast `{name}` echoes what you type in First/Last name (not the stored name), so type something recognizable.
- After S2/S3 succeed, the new role appears in the roster (the list refreshes) — visual bonus confirmation.
- Do them in order S1→S6; tell me after each (or after all) and share the Tango export. I run the backend assertions after each.

## Fixture IDs (for my assertions — not needed by you)
- S2 +test3 = `2269bdb4-3ba5-4db0-bd5d-fc66cf8f9a88`
- S3 +uat-deactivated = `97b750a1-2621-4bf1-bbf5-91df16af8a29`
- S4 +uat-xorg-zombie = `841e6e80-13f5-4bf7-abb4-fd462766275e`
- S5 +test2 = `093c0e7b-5ace-49df-9632-d49858d54ef5`
- S6 +uat-xorg-member = `558ecba0-1111-450f-b6aa-646c87ca14e4`

## Results — EXECUTED 2026-07-01 · ALL 6 PASS ✅

Driver: Lars as `johnltice@yahoo.com` (provider_admin, TestOrg-20260329 = `2d0829ae-224b-4a79-ac3a-726b00d6c172`). Backend assertions via Mgmt API SQL (project `tmrjlswbsxmbglmaclxu`). Each scenario verified **frontend** (toast/banner) **and** **backend** (events + projections + negative checks).

| # | Routing action | Frontend | Backend evidence |
|---|----------------|----------|------------------|
| **S1** | greenfield → invite | toast "Invitation sent…" | new `invitations_projection` (pending, roles=[Aspen Med Viewer]); `user.invited`; **no** `users` row; corr-id shared invite↔event |
| **S2** ⭐ | same-org roleless → **direct assign** | toast "…added to the organization" | new `user_roles_projection` (0→1); `user.role.assigned`; **0** new invitations |
| **S3** | deactivated → reactivate + assign | toast "…reactivated and added…" | `is_active` false→true; `user.reactivated`; **0** invitations *(first attempt was an email typo → greenfield invite; re-run clean)* |
| **S4** | xorg **zombie** (0 roles) → fallback invite | toast "Invitation sent…" | new pending invitation in caller org; `user.invited`; zombie still **0** roles everywhere |
| **S5** | already-in-org → **409 no-op** | red banner "Failed to send invitation" | role count unchanged (1); **0** new role events/invitations; user unchanged |
| **S6** | xorg **member** (has role) → **422 block** | red banner "Failed to send invitation" | **0** role in caller org; **0** invitation (NOT invited); still Live for Life / Aspen Program Manager; **0** TestOrg membership |

**S4 vs S6 contrast confirmed**: zero-role zombie → invite fallback; role-holding member of another provider (Live for Life, no cross-tenant grant) → hard 422 block.

### Side-findings (spun off as seed cards; no functional defect)
- **`wireup-invite-form-email-status-lookup-seed.md`** — the invite form's email status-lookup is fully built but never invoked (`onEmailBlur` stub at `UsersManagePage.tsx:820-823`); no pre-submit feedback renders for any status (new/pending/deactivated/active/other-org).
- **`investigate-user-mgmt-notification-inconsistency-seed.md`** — dual feedback mechanism: success → floating Sonner toast; invite-failure → persistent inline `role="alert"` banner. UX/a11y inconsistency (known double-announce, comments at `:627/:652`).

Related doc fix shipped: `invitations_projection.md` scalar-`role` reconciliation (branch `docs/invitations-projection-drop-scalar-role`).
