---
status: aspirational
last_updated: 2026-01-07
---

<!-- TL;DR-START -->
## TL;DR

**Summary**: Production-scale observability operations: event retention with archival, trace sampling for cost control, APM tool integration via OTLP export.

**When to read**:
- Planning for >10,000 events/day
- Need to reduce tracing storage costs
- Integrating with Datadog/Jaeger/Honeycomb
- Setting up automated event archival

**Prerequisites**: [event-observability.md](./event-observability.md)

**Key topics**: `retention-policy`, `trace-sampling`, `apm-integration`, `otlp-export`, `event-archival`

**Estimated read time**: 10 minutes
<!-- TL;DR-END -->

# Observability Operations

> **Note**: This document describes planned functionality that is not yet implemented. These features are recommended for production scale but can be implemented after initial rollout.

This guide covers production-scale observability operations for the A4C-AppSuite event tracing system. It addresses three concerns that become important as event volume grows: retention, sampling, and APM integration.

---

## Event Retention and Archival

### Problem

The `domain_events` table grows indefinitely. At scale (thousands of events/day), this causes:
- Slower queries as table size increases
- Increased storage costs
- Backup/restore times grow linearly with table size

### Solution

Implement a retention policy with automated archival:

| Component | Purpose |
|-----------|---------|
| `domain_events_archive` | Partitioned table (by month) for cold storage |
| `archive_old_events()` | Function that moves events older than retention period |
| pg_cron or Temporal workflow | Automated daily/weekly execution |

### Implementation

#### 1. Create Archive Table

```sql
-- Partitioned archive table by month
CREATE TABLE IF NOT EXISTS domain_events_archive (
  LIKE domain_events INCLUDING ALL
) PARTITION BY RANGE (created_at);

-- Create partitions for historical data
CREATE TABLE domain_events_archive_2025_01
  PARTITION OF domain_events_archive
  FOR VALUES FROM ('2025-01-01') TO ('2025-02-01');

-- Add more partitions as needed...
```

#### 2. Create Archive Function

```sql
CREATE OR REPLACE FUNCTION archive_old_events(
  p_retention_days INTEGER DEFAULT 90
) RETURNS INTEGER AS $$
DECLARE
  v_cutoff_date TIMESTAMPTZ;
  v_archived_count INTEGER;
BEGIN
  v_cutoff_date := NOW() - (p_retention_days || ' days')::INTERVAL;

  -- Move old events to archive
  WITH moved AS (
    DELETE FROM domain_events
    WHERE created_at < v_cutoff_date
    RETURNING *
  )
  INSERT INTO domain_events_archive
  SELECT * FROM moved;

  GET DIAGNOSTICS v_archived_count = ROW_COUNT;

  RETURN v_archived_count;
END;
$$ LANGUAGE plpgsql;
```

#### 3. Schedule Execution

**Option A: pg_cron** (requires pg_cron extension)
```sql
-- Run daily at 3 AM
SELECT cron.schedule(
  'archive-old-events',
  '0 3 * * *',
  'SELECT archive_old_events(90)'
);
```

**Option B: Temporal Workflow**
```typescript
// Schedule via Temporal scheduled workflow
export async function archiveEventsWorkflow(): Promise<number> {
  return await archiveOldEvents({ retentionDays: 90 });
}
```

### Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| Retention period | 90 days | Events older than this are archived |
| Archive frequency | Daily | How often the archive job runs |
| Partition size | Monthly | Archive table partition granularity |

### When to Implement

| Trigger | Recommendation |
|---------|----------------|
| >10,000 events/day | Implement retention policy |
| Table >10GB | Implement urgently |
| Query latency >500ms on filtered queries | Implement retention policy |

---

## Trace Sampling Strategy

### Problem

Full tracing of every request is expensive in high-traffic production:
- Storage costs for trace data in `domain_events`
- CPU overhead for trace context propagation
- Network overhead if exporting to APM tools

### Solution

Implement configurable trace sampling that:
- Samples a configurable percentage of requests
- Always captures errors (regardless of sampling rate)
- Honors upstream sampling decisions from APM tools

### Implementation

#### 1. Environment Configuration

```bash
# Sampling rate: 0.0 to 1.0 (0.1 = 10% of requests)
TRACE_SAMPLING_RATE=0.1
```

#### 2. Sampling Function (Frontend)

```typescript
// frontend/src/utils/tracing.ts

/**
 * Determines if a trace should be sampled.
 * Uses consistent hashing on trace_id for determinism.
 */
export function shouldSample(traceId: string): boolean {
  const rate = parseFloat(import.meta.env.VITE_TRACE_SAMPLING_RATE || '1.0');

  // Always sample if rate is 1.0
  if (rate >= 1.0) return true;

  // Never sample if rate is 0.0
  if (rate <= 0.0) return false;

  // Consistent hashing: same trace_id always gets same decision
  const hash = hashTraceId(traceId);
  return hash < rate;
}

function hashTraceId(traceId: string): number {
  // Simple hash to [0, 1) range
  let hash = 0;
  for (let i = 0; i < traceId.length; i++) {
    hash = ((hash << 5) - hash) + traceId.charCodeAt(i);
    hash |= 0; // Convert to 32-bit integer
  }
  return Math.abs(hash) / 2147483647; // Normalize to [0, 1)
}
```

#### 3. Sampling Function (Edge Functions)

