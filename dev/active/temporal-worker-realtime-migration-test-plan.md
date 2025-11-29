# Temporal Worker Realtime Migration - Automated Test Plan

**Status**: ⏸️ PENDING
**Created**: 2025-11-27
**Test Results Directory**: `/tmp/temporal-worker-realtime-tests/`

## Overview

This automated test plan validates the migration from PostgreSQL LISTEN/NOTIFY to Supabase Realtime for the Temporal worker event listener. All tests write results to JSON files for AI evaluation, minimizing manual intervention.

**Key Features**:
- ✅ Automated test execution with minimal user intervention
- ✅ JSON output for AI evaluation
- ✅ Progress tracking within this document
- ✅ Idempotent test scripts
- ✅ Comprehensive validation coverage

---

## Progress Tracking

### Test Suite Status

- [ ] **Prerequisites**: Supabase Local Setup
- [ ] **Test 1**: Environment Validation
- [ ] **Test 2**: Worker Startup and Realtime Subscription
- [ ] **Test 3**: Event Reception and Workflow Triggering
- [ ] **Test 4**: Multiple Concurrent Events
- [ ] **Test 5**: Reconnection Behavior
- [ ] **Test 6**: Graceful Shutdown
- [ ] **Cleanup**: Environment Cleanup

### Execution Log

| Timestamp | Test | Status | Details |
|-----------|------|--------|---------|
| - | - | - | - |

*(Agent will update this table during test execution)*

---

## Prerequisites: Supabase Environment Setup

**Status**: ⚠️ BLOCKED - Local Supabase storage migration issue
**Objective**: ~~Ensure local Supabase is running correctly~~ Use remote Supabase development project
**Output**: `/tmp/temporal-worker-realtime-tests/00-setup.json`

### Issue Discovered

Local Supabase (CLI v2.58.5) fails to start with storage service error:
```
Error: Migration iceberg-catalog-ids not found
```

This is a known issue with Supabase storage service migrations in recent CLI versions. The storage container repeatedly fails health checks and prevents Supabase from starting.

### Adapted Approach

Instead of using local Supabase, tests will use the **remote Supabase development project** (`tmrjlswbsxmbglmaclxu.supabase.co`). This approach:
- ✅ Tests against real infrastructure (more realistic)
- ✅ Validates Realtime works over internet connection
- ✅ Tests actual RLS policies and database schema
- ✅ Avoids local environment issues
- ⚠️ Requires cleanup of test data after execution

### Script: `setup-local-supabase.sh`

**Location**: `/tmp/temporal-worker-realtime-tests/setup-local-supabase.sh`

```bash
#!/bin/bash
# Setup and verify local Supabase environment
# Output: /tmp/temporal-worker-realtime-tests/00-setup.json

set -e

RESULTS_DIR="/tmp/temporal-worker-realtime-tests"
mkdir -p "$RESULTS_DIR"

RESULT_FILE="$RESULTS_DIR/00-setup.json"

echo "{" > "$RESULT_FILE"
echo '  "test": "supabase-local-setup",' >> "$RESULT_FILE"
echo '  "timestamp": "'$(date -Iseconds)'",' >> "$RESULT_FILE"

# Set Podman socket
export DOCKER_HOST=unix:///run/user/1000/podman/podman.sock

# Navigate to Supabase directory
cd /home/lars/dev/A4C-AppSuite/infrastructure/supabase

# Start Supabase
echo "Starting local Supabase..."
./local-tests/start-local.sh > "$RESULTS_DIR/supabase-start.log" 2>&1

# Wait for services to be ready
sleep 5

# Get status
./local-tests/status-local.sh > "$RESULTS_DIR/supabase-status.log" 2>&1

# Extract key information
SUPABASE_URL=$(grep "API URL" "$RESULTS_DIR/supabase-status.log" | awk '{print $NF}')
SERVICE_ROLE_KEY=$(grep "service_role key" "$RESULTS_DIR/supabase-status.log" | awk '{print $NF}')
REALTIME_URL=$(grep "Realtime URL" "$RESULTS_DIR/supabase-status.log" | awk '{print $NF}')
DB_URL=$(grep "DB URL" "$RESULTS_DIR/supabase-status.log" | grep -v "Pooler" | awk '{print $NF}')

# Verify Realtime is running
REALTIME_STATUS="stopped"
if grep -q "Realtime" "$RESULTS_DIR/supabase-status.log"; then
  REALTIME_STATUS="running"
fi

# Run migrations
echo "Running migrations..."
./local-tests/run-migrations.sh > "$RESULTS_DIR/migrations.log" 2>&1
MIGRATION_EXIT_CODE=$?

# Verify domain_events table exists
echo "Verifying domain_events table..."
PGPASSWORD=postgres psql "$DB_URL" -c "\d domain_events" > "$RESULTS_DIR/domain-events-check.log" 2>&1
TABLE_EXISTS=$?

# Write results
echo '  "supabase_url": "'$SUPABASE_URL'",' >> "$RESULT_FILE"
echo '  "service_role_key": "'${SERVICE_ROLE_KEY:0:50}'...",' >> "$RESULT_FILE"
echo '  "realtime_url": "'$REALTIME_URL'",' >> "$RESULT_FILE"
echo '  "db_url": "'${DB_URL:0:50}'...",' >> "$RESULT_FILE"
echo '  "realtime_status": "'$REALTIME_STATUS'",' >> "$RESULT_FILE"
echo '  "migrations_applied": '$([[ $MIGRATION_EXIT_CODE -eq 0 ]] && echo "true" || echo "false")',' >> "$RESULT_FILE"
echo '  "domain_events_table_exists": '$([[ $TABLE_EXISTS -eq 0 ]] && echo "true" || echo "false")',' >> "$RESULT_FILE"

# Overall status
if [[ "$REALTIME_STATUS" == "running" ]] && [[ $MIGRATION_EXIT_CODE -eq 0 ]] && [[ $TABLE_EXISTS -eq 0 ]]; then
  echo '  "status": "success",' >> "$RESULT_FILE"
  echo '  "message": "Local Supabase is ready for testing"' >> "$RESULT_FILE"
  EXIT_CODE=0
else
  echo '  "status": "failed",' >> "$RESULT_FILE"
  echo '  "message": "Local Supabase setup incomplete"' >> "$RESULT_FILE"
  EXIT_CODE=1
fi

echo "}" >> "$RESULT_FILE"

# Save environment variables for subsequent tests
cat > "$RESULTS_DIR/test-env.sh" <<EOF
export SUPABASE_URL="$SUPABASE_URL"
export SUPABASE_SERVICE_ROLE_KEY="$SERVICE_ROLE_KEY"
export TEMPORAL_ADDRESS="localhost:7233"
export TEMPORAL_NAMESPACE="default"
export TEMPORAL_TASK_QUEUE="bootstrap"
export WORKFLOW_MODE="development"
export NODE_ENV="development"
export LOG_LEVEL="debug"
EOF

echo "Setup complete. Results: $RESULT_FILE"
exit $EXIT_CODE
```

