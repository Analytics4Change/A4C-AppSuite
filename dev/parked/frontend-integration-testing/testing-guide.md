# Frontend Integration Testing Guide

## Overview

This guide provides step-by-step instructions for testing the frontend integration with the deployed Supabase Edge Functions for the Organization Module.

**Date**: 2025-10-30
**Status**: Configuration Complete, Ready for Testing

---

## Prerequisites

### ✅ Completed
- [x] Backend Edge Functions deployed to Supabase (4 functions)
- [x] Database schema deployed (projection tables + event processors)
- [x] SERVICE_ROLE_KEY configured in Supabase
- [x] Frontend configuration updated (`VITE_DEV_PROFILE=mock-auth-real-api`)

### 📋 Required for Testing
- [ ] Test data inserted into database (see Step 1 below)
- [ ] Frontend development server running
- [ ] Browser with developer tools open

---

## Step 1: Insert Test Data

### Option A: Using Supabase Studio (Recommended)

1. **Open Supabase Studio**:
   - Navigate to: https://supabase.com/dashboard/project/tmrjlswbsxmbglmaclxu
   - Go to: **SQL Editor** → **New Query**

2. **Execute Test Data Script**:
   - Open the file: `infrastructure/supabase/TEST_DATA_SETUP.sql`
   - Copy the entire contents
   - Paste into Supabase SQL Editor
   - Click **Run** button

3. **Verify Results**:
   - You should see confirmation queries showing:
     - 1 organization created
     - 1 program created
     - 1 contact created
     - 3 invitations created (valid, expired, already-accepted)

### Option B: Using psql (Alternative)

```bash
# From infrastructure/supabase directory
psql "postgresql://postgres:[password]@db.tmrjlswbsxmbglmaclxu.supabase.co:5432/postgres" \
  -f TEST_DATA_SETUP.sql
```

---

## Step 2: Start Frontend Development Server

```bash
cd frontend
npm run dev
```

**Expected Output**:
```
VITE v5.x.x  ready in xxx ms

➜  Local:   http://localhost:5173/
➜  Network: use --host to expose
```

**Verify Configuration**:
- Open browser console (F12)
- You should see logs indicating:
  - `Using TemporalWorkflowClient (production mode)`
  - `Using SupabaseInvitationService (production mode)`

---

## Step 3: Test Invitation Validation (validate-invitation Edge Function)

### Test Case 1: Valid Invitation

**URL**: http://localhost:5173/accept-invitation?token=test-invitation-token-123

**Expected Behavior**:
- ✅ Page loads invitation acceptance form
- ✅ Shows organization name: "Test Organization"
- ✅ Shows invited email: "invited-user@example.com"
- ✅ No expiration errors
- ✅ Form fields are enabled

**Network Tab Verification**:
- Check: **Network** → **Fetch/XHR**
- Look for: `POST https://tmrjlswbsxmbglmaclxu.supabase.co/functions/v1/validate-invitation`
- Status: `200 OK`
- Response:
  ```json
  {
    "valid": true,
    "token": "test-invitation-token-123",
    "email": "invited-user@example.com",
    "organizationName": "Test Organization",
    "organizationId": "00000000-0000-0000-0000-000000000001",
    "expired": false,
    "alreadyAccepted": false
  }
  ```

---

### Test Case 2: Expired Invitation

**URL**: http://localhost:5173/accept-invitation?token=expired-invitation-token-456

**Expected Behavior**:
- ✅ Page shows error message: "This invitation has expired"
- ✅ Form fields are disabled
- ✅ No submit button available

**Network Tab Verification**:
- Response includes: `"expired": true`

---

### Test Case 3: Already Accepted Invitation

**URL**: http://localhost:5173/accept-invitation?token=accepted-invitation-token-789

**Expected Behavior**:
- ✅ Page shows error message: "This invitation has already been accepted"
- ✅ Form fields are disabled
- ✅ Link to login page provided

**Network Tab Verification**:
- Response includes: `"alreadyAccepted": true`

---

### Test Case 4: Invalid Token

