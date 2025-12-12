---
description: "Preview organization cleanup actions WITHOUT executing deletions"
allowed-tools: ["bash", "supabase"]
---

# Organization Cleanup Dry Run

**SAFE MODE - Reports what WOULD be deleted without executing any deletions**

## Input
Organization Name: `$1`

## Prerequisites Validation

Before proceeding, verify:
1. Supabase MCP server is online - if not, STOP and inform user
2. Organization name is provided as argument

**DRY RUN MODE**: No data will be deleted. This command only reports what would be affected.

## Workflow

### Phase 1: Database Discovery

**Step 1.1: Find Organization ID**
- Query `public.domain_events` table in Supabase project `tmrjlswbsxmbglmaclxu`
- Filter: `stream_type = 'organization'`
- Extract Organization ID from results
- Store as `org_id` (accept variations: orgId, org_id, organizationId, organization_id - case insensitive)
- **Report**: "Found Organization ID: {org_id}"

**Step 1.2: Find User IDs from Domain Events**
- Query `public.domain_events` table
- Filter: `stream_type = 'user'` AND related to `org_id`
- Parse JSON in `event_data` column
- Extract top-level key `"user_id"`
- Store as `user_ids_from_events` list
- **Report**: "Found {count} user IDs from domain events"

**Step 1.3: Find Invited Emails**
- Query `invitations_projection` WHERE `organization_id = org_id`
- Extract all `email` values
- Store as `invited_emails` list
- **Report**: "Found {count} invited emails: {email_list}"

**Step 1.4: Find Auth Users by Email**
- Query `auth.users` WHERE `email IN (invited_emails)`
- Store matching user IDs and emails as `auth_users_by_email`
- **Report**: "Found {count} auth users matching invited emails"

**Step 1.5: Find Auth Users by Organization Metadata**
- Query `auth.users` WHERE `raw_user_meta_data->>'organization_id' = org_id`
- Store matching user IDs and emails as `auth_users_by_metadata`
- **Report**: "Found {count} auth users with organization in metadata"

**Step 1.6: Consolidate User List**
- Merge `user_ids_from_events`, `auth_users_by_email`, and `auth_users_by_metadata`
- Remove duplicates
- Store as `all_user_ids` and `all_auth_users`
- **Report**: "Total unique users to clean up: {count}"

### Phase 2: Temporal Workflow Analysis

**Step 2.1: Check for Local Kubernetes Cluster**
- Run: `kubectl cluster-info`
- If kubectl not found or cluster not accessible, skip to Phase 3
- **Report**: "Kubernetes cluster status: {found/not found}"

**Step 2.2: Verify Temporal Namespace**
- Run: `kubectl get namespace temporal`
- If namespace doesn't exist, skip to Phase 3
- **Report**: "Temporal namespace: {found/not found}"

**Step 2.3: Connect to Temporal CLI Pod**
- Find pod with Temporal CLI: `kubectl get pods -n temporal -l app=temporal-cli`
- Alternative: Find any temporal pod that has the `temporal` CLI available
- Store pod name as `temporal_pod`
- **Report**: "Temporal CLI pod: {pod_name}" or "No suitable Temporal pod found"

**Step 2.4: Search for Active Workflows**
- Execute in pod: `kubectl exec -n temporal $temporal_pod -- temporal workflow list --query "WorkflowId='$org_id' AND ExecutionStatus!='Completed'"`
- **DO NOT TERMINATE** - only list workflows
- **Report** each workflow found:
  ```
  WOULD TERMINATE Workflow:
    - Workflow ID: {workflow_id}
    - Run ID: {run_id}
    - Status: {status}
    - Start Time: {start_time}
  ```
- If no active workflows found: **Report**: "No active Temporal workflows found for this organization"

**Step 2.5: Workflow Termination Summary**
- **Report**:
  ```
  Temporal Workflow Impact:
  - Total workflows found: {count}
  - Active workflows that would be terminated: {count}
  - Workflow IDs: [{list of workflow_ids}]
  ```

### Phase 3: Database Impact Analysis

**Step 3.1: Auth User Analysis**
- For each user in `all_auth_users` (from Phase 1):
  - **Report**: "WOULD DELETE auth user: {user_email} (ID: {user_id})"
  - Note source: "Found via: {email_match|metadata_match|event_match}"
- **DO NOT DELETE** - this is dry run mode
- If no auth users found: **Report**: "No auth users found for this organization"