### Success Criteria

```json
{
  "status": "success",
  "realtime_status": "running",
  "migrations_applied": true,
  "domain_events_table_exists": true
}
```

### Execution Notes

*(Agent will add notes here during execution)*

---

## Test 1: Environment Validation

**Status**: ⏸️ PENDING
**Objective**: Verify `validateEnvironment()` catches missing/invalid env vars
**Output**: `/tmp/temporal-worker-realtime-tests/01-env-validation.json`

### Script: `test-01-env-validation.sh`

**Location**: `/tmp/temporal-worker-realtime-tests/test-01-env-validation.sh`

```bash
#!/bin/bash
# Test environment validation
# Output: /tmp/temporal-worker-realtime-tests/01-env-validation.json

set +e  # Don't exit on error - we're testing error cases

RESULTS_DIR="/tmp/temporal-worker-realtime-tests"
RESULT_FILE="$RESULTS_DIR/01-env-validation.json"

cd /home/lars/dev/A4C-AppSuite/workflows

echo "{" > "$RESULT_FILE"
echo '  "test": "environment-validation",' >> "$RESULT_FILE"
echo '  "timestamp": "'$(date -Iseconds)'",' >> "$RESULT_FILE"
echo '  "test_cases": [' >> "$RESULT_FILE"

# Test Case 1: Missing SUPABASE_URL
echo "Test 1: Missing SUPABASE_URL..."
SUPABASE_SERVICE_ROLE_KEY="test" \
TEMPORAL_ADDRESS="localhost:7233" \
TEMPORAL_NAMESPACE="default" \
timeout 5 npm run dev > "$RESULTS_DIR/test-01-case-1.log" 2>&1
EXIT_CODE=$?

TEST1_PASSED="false"
if grep -q "Missing required environment variables: SUPABASE_URL" "$RESULTS_DIR/test-01-case-1.log"; then
  TEST1_PASSED="true"
fi

echo '    {' >> "$RESULT_FILE"
echo '      "case": "missing_supabase_url",' >> "$RESULT_FILE"
echo '      "passed": '$TEST1_PASSED',' >> "$RESULT_FILE"
echo '      "expected_error": "Missing required environment variables: SUPABASE_URL",' >> "$RESULT_FILE"
echo '      "exit_code": '$EXIT_CODE >> "$RESULT_FILE"
echo '    },' >> "$RESULT_FILE"

# Test Case 2: Invalid SUPABASE_URL format
echo "Test 2: Invalid SUPABASE_URL format..."
SUPABASE_URL="not-a-valid-url" \
SUPABASE_SERVICE_ROLE_KEY="test" \
TEMPORAL_ADDRESS="localhost:7233" \
TEMPORAL_NAMESPACE="default" \
timeout 5 npm run dev > "$RESULTS_DIR/test-01-case-2.log" 2>&1
EXIT_CODE=$?

TEST2_PASSED="false"
if grep -q "Invalid SUPABASE_URL format" "$RESULTS_DIR/test-01-case-2.log"; then
  TEST2_PASSED="true"
fi

echo '    {' >> "$RESULT_FILE"
echo '      "case": "invalid_supabase_url",' >> "$RESULT_FILE"
echo '      "passed": '$TEST2_PASSED',' >> "$RESULT_FILE"
echo '      "expected_error": "Invalid SUPABASE_URL format",' >> "$RESULT_FILE"
echo '      "exit_code": '$EXIT_CODE >> "$RESULT_FILE"
echo '    },' >> "$RESULT_FILE"

# Test Case 3: Invalid TEMPORAL_ADDRESS format
echo "Test 3: Invalid TEMPORAL_ADDRESS format..."
SUPABASE_URL="http://localhost:54321" \
SUPABASE_SERVICE_ROLE_KEY="test" \
TEMPORAL_ADDRESS="invalid-address" \
TEMPORAL_NAMESPACE="default" \
timeout 5 npm run dev > "$RESULTS_DIR/test-01-case-3.log" 2>&1
EXIT_CODE=$?

TEST3_PASSED="false"
if grep -q "Invalid TEMPORAL_ADDRESS format" "$RESULTS_DIR/test-01-case-3.log"; then
  TEST3_PASSED="true"
fi

echo '    {' >> "$RESULT_FILE"
echo '      "case": "invalid_temporal_address",' >> "$RESULT_FILE"
echo '      "passed": '$TEST3_PASSED',' >> "$RESULT_FILE"
echo '      "expected_error": "Invalid TEMPORAL_ADDRESS format",' >> "$RESULT_FILE"
echo '      "exit_code": '$EXIT_CODE >> "$RESULT_FILE"
echo '    }' >> "$RESULT_FILE"

echo '  ],' >> "$RESULT_FILE"

# Overall status
if [[ "$TEST1_PASSED" == "true" ]] && [[ "$TEST2_PASSED" == "true" ]] && [[ "$TEST3_PASSED" == "true" ]]; then
  echo '  "status": "success",' >> "$RESULT_FILE"
  echo '  "message": "All environment validation tests passed"' >> "$RESULT_FILE"
  EXIT_CODE=0
else
  echo '  "status": "failed",' >> "$RESULT_FILE"
  echo '  "message": "Some environment validation tests failed"' >> "$RESULT_FILE"
  EXIT_CODE=1
fi

echo "}" >> "$RESULT_FILE"

echo "Test 1 complete. Results: $RESULT_FILE"
exit $EXIT_CODE
```

