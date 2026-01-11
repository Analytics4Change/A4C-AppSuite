# AsyncAPI Event Contracts: Contract-First Event Design

## Overview

AsyncAPI contracts define the structure of domain events before implementation. This "contract-first" approach ensures:
- **Type safety**: Frontend and backend share event schemas
- **Documentation**: Events are self-documenting
- **Validation**: Events are validated against schemas before emission
- **Evolution**: Schema versioning prevents breaking changes

**Key Principle**: Define the contract first, then implement.

## Event Naming Conventions

### PastTense Pattern

Events represent **facts that happened**, not commands:

```yaml
# GOOD: Past tense, describes what happened
OrganizationCreated
UserInvited
InvitationAccepted
DNSRecordProvisioned
PaymentProcessed

# BAD: Imperative (commands, not events)
CreateOrganization
InviteUser
AcceptInvitation
ProvisionDNSRecord
ProcessPayment
```

### Naming Structure

```
{AggregateType}{Action}
```

Examples:
- **Organization**: `OrganizationCreated`, `OrganizationUpdated`, `OrganizationDeleted`
- **User**: `UserCreated`, `UserRoleChanged`, `UserDeactivated`
- **Invitation**: `InvitationSent`, `InvitationAccepted`, `InvitationExpired`

## AsyncAPI Contract Structure

### Basic Contract Template

```yaml
asyncapi: 3.0.0
info:
  title: A4C Domain Events
  version: 1.0.0
  description: Domain events for A4C-AppSuite event-driven architecture

channels:
  OrganizationCreated:
    address: domain_events.OrganizationCreated
    messages:
      OrganizationCreated:
        $ref: '#/components/messages/OrganizationCreated'

components:
  messages:
    OrganizationCreated:
      name: OrganizationCreated
      title: Organization Created Event
      summary: Emitted when a new organization is created
      contentType: application/json
      payload:
        $ref: '#/components/schemas/OrganizationCreatedPayload'

  schemas:
    OrganizationCreatedPayload:
      type: object
      required:
        - event_type
        - aggregate_type
        - aggregate_id
        - event_data
        - metadata
        - version
      properties:
        event_type:
          type: string
          const: OrganizationCreated
        aggregate_type:
          type: string
          const: Organization
        aggregate_id:
          type: string
          format: uuid
          description: Unique identifier for the organization
        event_data:
          $ref: '#/components/schemas/OrganizationCreatedData'
        metadata:
          $ref: '#/components/schemas/EventMetadata'
        version:
          type: integer
          const: 1
          description: Schema version for evolution

    OrganizationCreatedData:
      type: object
      required:
        - name
        - subdomain
        - owner_email
      properties:
        name:
          type: string
          minLength: 1
          maxLength: 255
          description: Organization display name
        subdomain:
          type: string
          pattern: '^[a-z0-9-]+$'
          minLength: 3
          maxLength: 63
          description: Unique subdomain for the organization
        owner_email:
          type: string
          format: email
          description: Email of the organization owner
        plan:
          type: string
          enum: [free, pro, enterprise]
          default: free

    EventMetadata:
      type: object
      required:
        - workflow_id
        - run_id
        - workflow_type
      properties:
        workflow_id:
          type: string
          description: Temporal workflow ID that emitted this event
        run_id:
          type: string
          description: Temporal run ID
        workflow_type:
          type: string
          description: Temporal workflow type name
        activity_id:
          type: string
          description: Activity that emitted the event
        timestamp:
          type: string
          format: date-time
```

## Event Data Design

### Include Relevant State

Include all data needed by projections and consumers:

```yaml
# GOOD: Includes all relevant context
InvitationSentData:
  type: object
  required:
    - invitation_id
    - email
    - org_id
    - org_name
    - inviter_user_id
    - inviter_email
    - role
    - expires_at
  properties:
    invitation_id: { type: string, format: uuid }
    email: { type: string, format: email }
    org_id: { type: string, format: uuid }
    org_name: { type: string } # Denormalized for email templates
    inviter_user_id: { type: string, format: uuid }
    inviter_email: { type: string, format: email } # For display
    role: { type: string, enum: [clinician, provider_admin] }
    expires_at: { type: string, format: date-time }

# BAD: Missing context, projections need to fetch additional data
InvitationSentData:
  type: object
  required: [invitation_id, email]
  properties:
    invitation_id: { type: string, format: uuid }
    email: { type: string, format: email }
    # Missing org_id, org_name, role, etc.
```

