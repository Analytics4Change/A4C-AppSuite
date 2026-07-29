---
status: current
last_updated: 2026-07-28
---

<!-- TL;DR-START -->
## TL;DR

**Summary**: Informational page-level banner shown when the caller is a platform administrator with no active organization; explains why org-scoped write affordances (e.g. Invite User) are disabled instead of surfacing a cryptic Edge Function 403.

**When to read**:
- Gating org-scoped write actions for platform admins
- Understanding the `platform_owner && !org_id` state gate
- Wiring `aria-describedby` from disabled buttons to a reachable explanation

**Prerequisites**: `usePlatformNoOrgContext` hook; the Permission Gating Convention (frontend/CLAUDE.md)

**Key topics**: `platform-owner`, `state-gate`, `accessibility`, `aria-describedby`, `honest-ux`

**Estimated read time**: 3 minutes
<!-- TL;DR-END -->

# PlatformNoOrgContextBanner

## Overview

`PlatformNoOrgContextBanner` is a static, informational notice rendered on organization-management pages when the caller is a **platform administrator with no active organization** (`org_type === 'platform_owner'` with an empty `org_id` — see `usePlatformNoOrgContext`). In that state every org-scoped write is rejected at the Edge Function preflight with HTTP 403 `"No organization context in token"`. Rather than let the caller fire a doomed request and read a cryptic error, the surface **disables** the write affordances and renders this banner to explain why.

It is rendered as `role="note"` — a persistent informational region — and is deliberately **not** the assertive `role="alert"` command-feedback banner (`CommandFeedbackBanner`), which is reserved for command *results* and would hijack the screen-reader live region on every render. Its `id` is the anchor that disabled buttons reference via `aria-describedby`, providing the reachable explanation a `disabled` button's tooltip cannot.

This is distinct from the impersonation *session* banner (`ImpersonationBanner`), shown while actively impersonating. It is the natural future launch point for the (currently scaffolded, not-yet-functional) impersonation flow.

## Props and Usage

```typescript
interface PlatformNoOrgContextBannerProps {
  // DOM id for the banner, used as the aria-describedby target of the disabled
  // write buttons it explains. Defaults to "platform-no-org-banner".
  id?: string;

  // Optional extra classes appended to the banner container.
  className?: string;
}
```

## Usage Examples

### Gating an org-scoped write affordance

```tsx
import { usePlatformNoOrgContext } from '@/hooks/usePlatformNoOrgContext';
import { PlatformNoOrgContextBanner } from '@/components/users/PlatformNoOrgContextBanner';

const UsersManagePage = () => {
  const platformNoOrg = usePlatformNoOrgContext();

  return (
    <>
      <Button
        onClick={handleCreateClick}   // guards: `if (platformNoOrg) return;`
        // NOTE: aria-disabled, NOT native `disabled`, for the no-org gate — a
        // natively-disabled button leaves the tab order, so its aria-describedby
        // banner would never be announced at focus. Keep it focusable.
        aria-disabled={platformNoOrg || undefined}
        aria-describedby={platformNoOrg ? 'platform-no-org-banner' : undefined}
        data-testid="invite-user-btn"
      >
        Invite New User
      </Button>

      {platformNoOrg && <PlatformNoOrgContextBanner />}
    </>
  );
};
```

## Accessibility

### WCAG 2.1 Level AA Compliance

- **Informational region**: `role="note"` (persistent state), NOT `role="alert"` — it must not hijack the assertive live region reserved for command results.
- **Reachable explanation**: a natively-`disabled` button is removed from the tab order, so a `title` tooltip on it is unreachable and any `aria-describedby` never fires at focus. Gated write buttons therefore use **`aria-disabled="true"` (keeping them focusable) rather than the native `disabled` attribute**, guard their click handler (`if (platformNoOrg) return;`), and point `aria-describedby` at this banner's `id` — so keyboard/AT users land on the button and hear the explanation.
- **Icon**: the leading icon is decorative (`aria-hidden="true"`); the text carries all meaning (color is not the sole signal).

## Testing

### Unit Tests

Key test cases (`src/components/users/__tests__/PlatformNoOrgContextBanner.test.tsx`):
- ✅ Renders as `role="note"` (and no `role="alert"` is present)
- ✅ Carries the default `id` (`platform-no-org-banner`) for `aria-describedby`
- ✅ Honors a custom `id`
- ✅ Explains the no-active-organization state honestly

## Related Components

- **usePlatformNoOrgContext** (`hooks/usePlatformNoOrgContext.ts`) — the state predicate this banner accompanies
- **ImpersonationBanner** — the distinct impersonation *session* banner (shown while impersonating)
- **CommandFeedbackBanner** — the assertive command-*result* banner (do not confuse)

## Related Documentation

- `../../../../frontend/src/contexts/CLAUDE.md` — the `platform_owner && !org_id` boundary rule
- `../../../architecture/authentication/impersonation-architecture.md` — where acting-as-an-org is deferred

## Changelog

- **2026-07-28**: Initial documentation created (honest-UX gate for platform-admin no-org state).