### Success Criteria

```json
{
  "status": "success",
  "test_cases": [
    { "case": "missing_supabase_url", "passed": true },
    { "case": "invalid_supabase_url", "passed": true },
    { "case": "invalid_temporal_address", "passed": true }
  ]
}
```

### Execution Notes

*(Agent will add notes here during execution)*

---

## Test 2: Worker Startup and Realtime Subscription

**Status**: ⏸️ PENDING
**Objective**: Verify worker starts and subscribes to Supabase Realtime
**Output**: `/tmp/temporal-worker-realtime-tests/02-worker-startup.json`

### Script: `test-02-worker-startup.sh`

**Location**: `/tmp/temporal-worker-realtime-tests/test-02-worker-startup.sh`

```bash
#!/bin/bash
# Test worker startup and Realtime subscription
# Output: /tmp/temporal-worker-realtime-tests/02-worker-startup.json

set -e

RESULTS_DIR="/tmp/temporal-worker-realtime-tests"
RESULT_FILE="$RESULTS_DIR/02-worker-startup.json"

# Load test environment
source "$RESULTS_DIR/test-env.sh"

cd /home/lars/dev/A4C-AppSuite/workflows

echo "{" > "$RESULT_FILE"
echo '  "test": "worker-startup",' >> "$RESULT_FILE"
echo '  "timestamp": "'$(date -Iseconds)'",' >> "$RESULT_FILE"

# Start worker in background
echo "Starting worker..."
npm run dev > "$RESULTS_DIR/worker-startup.log" 2>&1 &
WORKER_PID=$!

# Save PID for cleanup
echo $WORKER_PID > "$RESULTS_DIR/worker.pid"

# Wait for worker to start (max 30 seconds)
echo "Waiting for worker to start..."
for i in {1..30}; do
  if grep -q "Subscribed to workflow events via Supabase Realtime" "$RESULTS_DIR/worker-startup.log"; then
    break
  fi
  sleep 1
done

# Check for expected log messages
CONNECTED_TO_TEMPORAL="false"
if grep -q "✅ Connected to Temporal" "$RESULTS_DIR/worker-startup.log"; then
  CONNECTED_TO_TEMPORAL="true"
fi

WORKER_CREATED="false"
if grep -q "✅ Worker created successfully" "$RESULTS_DIR/worker-startup.log"; then
  WORKER_CREATED="true"
fi

REALTIME_SUBSCRIBED="false"
if grep -q "✅ Subscribed to workflow events via Supabase Realtime" "$RESULTS_DIR/worker-startup.log"; then
  REALTIME_SUBSCRIBED="true"
fi

CORRECT_CHANNEL="false"
if grep -q "Channel: workflow_events" "$RESULTS_DIR/worker-startup.log"; then
  CORRECT_CHANNEL="true"
fi

CORRECT_FILTER="false"
if grep -q "Filter: event_type=eq.organization.bootstrap.initiated" "$RESULTS_DIR/worker-startup.log"; then
  CORRECT_FILTER="true"
fi

WORKER_RUNNING="false"
if grep -q "Worker is running and ready to process workflows" "$RESULTS_DIR/worker-startup.log"; then
  WORKER_RUNNING="true"
fi

# Check for errors
HAS_ERRORS="false"
if grep -qi "error\|undefined\|null\|failed" "$RESULTS_DIR/worker-startup.log" | grep -v "Error handling" | grep -v "errorCodes"; then
  HAS_ERRORS="true"
fi

# Check if worker process is still running
PROCESS_ALIVE="false"
if kill -0 $WORKER_PID 2>/dev/null; then
  PROCESS_ALIVE="true"
fi

# Write results
echo '  "connected_to_temporal": '$CONNECTED_TO_TEMPORAL',' >> "$RESULT_FILE"
echo '  "worker_created": '$WORKER_CREATED',' >> "$RESULT_FILE"
echo '  "realtime_subscribed": '$REALTIME_SUBSCRIBED',' >> "$RESULT_FILE"
echo '  "correct_channel": '$CORRECT_CHANNEL',' >> "$RESULT_FILE"
echo '  "correct_filter": '$CORRECT_FILTER',' >> "$RESULT_FILE"
echo '  "worker_running": '$WORKER_RUNNING',' >> "$RESULT_FILE"
echo '  "has_errors": '$HAS_ERRORS',' >> "$RESULT_FILE"
echo '  "process_alive": '$PROCESS_ALIVE',' >> "$RESULT_FILE"
echo '  "worker_pid": '$WORKER_PID',' >> "$RESULT_FILE"

# Overall status
if [[ "$REALTIME_SUBSCRIBED" == "true" ]] && [[ "$WORKER_RUNNING" == "true" ]] && [[ "$HAS_ERRORS" == "false" ]] && [[ "$PROCESS_ALIVE" == "true" ]]; then
  echo '  "status": "success",' >> "$RESULT_FILE"
  echo '  "message": "Worker started successfully and subscribed to Realtime"' >> "$RESULT_FILE"
  EXIT_CODE=0
else
  echo '  "status": "failed",' >> "$RESULT_FILE"
  echo '  "message": "Worker startup or subscription failed"' >> "$RESULT_FILE"
  EXIT_CODE=1
  # Kill worker if it started
  kill $WORKER_PID 2>/dev/null || true
fi

echo "}" >> "$RESULT_FILE"

echo "Test 2 complete. Results: $RESULT_FILE"
exit $EXIT_CODE
```