### Avoid Sensitive Data

Never include passwords, tokens, or credentials:

```yaml
# GOOD: No sensitive data
UserCreatedData:
  type: object
  properties:
    user_id: { type: string, format: uuid }
    email: { type: string, format: email }
    role: { type: string }
    # password_hash is NOT included

# BAD: Includes sensitive data
UserCreatedData:
  type: object
  properties:
    user_id: { type: string, format: uuid }
    email: { type: string, format: email }
    password_hash: { type: string } # NEVER DO THIS
```

### Keep Events Immutable

Events should be append-only, never updated:

```yaml
# GOOD: Events represent immutable facts
- OrganizationCreated (created_at: 2024-01-01)
- OrganizationNameChanged (created_at: 2024-01-02, old_name: "Acme", new_name: "Acme Corp")
- OrganizationNameChanged (created_at: 2024-01-03, old_name: "Acme Corp", new_name: "Acme Inc")

# BAD: Modifying existing events (breaks event sourcing)
- OrganizationCreated (created_at: 2024-01-01, name: "Acme Inc") # Modified after creation
```

## Schema Versioning

### Version Field

All events must include a `version` field:

```yaml
OrganizationCreatedPayload:
  type: object
  required: [event_type, aggregate_type, aggregate_id, event_data, version]
  properties:
    version:
      type: integer
      const: 1 # Increment when schema changes
```

### Versioning Strategy

**Non-Breaking Changes** (same version):
- Add optional fields
- Make required fields optional
- Expand enums with new values

**Breaking Changes** (increment version):
- Remove fields
- Rename fields
- Change field types
- Make optional fields required
- Remove enum values

### Example: Version 1 to Version 2

```yaml
# Version 1 (original schema)
OrganizationCreatedData_v1:
  type: object
  required: [name, subdomain, owner_email]
  properties:
    name: { type: string }
    subdomain: { type: string }
    owner_email: { type: string, format: email }

# Version 2 (added optional fields - non-breaking)
OrganizationCreatedData_v2:
  type: object
  required: [name, subdomain, owner_email]
  properties:
    name: { type: string }
    subdomain: { type: string }
    owner_email: { type: string, format: email }
    phone: { type: string } # Added, optional
    address: { type: string } # Added, optional
    version:
      type: integer
      const: 2

# Version 3 (renamed field - BREAKING)
OrganizationCreatedData_v3:
  type: object
  required: [organization_name, subdomain, owner_email] # Renamed 'name' → 'organization_name'
  properties:
    organization_name: { type: string } # BREAKING CHANGE
    subdomain: { type: string }
    owner_email: { type: string, format: email }
    version:
      type: integer
      const: 3
```

### Handling Multiple Versions

Projection triggers must support all versions:

```sql
CREATE OR REPLACE FUNCTION update_organization_projection()
RETURNS TRIGGER AS $$
DECLARE
  event_version INTEGER;
  org_name TEXT;
BEGIN
  event_version := COALESCE((NEW.event_data->>'version')::integer, 1);

  -- Extract name based on version
  IF event_version = 1 OR event_version = 2 THEN
    org_name := NEW.event_data->>'name';
  ELSIF event_version = 3 THEN
    org_name := NEW.event_data->>'organization_name';
  END IF;

  INSERT INTO organizations_projection (id, name, created_at, updated_at)
  VALUES (NEW.aggregate_id, org_name, NEW.created_at, NEW.created_at)
  ON CONFLICT (id) DO NOTHING;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
```

## Contract Registration Workflow

### Step 1: Define Contract

Create AsyncAPI YAML in `infrastructure/supabase/contracts/`:

```bash
infrastructure/supabase/contracts/
├── README.md
├── asyncapi.yaml # Main contract file
└── schemas/
    ├── organization-events.yaml
    ├── user-events.yaml
    └── invitation-events.yaml
```

