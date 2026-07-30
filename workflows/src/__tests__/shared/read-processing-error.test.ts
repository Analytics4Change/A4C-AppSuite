/**
 * readProcessingError Tests (Temporal tier)
 *
 * ## What this is guarding
 *
 * `api.emit_domain_event` returning a UUID with no error does NOT mean the
 * projection was written. `process_domain_event` catches every handler failure
 * with `EXCEPTION WHEN OTHERS`, records it on `domain_events.processing_error`,
 * and does not re-raise — so the outer INSERT commits and the RPC hands back an
 * id while the handler's own write has already rolled back.
 *
 * `emitEvent` is the single funnel for every Temporal activity emit, so before
 * the read-back landed there, EVERY activity reported success for events that
 * wrote nothing. On the org-bootstrap path that means generate-invitations
 * pushes an invitation into the array send-invitation-emails consumes, and we
 * email a token with no row behind it.
 *
 * The fail-closed case is the one that matters most: an undeterminable outcome
 * must never be reported as success.
 */

import { readProcessingError } from '@shared/utils/emit-event';

/** Minimal Supabase stub: `.schema('api').rpc(name, args)` returns a configured response. */
function mockClient(
  response: { data: unknown; error: unknown },
  capture?: { name?: string; args?: unknown }
) {
  return {
    schema: () => ({
      rpc: (name: string, args: unknown) => {
        if (capture) {
          capture.name = name;
          capture.args = args;
        }
        return Promise.resolve(response);
      }
    })
  };
}

describe('readProcessingError', () => {
  it('returns null when the event processed cleanly', async () => {
    const client = mockClient({ data: null, error: null });
    await expect(readProcessingError(client, 'evt-1')).resolves.toBeNull();
  });

  it('returns the handler failure message', async () => {
    const msg = 'new row violates check constraint "chk_users_email_normalized"';
    const client = mockClient({ data: msg, error: null });
    await expect(readProcessingError(client, 'evt-2')).resolves.toBe(msg);
  });

  it('calls api.get_event_processing_error with the event id', async () => {
    const capture: { name?: string; args?: unknown } = {};
    const client = mockClient({ data: null, error: null }, capture);
    await readProcessingError(client, 'evt-3');
    expect(capture.name).toBe('get_event_processing_error');
    expect(capture.args).toEqual({ p_event_id: 'evt-3' });
  });

  it('FAILS CLOSED when the read-back itself errors', async () => {
    // Returning null here would let the caller treat an unverifiable event as a
    // success — precisely the bug this function exists to remove.
    const client = mockClient({ data: null, error: { message: 'permission denied' } });
    const result = await readProcessingError(client, 'evt-4');
    expect(result).not.toBeNull();
    expect(result).toContain('Unable to verify event processing');
  });

  it('treats undefined data as clean', async () => {
    const client = mockClient({ data: undefined, error: null });
    await expect(readProcessingError(client, 'evt-5')).resolves.toBeNull();
  });
});
