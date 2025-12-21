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

**Step 1.6: Find Shadow Users in public.users**
- Query `public.users` WHERE `email IN (invited_emails)`
- Store matching user IDs as `shadow_users_by_email`
- Query `public.users` WHERE `current_organization_id = org_id`
- Store matching user IDs as `shadow_users_by_org`

**Step 1.7: Consolidate User List**
- Merge `user_ids_from_events`, `auth_users_by_email`, `auth_users_by_metadata`, `shadow_users_by_email`, `shadow_users_by_org`
- Remove duplicates
- Store as `all_user_ids` and `all_auth_users`

**Step 1.8: Display findings and request confirmation**
- Show: Organization Name, Organization ID, User count, Auth user emails, Shadow user count
- Prompt: "This will DELETE all data for this organization including {count} auth users and {count} shadow users. Type 'CONFIRM' to proceed."
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

### Phase 3: Complete Database Cleanup

**IMPORTANT**: This phase uses GENERIC DISCOVERY to find and delete ALL records from ALL tables containing organization or user references. This includes junction tables discovered via FK chain traversal.

**Step 3.1: Discover FK-Linked Tables (Recursive)**
Execute this recursive CTE to find ALL tables reachable via foreign key chain from organizations_projection:
```sql
WITH RECURSIVE fk_chain AS (
  -- Base: tables directly referencing organizations_projection
  SELECT
    tc.table_name::text as child_table,
    ccu.table_name::text as parent_table,
    kcu.column_name::text as fk_column,
    1 as depth,
    ARRAY[tc.table_name::text] as path
  FROM information_schema.table_constraints tc
  JOIN information_schema.key_column_usage kcu
    ON tc.constraint_name = kcu.constraint_name
  JOIN information_schema.constraint_column_usage ccu
    ON tc.constraint_name = ccu.constraint_name
  WHERE tc.constraint_type = 'FOREIGN KEY'
    AND tc.table_schema = 'public'
    AND ccu.table_name = 'organizations_projection'

  UNION

  -- Recursive: tables referencing tables already in chain
  SELECT
    tc.table_name::text,
    ccu.table_name::text,
    kcu.column_name::text,
    fc.depth + 1,
    fc.path || tc.table_name::text
  FROM information_schema.table_constraints tc
  JOIN information_schema.key_column_usage kcu
    ON tc.constraint_name = kcu.constraint_name
  JOIN information_schema.constraint_column_usage ccu
    ON tc.constraint_name = ccu.constraint_name
  JOIN fk_chain fc
    ON ccu.table_name = fc.child_table
  WHERE tc.constraint_type = 'FOREIGN KEY'
    AND tc.table_schema = 'public'
    AND NOT tc.table_name::text = ANY(fc.path)
)
SELECT DISTINCT child_table, parent_table, fk_column, MAX(depth) as depth
FROM fk_chain
GROUP BY child_table, parent_table, fk_column
ORDER BY depth DESC, child_table;
```
- Store results as `fk_linked_tables` with depth
- Log: "Discovered {count} FK-linked tables (including junction tables)"
- This automatically discovers junction tables like: contact_phones, contact_addresses, phone_addresses, etc.

**Step 3.2: Discover Column-Based Tables (Non-FK)**
Execute this SQL to find additional tables with organization-related columns but no FK:
```sql
SELECT DISTINCT table_name, column_name
FROM information_schema.columns
WHERE table_schema = 'public'
  AND column_name IN (
    'organization_id', 'org_id',
    'provider_org_id', 'consultant_org_id', 'target_org_id',
    'current_organization_id', 'stream_id'
  )
  AND table_name NOT IN (SELECT child_table FROM fk_chain)
ORDER BY table_name;
```
- Store results as `column_based_tables`
- Log: "Found {count} additional tables with org columns (no FK)"

**Step 3.3: Delete Shadow Users from public.users**
- IMPORTANT: This MUST happen BEFORE auth.users deletion
- For each user_id in `all_user_ids`:
  - Execute: `DELETE FROM public.users WHERE id = {user_id}`
  - Log: "Deleted shadow user: {user_email} (ID: {user_id})"
- Also clean any orphaned shadow users by email:
  - Execute: `DELETE FROM public.users WHERE email IN ({invited_emails})`
  - Log orphan count if any deleted
- If no shadow users found: Log "No shadow users to delete"

**Step 3.4: Delete Supabase Auth Users**
- For each user in `all_auth_users` (from Phase 1):
  - Execute: `DELETE FROM auth.users WHERE id = {user_id}`
  - Log: "Deleted auth user: {user_email} (ID: {user_id})"
- Verify all deletions successful
- If no auth users found: Log "No auth users to delete"

**Step 3.5: Execute Cascading Deletions (FK-Linked Tables)**
Delete from FK-linked tables in depth order (deepest first):

For each table in `fk_linked_tables` ordered by depth DESC:
- If table has organization_id column:
  ```sql
  DELETE FROM {table_name} WHERE organization_id = {org_id};
  ```
