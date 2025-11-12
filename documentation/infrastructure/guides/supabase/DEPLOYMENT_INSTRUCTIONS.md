# Organization Module Deployment Instructions

## Step 1: Deploy Database Migrations ✅

### Option A: Using Supabase Studio (Recommended)

1. **Open Supabase Studio**
   - Go to https://app.supabase.com
   - Select your project
   - Navigate to **SQL Editor** in the left sidebar

2. **Run Main Migration Script**
   - Click **New Query**
   - Copy the entire contents of `DEPLOY_ORGANIZATION_MODULE.sql`
   - Paste into the SQL editor
   - Click **Run** (or press `Ctrl+Enter`)

3. **Verify Deployment**
   - You should see a success message with table row counts
   - Check that 4 new tables were created:
     - `programs_projection`
     - `contacts_projection`
     - `addresses_projection`
     - `phones_projection`

4. **Update Event Router**
   - Open a new query in SQL Editor
   - Copy the entire contents of `UPDATE_EVENT_ROUTER.sql`
   - Paste and click **Run**
   - Verify the success message

### Option B: Using Supabase CLI

```bash
cd infrastructure/supabase

# Login to Supabase
supabase login

# Link to your project
supabase link --project-ref your-project-ref

# Run migrations
supabase db push DEPLOY_ORGANIZATION_MODULE.sql
supabase db push UPDATE_EVENT_ROUTER.sql
```

### Verification

After deployment, verify the tables exist:

```sql
-- Run this in SQL Editor
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN (
    'programs_projection',
    'contacts_projection',
    'addresses_projection',
    'phones_projection'
  );
```

You should see all 4 tables listed.

---

## Step 2: Deploy Edge Functions ✅

### Prerequisites

1. **Install Supabase CLI** (if not already installed):
   ```bash
   # macOS
   brew install supabase/tap/supabase

   # Windows
   scoop bucket add supabase https://github.com/supabase/scoop-bucket.git
   scoop install supabase

   # Linux
   brew install supabase/tap/supabase
   ```

2. **Login to Supabase**:
   ```bash
   supabase login
   ```

3. **Link to Your Project**:
   ```bash
   cd /home/tila5282@hq.brmutual.com/dev/A4C-AppSuite/infrastructure/supabase
   supabase link --project-ref your-project-ref
   ```

### Deploy Edge Functions

```bash
cd /home/tila5282@hq.brmutual.com/dev/A4C-AppSuite/infrastructure/supabase

# Deploy organization-bootstrap function
supabase functions deploy organization-bootstrap

# Deploy workflow-status function
supabase functions deploy workflow-status

# Deploy validate-invitation function
supabase functions deploy validate-invitation

# Deploy accept-invitation function
supabase functions deploy accept-invitation
```

### Set Required Secrets

```bash
# Supabase service role key (from Supabase dashboard > Settings > API)
supabase secrets set SUPABASE_SERVICE_ROLE_KEY="your-service-role-key"

# Temporal address (if using Temporal)
supabase secrets set TEMPORAL_ADDRESS="temporal-frontend.temporal.svc.cluster.local:7233"

# Optional: If using Cloudflare for DNS
supabase secrets set CLOUDFLARE_API_TOKEN="your-cloudflare-token"

# Optional: If using SMTP for emails
supabase secrets set SMTP_HOST="smtp.example.com"
supabase secrets set SMTP_USER="your-smtp-user"
supabase secrets set SMTP_PASS="your-smtp-password"
```

### Verify Deployment

1. **Check Functions in Supabase Dashboard**:
   - Go to **Edge Functions** in the left sidebar
   - You should see 4 functions:
     - `organization-bootstrap`
     - `workflow-status`
     - `validate-invitation`
     - `accept-invitation`

2. **Test a Function**:
   ```bash
   # Test workflow-status function
   curl -i --location --request GET 'https://your-project-ref.supabase.co/functions/v1/workflow-status?workflowId=test-123' \
     --header 'Authorization: Bearer YOUR_ANON_KEY'
   ```

---

## Manual Deployment (Without CLI)

If you can't use the Supabase CLI, you can deploy Edge Functions manually:

### 1. Create Functions in Supabase Dashboard

1. Go to **Edge Functions** > **Create Function**
2. For each function, create with these names:
   - `organization-bootstrap`
   - `workflow-status`
   - `validate-invitation`
   - `accept-invitation`

### 2. Copy Function Code

For each function, paste the corresponding code:

**organization-bootstrap**:
- Copy from: `functions/organization-bootstrap/index.ts`

**workflow-status**:
- Copy from: `functions/workflow-status/index.ts`

**validate-invitation**:
- Copy from: `functions/validate-invitation/index.ts`

**accept-invitation**:
- Copy from: `functions/accept-invitation/index.ts`

### 3. Configure Secrets

Go to **Settings** > **Edge Functions** > **Secrets** and add:
- `SUPABASE_SERVICE_ROLE_KEY`
- `TEMPORAL_ADDRESS` (optional)
- `CLOUDFLARE_API_TOKEN` (optional)
- `SMTP_*` credentials (optional)

