/**
 * PlatformNoOrgContextBanner — accessibility + contract.
 *
 * Fences that the honest-state banner is an informational region (role="note",
 * NOT the assertive role="alert" command-feedback banner) and exposes the `id`
 * that disabled write buttons reference via `aria-describedby` — the reachable
 * explanation a disabled button's tooltip cannot provide.
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PlatformNoOrgContextBanner } from '../PlatformNoOrgContextBanner';

describe('PlatformNoOrgContextBanner', () => {
  it('renders as an informational note (role="note", not alert)', () => {
    render(<PlatformNoOrgContextBanner />);
    const banner = screen.getByTestId('platform-no-org-banner');
    expect(banner.getAttribute('role')).toBe('note');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('carries the default aria-describedby anchor id', () => {
    render(<PlatformNoOrgContextBanner />);
    expect(screen.getByTestId('platform-no-org-banner').id).toBe('platform-no-org-banner');
  });

  it('honors a custom id (so callers can wire aria-describedby)', () => {
    render(<PlatformNoOrgContextBanner id="custom-anchor" />);
    expect(screen.getByTestId('platform-no-org-banner').id).toBe('custom-anchor');
  });

  it('explains the no-active-organization state honestly', () => {
    render(<PlatformNoOrgContextBanner />);
    expect(screen.getByTestId('platform-no-org-banner').textContent).toMatch(
      /no active organization/i
    );
  });
});