```typescript
// _shared/tracing-context.ts

export function shouldSample(context: TracingContext): boolean {
  const rate = parseFloat(Deno.env.get('TRACE_SAMPLING_RATE') || '1.0');

  // Honor upstream sampling flag from traceparent
  if (!context.sampled) return false;

  // Always sample if rate is 1.0
  if (rate >= 1.0) return true;

  // Consistent hashing on trace_id
  return hashTraceId(context.traceId) < rate;
}
```

#### 4. Always Sample Errors

```typescript
// When catching errors, force sampling
try {
  // ... operation ...
} catch (error) {
  // Force sampling for errors
  context.sampled = true;

  await emitDomainEvent({
    ...params,
    tracing: context,
  });

  throw error;
}
```

### Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| `TRACE_SAMPLING_RATE` | `1.0` | Fraction of requests to sample (0.0-1.0) |
| Error sampling | Always | Errors always get full traces |
| Upstream honor | Yes | Respect `traceparent` sampling flag |

### When to Implement

| Trigger | Recommendation |
|---------|----------------|
| >1,000 requests/minute | Consider 50% sampling |
| >10,000 requests/minute | Consider 10% sampling |
| Storage costs concern | Implement sampling |

---

## APM Tool Integration

### Problem

Traces stored only in PostgreSQL limit observability:
- No visualization dashboards
- No alerting on latency/error thresholds
- No cross-service trace correlation with external services
- No historical trend analysis

### Solution

Export traces to external APM tools using OpenTelemetry Protocol (OTLP):

| APM Tool | Compatibility |
|----------|---------------|
| Datadog | OTLP endpoint |
| Jaeger | OTLP endpoint |
| Honeycomb | OTLP endpoint |
| New Relic | OTLP endpoint |
| Grafana Tempo | OTLP endpoint |

### Implementation

#### 1. Environment Configuration

```bash
# OTLP collector endpoint
OTLP_ENDPOINT=https://otlp.datadoghq.com/v1/traces

# Optional: API key for authenticated endpoints
OTLP_API_KEY=your-api-key
```

#### 2. Trace Exporter Module

```typescript
// _shared/trace-exporter.ts

interface OTLPSpan {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  startTimeUnixNano: string;
  endTimeUnixNano: string;
  status: { code: number };
  attributes: Array<{ key: string; value: { stringValue: string } }>;
}

/**
 * Exports span to OTLP endpoint.
 * Fire-and-forget: never blocks business logic.
 */
export function exportSpan(span: Span, context: TracingContext): void {
  const endpoint = Deno.env.get('OTLP_ENDPOINT');
  if (!endpoint) return; // OTLP not configured

  // Fire-and-forget: don't await
  sendToOTLP(endpoint, formatOTLP(span, context)).catch((err) => {
    console.warn('[trace-exporter] Failed to export span:', err.message);
  });
}

function formatOTLP(span: Span, context: TracingContext): OTLPSpan {
  return {
    traceId: context.traceId,
    spanId: span.spanId,
    parentSpanId: span.parentSpanId || undefined,
    name: span.operationName,
    startTimeUnixNano: (span.startTime * 1_000_000).toString(),
    endTimeUnixNano: ((span.endTime || Date.now()) * 1_000_000).toString(),
    status: { code: span.status === 'error' ? 2 : 1 },
    attributes: Object.entries(span.attributes).map(([key, value]) => ({
      key,
      value: { stringValue: String(value) },
    })),
  };
}

async function sendToOTLP(endpoint: string, span: OTLPSpan): Promise<void> {
  const apiKey = Deno.env.get('OTLP_API_KEY');

  await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(apiKey && { 'DD-API-KEY': apiKey }),
    },
    body: JSON.stringify({
      resourceSpans: [{
        resource: {
          attributes: [
            { key: 'service.name', value: { stringValue: 'a4c-edge-functions' } },
          ],
        },
        scopeSpans: [{
          spans: [span],
        }],
      }],
    }),
  });
}
```

#### 3. Integration with Span Lifecycle

```typescript
// In Edge Function
import { exportSpan } from '../_shared/trace-exporter.ts';

const span = createSpan(context, 'invite-user');
try {
  // ... operation ...
  endSpan(span, 'ok');
} catch (error) {
  endSpan(span, 'error');
  throw error;
} finally {
  // Fire-and-forget export
  exportSpan(span, context);
}
```

### Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| `OTLP_ENDPOINT` | None | OTLP collector URL (disabled if not set) |
| `OTLP_API_KEY` | None | API key for authenticated endpoints |
| Export mode | Fire-and-forget | Never blocks response |

### When to Implement

| Trigger | Recommendation |
|---------|----------------|
| Need production dashboards | Implement APM integration |
| Need latency alerting | Implement APM integration |
| Multi-service correlation needed | Implement APM integration |

---

## Implementation Decision Matrix

| Your Situation | Recommended Action |
|----------------|-------------------|
| <10,000 events/day, no external APM needs | Keep current implementation |
| >10,000 events/day | Implement retention policy |
| >1,000 requests/minute | Implement sampling |
| Need production dashboards/alerting | Implement APM integration |
| All of the above | Implement all three features |

---

## Related Documentation

- [Event Observability Guide](./event-observability.md) - Current implementation (tracing, debugging, admin dashboard)
- [Event Metadata Schema](../../workflows/reference/event-metadata-schema.md) - Event structure and tracing fields
- [Event Sourcing Overview](../../architecture/data/event-sourcing-overview.md) - CQRS architecture
