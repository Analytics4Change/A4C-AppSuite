/**
 * Email normalization in OrganizationFormViewModel.
 *
 * ## What this is guarding
 *
 * This ViewModel heads the org-bootstrap chain, which normalized email at ZERO
 * of its five layers:
 *
 *   OrganizationFormViewModel  -> no trim, no lower
 *   organization-bootstrap EF  -> no email regex at all
 *   generate-invitations       -> raw into the idempotency probe AND the event
 *   handle_user_invited        -> raw INSERT
 *   invitations_projection     -> mixed-case row
 *
 * A mixed-case row was then invisible to its own invitee under the
 * `invitations_user_own_select` RLS policy, and fatal on the
 * accept-invitation "already registered" retry branch.
 *
 * Migration `20260730045737` now canonicalizes at the database, but this is the
 * layer that should not have been sending dirty values in the first place — and
 * its sibling `UserFormViewModel` has trimmed at the equivalent point all along.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { OrganizationFormViewModel } from '../OrganizationFormViewModel';

vi.mock('sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

describe('OrganizationFormViewModel email normalization', () => {
  let viewModel: OrganizationFormViewModel;

  beforeEach(() => {
    viewModel = new OrganizationFormViewModel();
  });

  it('normalizes the provider-admin email in the transformed contact', () => {
    viewModel.updateField('providerAdminContact', {
      ...viewModel.formData.providerAdminContact,
      firstName: 'Bob',
      lastName: 'Smith',
      email: '  BoB@Example.COM  ',
    });

    // transformContact is private; reach it through the public transform surface.
    const transformed = (
      viewModel as unknown as {
        transformContact: (c: unknown) => { email: string };
      }
    ).transformContact(viewModel.formData.providerAdminContact);

    expect(transformed.email).toBe('bob@example.com');
  });

  it('leaves an already-canonical address untouched', () => {
    const transformed = (
      viewModel as unknown as {
        transformContact: (c: unknown) => { email: string };
      }
    ).transformContact({
      firstName: 'Bob',
      lastName: 'Smith',
      email: 'bob@example.com',
      type: 'provider_admin',
    });

    expect(transformed.email).toBe('bob@example.com');
  });

  it('keeps the raw value in formData so the input does not fight the user', () => {
    // Normalization belongs on the wire, not in the bound field — rewriting the
    // input mid-type is a worse experience than sending a canonical value.
    viewModel.updateField('providerAdminContact', {
      ...viewModel.formData.providerAdminContact,
      email: '  BoB@Example.COM  ',
    });
    expect(viewModel.formData.providerAdminContact.email).toBe('  BoB@Example.COM  ');
  });
});
