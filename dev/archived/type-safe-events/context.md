# Context: Type-Safe Event Emission Refactor

## Decision Record

**Date**: 2026-01-11
**Feature**: Type-Safe Event Emission for Organization Bootstrap
**Goal**: Convert all organization-bootstrap activities to use generated TypeScript types from AsyncAPI contracts, ensuring type safety between event schemas and workflow code.

### Key Decisions

1. **No Backward Compatibility**: Events can change structure freely - no need to maintain old formats
2. **Full Refactor Scope**: Convert ALL 13+ activities (14 with delete-emails), not just add one new activity
3. **Type Sharing via Copy**: Use post-generate script to copy types to workflows (no npm workspaces needed)
4. **Contract-First Pattern**: Define events in AsyncAPI YAML, generate TypeScript, import in activities
5. **Import from @shared/types**: Workflows will import generated types via `@shared/types` path alias
6. **Email as First-Class Entity**: Email is a separate entity with its own projection table, junction tables, and event lifecycle (not embedded in contacts) - Added 2026-01-11
7. **Reference-Based Correlation**: Use `temp_id`/`contact_ref` pattern for bootstrap workflow inputs to resolve relationships at entity creation time - Added 2026-01-11
8. **Typed Event Emitters**: Create wrapper functions (`emitOrganizationActivated`, `emitSubdomainDnsCreated`, etc.) that enforce type safety at the call site - Added 2026-01-11

## Technical Context

### Architecture

The A4C platform uses an event-sourced architecture where:
- **AsyncAPI contracts** define event schemas (source of truth)
- **Modelina** generates TypeScript types from AsyncAPI
- **Temporal activities** emit domain events to `domain_events` table
- **PostgreSQL triggers** process events into CQRS projections

Currently, activities emit events with untyped `event_data` objects. This refactor adds compile-time type checking.

### Tech Stack

- **AsyncAPI 3.0**: Event schema definitions in YAML
- **Modelina**: TypeScript type generator (already configured)
- **Temporal.io**: Workflow orchestration
- **TypeScript**: Strict type checking for activities
- **Supabase**: PostgreSQL database with event storage

### Dependencies

- `infrastructure/supabase/contracts/` - AsyncAPI schemas and type generation
- `workflows/src/shared/utils/emit-event.ts` - Event emission utility
- `workflows/src/shared/utils/typed-events.ts` - Type-safe emitter wrappers (NEW)
- `workflows/src/shared/types/` - Type definitions for workflows

## File Structure

### AsyncAPI Schema Files (COMPLETE)
- `infrastructure/supabase/contracts/asyncapi/domains/organization.yaml` - Organization events + Bootstrap*Input types
- `infrastructure/supabase/contracts/asyncapi/domains/invitation.yaml` - Invitation events including email.sent, resent
- `infrastructure/supabase/contracts/asyncapi/domains/contact.yaml` - Contact entity events
- `infrastructure/supabase/contracts/asyncapi/domains/address.yaml` - Address entity events
- `infrastructure/supabase/contracts/asyncapi/domains/phone.yaml` - Phone entity events
- `infrastructure/supabase/contracts/asyncapi/domains/email.yaml` - Email entity events (NEW)
- `infrastructure/supabase/contracts/asyncapi/domains/rbac.yaml` - Role and permission events
- `infrastructure/supabase/contracts/asyncapi/domains/junction.yaml` - All junction link/unlink events including email

### Workflow Files (CONVERTED)
- `workflows/src/shared/types/generated/events.ts` - Generated types (copied from contracts)
- `workflows/src/shared/utils/typed-events.ts` - Type-safe emitter wrappers
- `workflows/src/shared/utils/index.ts` - Exports typed emitters
- `workflows/src/activities/organization-bootstrap/configure-dns.ts` - ✅ CONVERTED
- `workflows/src/activities/organization-bootstrap/verify-dns.ts` - ✅ CONVERTED
- `workflows/src/activities/organization-bootstrap/remove-dns.ts` - ✅ CONVERTED
- `workflows/src/activities/organization-bootstrap/activate-organization.ts` - ✅ CONVERTED
- `workflows/src/activities/organization-bootstrap/send-invitation-emails.ts` - ✅ CONVERTED
- `workflows/src/activities/organization-bootstrap/create-organization.ts` - ✅ CONVERTED (temp_id correlation + email support)
- `workflows/src/activities/organization-bootstrap/deactivate-organization.ts` - ⏸️ DEFERRED (schema mismatch)
- `workflows/src/activities/organization-bootstrap/grant-provider-admin-permissions.ts` - ✅ CONVERTED (emitRoleCreated, emitRolePermissionGranted)
- `workflows/src/activities/organization-bootstrap/emit-bootstrap-failed.ts` - ✅ CREATED (emitBootstrapFailed)
- `workflows/src/activities/organization-bootstrap/delete-contacts.ts` - ✅ CONVERTED (emitContactDeleted)
- `workflows/src/activities/organization-bootstrap/delete-addresses.ts` - ✅ CONVERTED (emitAddressDeleted)
- `workflows/src/activities/organization-bootstrap/delete-phones.ts` - ✅ CONVERTED (emitPhoneDeleted)
- `workflows/src/activities/organization-bootstrap/delete-emails.ts` - ✅ CREATED (new compensation activity)