### Success Criteria

```json
{
  "status": "success",
  "realtime_subscribed": true,
  "worker_running": true,
  "has_errors": false,
  "process_alive": true
}
```

### Execution Notes

*(Agent will add notes here during execution)*

---

## Test 3: Event Reception and Workflow Triggering

**Status**: ⏸️ PENDING
**Objective**: Insert test event and verify worker receives it, starts workflow
**Output**: `/tmp/temporal-worker-realtime-tests/03-event-reception.json`

### Script: `test-03-event-reception.sh`

**Location**: `/tmp/temporal-worker-realtime-tests/test-03-event-reception.sh`

```bash
#!/bin/bash
# Test event reception via Realtime and workflow triggering
# Output: /tmp/temporal-worker-realtime-tests/03-event-reception.json

set -e

RESULTS_DIR="/tmp/temporal-worker-realtime-tests"
RESULT_FILE="$RESULTS_DIR/03-event-reception.json"

# Load test environment
source "$RESULTS_DIR/test-env.sh"

echo "{" > "$RESULT_FILE"
echo '  "test": "event-reception",' >> "$RESULT_FILE"
echo '  "timestamp": "'$(date -Iseconds)'",' >> "$RESULT_FILE"

# Get current log size (to detect new logs)
INITIAL_LOG_SIZE=$(wc -l < "$RESULTS_DIR/worker-startup.log")

# Insert test event into database
echo "Inserting test event..."
PGPASSWORD=postgres psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" > "$RESULTS_DIR/insert-event.log" 2>&1 <<'SQL'
INSERT INTO domain_events (
  stream_id,
  stream_type,
  stream_version,
  event_type,
  event_data,
  event_metadata
) VALUES (
  gen_random_uuid(),
  'organization',
  1,
  'organization.bootstrap.initiated',
  '{"subdomain": "test-realtime-001", "orgData": {"name": "Test Realtime Org"}, "users": [{"email": "admin@test.com", "role": "admin"}]}'::jsonb,
  '{}'::jsonb
) RETURNING id, stream_id, event_type, created_at;
SQL

# Extract event details
EVENT_ID=$(grep -A 1 "id" "$RESULTS_DIR/insert-event.log" | tail -1 | tr -d ' ')
STREAM_ID=$(grep -A 1 "stream_id" "$RESULTS_DIR/insert-event.log" | tail -1 | tr -d ' ')

# Wait for worker to process event (max 10 seconds)
echo "Waiting for worker to process event..."
sleep 5

# Get new log entries
tail -n +$((INITIAL_LOG_SIZE + 1)) "$RESULTS_DIR/worker-startup.log" > "$RESULTS_DIR/new-logs.log"

# Check for event reception
NOTIFICATION_RECEIVED="false"
if grep -q "Received notification" "$RESULTS_DIR/new-logs.log"; then
  NOTIFICATION_RECEIVED="true"
fi

# Check for workflow start
WORKFLOW_STARTED="false"
WORKFLOW_ID=""
if grep -q "Starting workflow" "$RESULTS_DIR/new-logs.log"; then
  WORKFLOW_STARTED="true"
  WORKFLOW_ID="org-bootstrap-$STREAM_ID"
fi

# Check workflow ID format
CORRECT_WORKFLOW_ID="false"
if grep -q "org-bootstrap-" "$RESULTS_DIR/new-logs.log"; then
  CORRECT_WORKFLOW_ID="true"
fi

# Check for workflow_started event emission
WORKFLOW_EVENT_EMITTED="false"
if grep -q "Emitted workflow_started event" "$RESULTS_DIR/new-logs.log"; then
  WORKFLOW_EVENT_EMITTED="true"
fi

# Verify workflow in Temporal using CLI
WORKFLOW_IN_TEMPORAL="false"
WORKFLOW_STATUS="unknown"
if [[ -n "$WORKFLOW_ID" ]]; then
  temporal workflow describe --workflow-id="$WORKFLOW_ID" --namespace=default > "$RESULTS_DIR/workflow-describe.log" 2>&1
  if [[ $? -eq 0 ]]; then
    WORKFLOW_IN_TEMPORAL="true"
    WORKFLOW_STATUS=$(grep "Status:" "$RESULTS_DIR/workflow-describe.log" | awk '{print $2}')
  fi
fi

# Check for errors
HAS_ERRORS="false"
if grep -qi "error\|failed" "$RESULTS_DIR/new-logs.log" | grep -v "Error handling"; then
  HAS_ERRORS="true"
fi

# Write results
echo '  "event_id": "'$EVENT_ID'",' >> "$RESULT_FILE"
echo '  "stream_id": "'$STREAM_ID'",' >> "$RESULT_FILE"
echo '  "notification_received": '$NOTIFICATION_RECEIVED',' >> "$RESULT_FILE"
echo '  "workflow_started": '$WORKFLOW_STARTED',' >> "$RESULT_FILE"
echo '  "workflow_id": "'$WORKFLOW_ID'",' >> "$RESULT_FILE"
echo '  "correct_workflow_id": '$CORRECT_WORKFLOW_ID',' >> "$RESULT_FILE"
echo '  "workflow_event_emitted": '$WORKFLOW_EVENT_EMITTED',' >> "$RESULT_FILE"
echo '  "workflow_in_temporal": '$WORKFLOW_IN_TEMPORAL',' >> "$RESULT_FILE"
echo '  "workflow_status": "'$WORKFLOW_STATUS'",' >> "$RESULT_FILE"
echo '  "has_errors": '$HAS_ERRORS',' >> "$RESULT_FILE"

# Overall status
if [[ "$NOTIFICATION_RECEIVED" == "true" ]] && [[ "$WORKFLOW_STARTED" == "true" ]] && [[ "$WORKFLOW_IN_TEMPORAL" == "true" ]] && [[ "$HAS_ERRORS" == "false" ]]; then
  echo '  "status": "success",' >> "$RESULT_FILE"
  echo '  "message": "Event received via Realtime and workflow started successfully"' >> "$RESULT_FILE"
  EXIT_CODE=0
else
  echo '  "status": "failed",' >> "$RESULT_FILE"
  echo '  "message": "Event reception or workflow start failed"' >> "$RESULT_FILE"
  EXIT_CODE=1
fi

echo "}" >> "$RESULT_FILE"

echo "Test 3 complete. Results: $RESULT_FILE"
exit $EXIT_CODE
```

