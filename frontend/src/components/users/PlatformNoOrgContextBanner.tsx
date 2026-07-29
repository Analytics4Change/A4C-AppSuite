/**
 * PlatformNoOrgContextBanner
 *
 * Static, informational page-level notice shown when the caller is a platform
 * administrator with no active organization (see `usePlatformNoOrgContext`).
 * It explains, honestly, why the org-scoped write affordances on the page are
 * disabled — replacing the otherwise-cryptic Edge Function 403
 * `"No organization context in token"`.
 *
 * Rendered as `role="note"` (a persistent informational region) — deliberately
 * NOT the assertive `role="alert"` command-feedback banner
 * (`CommandFeedbackBanner`), which is reserved for command *results* and would
 * hijack the screen-reader live region on every render.
 *
 * Its `id` is the anchor that disabled write buttons reference via
 * `aria-describedby`, so a keyboard/AT user reaches the explanation the
 * unreachable tooltip of a `disabled` button cannot provide.
 *
 * This is distinct from the impersonation *session* banner
 * (`components/auth/ImpersonationBanner.tsx`, shown while actively
 * impersonating). It is the natural future launch point for the (currently
 * scaffolded, not-yet-functional) impersonation flow — see
 * `documentation/architecture/authentication/impersonation-architecture.md`.
 */

import React from 'react';
import { Info } from 'lucide-react';

export interface PlatformNoOrgContextBannerProps {
  /**
   * DOM id for the banner, used as the `aria-describedby` target of the
   * disabled write buttons it explains. Defaults to `platform-no-org-banner`.
   */
  id?: string;
  /** Optional extra classes appended to the banner container. */
  className?: string;
}

export const PlatformNoOrgContextBanner: React.FC<PlatformNoOrgContextBannerProps> = ({
  id = 'platform-no-org-banner',
  className,
}) => {
  return (
    <div
      id={id}
      role="note"
      data-testid="platform-no-org-banner"
      className={`p-4 rounded-lg border border-blue-300 bg-blue-50${className ? ` ${className}` : ''}`}
    >
      <div className="flex items-start gap-3">
        <Info className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" aria-hidden="true" />
        <div className="flex-1">
          <h3 className="text-blue-800 font-semibold">
            Platform administrator — no active organization
          </h3>
          <p className="text-blue-700 text-sm mt-1">
            You&apos;re signed in as a platform administrator with no active organization. Managing
            an organization&apos;s users isn&apos;t available from here yet — acting on a specific
            organization will use the impersonation flow (in progress).
          </p>
        </div>
      </div>
    </div>
  );
};