**URL**: http://localhost:5173/accept-invitation?token=invalid-token-xyz

**Expected Behavior**:
- ✅ Page shows error message: "Invalid invitation token"
- ✅ HTTP Status: `404 Not Found`

**Network Tab Verification**:
- Response includes: `"error": "Invalid invitation token"`

---

## Step 4: Test Organization Creation (organization-bootstrap Edge Function)

### Prerequisites
- User must be authenticated (mock auth profile will work)
- User must have `super_admin` or `a4c_partner` role

### Test Procedure

1. **Navigate to Organization Creation**:
   - URL: http://localhost:5173/organizations/create
   - Or: Click **Organizations** → **Create Organization** in nav

2. **Fill Out Form**:
   - **Organization Details**:
     - Name: "Integration Test Organization"
     - Type: Select "Provider"
     - Subdomain: "integration-test" (check availability)
     - Timezone: Select "America/New_York"

   - **Admin Contact**:
     - First Name: "Test"
     - Last Name: "Admin"
     - Email: "test.admin@integration-test.example.com"
     - Title: "Administrator"

   - **Billing Address**:
     - Street: "123 Test St"
     - City: "Test City"
     - State: "NY"
     - Zip Code: "12345"

   - **Billing Phone**:
     - Number: "(555) 123-4567"

   - **Program Details**:
     - Name: "Main Treatment Program"
     - Type: Select "Residential"
     - Description: "Integration test program"
     - Capacity: 50

3. **Submit Form**:
   - Click **Create Organization** button
   - Wait for processing...

4. **Expected Behavior**:
   - ✅ Form validates successfully
   - ✅ Network call to `organization-bootstrap` Edge Function
   - ✅ Redirects to workflow status page
   - ✅ Shows workflow ID and progress tracking

**Network Tab Verification**:
- Check: `POST https://tmrjlswbsxmbglmaclxu.supabase.co/functions/v1/organization-bootstrap`
- Status: `200 OK`
- Response includes:
  ```json
  {
    "workflowId": "<uuid>",
    "organizationId": "<uuid>",
    "status": "initiated"
  }
  ```

---

## Step 5: Test Workflow Status (workflow-status Edge Function)

### Automatic Testing
After organization creation, you should be redirected to the status page which automatically polls for workflow updates.

### Manual Testing

**URL**: http://localhost:5173/organizations/bootstrap/status?workflowId=<workflowId>

**Expected Behavior**:
- ✅ Page shows workflow progress
- ✅ 10 stages displayed with status indicators:
  1. Initialize Organization
  2. Create Organization Record
  3. Create Admin Contact
  4. Create Billing Address
  5. Create Billing Phone
  6. Create Program
  7. Provision DNS (Subdomain)
  8. Assign Admin Role
  9. Send Invitation Email
  10. Complete Bootstrap
- ✅ Status updates every 2 seconds (polling)

**Network Tab Verification**:
- Check: `GET https://tmrjlswbsxmbglmaclxu.supabase.co/functions/v1/workflow-status?workflowId=<id>`
- Status: `200 OK`
- Response includes stages array with status for each stage

**Note**: Since Temporal workflows are not fully implemented yet, the workflow will likely show "initiated" status indefinitely. This is EXPECTED and doesn't block frontend testing.

---

## Step 6: Verify Event-Driven Architecture

### Check Domain Events Table

**Execute in Supabase Studio**:
```sql
-- View recent domain events
SELECT
  id,
  stream_type,
  event_type,
  event_data->>'organization_name' as org_name,
  event_data->>'subdomain' as subdomain,
  created_at
FROM domain_events
WHERE stream_type = 'organization'
ORDER BY created_at DESC
LIMIT 10;
```

**Expected Results**:
- ✅ Event with type: `organization.bootstrap.initiated`
- ✅ Event includes organization name and subdomain
- ✅ Timestamp matches your test submission

### Check Projection Updates (After Temporal Implementation)

**Execute in Supabase Studio**:
```sql
-- View organizations created via workflow
SELECT
  id,
  name,
  slug,
  subdomain,
  status,
  created_at
FROM organizations_projection
ORDER BY created_at DESC
LIMIT 5;
```