### Success Criteria

```json
{
  "status": "success",
  "notification_received": true,
  "workflow_started": true,
  "workflow_in_temporal": true,
  "workflow_status": "Running" | "Completed",
  "has_errors": false
}
```

### Execution Notes

*(Agent will add notes here during execution)*

---

## Test 4: Multiple Concurrent Events

**Status**: ⏸️ PENDING
**Objective**: Verify worker handles multiple events correctly
**Output**: `/tmp/temporal-worker-realtime-tests/04-multiple-events.json`

### Script: `test-04-multiple-events.sh`

**Location**: `/tmp/temporal-worker-realtime-tests/test-04-multiple-events.sh`

```bash
#!/bin/bash
# Test multiple concurrent event handling
# Output: /tmp/temporal-worker-realtime-tests/04-multiple-events.json

set -e

RESULTS_DIR="/tmp/temporal-worker-realtime-tests"
RESULT_FILE="$RESULTS_DIR/04-multiple-events.json"

echo "{" > "$RESULT_FILE"
echo '  "test": "multiple-events",' >> "$RESULT_FILE"
echo '  "timestamp": "'$(date -Iseconds)'",' >> "$RESULT_FILE"

# Get current log size
INITIAL_LOG_SIZE=$(wc -l < "$RESULTS_DIR/worker-startup.log")

# Insert 5 events
echo "Inserting 5 test events..."
PGPASSWORD=postgres psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" > "$RESULTS_DIR/insert-multiple.log" 2>&1 <<'SQL'
INSERT INTO domain_events (stream_id, stream_type, stream_version, event_type, event_data, event_metadata)
SELECT
  gen_random_uuid(), 'organization', 1,
  'organization.bootstrap.initiated',
  ('{"subdomain": "test-multi-' || i || '", "orgData": {"name": "Multi Test ' || i || '"}, "users": []}')::jsonb,
  '{}'::jsonb
FROM generate_series(1, 5) AS i
RETURNING id, stream_id;
SQL

# Extract stream IDs
STREAM_IDS=$(grep -oP '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' "$RESULTS_DIR/insert-multiple.log" | uniq)
EVENT_COUNT=$(echo "$STREAM_IDS" | wc -l)

# Wait for processing
sleep 10

# Get new logs
tail -n +$((INITIAL_LOG_SIZE + 1)) "$RESULTS_DIR/worker-startup.log" > "$RESULTS_DIR/multiple-logs.log"

# Count notifications received
NOTIFICATIONS_COUNT=$(grep -c "Received notification" "$RESULTS_DIR/multiple-logs.log" || echo "0")

# Count workflows started
WORKFLOWS_COUNT=$(grep -c "✅ Workflow started" "$RESULTS_DIR/multiple-logs.log" || echo "0")

# Verify workflows in Temporal
WORKFLOWS_IN_TEMPORAL=0
while IFS= read -r stream_id; do
  if temporal workflow describe --workflow-id="org-bootstrap-$stream_id" --namespace=default &>/dev/null; then
    ((WORKFLOWS_IN_TEMPORAL++))
  fi
done <<< "$STREAM_IDS"

# Write results
echo '  "events_inserted": '$EVENT_COUNT',' >> "$RESULT_FILE"
echo '  "notifications_received": '$NOTIFICATIONS_COUNT',' >> "$RESULT_FILE"
echo '  "workflows_started": '$WORKFLOWS_COUNT',' >> "$RESULT_FILE"
echo '  "workflows_in_temporal": '$WORKFLOWS_IN_TEMPORAL',' >> "$RESULT_FILE"

# Overall status
if [[ $NOTIFICATIONS_COUNT -eq $EVENT_COUNT ]] && [[ $WORKFLOWS_COUNT -eq $EVENT_COUNT ]] && [[ $WORKFLOWS_IN_TEMPORAL -eq $EVENT_COUNT ]]; then
  echo '  "status": "success",' >> "$RESULT_FILE"
  echo '  "message": "All events received and workflows started"' >> "$RESULT_FILE"
  EXIT_CODE=0
else
  echo '  "status": "failed",' >> "$RESULT_FILE"
  echo '  "message": "Some events were dropped or workflows failed to start"' >> "$RESULT_FILE"
  EXIT_CODE=1
fi

echo "}" >> "$RESULT_FILE"

echo "Test 4 complete. Results: $RESULT_FILE"
exit $EXIT_CODE
```

### Success Criteria

```json
{
  "status": "success",
  "events_inserted": 5,
  "notifications_received": 5,
  "workflows_started": 5,
  "workflows_in_temporal": 5
}
```

### Execution Notes

*(Agent will add notes here during execution)*

---

## Test 5: Reconnection Behavior

