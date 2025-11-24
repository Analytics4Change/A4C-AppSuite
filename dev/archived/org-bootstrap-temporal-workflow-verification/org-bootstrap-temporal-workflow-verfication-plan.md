# Phase 4.1: Workflow Parameter Verification Plan

**Created**: 2025-11-19
**Updated**: 2025-11-19
**Status**: PENDING
**Purpose**: Test the organization bootstrap workflow with the new parameter structure (contacts/addresses/phones arrays, optional subdomain, partner types)

---

## Key Clarifications

### Contacts vs Users Arrays

| Array | Purpose | Result |
|-------|---------|--------|
| `orgData.contacts` | Organizational metadata | Stored in `contacts_projection` |
| `users` | Invitation recipients | Emails sent, Supabase users created on acceptance |

**Important**: The Provider Admin contact email should appear in BOTH arrays:
- In `contacts` for organizational records
- In `users` to receive an invitation

The current ViewModel implementation correctly extracts the Provider Admin email into the `users` array with `role: 'provider_admin'`.

### Supabase User Creation Timeline

Users are NOT created during the workflow. The flow is:
1. **Workflow**: Generates invitation token, sends email
2. **User clicks link**: `/accept-invitation?token=<token>`
3. **Edge Function**: `supabase.auth.admin.createUser()` creates the Supabase Auth user

### Email Safety in Development Mode

With `WORKFLOW_MODE=development`:
- **Emails are logged to console only** - NOT actually sent to Resend
- Safe to use fake test emails like `test@fake-provider.local`
- No risk to Resend sender reputation

### Execution Method

This entire plan is **script-based** - no UI required:
- Trigger workflow via `npm run trigger-workflow`
- Verify via SQL queries (MCP tools)
- Cleanup via SQL + `removeDNS` activity

---

## Prerequisites

### Terminal 1: Port-forward Temporal
```bash
kubectl port-forward -n temporal svc/temporal-frontend 7233:7233
```

### Terminal 2: Start Workflow Worker
```bash
cd /home/lars/dev/A4C-AppSuite/workflows

# Set environment variables
export WORKFLOW_MODE=development
export TEMPORAL_ADDRESS=localhost:7233
export TEMPORAL_NAMESPACE=default
export TEMPORAL_TASK_QUEUE=bootstrap
export SUPABASE_URL=https://tmrjlswbsxmbglmaclxu.supabase.co
export SUPABASE_SERVICE_ROLE_KEY="<get-from-supabase-dashboard>"

npm run dev
```

### Get Supabase Service Role Key
1. Go to: https://app.supabase.com/projects/tmrjlswbsxmbglmaclxu/settings/api
2. Copy the **Service Role key** (NOT the anon key)

---

## Test Cases

### Test Case A: Provider Organization (Full Structure)

**Expected**: 3 contacts, 3 addresses, 3 phones, DNS configured

**Payload** for `workflows/src/examples/trigger-workflow.ts`:

```typescript
const params: OrganizationBootstrapParams = {
  subdomain: "test-provider-001",
  orgData: {
    name: "Test Healthcare Provider",
    type: "provider",
    contacts: [
      {
        firstName: "John",
        lastName: "Admin",
        email: "john@test-provider.com",
        title: "Administrator",
        department: "Administration",
        type: "a4c_admin",
        label: "A4C Administrator"
      },
      {
        firstName: "Sarah",
        lastName: "Billing",
        email: "sarah@test-provider.com",
        title: "Finance Director",
        department: "Finance",
        type: "billing",
        label: "Billing Contact"
      },
      {
        firstName: "Mike",
        lastName: "Tech",
        email: "mike@test-provider.com",
        title: "IT Director",
        department: "IT",
        type: "technical",
        label: "Technical Contact"
      }
    ],
    addresses: [
      {
        street1: "100 Main Street",
        street2: "Suite 200",
        city: "San Francisco",
        state: "CA",
        zipCode: "94105",
        type: "physical",
        label: "Headquarters"
      },
      {
        street1: "200 Mail Avenue",
        city: "Oakland",
        state: "CA",
        zipCode: "94612",
        type: "mailing",
        label: "Mailing Address"
      },
      {
        street1: "300 Billing Boulevard",
        city: "Berkeley",
        state: "CA",
        zipCode: "94704",
        type: "billing",
        label: "Billing Address"
      }
    ],
    phones: [
      {
        number: "555-0100",
        extension: "1001",
        type: "office",
        label: "Main Office"
      },
      {
        number: "555-0200",
        type: "mobile",
        label: "Emergency Line"
      },
      {
        number: "555-0300",
        type: "fax",
        label: "Fax Machine"
      }
    ]
  },
  users: [
    {
      email: "admin@test-provider.com",
      firstName: "Test",
      lastName: "Admin",
      role: "provider_admin"
    }
  ]
};
```