- If table is a junction table (no org column, has FK to org-related table):
  ```sql
  -- Example: contact_phones references contacts_projection
  DELETE FROM contact_phones
  WHERE contact_id IN (
    SELECT id FROM contacts_projection WHERE organization_id = {org_id}
  );
  ```
- Log: "Deleted {count} records from {table_name}"

**Step 3.6: Execute Deletions (Column-Based Tables)**
Delete from non-FK tables that have org-related columns:

For each table in `column_based_tables`:
- Use the discovered column name for the WHERE clause:
  ```sql
  DELETE FROM {table_name} WHERE {column_name} = {org_id};
  ```
- Special cases:
  - `cross_tenant_access_grants_projection`: Delete WHERE provider_org_id = {org_id} OR consultant_org_id = {org_id}
  - `domain_events`: Delete WHERE stream_id = {org_id}
  - `workflow_queue_projection`: Delete WHERE stream_id = {org_id}
- Log: "Deleted {count} records from {table_name}"

**Step 3.7: Delete Root Organization**
- Execute: `DELETE FROM organizations_projection WHERE id = {org_id}`
- Log: "Deleted organization: {org_name} (ID: {org_id})"

**Step 3.8: Delete Event Store (Last)**
- Execute: `DELETE FROM domain_events WHERE stream_id = {org_id}`
- Also delete user events: `DELETE FROM domain_events WHERE stream_id IN ({user_ids})`
- Log: "Deleted {count} domain events"

Log all deletions with table name and row count

### Phase 4: DNS Cleanup

**Step 4.1: Extract Actual FQDN from Domain Events**
- Query `domain_events` WHERE `stream_id = org_id` AND `event_type = 'organization.subdomain.dns_created'`
- Extract the actual FQDN from `event_data`:
  - Try `event_data->>'full_subdomain'` first
  - Fallback to `event_data->>'fqdn'`
  - Fallback to `event_data->>'subdomain'`
- Store as `dns_fqdn`
- Also store the base subdomain (org name portion) as `dns_subdomain`
- Log: "Found DNS FQDN from events: {dns_fqdn}"

**Step 4.2: Locate Cloudflare API Token**
Search in order:
1. Check environment variables: `CLOUDFLARE_API_TOKEN`, `CF_API_TOKEN`, `CLOUDFLARE_TOKEN`
2. Search filesystem for `.env.local` files
3. If K8s cluster exists: `kubectl get secret -n temporal workflow-worker-secrets` and extract token
4. If all fail: STOP and prompt user to provide token manually

**Step 4.3: Connect to Cloudflare**
- Use Cloudflare REST API with Bearer token authentication
- Authenticate with discovered/provided API token

**Step 4.4: Identify Zone ID**
- List all zones in Cloudflare account
- Match zone that would contain records (typically `firstovertheline.com`)
- Store zone_id

**Step 4.5: Search for DNS Records (Comprehensive)**
- Fetch ALL DNS records from the zone and filter for matching records using this exact syntax:
  ```bash
  curl -s "https://api.cloudflare.com/client/v4/zones/{zone_id}/dns_records?per_page=100" \
       -H "Authorization: Bearer {api_token}" \
       -H "Content-Type: application/json" | jq '.result[] | select(.name | contains("{subdomain_name}")) | {id, type, name, content}'
  ```
- Search for records matching ANY of these patterns:
  1. Exact FQDN match: `dns_fqdn` (from Step 4.1)
  2. Contains org name: any record where `name` contains `$1` (the org name argument)
  3. Contains subdomain: any record where `name` contains `dns_subdomain`
- This catches records regardless of subdomain format (e.g., `{org}.firstovertheline.com` OR `{org}.a4c.firstovertheline.com`)
- Store all matching record IDs and details

**Step 4.6: Delete DNS Records**
- For each matching record found in Step 4.5:
  - Delete using this exact syntax:
    ```bash
    curl -s -X DELETE "https://api.cloudflare.com/client/v4/zones/{zone_id}/dns_records/{record_id}" \
         -H "Authorization: Bearer {api_token}" \
         -H "Content-Type: application/json" | jq '{success, result_id: .result.id}'
    ```
  - Log: "Deleted DNS record: {type} {name} -> {content} (ID: {record_id})"
- If no records found: Log "No DNS records found matching organization"

**Step 4.7: Verify DNS Deletion**
- For each FQDN that was deleted, run: `dig {fqdn}` and `nslookup {fqdn}`
- Confirm NXDOMAIN or no records returned
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
ALL records from ALL tables with organization/user references were deleted.

- Shadow users deleted (public.users): {count}
- Auth users deleted (auth.users): {count}
  - {user_email_1} (ID: {user_id_1})
  - {user_email_2} (ID: {user_id_2})
  ...
- Tables processed: {count}
- Total records deleted: {count}

Breakdown by table category:
  Core projections: {count} records
  Contact/Location: {count} records
  Role/Permission: {count} records
  Access Control: {count} records
  Audit Logs: {count} records
  Clinical Data: {count} records
  Event Store: {count} records

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