### Step 2: Validate Contract

Use AsyncAPI CLI to validate:

```bash
npm install -g @asyncapi/cli
asyncapi validate infrastructure/supabase/contracts/asyncapi.yaml
```

### Step 3: Generate TypeScript Types

Generate types for Temporal activities:

```bash
# Install generator
npm install -g @asyncapi/modelina

# Generate TypeScript interfaces
asyncapi generate fromTemplate asyncapi.yaml @asyncapi/typescript-template \
  --output temporal/src/types/events \
  --param modelType=interface
```

### Step 4: Implement in Activities

Use generated types in activities:

```typescript
// Use generated interface
import { OrganizationCreatedPayload } from '../types/events/OrganizationCreatedPayload';

export async function createOrganization(params: CreateOrganizationParams): Promise<void> {
  const event: OrganizationCreatedPayload = {
    event_type: 'OrganizationCreated',
    aggregate_type: 'Organization',
    aggregate_id: orgId,
    event_data: { name: params.name, subdomain: params.subdomain, owner_email: params.ownerEmail },
    metadata: { workflow_id: workflowInfo().workflowId, run_id: workflowInfo().runId, ... },
    version: 1,
  };
  await emitDomainEvent(event);
}
```

### Step 5: Update Projections

Ensure projection triggers handle the new event type:

```sql
-- Add case to existing trigger
WHEN 'OrganizationCreated' THEN
  INSERT INTO organizations_projection (id, name, created_at, updated_at)
  VALUES (NEW.aggregate_id, NEW.event_data->>'name', NEW.created_at, NEW.created_at)
  ON CONFLICT (id) DO NOTHING;
```

## Integration with Temporal Activities

### Event Emission Helper

Reusable helper for all activities (see `temporal-workflow-guidelines/resources/activity-best-practices.md` for full implementation):

```typescript
// temporal/src/activities/helpers/eventEmission.ts
export async function emitDomainEvent(event: DomainEvent): Promise<void> {
  const supabase = new Client(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const { error } = await supabase.from('domain_events').insert({
    id: crypto.randomUUID(),
    event_type: event.event_type,
    aggregate_type: event.aggregate_type,
    aggregate_id: event.aggregate_id,
    event_data: event.event_data,
    metadata: event.metadata,
    created_at: new Date().toISOString(),
  });
  if (error) throw new Error(`Failed to emit event: ${error.message}`);
}
```

### Activity Example

```typescript
import { InvitationSentPayload } from '../types/events/InvitationSentPayload';

export async function sendInvitation(params: SendInvitationParams): Promise<string> {
  const invitationId = await createInvitationRecord(params);
  await sendEmail({ to: params.email, subject: `Join ${params.orgName}`, template: 'invitation' });

  const event: InvitationSentPayload = {
    event_type: 'InvitationSent',
    aggregate_type: 'Invitation',
    aggregate_id: invitationId,
    event_data: { invitation_id: invitationId, email: params.email, org_id: params.orgId, ... },
    metadata: { workflow_id: workflowInfo().workflowId, run_id: workflowInfo().runId, ... },
    version: 1,
  };
  await emitDomainEvent(event);
  return invitationId;
}
```

## TypeScript Type Generation with Modelina

### Source of Truth

**Generated types are the SINGLE source of truth for domain event types.**

- **NEVER** hand-write event type definitions
- **ALWAYS** regenerate types after modifying AsyncAPI schemas
- Import from `@/types/events` (frontend) or `@a4c/event-contracts` (workflows)

### Type Generation Pipeline

```bash
cd infrastructure/supabase/contracts
npm run generate:types
# Then copy to frontend:
cp types/generated-events.ts ../../../frontend/src/types/generated/
```

The pipeline consists of:
1. `replace-inline-enums.js` - Extracts single-value enums to const patterns
2. `asyncapi bundle` - Bundles all YAML files into single spec
3. `generate-types.js` - Uses Modelina to generate TypeScript interfaces
4. `dedupe-enums.js` - Deduplicates enum definitions with canonical names

### Critical Configuration Options