**Status**: ⏸️ PENDING
**Objective**: Verify automatic reconnection after Realtime drops
**Output**: `/tmp/temporal-worker-realtime-tests/05-reconnection.json`

### Script: `test-05-reconnection.sh`

**Location**: `/tmp/temporal-worker-realtime-tests/test-05-reconnection.sh`

```bash
#!/bin/bash
# Test automatic reconnection
# Output: /tmp/temporal-worker-realtime-tests/05-reconnection.json

set -e

RESULTS_DIR="/tmp/temporal-worker-realtime-tests"
RESULT_FILE="$RESULTS_DIR/05-reconnection.json"

echo "{" > "$RESULT_FILE"
echo '  "test": "reconnection",' >> "$RESULT_FILE"
echo '  "timestamp": "'$(date -Iseconds)'",' >> "$RESULT_FILE"

# Get current log size
INITIAL_LOG_SIZE=$(wc -l < "$RESULTS_DIR/worker-startup.log")

# Stop Supabase
echo "Stopping Supabase to simulate connection drop..."
cd /home/lars/dev/A4C-AppSuite/infrastructure/supabase
./local-tests/stop-local.sh > /dev/null 2>&1

# Wait for worker to detect disconnect
sleep 7

# Get logs
tail -n +$((INITIAL_LOG_SIZE + 1)) "$RESULTS_DIR/worker-startup.log" > "$RESULTS_DIR/reconnect-phase1.log"

# Check for reconnection attempt
DETECTED_DISCONNECT="false"
if grep -q "Subscription closed\|Attempting to reconnect" "$RESULTS_DIR/reconnect-phase1.log"; then
  DETECTED_DISCONNECT="true"
fi

# Restart Supabase
echo "Restarting Supabase..."
./local-tests/start-local.sh > /dev/null 2>&1
sleep 5

# Wait for reconnection
sleep 10

# Get new logs
RECONNECT_LOG_SIZE=$(wc -l < "$RESULTS_DIR/worker-startup.log")
tail -n +$((INITIAL_LOG_SIZE + 1)) "$RESULTS_DIR/worker-startup.log" > "$RESULTS_DIR/reconnect-phase2.log"

# Check for successful reconnection
RECONNECTED="false"
if grep -q "✅ Reconnected successfully\|✅ Subscribed to workflow events via Supabase Realtime" "$RESULTS_DIR/reconnect-phase2.log"; then
  RECONNECTED="true"
fi

# Insert test event after reconnection
echo "Inserting test event after reconnection..."
PGPASSWORD=postgres psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" > "$RESULTS_DIR/reconnect-event.log" 2>&1 <<'SQL'
INSERT INTO domain_events (stream_id, stream_type, stream_version, event_type, event_data, event_metadata)
VALUES (
  gen_random_uuid(), 'organization', 1,
  'organization.bootstrap.initiated',
  '{"subdomain": "test-reconnect", "orgData": {"name": "Reconnect Test"}, "users": []}'::jsonb,
  '{}'::jsonb
) RETURNING stream_id;
SQL

STREAM_ID=$(grep -oP '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' "$RESULTS_DIR/reconnect-event.log")

# Wait for processing
sleep 5

# Get final logs
tail -n +$((RECONNECT_LOG_SIZE + 1)) "$RESULTS_DIR/worker-startup.log" > "$RESULTS_DIR/reconnect-phase3.log"

# Check if event was received after reconnection
EVENT_RECEIVED_AFTER_RECONNECT="false"
if grep -q "Received notification" "$RESULTS_DIR/reconnect-phase3.log"; then
  EVENT_RECEIVED_AFTER_RECONNECT="true"
fi

# Verify workflow started
WORKFLOW_STARTED_AFTER_RECONNECT="false"
if grep -q "✅ Workflow started" "$RESULTS_DIR/reconnect-phase3.log"; then
  WORKFLOW_STARTED_AFTER_RECONNECT="true"
fi

# Write results
echo '  "detected_disconnect": '$DETECTED_DISCONNECT',' >> "$RESULT_FILE"
echo '  "reconnected": '$RECONNECTED',' >> "$RESULT_FILE"
echo '  "event_received_after_reconnect": '$EVENT_RECEIVED_AFTER_RECONNECT',' >> "$RESULT_FILE"
echo '  "workflow_started_after_reconnect": '$WORKFLOW_STARTED_AFTER_RECONNECT',' >> "$RESULT_FILE"

# Overall status
if [[ "$DETECTED_DISCONNECT" == "true" ]] && [[ "$RECONNECTED" == "true" ]] && [[ "$EVENT_RECEIVED_AFTER_RECONNECT" == "true" ]]; then
  echo '  "status": "success",' >> "$RESULT_FILE"
  echo '  "message": "Worker successfully reconnected and processed events"' >> "$RESULT_FILE"
  EXIT_CODE=0
else
  echo '  "status": "failed",' >> "$RESULT_FILE"
  echo '  "message": "Reconnection failed or events not processed after reconnect"' >> "$RESULT_FILE"
  EXIT_CODE=1
fi

echo "}" >> "$RESULT_FILE"

echo "Test 5 complete. Results: $RESULT_FILE"
exit $EXIT_CODE
```

### Success Criteria

```json
{
  "status": "success",
  "detected_disconnect": true,
  "reconnected": true,
  "event_received_after_reconnect": true,
  "workflow_started_after_reconnect": true
}
```

### Execution Notes

*(Agent will add notes here during execution)*

---

## Test 6: Graceful Shutdown

**Status**: ⏸️ PENDING
**Objective**: Verify worker shuts down cleanly
**Output**: `/tmp/temporal-worker-realtime-tests/06-shutdown.json`

### Script: `test-06-shutdown.sh`

**Location**: `/tmp/temporal-worker-realtime-tests/test-06-shutdown.sh`