### Database Migration Files (NEW)
- `infrastructure/supabase/supabase/migrations/20260111111938_email_entity.sql` - Email entity infrastructure:
  - `email_type` enum (work, personal, billing, support, main)
  - `emails_projection` table
  - `organization_emails` junction table
  - `contact_emails` junction table
  - `process_email_event()` function
  - Updated `process_junction_event()` for email links
  - Updated `process_domain_event()` router for 'email' stream_type
  - RLS policies for emails
  - `api.get_emails_by_org()` RPC function

### Generated Output
- `infrastructure/supabase/contracts/types/generated-events.ts` - 27 enums, 169 interfaces (updated 2026-01-11)
- `frontend/src/types/generated/generated-events.ts` - Copy for frontend

## Related Components

- **Frontend types**: `frontend/src/types/generated/generated-events.ts` (receives copy)
- **Event processors**: PostgreSQL triggers that handle events (updated for email)
- **CI Workflow**: `.github/workflows/contracts-validation.yml` validates type sync

## Key Patterns and Conventions

### Typed Emitter Pattern (Current Best Practice)
```typescript
import { emitOrganizationActivated, emitSubdomainDnsCreated } from '@shared/utils';

// Type-safe event using AsyncAPI contract
await emitOrganizationActivated(params.orgId, {
  org_id: params.orgId,
  activated_at: new Date().toISOString(),
  previous_is_active: org.is_active,
}, params.tracing);
```

### temp_id Correlation Pattern (For create-organization.ts)
```typescript
// 1. Create contacts first → build temp→real ID map
const contactIdMap = new Map<string, string>();  // temp_id → real UUID

for (const contact of params.contacts ?? []) {
  const contactId = await createContact(contact);  // emits contact.created
  contactIdMap.set(contact.temp_id, contactId);
  await linkOrgContact(orgId, contactId);          // emits organization.contact.linked
}

// 2. Create phones, resolve contact_ref
for (const phone of params.phones ?? []) {
  const phoneId = await createPhone(phone);
  await linkOrgPhone(orgId, phoneId);
  if (phone.contact_ref) {
    const contactId = contactIdMap.get(phone.contact_ref);
    if (contactId) await linkContactPhone(contactId, phoneId);
  }
}
```

### Enum Usage Pattern
```typescript
import { DNSRecordType, DnsRemovalStatus, VerificationMethod } from '@shared/utils';

await emitSubdomainDnsCreated(params.orgId, {
  subdomain: params.subdomain,
  cloudflare_record_id: record.id,
  dns_record_type: DNSRecordType.CNAME,  // Typed enum
  dns_record_value: record.content,
}, params.tracing);
```

## Reference Materials

- `documentation/infrastructure/guides/supabase/CONTRACT-TYPE-GENERATION.md` - Type generation guide
- `.claude/skills/infrastructure-guidelines/resources/asyncapi-contracts.md` - AsyncAPI patterns
- `infrastructure/supabase/contracts/README.md` - Contracts overview
- `~/.claude/plans/purrfect-cuddling-patterson.md` - Email entity design and temp_id correlation pattern

## Important Constraints

1. **Every schema needs `title` property** - Without it, Modelina generates `AnonymousSchema_XXX`
2. **Enums must be in `components/enums.yaml`** - Centralized for proper TypeScript enum generation
3. **Use `$ref` for shared types** - EventMetadata, enums, etc. must reference centralized schemas
4. **Post-generate copy required** - Types must be copied to both workflows and frontend
5. **RemoveDNSParams has no tracing** - Compensation activities don't receive tracing params - Discovered 2026-01-11

## Gotchas Discovered

1. **RemoveDNS no tracing**: The `RemoveDNSParams` type doesn't include a `tracing` property because it's a compensation activity. Don't try to pass `params.tracing` to emitters in compensation activities.

2. **Email junction events already exist**: When creating the email database migration, the AsyncAPI junction events for email (organization.email.linked, contact.email.linked) were already defined in junction.yaml.

3. **process_domain_event router needs updating**: When adding a new entity type, must update the CASE statement in `process_domain_event()` to route events to the new processor function.

4. **OrganizationDeactivationData schema mismatch**: The AsyncAPI contract defines `OrganizationDeactivationData` with fields like `deactivation_type`, `cascade_to_children`, etc. designed for business deactivations (billing suspension, compliance). This doesn't match the compensation use case (`workflow_failure`), so `deactivate-organization.ts` uses the existing untyped pattern rather than forcing a schema fit.

5. **Bootstrap*Input vs CreationData types**: Bootstrap input types (e.g., `BootstrapContactInput`) have optional `email` field, but creation event types (e.g., `ContactCreationData`) require `email`. Handle with `email ?? ''` when creating contacts without embedded email (since email is now a separate entity).