```javascript
// generate-types.js
const generator = new TypeScriptGenerator({
  modelType: 'interface',    // Generate interfaces, not classes
  enumType: 'enum',          // Use TypeScript enums
  rawPropertyNames: true,    // CRITICAL: Preserve snake_case (matches DB schema)
});

// IMPORTANT: Pass raw YAML content, not parsed document
const models = await generator.generate(asyncapiContent);  // ✅ Correct
// NOT: generator.generate(parsedDocument)  // ❌ Loses property info
```

### Anonymous Schema Prevention

**Problem**: Schemas without `title` property generate as `AnonymousSchema_XXX`.

**Solution**: Every schema MUST have a `title` property:

```yaml
# GOOD: Has title, generates as UserCreatedData
UserCreatedData:
  title: UserCreatedData
  type: object
  properties:
    email: { type: string, format: email }

# BAD: No title, generates as AnonymousSchema_123
UserCreatedData:
  type: object
  properties:
    email: { type: string, format: email }
```

**Inline event_data/event_metadata schemas**: These commonly lack titles and generate
anonymous types. Accept this tradeoff (20+ anonymous schemas is normal) or extract to
named schemas if specific type references are needed.

### Enum Handling

**Multi-value enums** use canonical naming via `dedupe-enums.js`:
- Define in `asyncapi/components/enums.yaml`
- Reference via `$ref: ../components/enums.yaml#/...`
- Dedupe script maps values to canonical names

**Single-value enums** (const patterns) stay inline:
- `replace-inline-enums.js` converts to `const` assertions
- These don't need deduplication

### Base Types Injection

Modelina doesn't extract `components/schemas` unless referenced by messages.
The generator injects base types manually:

```javascript
// generate-types.js
const BASE_TYPES = `
export type StreamType = 'user' | 'organization' | ... ;

export interface DomainEvent<TData = Record<string, unknown>> {
  'id': string;
  'stream_type': StreamType;
  ...
}
`;

output += BASE_TYPES;  // Injected before Modelina output
```

### Lessons Learned & Pitfalls

1. **Don't use `constraints` option** - Breaks property extraction
2. **Must pass raw YAML, not parsed document** - `generator.generate(yamlContent)`
3. **Add `export` keyword manually** - Modelina generates without export
4. **Dedupe script must handle `export enum`** - Match full pattern including `export `
5. **Keep StreamType in sync** - Add new stream types to BASE_TYPES in generator
6. **EventMetadata fields** - Add new standard fields to AsyncAPI schema, regenerate

### Frontend Import Pattern

```typescript
// ✅ GOOD: Import from events.ts (which re-exports from generated)
import { DomainEvent, EventMetadata, StreamType } from '@/types/events';

// ❌ BAD: Direct import from generated (bypasses extensions)
import { DomainEvent } from '@/types/generated/generated-events';

// ❌ BAD: Hand-written types (DELETED - don't recreate)
import { DomainEvent } from '@/types/event-types';  // THIS FILE NO LONGER EXISTS
```

### Workflow Import Pattern

```typescript
// In workflows/src/ code
import { UserInvitedEvent, EventMetadata } from '@a4c/event-contracts';
```

## Best Practices

1. **Define contracts before implementation** - Contract-first prevents drift
2. **Version all events** - Include `version` field from day 1
3. **Use past tense names** - Events are facts, not commands
4. **Include all relevant context** - Avoid requiring consumers to fetch additional data
5. **Never include sensitive data** - No passwords, tokens, or credentials
6. **Keep events immutable** - Append-only, never modify
7. **Validate with AsyncAPI CLI** - Catch schema errors early
8. **Generate TypeScript types** - ALWAYS regenerate, NEVER hand-write
9. **Support multiple versions** - Projection triggers handle all versions
10. **Document metadata requirements** - All events include workflow/activity context
11. **Add title to all schemas** - Prevents anonymous schema generation

## Cross-References

- **Event Emission**: See `temporal-workflow-guidelines/resources/event-emission.md` for how activities emit events
- **CQRS Projections**: See `resources/cqrs-projections.md` for projection trigger implementation
- **Contract Registry**: See `infrastructure/supabase/contracts/README.md` for contract file structure