```bash
#!/bin/bash
# Test graceful shutdown
# Output: /tmp/temporal-worker-realtime-tests/06-shutdown.json

set -e

RESULTS_DIR="/tmp/temporal-worker-realtime-tests"
RESULT_FILE="$RESULTS_DIR/06-shutdown.json"

echo "{" > "$RESULT_FILE"
echo '  "test": "graceful-shutdown",' >> "$RESULT_FILE"
echo '  "timestamp": "'$(date -Iseconds)'",' >> "$RESULT_FILE"

# Read worker PID
WORKER_PID=$(cat "$RESULTS_DIR/worker.pid")

# Get current log size
INITIAL_LOG_SIZE=$(wc -l < "$RESULTS_DIR/worker-startup.log")

# Send SIGINT (Ctrl+C equivalent)
echo "Sending SIGINT to worker (PID: $WORKER_PID)..."
kill -INT $WORKER_PID

# Wait for shutdown (max 30 seconds)
for i in {1..30}; do
  if ! kill -0 $WORKER_PID 2>/dev/null; then
    break
  fi
  sleep 1
done

# Get shutdown logs
tail -n +$((INITIAL_LOG_SIZE + 1)) "$RESULTS_DIR/worker-startup.log" > "$RESULTS_DIR/shutdown-logs.log"

# Check for shutdown messages
RECEIVED_SIGNAL="false"
if grep -q "Received SIGINT\|starting graceful shutdown" "$RESULTS_DIR/shutdown-logs.log"; then
  RECEIVED_SIGNAL="true"
fi

EVENT_LISTENER_STOPPED="false"
if grep -q "Event listener stopped\|Stopping event listener" "$RESULTS_DIR/shutdown-logs.log"; then
  EVENT_LISTENER_STOPPED="true"
fi

WORKER_SHUTDOWN="false"
if grep -q "Worker shutdown complete" "$RESULTS_DIR/shutdown-logs.log"; then
  WORKER_SHUTDOWN="true"
fi

TEMPORAL_CLOSED="false"
if grep -q "Temporal connection closed" "$RESULTS_DIR/shutdown-logs.log"; then
  TEMPORAL_CLOSED="true"
fi

SHUTDOWN_COMPLETE="false"
if grep -q "Graceful shutdown complete" "$RESULTS_DIR/shutdown-logs.log"; then
  SHUTDOWN_COMPLETE="true"
fi

# Verify process is not running
PROCESS_STOPPED="false"
if ! kill -0 $WORKER_PID 2>/dev/null; then
  PROCESS_STOPPED="true"
fi

# Write results
echo '  "received_signal": '$RECEIVED_SIGNAL',' >> "$RESULT_FILE"
echo '  "event_listener_stopped": '$EVENT_LISTENER_STOPPED',' >> "$RESULT_FILE"
echo '  "worker_shutdown": '$WORKER_SHUTDOWN',' >> "$RESULT_FILE"
echo '  "temporal_closed": '$TEMPORAL_CLOSED',' >> "$RESULT_FILE"
echo '  "shutdown_complete": '$SHUTDOWN_COMPLETE',' >> "$RESULT_FILE"
echo '  "process_stopped": '$PROCESS_STOPPED',' >> "$RESULT_FILE"

# Overall status
if [[ "$SHUTDOWN_COMPLETE" == "true" ]] && [[ "$PROCESS_STOPPED" == "true" ]]; then
  echo '  "status": "success",' >> "$RESULT_FILE"
  echo '  "message": "Worker shutdown gracefully"' >> "$RESULT_FILE"
  EXIT_CODE=0
else
  echo '  "status": "failed",' >> "$RESULT_FILE"
  echo '  "message": "Worker did not shutdown gracefully"' >> "$RESULT_FILE"
  EXIT_CODE=1
  # Force kill if still running
  kill -9 $WORKER_PID 2>/dev/null || true
fi

echo "}" >> "$RESULT_FILE"

echo "Test 6 complete. Results: $RESULT_FILE"
exit $EXIT_CODE
```

### Success Criteria

```json
{
  "status": "success",
  "shutdown_complete": true,
  "process_stopped": true
}
```

### Execution Notes

*(Agent will add notes here during execution)*

---

## Cleanup

**Status**: ⏸️ PENDING
**Objective**: Clean up test environment and data
**Output**: `/tmp/temporal-worker-realtime-tests/99-cleanup.json`

### Script: `cleanup.sh`

**Location**: `/tmp/temporal-worker-realtime-tests/cleanup.sh`

```bash
#!/bin/bash
# Cleanup test environment
# Output: /tmp/temporal-worker-realtime-tests/99-cleanup.json

set -e

RESULTS_DIR="/tmp/temporal-worker-realtime-tests"
RESULT_FILE="$RESULTS_DIR/99-cleanup.json"

echo "{" > "$RESULT_FILE"
echo '  "test": "cleanup",' >> "$RESULT_FILE"
echo '  "timestamp": "'$(date -Iseconds)'",' >> "$RESULT_FILE"

# Kill worker if still running
if [[ -f "$RESULTS_DIR/worker.pid" ]]; then
  WORKER_PID=$(cat "$RESULTS_DIR/worker.pid")
  if kill -0 $WORKER_PID 2>/dev/null; then
    echo "Killing worker process..."
    kill -9 $WORKER_PID 2>/dev/null || true
  fi
fi

# Delete test events from database
echo "Cleaning up test data..."
PGPASSWORD=postgres psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" > "$RESULTS_DIR/cleanup-db.log" 2>&1 <<'SQL'
DELETE FROM domain_events
WHERE event_data->>'subdomain' LIKE 'test-%'
RETURNING id;
SQL

DELETED_COUNT=$(grep -c "[0-9a-f-]" "$RESULTS_DIR/cleanup-db.log" || echo "0")

# Stop Supabase
echo "Stopping Supabase..."
cd /home/lars/dev/A4C-AppSuite/infrastructure/supabase
./local-tests/stop-local.sh > /dev/null 2>&1

echo '  "worker_killed": true,' >> "$RESULT_FILE"
echo '  "test_events_deleted": '$DELETED_COUNT',' >> "$RESULT_FILE"
echo '  "supabase_stopped": true,' >> "$RESULT_FILE"
echo '  "status": "success",' >> "$RESULT_FILE"
echo '  "message": "Cleanup complete"' >> "$RESULT_FILE"
echo "}" >> "$RESULT_FILE"

echo "Cleanup complete. Results: $RESULT_FILE"
```

