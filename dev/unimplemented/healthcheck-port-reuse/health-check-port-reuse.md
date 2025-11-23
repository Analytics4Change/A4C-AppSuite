# Health Check Server Port Reuse Improvement

**Status**: Parked (not blocking)
**Priority**: Low (dev ergonomics improvement)
**Created**: 2025-11-21
**Context**: Discovered during Phase 4.1 workflow testing when nodemon restarts caused `EADDRINUSE` errors

## Problem Statement

When nodemon restarts the Temporal worker during development, the health check server occasionally fails to bind to port 9090 with error:

```
❌ Failed to start health check server: Error: listen EADDRINUSE: address already in use :::9090
```

**Root Cause**:
- Nodemon sends `SIGTERM` to old worker process
- Worker's graceful shutdown handler (`worker/index.ts:112-137`) closes health check server
- But TCP socket may not be released immediately by OS
- New worker process starts and tries to bind to port 9090 before OS releases the socket
- Result: `EADDRINUSE` error

## Current Workaround

```bash
# Kill orphaned process holding port 9090
lsof -ti:9090 | xargs kill -9
```

This works but requires manual intervention on every restart.

## Proposed Solution: SO_REUSEADDR Option

Configure the Node.js HTTP server to use the `SO_REUSEADDR` socket option, which allows binding to a port that's in `TIME_WAIT` state.

### Implementation Plan

#### File: `workflows/src/worker/health.ts`

**Current Code** (line ~95-100):
```typescript
start(): Promise<void> {
  return new Promise((resolve, reject) => {
    this.server.listen(this.port, () => {
      console.log(`[Health Check] Server listening on port ${this.port}`);
      resolve();
    });
```

**Proposed Change**:
```typescript
import { Server } from 'http';

start(): Promise<void> {
  return new Promise((resolve, reject) => {
    // Get the underlying server handle before listen()
    const server = this.server as Server;

    // Listen with callback to set SO_REUSEADDR
    server.on('error', (err) => {
      reject(err);
    });

    server.listen({
      port: this.port,
      host: '0.0.0.0',
      // Enable SO_REUSEADDR - allows binding to port in TIME_WAIT state
      // This is safe for development where we control port lifecycle
    }, () => {
      console.log(`[Health Check] Server listening on port ${this.port}`);
      resolve();
    });

    // Alternative approach using lower-level net.Server:
    // const handle = (server as any)._handle;
    // if (handle && handle.setNoDelay) {
    //   handle.setNoDelay(true);
    // }
  });
}
```

**Note**: Node.js doesn't expose `SO_REUSEADDR` directly in the HTTP module. Need to research if this requires:
1. Using `net.Server` directly instead of `http.Server`
2. Using a native addon (too complex for this use case)
3. Alternative approach: Use `server.close()` with longer timeout

### Alternative Solution: Nodemon Delay Configuration

Create `workflows/nodemon.json`:

```json
{
  "watch": ["src"],
  "ext": "ts",
  "exec": "ts-node -r tsconfig-paths/register src/worker/index.ts",
  "delay": 2000,
  "signal": "SIGTERM",
  "verbose": true
}
```

Update `workflows/package.json`:
```json
{
  "scripts": {
    "dev": "nodemon",
    // Remove: "dev": "nodemon --watch src --ext ts --exec ts-node -r tsconfig-paths/register src/worker/index.ts"
  }
}
```

**Pros**:
- Simple, no code changes
- 2 second delay gives OS time to release socket
- Works with existing graceful shutdown

**Cons**:
- Slower restart cycle (2s delay on every change)
- Doesn't address root cause

### Alternative Solution: Graceful Close with Timeout

Enhance `workflows/src/worker/health.ts` close method:

```typescript
close(): Promise<void> {
  return new Promise((resolve) => {
    if (!this.server.listening) {
      resolve();
      return;
    }

    // Set a timeout for close operation
    const closeTimeout = setTimeout(() => {
      console.warn('[Health Check] Server close timed out, forcing shutdown');
      resolve();
    }, 5000);

    this.server.close(() => {
      clearTimeout(closeTimeout);
      console.log('[Health Check] Server closed gracefully');
      resolve();
    });

    // Destroy all active connections immediately
    this.server.closeAllConnections?.();
  });
}
```

**Note**: `closeAllConnections()` requires Node.js 18.2.0+

## Research Required

1. **Node.js Socket Options**: Investigate if `SO_REUSEADDR` can be set on `http.Server` without dropping to native addons
2. **net.Server vs http.Server**: Determine if health check needs to be rewritten with `net.Server` for socket control
3. **Node.js Version**: Check if we're on Node.js 18.2.0+ for `closeAllConnections()` API
4. **Production Impact**: Verify changes are dev-only and don't affect Kubernetes deployments

## Testing Plan

1. **Before**: Trigger nodemon restart, verify `EADDRINUSE` error
2. **After**: Implement solution, trigger multiple rapid restarts
3. **Verify**: No `EADDRINUSE` errors, health check server starts consistently
4. **Production**: Deploy to dev cluster, verify health checks work in Kubernetes

## Decision: Which Solution?

**Recommendation**: Start with **Alternative Solution 2 (nodemon delay)**
- Quickest to implement (no code changes)
- Solves 95% of cases
- Can be implemented immediately

If nodemon delay proves insufficient, escalate to **Alternative Solution 3 (graceful close enhancement)**.

Only pursue SO_REUSEADDR (original proposal) if both alternatives fail.

## Files to Modify

- `workflows/nodemon.json` (new file)
- `workflows/package.json` (update `dev` script)
- OR `workflows/src/worker/health.ts` (enhance `close()` method)

## Related Files

- `workflows/src/worker/index.ts:112-137` - Graceful shutdown handler
- `workflows/src/worker/health.ts:95-100` - Server listen
- `workflows/src/worker/health.ts` - Server close method

## Context: When This Was Discovered

- **Phase**: 4.1 Workflow Testing
- **Test Case**: Test Case A (Provider organization with contacts/addresses/phones)
- **Issue**: RPC function schema error required code changes to `create-organization.ts`
- **Trigger**: Nodemon auto-reload after adding `.schema('api')` to RPC calls
- **Result**: Worker crashed with `EADDRINUSE`, blocking Test Case A execution

## Next Steps (When Prioritized)

1. Create nodemon.json with 2s delay
2. Update package.json dev script
3. Test with multiple rapid file changes
4. Document in workflows/CLAUDE.md if successful
5. Close this plan file and move to archived/
