/**
 * UserFormViewModel — email-lookup ownership, gating, and the staleness traps.
 *
 * PR B moved the lookup here from `UsersViewModel` so that one object owns the
 * call, the in-flight flag, the result, the repeat-blur memo and the staleness
 * guard. These tests fence the parts that are easy to regress and expensive to
 * notice:
 *
 *  - **Fail-open gating.** `lookup_failed` means "we could not find out", never a
 *    verdict. It must never block submission — the server re-checks before routing.
 *  - **The staleness trap.** Before PR B, editing the email left a stale verdict in
 *    place. Since `shouldDisableFields` locks name/role on active_member|pending and
 *    `canSubmit` blocks on active_member, that trapped the admin in a form they
 *    could not edit their way out of.
 *  - **Edit-during-flight.** The guard is keyed on the email string, not a counter:
 *    a counter admits the late response because it IS the latest one.
 *  - **The harvested name.** A prefilled name from a mistyped address must not
 *    survive the correction and submit as someone else.
 *
 * Unit-level (plain construction, no React) per the §S2 guidance to test the VM as
 * the unit of MobX logic rather than reaching through a page fixture.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { UserFormViewModel } from '../UserFormViewModel';
import type { IUserQueryService } from '@/services/users/IUserQueryService';
import type { EmailLookupResult, EmailLookupStatus, RoleReference } from '@/types/user.types';

const ROLES: RoleReference[] = [{ roleId: 'r1', roleName: 'Clinician' }];

/**
 * Minimal query-service stub — only checkEmailStatus is exercised.
 *
 * `satisfies Pick<…>` keeps the one stubbed method type-checked against the real
 * interface, so a signature change (e.g. making correlationId required) fails here
 * rather than being swallowed by a blind `as unknown as` cast.
 */
function stubService(impl: (email: string) => Promise<EmailLookupResult>) {
  const stub = { checkEmailStatus: vi.fn(impl) } satisfies Pick<
    IUserQueryService,
    'checkEmailStatus'
  >;
  return stub as unknown as IUserQueryService;
}

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

/**
 * Every status, exhaustively — a `Record` keyed on the union, so adding an eighth
 * member is a COMPILE error here rather than a silently-skipped matrix row. That
 * gap is what let `suggestedAction`'s missing `lookup_failed` case survive.
 */
const BLOCKS_SUBMIT: Record<EmailLookupStatus, boolean> = {
  not_found: false,
  pending: false,
  expired: false,
  active_member: true,
  deactivated: false,
  other_org: false,
  lookup_failed: false,
};

/** A form filled well enough that only the lookup can block submission. */
function validForm(vm: UserFormViewModel, email = 'someone@example.com') {
  vm.updateField('email', email);
  vm.updateField('firstName', 'Ada');
  vm.updateField('lastName', 'Lovelace');
  vm.toggleRole('r1');
}