### Execution Notes

*(Agent will add notes here during execution)*

---

## Master Test Runner

### Script: `run-all-tests.sh`

**Location**: `/tmp/temporal-worker-realtime-tests/run-all-tests.sh`

```bash
#!/bin/bash
# Master test runner
# Output: /tmp/temporal-worker-realtime-tests/test-summary.json

set -e

RESULTS_DIR="/tmp/temporal-worker-realtime-tests"
mkdir -p "$RESULTS_DIR"

SUMMARY_FILE="$RESULTS_DIR/test-summary.json"

echo "========================================"
echo "Temporal Worker Realtime Migration Tests"
echo "========================================"
echo ""

# Prerequisites
echo "Running Prerequisites: Supabase Setup..."
bash setup-local-supabase.sh
SETUP_EXIT=$?

if [[ $SETUP_EXIT -ne 0 ]]; then
  echo "❌ Prerequisites failed. Aborting tests."
  exit 1
fi

echo "✅ Prerequisites passed"
echo ""

# Run tests
TESTS=(
  "test-01-env-validation.sh"
  "test-02-worker-startup.sh"
  "test-03-event-reception.sh"
  "test-04-multiple-events.sh"
  "test-05-reconnection.sh"
  "test-06-shutdown.sh"
)

PASSED=0
FAILED=0

for test in "${TESTS[@]}"; do
  echo "Running: $test"
  if bash "$test"; then
    echo "✅ PASSED: $test"
    ((PASSED++))
  else
    echo "❌ FAILED: $test"
    ((FAILED++))
  fi
  echo ""
done

# Cleanup
echo "Running cleanup..."
bash cleanup.sh

# Generate summary
echo "{" > "$SUMMARY_FILE"
echo '  "test_suite": "temporal-worker-realtime-migration",' >> "$SUMMARY_FILE"
echo '  "timestamp": "'$(date -Iseconds)'",' >> "$SUMMARY_FILE"
echo '  "total_tests": '${#TESTS[@]}',' >> "$SUMMARY_FILE"
echo '  "passed": '$PASSED',' >> "$SUMMARY_FILE"
echo '  "failed": '$FAILED',' >> "$SUMMARY_FILE"
echo '  "results": {' >> "$SUMMARY_FILE"

# Include all test results
for i in {0..6} 99; do
  if [[ -f "$RESULTS_DIR/0${i}-"*.json ]]; then
    TEST_FILE=$(ls "$RESULTS_DIR/0${i}-"*.json 2>/dev/null | head -1)
    TEST_NAME=$(basename "$TEST_FILE" .json)
    echo "    \"$TEST_NAME\": $(cat "$TEST_FILE")," >> "$SUMMARY_FILE"
  fi
done

# Remove trailing comma and close
sed -i '$ s/,$//' "$SUMMARY_FILE"
echo '  },' >> "$SUMMARY_FILE"

if [[ $FAILED -eq 0 ]]; then
  echo '  "overall_status": "success",' >> "$SUMMARY_FILE"
  echo '  "message": "All tests passed"' >> "$SUMMARY_FILE"
  EXIT_CODE=0
else
  echo '  "overall_status": "failed",' >> "$SUMMARY_FILE"
  echo '  "message": "'$FAILED' test(s) failed"' >> "$SUMMARY_FILE"
  EXIT_CODE=1
fi

echo "}" >> "$SUMMARY_FILE"

echo "========================================"
echo "Test Summary"
echo "========================================"
echo "Total: ${#TESTS[@]}"
echo "Passed: $PASSED"
echo "Failed: $FAILED"
echo ""
echo "Results: $SUMMARY_FILE"
echo "========================================"

exit $EXIT_CODE
```

---

## Test Results Files

All test outputs are written to `/tmp/temporal-worker-realtime-tests/`:

| File | Description |
|------|-------------|
| `test-summary.json` | Overall test suite results |
| `00-setup.json` | Supabase setup validation |
| `01-env-validation.json` | Environment validation results |
| `02-worker-startup.json` | Worker startup and subscription |
| `03-event-reception.json` | Event reception and workflow triggering |
| `04-multiple-events.json` | Concurrent event handling |
| `05-reconnection.json` | Automatic reconnection |
| `06-shutdown.json` | Graceful shutdown |
| `99-cleanup.json` | Cleanup results |

---

## Overall Success Criteria

**Phase 3 testing is complete when:**

```json
{
  "overall_status": "success",
  "total_tests": 6,
  "passed": 6,
  "failed": 0
}
```

All individual tests must show `"status": "success"` in their respective JSON output files.

---

## Post-Test Analysis

*(Agent will add analysis here after test execution)*

### Issues Found

*(Agent will document any issues discovered during testing)*

### Performance Observations

*(Agent will note any performance-related observations)*

### Recommendations

*(Agent will provide recommendations based on test results)*

---

## Next Steps After Testing

Once all tests pass:
- [ ] Proceed to Phase 4: Kubernetes Deployment
- [ ] Build and push Docker image
- [ ] Deploy to k8s cluster
- [ ] Run end-to-end verification in production
