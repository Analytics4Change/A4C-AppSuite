---
description: "Complete organization cleanup: database records, auth users, and DNS entries"
allowed-tools: ["bash", "supabase"]
---

# Organization Cleanup Workflow

**DESTRUCTIVE OPERATION - Removes all traces of an organization**

## Input
Organization Name: `$1`

## Prerequisites Validation

Before proceeding, verify:
1. Supabase MCP server is online - if not, STOP and inform user
2. Organization name is provided as argument
3. Confirm with user before executing any destructive operations

## Workflow

### Phase 1: Database Discovery

**Step 1.1: Find Organization ID**
- Query `public.domain_events` table in Supabase project `tmrjlswbsxmbglmaclxu`
- Filter: `stream_type = 'organization'`
- Extract Organization ID from results
- Store as `org_id` (accept variations: orgId, org_id, organizationId, organization_id - case insensitive)

**Step 1.2: Find User IDs from Domain Events**
- Query `public.domain_events` table
- Filter: `stream_type = 'user'` AND related to `org_id`
- Parse JSON in `event_data` column
- Extract top-level key `"user_id"`
- Store as `user_ids_from_events` list

**Step 1.3: Find Invited Emails**
- Query `invitations_projection` WHERE `organization_id = org_id`
- Extract all `email` values
- Store as `invited_emails` list

**Step 1.4: Find Auth Users by Email**
- Query `auth.users` WHERE `email IN (invited_emails)`
- Store matching user IDs and emails as `auth_users_by_email`

**Step 1.5: Find Auth Users by Organization Metadata**
- Query `auth.users` WHERE `raw_user_meta_data->>'organization_id' = org_id`
- Store matching user IDs and emails as `auth_users_by_metadata`

**Step 1.6: Consolidate User List**
- Merge `user_ids_from_events`, `auth_users_by_email`, and `auth_users_by_metadata`
- Remove duplicates
- Store as `all_user_ids` and `all_auth_users`

**Step 1.7: Display findings and request confirmation**
- Show: Organization Name, Organization ID, User count, Auth user emails
- Prompt: "This will DELETE all data for this organization including {count} auth users. Type 'CONFIRM' to proceed."
- If not confirmed, exit immediately

### Phase 2: Temporal Workflow Cleanup

**Step 2.1: Check for Local Kubernetes Cluster**
- Run: `kubectl cluster-info`
- If kubectl not found or cluster not accessible, skip to Phase 3
- If cluster exists, proceed to Step 2.2

**Step 2.2: Verify Temporal Namespace**
- Run: `kubectl get namespace temporal`
- If namespace doesn't exist, skip to Phase 3
- Log: "Found temporal namespace in Kubernetes cluster"

**Step 2.3: Connect to Temporal CLI Pod**
- Find pod with Temporal CLI: `kubectl get pods -n temporal -l app=temporal-cli` (or similar selector)
- Alternative: Find any temporal pod that has the `temporal` CLI available
- Store pod name as `temporal_pod`
- If no suitable pod found, skip to Phase 3 with warning

**Step 2.4: Search for Active Workflows**
- Execute in pod: `kubectl exec -n temporal $temporal_pod -- temporal workflow list --query "WorkflowId='$org_id' AND ExecutionStatus!='Completed'"`
- Alternative query formats if needed:
  - `--query "WorkflowId='$org_id'"`
  - Then filter for non-completed status
- List all matching workflows with their status
- If no active workflows found, skip to Step 2.6

**Step 2.5: Terminate Active Workflows**
- For each workflow found:
  - Get workflow_id and run_id
  - Execute: `kubectl exec -n temporal $temporal_pod -- temporal workflow terminate --workflow-id $org_id --run-id $run_id --reason "Organization cleanup: $1"`
  - Verify termination success
  - Log each termination

**Step 2.6: Report Temporal Cleanup Results**
- Display:
  ```
  Temporal Workflows:
  - Active workflows found: {count}
  - Workflows terminated: {count}
  - Status: {success/failed/skipped}
  ```

### Phase 3: Database Cleanup

**Step 3.1: Delete Supabase Auth Users**
- For each user in `all_auth_users` (from Phase 1):
  - Execute: `DELETE FROM auth.users WHERE id = {user_id}`
  - Log: "Deleted auth user: {user_email} (ID: {user_id})"
- Verify all deletions successful
- If no auth users found: Log "No auth users to delete"

**Step 3.2: Analyze Database Schema**
- Query information_schema to identify all tables with:
  - `user_id` column (any variation)
  - `organization_id` column (any variation)
- Build dependency graph based on foreign key constraints

**Step 3.3: Execute Cascading Deletions**
- Delete records in correct order to avoid foreign key violations:
  1. Child tables first (tables with foreign keys TO other tables)
  2. Parent tables last (tables with foreign keys FROM other tables)
- For User ID: Delete all records where user_id matches
- For Organization ID: Delete all records where organization_id matches
- Log all deletions with table name and row count

### Phase 4: DNS Cleanup

**Step 4.1: Verify DNS Records Exist**
- Run: `dig $1` and `nslookup $1`
- If no DNS records found, skip to Phase 5

**Step 4.2: Locate Cloudflare API Token**
Search in order:
1. Check environment variables: `CLOUDFLARE_API_TOKEN`, `CF_API_TOKEN`, `CLOUDFLARE_TOKEN`
2. Search filesystem for `.env.local` files
3. If K8s cluster exists: `kubectl get secret -n temporal` and extract token
4. If all fail: STOP and prompt user to provide token manually

**Step 4.3: Connect to Cloudflare**
- Use either `cloudflared` CLI or Cloudflare REST API
- Authenticate with discovered/provided API token

**Step 4.4: Identify Zone ID**
- List all zones in Cloudflare account
- Match zone that would contain records for `$1`
- Store zone_id

**Step 4.5: Delete DNS Records**
- List all DNS records in zone matching `$1`
- Delete each record (A, AAAA, CNAME, TXT, MX, etc.)
- Log each deletion

**Step 4.6: Verify DNS Deletion**
- Run: `dig $1` and `nslookup $1`
- Confirm no records returned
- May take 30-60 seconds for DNS propagation

### Phase 5: Summary Report

Generate completion report:
```
ORGANIZATION CLEANUP COMPLETE

Organization: $1
Organization ID: {org_id}
User ID: {user_id}

Temporal Workflows:
- Active workflows found: {count}
- Workflows terminated: {count}

Database Operations:
- Auth users deleted: {count}
  - {user_email_1} (ID: {user_id_1})
  - {user_email_2} (ID: {user_id_2})
  ...
- Tables processed: {count}
- Total records deleted: {count}

DNS Operations:
- Zone ID: {zone_id}
- Records deleted: {count}
- DNS verification: {status}

Timestamp: {ISO-8601}
```

## Error Handling

**If Supabase MCP server offline:**
Return immediately with message: "Cannot proceed - Supabase MCP server is unavailable. Please ensure the server is running and try again."

**If organization not found:**
Exit with: "Organization '$1' not found in database."

**If API token not found:**
Pause and prompt: "Cloudflare API token required. Please provide token or set environment variable."

**If foreign key constraint violation:**
Roll back current table, adjust deletion order, retry.

**If DNS zone not found:**
Log warning but continue: "No Cloudflare zone found for '$1' - skipping DNS cleanup."

## Safety Notes

- This operation is IRREVERSIBLE
- Always run against test/staging environments first
- Ensure database backups exist before running
- Consider running /org-cleanup-dryrun first to preview changes

