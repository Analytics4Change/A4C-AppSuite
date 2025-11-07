# Local Supabase Testing Guide

This guide helps you test SQL migrations and Edge Functions locally before enabling GitHub Actions automation.

## Prerequisites

- Podman installed and running
- Supabase CLI installed (already done)
- Docker symlink to Podman (already done)

## Quick Start

### 1. Start Local Supabase

In a **separate terminal** (keeps running):
```bash
cd infrastructure/supabase
./start-local.sh
```

Wait for all containers to start. You'll see connection URLs displayed.

### 2. Run Migrations (First Time)

In your **main terminal**:
```bash
./run-migrations.sh
```

This will:
- Apply all SQL files in dependency order (00-extensions → 99-seeds)
- Show progress for each file
- Report success/failure summary

### 3. Test Idempotency (Second Run)

Run the **exact same command again**:
```bash
./run-migrations.sh
```

**Expected Result**: All migrations should succeed with zero errors.

**If errors occur**: These are idempotency issues that need fixing!

### 4. Verify Results

Check for duplicate data and counts:
```bash
./verify-idempotency.sh
```

This shows:
- ✅ No duplicate IDs (good)
- ❌ Duplicate IDs found (needs fixing)
- Table row counts (should be same on both runs)
- Trigger and function counts

### 5. Stop Local Supabase

When done testing:
```bash
./stop-local.sh
```

## Complete Test Cycle

```bash
# Terminal 1: Start Supabase
./start-local.sh

# Terminal 2: Test migrations
./run-migrations.sh          # Run 1
./verify-idempotency.sh      # Check results
./run-migrations.sh          # Run 2 (should be clean)
./verify-idempotency.sh      # Verify no duplicates

# Clean up
./stop-local.sh
```

## Checking Status

At any time, check if Supabase is running:
```bash
./status-local.sh
```

This shows:
- Container status
- Connection URLs
- API keys
- Dashboard URL (http://localhost:54323)

## Common Issues

### "Could not get database URL"
- Supabase not running
- Run `./start-local.sh` first

### "Permission denied" on Podman socket
- DOCKER_HOST not set correctly
- Scripts handle this automatically
- Or run: `export DOCKER_HOST=unix:///run/user/1000/podman/podman.sock`

### Migration fails on second run
- **This is expected for testing!**
- Document the failure
- Fix the SQL file (add IF EXISTS, ON CONFLICT, etc.)
- Test again

## Idempotency Patterns

### Triggers
```sql
DROP TRIGGER IF EXISTS trigger_name ON table_name;
CREATE TRIGGER trigger_name ...
```

### Seed Data
```sql
INSERT INTO table_name (id, name)
VALUES ('uuid', 'value')
ON CONFLICT (id) DO NOTHING;
```

### Tables
```sql
CREATE TABLE IF NOT EXISTS table_name ...
```

### Functions
```sql
CREATE OR REPLACE FUNCTION function_name() ...
```

## Next Steps

After all migrations pass twice:
1. Document any issues found in SQL_IDEMPOTENCY_AUDIT.md
2. Fix critical issues (triggers, seeds)
3. Enable GitHub Actions workflow
4. Deploy automatically on push to main

## Testing Edge Functions

### Deploy Edge Functions (First Time)

In your **main terminal**:
```bash
./deploy-functions.sh
```

This will:
- Deploy all Edge Functions to local Supabase
- Show progress for each function
- Report success/failure summary

### Test Idempotency (Second Run)

Run the **exact same command again**:
```bash
./deploy-functions.sh
```

**Expected Result**: All functions should deploy successfully with zero errors.

**If errors occur**: These are deployment issues that need investigation!

### Verify Edge Functions

Check that functions are accessible:
```bash
./verify-functions.sh
```

This shows:
- ✅ Function deployed and responding (good)
- ❌ Function not accessible (needs fixing)
- HTTP status codes for each function endpoint

### Complete Test Cycle with Edge Functions

```bash
# Terminal 1: Start Supabase
./start-local.sh

# Terminal 2: Test everything
./run-migrations.sh          # Run 1 - SQL migrations
./verify-idempotency.sh      # Check SQL results
./run-migrations.sh          # Run 2 - SQL (should be clean)
./verify-idempotency.sh      # Verify no duplicates

./deploy-functions.sh        # Run 1 - Edge Functions
./verify-functions.sh        # Check deployment
./deploy-functions.sh        # Run 2 - Edge Functions (should be clean)
./verify-functions.sh        # Verify all accessible

# Clean up
./stop-local.sh
```

### Edge Function Idempotency

Edge Functions should be idempotent by default:
- `supabase functions deploy` overwrites existing function
- Same function can be deployed multiple times
- No duplicate function issues

**Note**: Functions use `--no-verify-jwt` flag for local testing (JWT verification disabled).