---

### Test Case B: Stakeholder Partner (No Subdomain)

**Status**: ⚠️ **DEFERRED** - Stakeholder role assignment pending analytics module design
**Reason**: No defined role for stakeholder partners yet. Analytics view-only access not implemented.
**Alternative**: Can test organization creation with empty `users: []` array (no invitations)

**Expected**: 1 contact, 2 addresses, 2 phones, DNS SKIPPED

**Payload**:

```typescript
const params: OrganizationBootstrapParams = {
  // NO subdomain for stakeholder partners
  orgData: {
    name: "Family Referral Partner",
    type: "provider_partner",
    partnerType: "family",
    contacts: [
      {
        firstName: "Contact",
        lastName: "Person",
        email: "contact@family-partner.org",
        type: "stakeholder",
        label: "Primary Contact"
      }
    ],
    addresses: [
      {
        street1: "600 Community Lane",
        city: "Palo Alto",
        state: "CA",
        zipCode: "94301",
        type: "physical",
        label: "Office"
      },
      {
        street1: "601 Community Lane",
        city: "Palo Alto",
        state: "CA",
        zipCode: "94301",
        type: "mailing",
        label: "Mailing"
      }
    ],
    phones: [
      {
        number: "650-555-0100",
        type: "office",
        label: "Main Line"
      },
      {
        number: "650-555-0200",
        type: "emergency",
        label: "Emergency"
      }
    ]
  },
  users: [
    {
      email: "family@test-partner.com",
      firstName: "Family",
      lastName: "User",
      role: "clinician"
    }
  ]
};
```

---

### Test Case C: VAR Partner (With Subdomain)

**Expected**: 1 contact, 2 addresses, 2 phones, DNS configured

**Payload**:

```typescript
const params: OrganizationBootstrapParams = {
  subdomain: "var-partner-001",
  orgData: {
    name: "Value Added Reseller Corp",
    type: "provider_partner",
    partnerType: "var",
    contacts: [
      {
        firstName: "Alice",
        lastName: "Manager",
        email: "alice@var-partner.com",
        title: "Account Manager",
        department: "Sales",
        type: "a4c_admin",
        label: "Primary Contact"
      }
    ],
    addresses: [
      {
        street1: "500 Tech Drive",
        city: "San Jose",
        state: "CA",
        zipCode: "95110",
        type: "physical",
        label: "Office"
      },
      {
        street1: "501 Tech Drive",
        city: "San Jose",
        state: "CA",
        zipCode: "95110",
        type: "mailing",
        label: "Mailing"
      }
    ],
    phones: [
      {
        number: "408-555-0100",
        type: "office",
        label: "Main Line"
      },
      {
        number: "408-555-0200",
        type: "mobile",
        label: "Mobile"
      }
    ]
  },
  users: [
    {
      email: "var.admin@var-partner.com",
      firstName: "VAR",
      lastName: "Admin",
      role: "partner_admin"
    }
  ]
};
```

---

## Execution Steps

### Step 1: Update Trigger Script
Edit `/home/lars/dev/A4C-AppSuite/workflows/src/examples/trigger-workflow.ts` with the test payload.

### Step 2: Trigger Workflow
```bash
# Terminal 3
cd /home/lars/dev/A4C-AppSuite/workflows

export WORKFLOW_MODE=development
export TEMPORAL_ADDRESS=localhost:7233
export SUPABASE_URL=https://tmrjlswbsxmbglmaclxu.supabase.co
export SUPABASE_SERVICE_ROLE_KEY="<key>"

npm run trigger-workflow
```

### Step 3: Monitor Execution
Watch Terminal 2 (worker logs) for:
- "Step 1: Creating organization"
- "Step 2: Configuring DNS" (or "Skipping DNS configuration...")
- "Step 3: Generating invitations"
- "Step 4: Sending invitation emails"
- "Step 5: Activating organization"
- "OrganizationBootstrapWorkflow completed successfully"

### Step 4: Verify in Database
Run SQL queries (see Verification Queries section below).

### Step 5: Cleanup
Run cleanup SQL (see Cleanup section below).

### Step 6: Repeat
Repeat Steps 1-5 for each test case (A, B, C).

---

## Verification Queries

Run via Supabase MCP tool or SQL editor:

```sql
-- ========================================
-- 1. Get Created Organization
-- ========================================
SELECT id, name, slug, type, status, partner_type, referring_partner_id, subdomain_status
FROM organizations_projection
WHERE name LIKE '%Test%' OR name LIKE '%Family%' OR name LIKE '%VAR%'
ORDER BY created_at DESC
LIMIT 5;

-- ========================================
-- 2. Verify Contacts Created
-- ========================================
-- Replace <org-id> with actual organization ID from query above
SELECT id, first_name, last_name, email, type, label, organization_id
FROM contacts_projection
WHERE organization_id = '<org-id>'
AND deleted_at IS NULL
ORDER BY created_at;

-- Expected counts:
-- Test A (Provider): 3 contacts
-- Test B (Family Partner): 1 contact
-- Test C (VAR Partner): 1 contact

-- ========================================
-- 3. Verify Addresses Created
-- ========================================
SELECT id, street1, city, state, zip_code, type, label, organization_id
FROM addresses_projection
WHERE organization_id = '<org-id>'
AND deleted_at IS NULL
ORDER BY created_at;

-- Expected counts:
-- Test A (Provider): 3 addresses
-- Test B (Family Partner): 2 addresses
-- Test C (VAR Partner): 2 addresses

-- ========================================
-- 4. Verify Phones Created
-- ========================================
SELECT id, number, extension, type, label, organization_id
FROM phones_projection
WHERE organization_id = '<org-id>'
AND deleted_at IS NULL
ORDER BY created_at;

-- Expected counts:
-- Test A (Provider): 3 phones
-- Test B (Family Partner): 2 phones
-- Test C (VAR Partner): 2 phones

-- ========================================
-- 5. Verify Junction Links Created
-- ========================================
SELECT 'org_contacts' as junction, count(*) as count
FROM organization_contacts WHERE organization_id = '<org-id>'
UNION ALL
SELECT 'org_addresses', count(*)
FROM organization_addresses WHERE organization_id = '<org-id>'
UNION ALL
SELECT 'org_phones', count(*)
FROM organization_phones WHERE organization_id = '<org-id>';

-- ========================================
-- 6. Verify Invitations Created
-- ========================================
SELECT invitation_id, email, role, status, created_at
FROM invitations_projection
WHERE organization_id = '<org-id>'
AND status = 'pending'
ORDER BY created_at;

-- ========================================
-- 7. Verify Domain Events Emitted
-- ========================================
SELECT id, event_type, aggregate_id, created_at
FROM domain_events
WHERE aggregate_id = '<org-id>'
ORDER BY created_at;

-- Expected event types:
-- organization.created
-- contact.created (x N)
-- address.created (x N)
-- phone.created (x N)
-- organization.contact.linked (x N)
-- organization.address.linked (x N)
-- organization.phone.linked (x N)
-- invitation.created (x N)
-- organization.activated
```

---

## Cleanup Procedure

After each test, perform complete cleanup of test data.

### Step 1: Remove Cloudflare DNS Record

For test cases with subdomain (A and C), use the existing `removeDNS` activity.

**Create cleanup script** `workflows/src/scripts/cleanup-dns.ts`:

```typescript
import { removeDNS } from '../activities/organization-bootstrap/remove-dns';

async function main() {
  const subdomain = process.argv[2];
  if (!subdomain) {
    console.error('Usage: npx ts-node src/scripts/cleanup-dns.ts <subdomain>');
    process.exit(1);
  }

  console.log(`Removing DNS for subdomain: ${subdomain}`);
  const result = await removeDNS({ subdomain });
  console.log('DNS removal result:', result);
}

main().catch(console.error);
```

**Run cleanup**:
```bash
cd /home/lars/dev/A4C-AppSuite/workflows
export CLOUDFLARE_API_TOKEN="<your-token>"
npx ts-node src/scripts/cleanup-dns.ts test-provider-001
npx ts-node src/scripts/cleanup-dns.ts var-partner-001
```

**Required**: `CLOUDFLARE_API_TOKEN` environment variable

### Step 2: Hard Delete from Supabase

Run these queries in order (respects FK constraints):