---

## Post-Deployment Verification

### 1. Test Database Tables

```sql
-- Check table structures
\d programs_projection
\d contacts_projection
\d addresses_projection
\d phones_projection

-- Check event processors exist
SELECT proname
FROM pg_proc
WHERE proname IN (
  'process_program_event',
  'process_contact_event',
  'process_address_event',
  'process_phone_event'
);
```

### 2. Test Edge Functions

```bash
# Get your Supabase URL and anon key from dashboard
SUPABASE_URL="https://your-project.supabase.co"
ANON_KEY="your-anon-key"

# Test workflow-status (should return 404 for non-existent workflow)
curl "$SUPABASE_URL/functions/v1/workflow-status?workflowId=test" \
  -H "Authorization: Bearer $ANON_KEY"

# Expected response: {"error":"Workflow not found",...}
```

### 3. Test Frontend Integration

1. Start frontend in integration mode:
   ```bash
   cd frontend
   VITE_DEV_PROFILE=integration-supabase npm run dev
   ```

2. Try creating an organization:
   - Navigate to `/organizations/create`
   - Fill out the form
   - Submit
   - Should navigate to bootstrap status page

---

## Troubleshooting

### Database Migration Issues

**Problem**: "Table already exists" error
**Solution**: Tables use `CREATE TABLE IF NOT EXISTS` - this is safe to ignore

**Problem**: "Function does not exist: safe_jsonb_extract_*"
**Solution**: These helper functions should exist from earlier migrations. If missing, you need to run the core schema migrations first.

**Problem**: "Relation 'organizations_projection' does not exist"
**Solution**: Run the core organization table migrations before this deployment.

### Edge Function Issues

**Problem**: "Function not found" when testing
**Solution**:
1. Check function deployed correctly in dashboard
2. Verify URL is correct: `https://PROJECT_REF.supabase.co/functions/v1/FUNCTION_NAME`
3. Ensure you're using the correct anon key

**Problem**: "Missing authorization header"
**Solution**: Always include `Authorization: Bearer YOUR_ANON_KEY` header

**Problem**: "Internal server error" from function
**Solution**:
1. Check function logs in Supabase dashboard
2. Verify secrets are set correctly
3. Check that SUPABASE_SERVICE_ROLE_KEY is set

---

## Rollback Procedure

If you need to rollback the deployment:

### Rollback Database

```sql
-- Drop event processors
DROP FUNCTION IF EXISTS process_program_event(RECORD);
DROP FUNCTION IF EXISTS process_contact_event(RECORD);
DROP FUNCTION IF EXISTS process_address_event(RECORD);
DROP FUNCTION IF EXISTS process_phone_event(RECORD);

-- Drop tables (WARNING: This deletes all data)
DROP TABLE IF EXISTS phones_projection;
DROP TABLE IF EXISTS addresses_projection;
DROP TABLE IF EXISTS contacts_projection;
DROP TABLE IF EXISTS programs_projection;

-- Restore old event router (if needed)
-- Copy previous version from git history
```

### Rollback Edge Functions

```bash
# Delete functions via CLI
supabase functions delete organization-bootstrap
supabase functions delete workflow-status
supabase functions delete validate-invitation
supabase functions delete accept-invitation
```

Or delete manually in Supabase Dashboard > Edge Functions

---

## Next Steps After Deployment

1. ✅ **Test in Development**:
   - Set `VITE_DEV_PROFILE=integration-supabase` in frontend
   - Create a test organization
   - Verify events are created in `domain_events` table
   - Verify projections are populated

2. ✅ **Enable Row Level Security** (if needed):
   ```sql
   ALTER TABLE programs_projection ENABLE ROW LEVEL SECURITY;
   ALTER TABLE contacts_projection ENABLE ROW LEVEL SECURITY;
   ALTER TABLE addresses_projection ENABLE ROW LEVEL SECURITY;
   ALTER TABLE phones_projection ENABLE ROW LEVEL SECURITY;
   ```

3. ✅ **Create RLS Policies** (example):
   ```sql
   -- Allow users to read their organization's data
   CREATE POLICY "Users can read own org programs"
   ON programs_projection FOR SELECT
   USING (
     organization_id = (auth.jwt() -> 'app_metadata' ->> 'org_id')::UUID
   );
   ```

4. ✅ **Set Up Monitoring**:
   - Monitor Edge Function logs
   - Set up alerts for failed event processing
   - Monitor database performance

5. ✅ **Deploy to Production**:
   - Test thoroughly in staging first
   - Use same deployment process
   - Update frontend `VITE_DEV_PROFILE=production`

---

## Support

For issues or questions:
1. Check Supabase function logs in dashboard
2. Check PostgreSQL logs for event processing errors
3. Review `ORGANIZATION_MODULE_IMPLEMENTATION.md` for architecture details
4. Check git history for previous working versions

---

**Deployment Status**: ✅ Ready to Deploy
**Last Updated**: 2025-10-30
**Version**: 1.0
