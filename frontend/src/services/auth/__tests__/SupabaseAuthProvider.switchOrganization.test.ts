/**
 * SupabaseAuthProvider.switchOrganization — RPC contract.
 *
 * Locks the dead-code repair: the method previously called a non-existent RPC
 * `switch_active_organization({ new_org_id })` (absent from every migration and
 * from the generated DB types) and would throw "function not found" if reached.
 * The correct primitive is `public.switch_organization({ p_new_org_id })`
 * (baseline; granted to `authenticated`), which a global super_admin may call
 * for any org. This test fences the name + param so a regression can't silently
 * revive the dead call.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SupabaseAuthProvider } from '../SupabaseAuthProvider';
import type { Session } from '@/types/auth.types';

describe('SupabaseAuthProvider.switchOrganization', () => {
  let provider: SupabaseAuthProvider;
  let mockRpc: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    provider = new SupabaseAuthProvider({
      supabaseUrl: 'http://localhost',
      supabaseAnonKey: 'anon',
    });
    mockRpc = vi.fn().mockResolvedValue({ error: null });
    // Inject a mock client + a truthy current session; stub refreshSession so we
    // isolate the RPC call from JWT decoding.
    (provider as unknown as { client: unknown }).client = { rpc: mockRpc };
    (provider as unknown as { currentSession: Session }).currentSession = {
      claims: { org_id: 'old-org' },
    } as unknown as Session;
    vi.spyOn(provider, 'refreshSession').mockResolvedValue({
      claims: { org_id: 'new-org-uuid' },
    } as unknown as Session);
  });

  it('calls public.switch_organization with p_new_org_id (not the dead switch_active_organization)', async () => {
    await provider.switchOrganization('new-org-uuid');
    expect(mockRpc).toHaveBeenCalledWith('switch_organization', { p_new_org_id: 'new-org-uuid' });
    expect(mockRpc).not.toHaveBeenCalledWith('switch_active_organization', expect.anything());
  });

  it('refreshes the session after the switch (new JWT with updated org_id)', async () => {
    await provider.switchOrganization('new-org-uuid');
    expect(provider.refreshSession).toHaveBeenCalledTimes(1);
  });
});
