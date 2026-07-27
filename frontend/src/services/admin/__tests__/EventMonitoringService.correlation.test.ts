/**
 * EventMonitoringService — correlation-id threading tests (service-mints variant).
 *
 * These admin-dashboard reads OWN their read-failure logging (the caller,
 * FailedEventsPage, only sets error state), so the service mints a fresh
 * correlation id internally via a defaulted `correlationId = generateCorrelationId()`
 * param, pins it as `X-Correlation-ID` (the 3rd `apiRpc` arg), and logs it. We
 * stub `generateCorrelationId` to a fixed value so the internally-minted id is
 * assertable exactly.
 *
 * See dev/active/seed-thread-correlation-id-residual-apirpc-reads.md.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockApiRpc, mockLogError } = vi.hoisted(() => ({
  mockApiRpc: vi.fn(),
  mockLogError: vi.fn(),
}));

vi.mock('@/services/auth/supabase.service', () => ({
  supabaseService: { apiRpc: mockApiRpc },
}));

// Mock the logger so the failure-log payload is directly assertable (getLogger's
// per-category instance isn't reliably spyable from the test after module load).
vi.mock('@/utils/logger', () => ({
  Logger: {
    getLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: mockLogError, debug: vi.fn() }),
  },
}));

// importOriginal so other trace-ids exports survive; override only the generator.
vi.mock('@/utils/trace-ids', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/utils/trace-ids')>()),
  generateCorrelationId: () => 'fixed-corr',
}));

import { EventMonitoringService } from '../EventMonitoringService';

describe('EventMonitoringService — correlation-id threading (service-mints)', () => {
  let service: EventMonitoringService;

  beforeEach(() => {
    vi.clearAllMocks();
    mockApiRpc.mockResolvedValue({ data: [], error: null });
    service = new EventMonitoringService();
  });

  it('getFailedEvents pins the internally-minted id on the RPC call', async () => {
    await service.getFailedEvents();
    const call = mockApiRpc.mock.calls.find((c) => c[0] === 'get_failed_events');
    expect(call?.[2]).toEqual({ correlationId: 'fixed-corr' });
  });

  it('getFailedEvents failure log carries the pinned id (the epic guarantee)', async () => {
    mockApiRpc.mockResolvedValueOnce({ data: null, error: { message: 'boom', code: 'XX' } });

    await service.getFailedEvents();

    expect(mockLogError).toHaveBeenCalledWith(
      'Failed to fetch failed events',
      expect.objectContaining({ correlationId: 'fixed-corr' })
    );
  });

  it('getProcessingStats pins the internally-minted id', async () => {
    await service.getProcessingStats();
    const call = mockApiRpc.mock.calls.find((c) => c[0] === 'get_event_processing_stats');
    expect(call?.[2]).toEqual({ correlationId: 'fixed-corr' });
  });

  it('getEventsBySession pins the internally-minted id', async () => {
    await service.getEventsBySession('sess-1');
    const call = mockApiRpc.mock.calls.find((c) => c[0] === 'get_events_by_session');
    expect(call?.[2]).toEqual({ correlationId: 'fixed-corr' });
  });

  it('getTraceTimeline pins the internally-minted id', async () => {
    await service.getTraceTimeline('trace-1');
    const call = mockApiRpc.mock.calls.find((c) => c[0] === 'get_trace_timeline');
    expect(call?.[2]).toEqual({ correlationId: 'fixed-corr' });
  });

  it('getEventsByCorrelation keeps the search key in the body AND pins a distinct request id', async () => {
    await service.getEventsByCorrelation('searched-id');
    const call = mockApiRpc.mock.calls.find((c) => c[0] === 'get_events_by_correlation');
    // body carries the SEARCH KEY…
    expect(call?.[1]).toMatchObject({ p_correlation_id: 'searched-id' });
    // …while the transport header is this request's OWN fresh id.
    expect(call?.[2]).toEqual({ correlationId: 'fixed-corr' });
  });
});
