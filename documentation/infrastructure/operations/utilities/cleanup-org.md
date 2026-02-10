---
status: current
last_updated: 2025-12-09
---

# cleanup-org.ts - Organization Cleanup Script

Hard deletes an organization and all related data by slug.

## Purpose

Completely removes an organization from:
- All database projection tables
- All junction tables
- Domain events table
- Cloudflare DNS records

Use this for cleaning up test organizations, failed bootstrap attempts, or development data that should be permanently removed.

## Location

```
workflows/src/scripts/cleanup-org.ts
```

## Usage

```bash
cd workflows

# Dry run - shows what would be deleted without making changes
npm run cleanup:org -- --slug=my-org-slug --dry-run

# Execute cleanup
npm run cleanup:org -- --slug=my-org-slug

# Skip DNS deletion (database only)
npm run cleanup:org -- --slug=my-org-slug --skip-dns
```

## Options

| Option | Required | Description |
|--------|----------|-------------|
| `--slug=<value>` | Yes | Organization slug to delete |
| `--dry-run` | No | Preview mode - shows SQL without executing |
| `--skip-dns` | No | Skip Cloudflare DNS record deletion |

## Execution Model

This script is designed for **Claude Code agent** execution:

1. **Database operations**: The script outputs SQL statements that the agent executes via `mcp__supabase__execute_sql`
2. **DNS operations**: The script directly calls Cloudflare API using token from `frontend/.env.local`

### Workflow

1. Look up organization by slug in `organizations_projection`
2. Count records in all related tables
3. Delete in FK-safe order:
   - Junction tables (organization_contacts, organization_addresses, organization_phones)
   - Dependent projections (invitations, contacts, addresses, phones)
   - Organization projection
   - Domain events
4. Delete Cloudflare DNS CNAME record

## Tables Affected

| Table | Delete Condition |
|-------|------------------|
| `organization_contacts` | `organization_id = {ORG_ID}` |
| `organization_addresses` | `organization_id = {ORG_ID}` |
| `organization_phones` | `organization_id = {ORG_ID}` |
| `invitations_projection` | `organization_id = {ORG_ID}` |
| `contacts_projection` | `organization_id = {ORG_ID}` |
| `addresses_projection` | `organization_id = {ORG_ID}` |
| `phones_projection` | `organization_id = {ORG_ID}` |
| `organizations_projection` | `id = {ORG_ID}` |
| `domain_events` | `stream_id = {ORG_ID}` |

## Configuration

### Cloudflare Token

The script reads `CLOUDFLARE_API_TOKEN` from `frontend/.env.local`:

```env
CLOUDFLARE_API_TOKEN=your-token-here
```

### Cloudflare Zone

- **Domain**: `firstovertheline.com`
- **Zone ID**: `538e5229b00f5660508a1c7fcd097f97`
- **Record type**: CNAME (`{slug}.firstovertheline.com`)

## Example Output

### Dry Run

```
============================================================
🧹 Organization Cleanup Script
============================================================

⚠️  DRY RUN MODE - No changes will be made

Looking up organization: poc-test-org

📋 The Claude Code agent should execute the following steps:

Step 1: Look up organization by slug
────────────────────────────────────────
SQL: SELECT id, name, slug FROM organizations_projection WHERE slug = 'poc-test-org';

If no organization found, abort the cleanup.

Step 2: Count records to delete (replace {ORG_ID} with actual ID)
────────────────────────────────────────
SQL: [counting queries...]

⚠️  DRY RUN - Stop here. No deletions will be performed.
```

### Execution

```
Step 3: Delete records (in FK-safe order)
────────────────────────────────────────
SQL: [deletion queries...]

Step 4: Delete Cloudflare DNS record
────────────────────────────────────────
   Deleting DNS record for: poc-test-org.firstovertheline.com
   ✅ Deleted DNS record: poc-test-org.firstovertheline.com

============================================================
✅ Cleanup script completed
============================================================
```

## Comparison with cleanup-dev.ts

| Feature | cleanup-org.ts | cleanup-dev.ts |
|---------|---------------|----------------|
| **Selection** | By slug (single org) | By tag (multiple orgs) |
| **Delete type** | Hard delete | Soft delete |
| **Domain events** | Deleted | Not affected |
| **Use case** | Complete removal | Marking as deleted |
| **Audit trail** | Destroyed | Preserved |

## Safety Considerations

- **No confirmation prompt**: The script relies on `--dry-run` for preview
- **Hard delete**: Data cannot be recovered after execution
- **Domain events**: Deleting events breaks the audit trail for that organization
- **DNS propagation**: DNS deletion is immediate but may take time to propagate

## See Also

- [Workflows CLAUDE.md](../../../../workflows/CLAUDE.md) - Script conventions
