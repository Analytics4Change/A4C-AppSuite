---
status: seed
last_updated: 2026-06-15
---

# Seed: Org-HQ → user contact copy/mirror affordance (solo/family providers)

**Origin**: Parked follow-up from PR #78 (per-user org-override removal). See `~/.claude/plans/spicy-dreaming-crystal.md` § Parked follow-up #1 and `memory/pr-78-close-out.md`.

## Problem / opportunity
For small/family-based providers, the "organization" is effectively one individual's home — the org HQ phone/address is the **same** as the person's. With per-user org-overrides removed, user phones/addresses are global; representing the shared value means entering it twice (once as org HQ in `phones_projection`/`addresses_projection`, once as the user's in `user_phones`/`user_addresses`). No uniqueness precludes the duplicate (verified PR #78) — it's purely a double-data-entry UX cost.

## Proposed (additive feature; NOT a revival of org-override tables)
An opt-in "use org HQ phone/address for this user" copy (or link) on user contact entry. Precedent:
- Org onboarding form's "Use General Information for Address/Phone" copy checkboxes (`organization-management-architecture.md`).
- Existing mirror mechanism: `user_phones.source_contact_phone_id` + `contacts_projection` (carries both `organization_id` and `user_id`).

## Decisions to make
- Copy (snapshot) vs link (live sync)? Copy is simpler; link needs a sync trigger.
- Which entry points (user onboarding, manage-user phone/address add).
- Scope to provider orgs where `type='provider'` + single-user, or offer broadly.

## Not started. Low priority unless solo/family-provider onboarding UX is prioritized.