describe('UserFormViewModel — email lookup', () => {
  let vm: UserFormViewModel;

  beforeEach(() => {
    vi.clearAllMocks();
    vm = new UserFormViewModel(ROLES, 'create');
  });

  describe('gating — lookup_failed must fail OPEN', () => {
    it('canSubmit stays true on lookup_failed', () => {
      validForm(vm);
      vm.setEmailLookupResult(FAILED);
      expect(vm.canSubmit).toBe(true);
    });

    it('canSubmit is false on active_member', () => {
      validForm(vm);
      vm.setEmailLookupResult(verdict('active_member', { userId: 'u1' }));
      expect(vm.canSubmit).toBe(false);
    });

    it('canSubmit is false while a lookup is in flight', () => {
      validForm(vm);
      vm.setIsCheckingEmail(true);
      expect(vm.canSubmit).toBe(false);
    });

    it.each(Object.entries(BLOCKS_SUBMIT) as Array<[EmailLookupStatus, boolean]>)(
      '%s → blocks submit: %s',
      (status, blocks) => {
        validForm(vm);
        vm.setEmailLookupResult(
          status === 'lookup_failed'
            ? FAILED
            : verdict(status as Exclude<EmailLookupStatus, 'lookup_failed'>)
        );
        expect(vm.canSubmit).toBe(!blocks);
      }
    );

    it('suggestedAction is none for lookup_failed (no action to suggest)', () => {
      vm.setEmailLookupResult(FAILED);
      expect(vm.suggestedAction).toBe('none');
    });
  });

  describe('staleness — editing the email invalidates the verdict', () => {
    it('clears the result when the email changes', () => {
      validForm(vm, 'active@org.com');
      vm.setEmailLookupResult(verdict('active_member', { userId: 'u1' }));
      expect(vm.emailLookupResult).not.toBeNull();

      vm.updateField('email', 'someone-else@org.com');

      expect(vm.emailLookupResult).toBeNull();
      // ...which is what releases the form: canSubmit was false a moment ago.
      expect(vm.canSubmit).toBe(true);
    });

    it('does NOT clear when a different field changes', () => {
      validForm(vm);
      vm.setEmailLookupResult(verdict('pending', { invitationId: 'inv-1' }));
      vm.updateField('firstName', 'Grace');
      expect(vm.emailLookupResult?.status).toBe('pending');
    });

    it('does NOT clear when the email is re-set to the same value', () => {
      validForm(vm, 'same@org.com');
      vm.setEmailLookupResult(verdict('pending'));
      vm.updateField('email', 'same@org.com');
      expect(vm.emailLookupResult?.status).toBe('pending');
    });

    it('reverts a name the LOOKUP prefilled', () => {
      // Fresh form: no admin-typed name, so the lookup's name lands.
      vm.updateField('email', 'active@org.com');
      vm.setEmailLookupResult(
        verdict('active_member', { userId: 'u1', firstName: 'Someone', lastName: 'Else' })
      );
      expect(vm.formData.firstName).toBe('Someone');

      vm.updateField('email', 'corrected@org.com');

      // The other person's name must not survive the correction and submit.
      expect(vm.formData.firstName).toBe('');
      expect(vm.formData.lastName).toBe('');
    });

    it('does NOT revert a prefilled name the admin then EDITED', () => {
      // The case the sibling test below misses: it types the name BEFORE the lookup,
      // so the prefill never fires and the flag is never set. Here the lookup DOES
      // prefill, the admin overwrites it (nothing locks the field for other_org),
      // and the correction must survive the email change.
      vm.updateField('email', 'external@other.com');
      vm.setEmailLookupResult(
        verdict('other_org', { userId: 'u9', firstName: 'External', lastName: 'User' })
      );
      expect(vm.formData.firstName).toBe('External');

      vm.updateField('firstName', 'Alice'); // admin takes ownership
      vm.updateField('email', 'corrected@other.com');

      expect(vm.formData.firstName).toBe('Alice');
      // lastName was never overwritten, so it is still the lookup's — and reverts.
      expect(vm.formData.lastName).toBe('');
    });

    it('does NOT revert a name the ADMIN typed', () => {
      validForm(vm, 'active@org.com'); // types Ada Lovelace
      vm.setEmailLookupResult(
        verdict('active_member', { userId: 'u1', firstName: 'Someone', lastName: 'Else' })
      );
      // Pre-fill only fills BLANK fields, so the admin's name stands.
      expect(vm.formData.firstName).toBe('Ada');

      vm.updateField('email', 'corrected@org.com');

      expect(vm.formData.firstName).toBe('Ada');
      expect(vm.formData.lastName).toBe('Lovelace');
    });

    it('reset() clears result, in-flight flag and the memo', () => {
      validForm(vm);
      vm.setEmailLookupResult(verdict('pending'));
      vm.setIsCheckingEmail(true);
      vm.reset();
      expect(vm.emailLookupResult).toBeNull();
      expect(vm.isCheckingEmail).toBe(false);
    });
  });

  describe('normalization — the key must match what the RPC compares', () => {
    it('probes the TRIMMED address', async () => {
      // validateEmail trims before validating, so " bob@org.com" is a valid address
      // with no field error — but the RPCs compare with bare `=`, so probing the
      // untrimmed value matches nothing and renders a confident "new user" panel
      // for someone who may be an active member.
      const svc = stubService(async () => verdict('active_member', { userId: 'u1' }));
      vm.updateField('email', '  bob@org.com  ');

      await vm.checkEmailStatus(svc);

      expect(svc.checkEmailStatus).toHaveBeenCalledWith('bob@org.com');
      expect(vm.emailLookupResult?.status).toBe('active_member');
    });

    it('writes the verdict despite surrounding whitespace in the field', async () => {
      // Regression fence: trimming only the outgoing value, while still comparing
      // the response against the RAW field, would discard every response and never
      // write a verdict at all.
      const svc = stubService(async () => verdict('pending', { invitationId: 'i1' }));
      vm.updateField('email', ' pending@org.com ');
      await vm.checkEmailStatus(svc);
      expect(vm.emailLookupResult?.status).toBe('pending');
    });

    it('treats a whitespace-only edit as the same address (memo holds)', async () => {
      const svc = stubService(async () => verdict('not_found'));
      vm.updateField('email', 'same@org.com');
      await vm.checkEmailStatus(svc);
      vm.updateField('email', '  same@org.com  ');
      await vm.checkEmailStatus(svc);
      expect(svc.checkEmailStatus).toHaveBeenCalledTimes(1);
    });
  });

  describe('checkEmailStatus — orchestration', () => {
    it('stores the verdict and clears the in-flight flag', async () => {
      const svc = stubService(async () => verdict('active_member', { userId: 'u1' }));
      validForm(vm, 'active@org.com');

      await vm.checkEmailStatus(svc);

      expect(svc.checkEmailStatus).toHaveBeenCalledWith('active@org.com');
      expect(vm.emailLookupResult?.status).toBe('active_member');
      expect(vm.isCheckingEmail).toBe(false);
    });

    it('skips the probe for an email too short to be one', async () => {
      const svc = stubService(async () => verdict('not_found'));
      vm.updateField('email', 'a@');
      await vm.checkEmailStatus(svc);
      expect(svc.checkEmailStatus).not.toHaveBeenCalled();
    });

    it('does not re-probe the same address twice (blur fires often; 3 RPCs each)', async () => {
      const svc = stubService(async () => verdict('not_found'));
      validForm(vm, 'stable@org.com');

      await vm.checkEmailStatus(svc);
      await vm.checkEmailStatus(svc);

      expect(svc.checkEmailStatus).toHaveBeenCalledTimes(1);
    });

    it('DOES re-probe after lookup_failed — retry must work', async () => {
      // The whole point of the "Try again" button. Memoising a failure would make
      // it permanent for that address and leave the button unable to do anything.
      const svc = stubService(async () => FAILED);
      validForm(vm, 'flaky@org.com');

      await vm.checkEmailStatus(svc);
      await vm.checkEmailStatus(svc);

      expect(svc.checkEmailStatus).toHaveBeenCalledTimes(2);
    });

    it('re-probes once the address changes', async () => {
      const svc = stubService(async () => verdict('not_found'));
      validForm(vm, 'first@org.com');
      await vm.checkEmailStatus(svc);

      vm.updateField('email', 'second@org.com');
      await vm.checkEmailStatus(svc);

      expect(svc.checkEmailStatus).toHaveBeenCalledTimes(2);
    });
  });

  describe('concurrency — one probe per address at a time', () => {
    it('does not stack a second probe for an address already in flight', async () => {
      // Reachable via edit-away-and-back (which clears the result, defeating the
      // memo) and via repeat retry clicks. Two same-address probes cannot be told
      // apart by value-keying, so the first to finish would clear the in-flight flag
      // while the second was still out — aria-busy, spinner and canSubmit all
      // reading "idle" while a late verdict could still land and re-lock the form.
      const pending: Array<(r: EmailLookupResult) => void> = [];
      const svc = stubService(() => new Promise<EmailLookupResult>((res) => pending.push(res)));

      validForm(vm, 'a@org.com');
      const first = vm.checkEmailStatus(svc);
      const second = vm.checkEmailStatus(svc); // same address, still in flight

      expect(svc.checkEmailStatus).toHaveBeenCalledTimes(1);

      pending[0](verdict('not_found'));
      await Promise.all([first, second]);
      expect(vm.isCheckingEmail).toBe(false);
    });
  });

  describe('edit-during-flight — the case a sequence counter misses', () => {
    it('discards a response whose address is no longer in the form', async () => {
      let release!: (r: EmailLookupResult) => void;
      const svc = stubService(() => new Promise<EmailLookupResult>((res) => (release = res)));

      validForm(vm, 'typo@org.com');
      const inFlight = vm.checkEmailStatus(svc);

      // Admin corrects the address while the probe is still out.
      vm.updateField('email', 'correct@org.com');

      // The original response lands. It IS the latest response — a monotonic
      // counter would accept it. Value-keying rejects it.
      release(verdict('active_member', { userId: 'u1', firstName: 'Someone' }));
      await inFlight;

      expect(vm.emailLookupResult).toBeNull();
      expect(vm.formData.firstName).toBe('Ada');
      expect(vm.canSubmit).toBe(true);
    });

    it('a discarded stale response does not wipe a newer valid verdict', async () => {
      // The failure mode of a naive "on stale, clear everything" guard.
      let releaseStale!: (r: EmailLookupResult) => void;
      const slow = stubService(() => new Promise<EmailLookupResult>((res) => (releaseStale = res)));

      validForm(vm, 'typo@org.com');
      const stale = vm.checkEmailStatus(slow);

      vm.updateField('email', 'correct@org.com');
      vm.setEmailLookupResult(verdict('not_found')); // newer verdict lands first

      releaseStale(verdict('active_member', { userId: 'u1' }));
      await stale;

      expect(vm.emailLookupResult?.status).toBe('not_found');
    });

    it('a stale response does NOT clear the flag a newer probe owns', async () => {
      // Flag ownership follows the lookup, not the form field. A stale response
      // must not make a live probe look finished.
      const pending: Array<(r: EmailLookupResult) => void> = [];
      const svc = stubService(() => new Promise<EmailLookupResult>((res) => pending.push(res)));

      validForm(vm, 'typo@org.com');
      const stale = vm.checkEmailStatus(svc);

      vm.updateField('email', 'correct@org.com');
      const live = vm.checkEmailStatus(svc); // newer probe takes ownership

      pending[0](verdict('active_member', { userId: 'u1' })); // stale lands first
      await stale;
      expect(vm.isCheckingEmail).toBe(true); // live probe still running

      pending[1](verdict('not_found'));
      await live;
      expect(vm.isCheckingEmail).toBe(false);
      expect(vm.emailLookupResult?.status).toBe('not_found');
    });

    it('a stale response DOES clear the flag when no newer probe is running', async () => {
      // Regression fence for a bug this suite caught: comparing against
      // formData.email meant a stale response left isCheckingEmail true forever,
      // and canSubmit blocks while checking — the form wedged shut with no probe
      // running and no way for the admin to recover.
      let release!: (r: EmailLookupResult) => void;
      const svc = stubService(() => new Promise<EmailLookupResult>((res) => (release = res)));

      validForm(vm, 'typo@org.com');
      const inFlight = vm.checkEmailStatus(svc);

      vm.updateField('email', 'correct@org.com'); // no new lookup issued
      release(verdict('active_member', { userId: 'u1' }));
      await inFlight;

      expect(vm.isCheckingEmail).toBe(false);
      expect(vm.canSubmit).toBe(true);
    });
  });
});

