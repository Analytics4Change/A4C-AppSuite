---
status: PASSED (2026-07-31) — 8/8 automated scenarios
last_updated: 2026-07-31
---

# UAT runbook — PR A, honest invitation links

Branch `feat/honest-superseded-invitation-links`. All five commits are deployed to dev
(migrations via `db push`, Edge Functions via `supabase functions deploy` — see the
deploy-clock pitfall for why both were needed).

**Caller org**: TestOrg-20260329 (`2d0829ae-224b-4a79-ac3a-726b00d6c172`).
**Accept URL shape**: `https://a4c.firstovertheline.com/accept-invitation?token=<token>`
(the platform host — verified during the epic UAT that it serves tenant invitations
correctly; that is *not* a defect and should not be re-opened).

## What PR A changed, and therefore what must be proven

| Commit | Claim to prove |
|---|---|
| `92901af3` | A revoked invitation is **not acceptable**, and is reported as *withdrawn* |
| `e6adf2b7` | The token is **write-once** — a resend does not kill links already sent |
| `c7c826fa` | `api.resend_invitation` retired (no UI surface; nothing to exercise here) |
| `0f044892` | The accept page says **why** a link failed, and never renders the form when it can't be used |

## Scenarios

`reason` is read from `data-reason` on `[data-testid="invitation-unusable"]`, so these
assert the actual discriminant rather than prose.

| # | Fixture | Setup | Expect `reason` | Copy | Form renders? |
|---|---|---|---|---|---|
| **P1** | `+uat-greenfield` | none — already valid | *(no panel)* | — | **YES** |
| **P2** ⭐ | `+uat-xorg-zombie` | already revoked, clock still live | `revoked` | "This invitation was withdrawn" | **NO** |
| **P3** | `+uat-pra` | `pending`, `expires_at` in the past (lazy expiry) | `expired` | "This invitation has expired" | **NO** |
| **P4** | `+uat-pra` | `status='expired'` | `expired` | same | **NO** |
| **P5** | `+test3` | already accepted | `accepted` | "already been used" | **NO** |
| **P6** | random string | none | `unknown` | "isn't valid" | **NO** |
| **P7** | *no* `?token=` | none | `unknown` | "isn't valid" | **NO** |
| **P8** ⭐ | `+uat-greenfield` | note URL → resend → **reuse the same URL** | *(no panel)* | — | **YES** |

⭐ **P2 is the security headline.** Before commit 1 this invitation was fully acceptable:
the token was live, the clock was fine, and nothing on the accept path consulted `status`.
It must now be refused *and* honestly described.

⭐ **P8 is the write-once headline.** Before commit 2 a resend rotated the token, so the
link already in someone's inbox died silently. The same URL must keep working.

P3 and P4 are separate deliberately — they exercise different branches of
`api.get_invitation_token_state` (lazy expiry via the clock vs. an explicit `status`), and
only the first is reachable in normal operation.

## Out of scope, and why

- **Actually submitting the form** (creating an account) — requires entering a password,
  which is the operator's step, not the agent's. Covered instead by
  `checkInvitationUsable` unit tests, and by P2 proving the form never renders for a
  revoked invitation, so the submit path is unreachable for it.
- **The accept-failure command-feedback banner** (`role="alert"` + echo + focus) — needs a
  *failed submit*, so it needs the account-creation step. Unit-covered; flagged below for
  an operator pass.

## Results — RUN 2026-07-31 ✅ 8/8 PASS

Verdicts read from `data-reason` on `[data-testid="invitation-unusable"]`, not from prose.

| # | Fixture | `reason` | Copy rendered | Form? | |
|---|---|---|---|---|---|
| P1 | `+uat-greenfield` | *(none)* | — | **YES** | ✅ |
| **P2** ⭐ | `+uat-xorg-zombie` | `revoked` | "This invitation was withdrawn" | no | ✅ |
| P3 | `+uat-pra` (clock) | `expired` | "This invitation has expired" | no | ✅ |
| P4 | `+uat-pra` (`status`) | `expired` | same | no | ✅ |
| P5 | `+test3` | `accepted` | "already been used" | no | ✅ |
| P6 | bogus token | `unknown` | "isn't valid" | no | ✅ |
| P7 | no `?token=` | `unknown` | "isn't valid" | no | ✅ |
| **P8** ⭐ | `+uat-greenfield` | *(none)* | — | **YES** | ✅ |

**P2** — that token had a live clock and was never accepted. Before commit 1 nothing on
the accept path consulted `status`, so it was fully acceptable. It is now refused *and*
described accurately.

**P8** — captured the URL, resent through the UI, then re-opened **the same URL**. Token
byte-identical, expiry advanced to 2026-08-07, form renders. The defect that started this
investigation is gone.

**P6 also checks non-disclosure**: a bogus token leaks no org name to an unauthenticated
caller (`leaksOrgName: false`).

**P3 vs P4** exercise both classifier branches — lazy clock expiry and explicit
`status='expired'` — and agree.

### How it was run, and one thing that surprised me

The frontend was run **locally** (`npm run dev`, :3000) against the **deployed** dev Edge
Functions and migrations. `a4c.firstovertheline.com` serves the last *merged* frontend
build, so the new page code is not there — the first P1 attempt hit the old bundle and
reported `formRenders:false` purely because the old markup has no testids.

That is the deploy-clock pitfall in a **third** variant: the frontend is another clock,
alongside migrations (`db push`) and Edge Functions (merge). Worth extending the pitfall
write-up, which currently names only two.

Also worth noting for whoever re-runs this: calling
`api.get_invitation_token_state(token)` in the **same statement** as an `UPDATE` returns
the pre-update classification — the function is `STABLE`, so it reads the statement's
snapshot. Verify in a separate statement or you will misread a correct classifier as broken.

### Fixture state after the run

Both `+uat-pra` and `+uat-greenfield` restored to `pending` / `valid`. `+uat-pra` is a new
fixture created for this run and can stay as a spare valid invitation.

### Not covered — needs an operator

Both require creating an account (entering a password), which is the operator's step:

- **Submitting a valid invitation** end to end.
- **The accept-failure command-feedback banner** — `role="alert"` + `aria-hidden` echo +
  focus-to-banner + dismiss-restores-focus. Needs a *failed* submit; the orphan-collision
  fixtures (`stale-uat-fixture-users-without-auth-identity`) are the natural trigger, since
  that path now returns 500 `PROCESSING_FAILED`.

  Unit coverage exists (`checkInvitationUsable`, the ViewModel reason tests), and P2 proves
  the form never renders for a revoked invitation, so that submit path is unreachable — but
  the banner's a11y contract is genuinely unexercised.