**Note**: Projections will only update after Temporal workflows are implemented and process the events.

---

## Expected Limitations

### 1. Workflow Won't Complete
**Symptom**: Status page shows "initiated" indefinitely
**Reason**: Temporal workflows not yet implemented
**Impact**: Frontend integration can still be tested - Edge Functions work correctly

### 2. DNS Won't Be Provisioned
**Symptom**: DNS stage shows pending/failed
**Reason**: Cloudflare API not configured
**Impact**: Expected - doesn't block testing

### 3. Email Won't Send
**Symptom**: Email stage shows pending/failed
**Reason**: SMTP/Resend not configured
**Impact**: Expected - doesn't block testing

---

## Success Criteria

### ✅ Configuration Phase (Completed)
- [x] VITE_DEV_PROFILE documented in .env.local
- [x] Profile set to `mock-auth-real-api`
- [x] Supabase URL and keys verified
- [x] Service factories verified

### 🔄 Testing Phase (Ready to Execute)
- [ ] Test data inserted successfully
- [ ] Frontend server started without errors
- [ ] Valid invitation test passes
- [ ] Expired invitation test shows error correctly
- [ ] Already-accepted invitation test shows error correctly
- [ ] Invalid token test shows 404 error
- [ ] Organization creation form submits successfully
- [ ] Workflow status page loads and polls
- [ ] Domain events created in database
- [ ] No console errors during testing

---

## Troubleshooting

### Problem: "Could not find the table 'api.organizations_projection'"
**Solution**: PostgREST schema cache needs refresh
- Go to: Supabase Dashboard → Settings → API
- Click: **Reload schema cache**
- Note: This doesn't affect Edge Functions (they connect directly to PostgreSQL)

### Problem: "Missing authorization header" when testing functions
**Solution**: Functions require authentication
- Invitation validation: Uses anon key (should work)
- Organization bootstrap: Requires authenticated user (mock auth should provide)
- Check browser console for auth errors

### Problem: Service factories using wrong implementation
**Solution**: Verify VITE_DEV_PROFILE setting
- Check: `frontend/.env.local`
- Should be: `VITE_DEV_PROFILE=mock-auth-real-api`
- Restart dev server after changes

### Problem: Edge Function returns 500 error
**Solution**: Check function logs in Supabase
- Go to: Functions → Select function → Logs
- Look for error messages
- Common issues: Missing SERVICE_ROLE_KEY, database connection errors

---

## Next Steps After Testing

Once frontend integration is verified:

### 1. Implement Temporal Workflows (4-8 hours)
- Create `OrganizationBootstrapWorkflow`
- Implement 8 activities with idempotency
- Deploy worker to Kubernetes
- Location: `temporal/src/workflows/` and `temporal/src/activities/`

### 2. Configure External Services (1-2 hours)
- Cloudflare DNS API token
- Email provider (Resend recommended)
- Update Kubernetes secrets

### 3. End-to-End Testing (2-4 hours)
- Complete workflow from creation to acceptance
- Verify all 10 stages complete
- Test invitation email delivery
- Verify subdomain provisioning

---

## Contact & Support

**For Questions**:
- Review implementation plans: `.plans/in-progress/organization-management-module.md`
- Review Temporal design: `.plans/in-progress/temporal-workflow-design.md`

**Test Data Management**:
- Create: `infrastructure/supabase/TEST_DATA_SETUP.sql`
- Cleanup: Uncomment cleanup section at end of SQL file

**Deployment Verification**:
- Edge Functions: `infrastructure/supabase/EDGE_FUNCTION_TESTS.md`
- Database: `infrastructure/supabase/DEPLOY_ORGANIZATION_MODULE.sql`

---

## Summary

**Configuration Status**: ✅ Complete
**Testing Status**: 📋 Ready to Execute
**Backend Status**: ✅ Deployed and Verified
**Frontend Status**: ✅ Ready for Integration

You can now proceed with executing the tests outlined in Steps 1-6 above. All configuration is complete and the system is ready for comprehensive integration testing.