**Step 3.2: Analyze Database Schema**
- Query information_schema to identify all tables with:
  - `user_id` column (any variation)
  - `organization_id` column (any variation)
- Build dependency graph based on foreign key constraints
- **Report**: "Found {count} tables with user_id references"
- **Report**: "Found {count} tables with organization_id references"

**Step 3.3: Count Affected Records**
For each table identified:
- Execute SELECT COUNT(*) WHERE user_id = {user_id}
- Execute SELECT COUNT(*) WHERE organization_id = {org_id}
- **DO NOT DELETE** - only count
- **Report** for each table:
  ```
  Table: {table_name}
    - Records matching user_id: {count}
    - Records matching org_id: {count}
    - Deletion order: {order_number}
  ```

**Step 3.4: Calculate Deletion Order**
- Determine correct deletion order based on foreign key constraints
- **Report**:
  ```
  Proposed Deletion Sequence:
  1. {child_table_1} ({count} records)
  2. {child_table_2} ({count} records)
  ...
  n. {parent_table} ({count} records)
  ```

### Phase 4: DNS Impact Analysis

**Step 4.1: Check DNS Records**
- Run: `dig $1` and `nslookup $1`
- **Report**: Current DNS records found (or "No DNS records found")
- Display all A, AAAA, CNAME, TXT, MX records discovered

**Step 4.2: Locate Cloudflare API Token**
Search in order:
1. Check environment variables: `CLOUDFLARE_API_TOKEN`, `CF_API_TOKEN`, `CLOUDFLARE_TOKEN`
2. Search filesystem for `.env.local` files
3. If K8s cluster exists: `kubectl get secret -n temporal` and extract token
4. If all fail: **Report**: "Cloudflare API token not found - DNS deletion would require manual token"

**Step 4.3: Connect to Cloudflare (Read-Only)**
- Use either `cloudflared` CLI or Cloudflare REST API
- Authenticate with discovered/provided API token
- **Use READ-ONLY operations only**

**Step 4.4: Identify Zone and Records**
- List all zones in Cloudflare account
- Match zone that would contain records for `$1`
- **Report**: "Zone ID: {zone_id}"
- List all DNS records matching `$1`
- **Report** each record:
  ```
  WOULD DELETE DNS Record:
    - Type: {type}
    - Name: {name}
    - Value: {value}
    - TTL: {ttl}
    - ID: {record_id}
  ```

### Phase 5: Dry Run Summary Report

Generate detailed impact report:
```
========================================
DRY RUN SUMMARY - NO DATA WAS DELETED
========================================

Organization: $1
Organization ID: {org_id}
User ID: {user_id}

Temporal Workflow Impact:
- Active workflows found: {count}
- Workflows that would be terminated: {count}

Database Impact:
- Auth users found: {count}
  - By invited email: {count}
  - By org metadata: {count}
  - By domain events: {count}
- Auth users that would be deleted:
  {user_email_1} (ID: {user_id_1})
  {user_email_2} (ID: {user_id_2})
  ...
- Total tables affected: {count}
- Total records that would be deleted: {count}

Breakdown by table:
  {table_1}: {count} records
  {table_2}: {count} records
  ...

DNS Impact:
- Zone: {zone_name} (ID: {zone_id})
- DNS records that would be deleted: {count}

Record details:
  - {type} {name} -> {value}
  - {type} {name} -> {value}
  ...

========================================
NEXT STEPS
========================================

To execute this cleanup:
  /org-cleanup $1

WARNING: The above operation is IRREVERSIBLE
- Ensure database backups exist
- Verify this is the correct organization
- Run in test environment first if possible

Timestamp: {ISO-8601}
```

## Error Handling

**If Supabase MCP server offline:**
Return immediately with message: "Cannot proceed - Supabase MCP server is unavailable. Please ensure the server is running and try again."

**If organization not found:**
Exit with: "Organization '$1' not found in database."

**If API token not found:**
Continue without Cloudflare analysis and note: "Cloudflare API token not found - DNS analysis skipped. Records would need to be deleted manually or provide token for full dry run."

**If DNS zone not found:**
Report: "No Cloudflare zone found for '$1' - no DNS cleanup would be performed."

## Safety Notes

- This is a READ-ONLY operation
- No data will be deleted during dry run
- Use this to validate before running /org-cleanup
- Review the output carefully before proceeding with actual cleanup
- Always test dry run first in production environments