```sql
-- ========================================
-- HARD DELETE TEST DATA
-- Replace <org-id> with actual organization ID
-- ========================================

-- 1. Delete domain events (no FK dependencies)
DELETE FROM domain_events
WHERE aggregate_id = '<org-id>';

-- 2. Delete invitations
DELETE FROM invitations_projection
WHERE organization_id = '<org-id>';

-- 3. Delete junction tables
DELETE FROM organization_contacts
WHERE organization_id = '<org-id>';

DELETE FROM organization_addresses
WHERE organization_id = '<org-id>';

DELETE FROM organization_phones
WHERE organization_id = '<org-id>';

-- 4. Delete entity projections
DELETE FROM contacts_projection
WHERE organization_id = '<org-id>';

DELETE FROM addresses_projection
WHERE organization_id = '<org-id>';

DELETE FROM phones_projection
WHERE organization_id = '<org-id>';

-- 5. Delete organization (last due to FK constraints)
DELETE FROM organizations_projection
WHERE id = '<org-id>';

-- ========================================
-- Verify Complete Cleanup
-- ========================================
SELECT 'organizations' as table_name, count(*) as remaining
FROM organizations_projection WHERE id = '<org-id>'
UNION ALL
SELECT 'contacts', count(*)
FROM contacts_projection WHERE organization_id = '<org-id>'
UNION ALL
SELECT 'addresses', count(*)
FROM addresses_projection WHERE organization_id = '<org-id>'
UNION ALL
SELECT 'phones', count(*)
FROM phones_projection WHERE organization_id = '<org-id>'
UNION ALL
SELECT 'invitations', count(*)
FROM invitations_projection WHERE organization_id = '<org-id>'
UNION ALL
SELECT 'domain_events', count(*)
FROM domain_events WHERE aggregate_id = '<org-id>';

-- All counts should be 0
```

### Cleanup Checklist

For each test case:
- [ ] DNS record removed (if subdomain was created)
- [ ] Domain events deleted
- [ ] Invitations deleted
- [ ] Junction tables cleared
- [ ] Contacts/addresses/phones deleted
- [ ] Organization deleted
- [ ] Verification query returns all zeros

---

## Success Criteria

### Test Case A (Provider)
- [ ] Workflow completes successfully
- [ ] Organization created with `type='provider'`, `status='active'`
- [ ] 3 contacts in `contacts_projection`
- [ ] 3 addresses in `addresses_projection`
- [ ] 3 phones in `phones_projection`
- [ ] 3 rows in `organization_contacts`
- [ ] 3 rows in `organization_addresses`
- [ ] 3 rows in `organization_phones`
- [ ] DNS configured (subdomain_status = 'active' or 'pending')
- [ ] 1 invitation created

### Test Case B (Stakeholder Partner)
- [ ] Workflow completes successfully
- [ ] Organization created with `type='provider_partner'`, `partner_type='family'`
- [ ] 1 contact in `contacts_projection`
- [ ] 2 addresses in `addresses_projection`
- [ ] 2 phones in `phones_projection`
- [ ] DNS SKIPPED (subdomain_status IS NULL)
- [ ] 1 invitation created

### Test Case C (VAR Partner)
- [ ] Workflow completes successfully
- [ ] Organization created with `type='provider_partner'`, `partner_type='var'`
- [ ] 1 contact in `contacts_projection`
- [ ] 2 addresses in `addresses_projection`
- [ ] 2 phones in `phones_projection`
- [ ] DNS configured (subdomain_status = 'active' or 'pending')
- [ ] 1 invitation created

---

## Test Matrix Summary

| Test | Org Type | Partner Type | Contacts | Addresses | Phones | Subdomain | DNS |
|------|----------|--------------|----------|-----------|--------|-----------|-----|
| A | provider | N/A | 3 | 3 | 3 | Yes | Configured |
| B | provider_partner | family | 1 | 2 | 2 | No | Skipped |
| C | provider_partner | var | 1 | 2 | 2 | Yes | Configured |

---

## Troubleshooting

### Workflow Fails at createOrganization
- Check Supabase logs: `mcp__supabase__get_logs --service postgres`
- Verify event processors are working (Phase 4.0 bugs fixed)
- Check for duplicate subdomain

### DNS Configuration Fails
- This is expected in development mode (console logging only)
- Check worker logs for "Skipping DNS configuration" message

### Invitations Not Created
- Check `WORKFLOW_MODE=development` (emails logged, not sent)
- Verify invitation events in `domain_events` table

### Cannot Connect to Temporal
- Verify port-forward is running: `kubectl port-forward -n temporal svc/temporal-frontend 7233:7233`
- Check Temporal pods are running: `kubectl get pods -n temporal`

---

## Notes

- **File to modify**: `workflows/src/examples/trigger-workflow.ts`
- **Types reference**: `workflows/src/shared/types/index.ts`
- **Workflow definition**: `workflows/src/workflows/organization-bootstrap/workflow.ts`
- **Activities**: `workflows/src/activities/organization-bootstrap/`

---

## Next Steps After 4.1

After all 3 test cases pass:
- Proceed to Phase 4.2: Event Emission Verification
- Proceed to Phase 4.3: Projection Update Verification
- Proceed to Phase 4.4: RLS Policy Verification
- Proceed to Phase 4.5: Edge Case Testing
