/**
 * UserFormFields — email-lookup rendering and its accessibility contract.
 *
 * First test for this component. Its reason for existing is the live region:
 *
 * The lookup feedback used to mount `role="status" aria-live="polite"` **together
 * with its text**. Screen readers only announce changes to a region they were
 * already observing, so a region inserted in the same tick as its content is
 * routinely missed — which made the whole "couldn't check this email" honesty fix
 * sighted-users-only. The region is now always mounted and only its children swap.
 *
 * That is invisible to a human reviewer and trivially regressed by anyone
 * "simplifying" the conditional back. Hence the fence.
 *
 * Also fences the no-dead-affordances rule: a status carries an `actionLabel` only
 * when its handler is actually wired. Asserting on `data-testid` rather than copy so
 * wording changes don't break these.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { UserFormFields } from '../UserFormFields';
import type { EmailLookupResult, EmailLookupStatus, InviteUserFormData } from '@/types/user.types';
import type { Role } from '@/types/role.types';

const ROLE: Role = {
  id: 'r1',
  name: 'Clinician',
  description: '',
  organizationId: 'org-1',
  orgHierarchyScope: null,
  isActive: true,
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-01'),
};

const FORM: InviteUserFormData = {
  email: 'someone@example.com',
  firstName: '',
  lastName: '',
  roleIds: [],
  phones: [],
};

function verdict(
  status: Exclude<EmailLookupStatus, 'lookup_failed'>,
  over = {}
): EmailLookupResult {
  return {
    status,
    userId: null,
    invitationId: null,
    firstName: null,
    lastName: null,
    expiresAt: null,
    currentRoles: null,
    ...over,
  } as EmailLookupResult;
}

const FAILED: EmailLookupResult = { status: 'lookup_failed' };

function renderFields(over: Partial<React.ComponentProps<typeof UserFormFields>> = {}) {
  return render(
    <UserFormFields
      formData={FORM}
      onFieldChange={vi.fn()}
      onFieldBlur={vi.fn()}
      getFieldError={() => null}
      availableRoles={[ROLE]}
      onRoleToggle={vi.fn()}
      {...over}
    />
  );
}

/** The always-mounted live region. */
function liveRegion(): HTMLElement | null {
  return document.querySelector('[role="status"][aria-live="polite"]');
}