/**
 * isDirty must not treat a case-only email edit as a change.
 *
 * The backend canonicalizes to `btrim(lower(email))` (migration
 * `20260730045737`), so `Bob@x.com` and `bob@x.com` are the same address to
 * every consumer. Before this fix, retyping your own email with different
 * capitalization armed the unsaved-changes guard and prompted the admin to
 * confirm discarding a change that did not exist.
 */
describe('UserFormViewModel — isDirty email comparison', () => {
  const existingUser = {
    id: 'u1',
    email: 'bob@example.com',
    firstName: 'Bob',
    lastName: 'Smith',
    roles: [{ roleId: 'r1', roleName: 'Clinician' }],
    isActive: true,
  } as unknown as Parameters<typeof UserFormViewModel>[2];

  function editVm() {
    return new UserFormViewModel(ROLES, 'edit', existingUser);
  }

  it('is not dirty when nothing changed', () => {
    expect(editVm().isDirty).toBe(false);
  });

  it('is NOT dirty for a case-only email edit', () => {
    const vm = editVm();
    vm.updateField('email', 'BOB@Example.COM');
    expect(vm.isDirty).toBe(false);
  });

  it('is NOT dirty for a whitespace-only email edit', () => {
    const vm = editVm();
    vm.updateField('email', '  bob@example.com  ');
    expect(vm.isDirty).toBe(false);
  });

  it('IS dirty for a genuine email change', () => {
    // The guard still has to work — normalizing must not swallow real edits.
    const vm = editVm();
    vm.updateField('email', 'robert@example.com');
    expect(vm.isDirty).toBe(true);
  });

  it('IS dirty for a non-email change', () => {
    const vm = editVm();
    vm.updateField('firstName', 'Robert');
    expect(vm.isDirty).toBe(true);
  });
});
