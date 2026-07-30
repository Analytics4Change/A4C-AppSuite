/**
 * Unit tests for findAuthUserByEmail.
 *
 * Run with: deno test --allow-net accept-invitation/__tests__/auth-user-email-match.test.ts
 *
 * ## What this is guarding
 *
 * `index.ts:534` used to be `existingUsers.users.find(u => u.email === invitation.email)`.
 * `auth.users.email` is lowercased by Supabase Auth; `invitation.email` was
 * whatever the org-bootstrap path stored, which normalized at zero of its five
 * layers. So on the "user already registered" retry branch the compare missed,
 * the function returned `500 "Inconsistent auth state"`, and the invitation
 * became permanently unacceptable — every retry took the same branch and missed
 * the same way.
 *
 * `20260730045737_normalize_email_at_the_source` makes stored values canonical,
 * so this is now defence in depth. It stays because the left-hand side comes
 * from the Auth admin API and no database constraint can reach it.
 *
 * Per-Edge-Function test pattern from PR #42.
 */

import { assert, assertEquals } from 'https://deno.land/std@0.220.1/assert/mod.ts';

import { findAuthUserByEmail } from '../index.ts';

const authUsers = [
  { id: 'u-other', email: 'someone.else@example.com' },
  { id: 'u-target', email: 'bob@example.com' },
];

Deno.test('findAuthUserByEmail → exact match', () => {
  assertEquals(findAuthUserByEmail(authUsers, 'bob@example.com')?.id, 'u-target');
});

Deno.test('findAuthUserByEmail → matches a mixed-case invitation email', () => {
  // The wedge: Auth stores bob@example.com, the invitation stored Bob@Example.COM.
  assertEquals(findAuthUserByEmail(authUsers, 'Bob@Example.COM')?.id, 'u-target');
});

Deno.test('findAuthUserByEmail → matches a whitespace-padded invitation email', () => {
  assertEquals(findAuthUserByEmail(authUsers, '  bob@example.com  ')?.id, 'u-target');
});

Deno.test('findAuthUserByEmail → matches across both case and padding', () => {
  assertEquals(findAuthUserByEmail(authUsers, '  BoB@Example.Com '), authUsers[1]);
});

Deno.test('findAuthUserByEmail → undefined on a genuine miss', () => {
  // Must stay undefined: this is what legitimately drives the "unexpected state"
  // branch. Loosening the compare must not turn a real miss into a false hit.
  assertEquals(findAuthUserByEmail(authUsers, 'nobody@example.com'), undefined);
});

Deno.test('findAuthUserByEmail → tolerates auth users with a null/absent email', () => {
  // auth.users.email is nullable (phone-only identities), and `.toLowerCase()`
  // on undefined would throw inside the find callback.
  const withNulls = [{ id: 'phone-only' }, { id: 'u-target', email: 'bob@example.com' }];
  assertEquals(findAuthUserByEmail(withNulls, 'bob@example.com')?.id, 'u-target');
});

Deno.test('findAuthUserByEmail → empty list yields undefined', () => {
  assertEquals(findAuthUserByEmail([], 'bob@example.com'), undefined);
});

Deno.test('findAuthUserByEmail → returns the first match when Auth holds duplicates', () => {
  // auth.users only enforces email uniqueness WHERE is_sso_user = false, so two
  // SSO identities can share an address. Pin the behaviour rather than leave it
  // to Array.prototype.find being incidentally first-wins.
  const dupes = [
    { id: 'sso-a', email: 'Dual@example.com' },
    { id: 'sso-b', email: 'dual@example.com' },
  ];
  assert(findAuthUserByEmail(dupes, 'dual@example.com')?.id === 'sso-a');
});