describe('UserFormFields — email lookup', () => {
  describe('live region (the load-bearing a11y contract)', () => {
    it('is mounted BEFORE any result exists', () => {
      // The whole point: the region must already be observed when content lands.
      renderFields({ emailLookup: null, isEmailLookupLoading: false });
      expect(liveRegion()).not.toBeNull();
      expect(liveRegion()?.textContent?.trim()).toBe('');
    });

    it('is the SAME region once a result arrives — content swaps, container does not', () => {
      const { rerender } = renderFields({ emailLookup: null });
      const before = liveRegion();
      expect(before).not.toBeNull();

      rerender(
        <UserFormFields
          formData={FORM}
          onFieldChange={vi.fn()}
          onFieldBlur={vi.fn()}
          getFieldError={() => null}
          availableRoles={[ROLE]}
          onRoleToggle={vi.fn()}
          emailLookup={verdict('not_found')}
        />
      );

      // Same node identity — if this fails the region was remounted with its
      // content and AT will not reliably announce it.
      expect(liveRegion()).toBe(before);
      expect(screen.getByTestId('email-lookup-not_found')).toBeTruthy();
    });

    it('has EXACTLY ONE live region — a nested one would double-announce', () => {
      // liveRegion() is querySelector, i.e. first match. Before this PR the inner
      // EmailLookupFeedback panel carried its own role="status" aria-live="polite";
      // if that were reintroduced, every other assertion here would still pass while
      // AT announced twice. Count, don't just find.
      renderFields({ emailLookup: verdict('active_member') });
      expect(document.querySelectorAll('[role="status"][aria-live="polite"]')).toHaveLength(1);
    });

    it('announces the in-flight state rather than leaving silence', () => {
      renderFields({ isEmailLookupLoading: true });
      expect(screen.getByTestId('email-lookup-checking')).toBeTruthy();
      expect(liveRegion()?.textContent).toMatch(/checking/i);
    });

    it('marks the spinner decorative and sets aria-busy on the input', () => {
      // A bare <svg aria-label> has no role="img", so the name may not be exposed;
      // the region carries the meaning instead.
      renderFields({ isEmailLookupLoading: true });
      expect(screen.getByTestId('email-lookup-spinner').getAttribute('aria-hidden')).toBe('true');
      expect(screen.getByPlaceholderText('user@example.com').getAttribute('aria-busy')).toBe(
        'true'
      );
    });

    it('shows the result, not the spinner, once loading finishes', () => {
      renderFields({ emailLookup: verdict('pending'), isEmailLookupLoading: false });
      expect(screen.queryByTestId('email-lookup-checking')).toBeNull();
      expect(screen.getByTestId('email-lookup-pending')).toBeTruthy();
    });
  });

  describe('per-status panels', () => {
    it.each<[Exclude<EmailLookupStatus, 'lookup_failed'>]>([
      ['not_found'],
      ['pending'],
      ['expired'],
      ['active_member'],
      ['deactivated'],
      ['other_org'],
    ])('renders the %s panel inside the live region', (status) => {
      renderFields({ emailLookup: verdict(status) });
      const panel = screen.getByTestId(`email-lookup-${status}`);
      expect(liveRegion()?.contains(panel)).toBe(true);
    });

    it('renders the failure panel for lookup_failed, NOT the not_found panel', () => {
      // The defect this whole epic exists to close: a failed lookup reading as a
      // confident "new user, go ahead and invite".
      renderFields({ emailLookup: FAILED });
      expect(screen.getByTestId('email-lookup-lookup_failed')).toBeTruthy();
      expect(screen.queryByTestId('email-lookup-not_found')).toBeNull();
    });

    it('hides the panel when the email field has a validation error', () => {
      renderFields({ emailLookup: verdict('pending'), getFieldError: () => 'Invalid email' });
      expect(screen.queryByTestId('email-lookup-pending')).toBeNull();
    });
  });

  describe('no dead affordances — a label only ships with its handler', () => {
    it('offers a working retry on lookup_failed', () => {
      const onSuggestedAction = vi.fn();
      renderFields({ emailLookup: FAILED, onSuggestedAction });

      const btn = screen.getByTestId('email-lookup-action-lookup_failed');
      btn.click();

      expect(onSuggestedAction).toHaveBeenCalledWith('retry');
    });

    it('keeps the retry button mounted and focused while the re-check runs', () => {
      // Retry lives INSIDE the live region. Swapping the panel for the "checking"
      // line on activation would unmount the button the user just pressed and drop
      // focus to <body> (command-feedback.md §Focus, WCAG 2.4.3). The panel stays;
      // the button disables instead.
      const { rerender } = renderFields({ emailLookup: FAILED, onSuggestedAction: vi.fn() });
      const btn = screen.getByTestId('email-lookup-action-lookup_failed');
      btn.focus();
      expect(document.activeElement).toBe(btn);

      rerender(
        <UserFormFields
          formData={FORM}
          onFieldChange={vi.fn()}
          onFieldBlur={vi.fn()}
          getFieldError={() => null}
          availableRoles={[ROLE]}
          onRoleToggle={vi.fn()}
          emailLookup={FAILED}
          isEmailLookupLoading
          onSuggestedAction={vi.fn()}
        />
      );

      const after = screen.getByTestId('email-lookup-action-lookup_failed') as HTMLButtonElement;
      expect(after).toBe(btn); // same node — not remounted
      expect(document.activeElement).toBe(after); // focus survived
      expect(after.disabled).toBe(true); // and it can't be double-fired
    });

    it.each<[Exclude<EmailLookupStatus, 'lookup_failed'>]>([
      ['pending'],
      ['expired'],
      ['active_member'],
      ['deactivated'],
      ['other_org'],
    ])('renders NO button for %s even when a handler is supplied', (status) => {
      // Supplying the handler is what would resurrect these: the button renders on
      // `actionLabel && onAction`. Their labels are deliberately blank until their
      // commands are wired — see EMAIL_STATUS_CONFIG for the per-status reason.
      renderFields({ emailLookup: verdict(status), onSuggestedAction: vi.fn() });
      expect(screen.queryByTestId(`email-lookup-action-${status}`)).toBeNull();
    });

    it('renders no button at all when no handler is supplied', () => {
      renderFields({ emailLookup: FAILED });
      expect(screen.queryByTestId('email-lookup-action-lookup_failed')).toBeNull();
    });
  });

  describe('field locking', () => {
    it.each<[Exclude<EmailLookupStatus, 'lookup_failed'>, boolean]>([
      ['active_member', true],
      ['pending', true],
      ['not_found', false],
      ['expired', false],
      ['deactivated', false],
      ['other_org', false],
    ])('%s → name fields disabled: %s', (status, locked) => {
      renderFields({ emailLookup: verdict(status) });
      const first = screen.getByPlaceholderText('John') as HTMLInputElement;
      expect(first.disabled).toBe(locked);
    });

    it('does NOT lock fields on lookup_failed — it is not a verdict', () => {
      renderFields({ emailLookup: FAILED });
      expect((screen.getByPlaceholderText('John') as HTMLInputElement).disabled).toBe(false);
    });

    it('leaves the email field editable even when names are locked', () => {
      // Otherwise a mistyped active-member address would be unrecoverable.
      renderFields({ emailLookup: verdict('active_member') });
      expect((screen.getByPlaceholderText('user@example.com') as HTMLInputElement).disabled).toBe(
        false
      );
    });
  });
});
