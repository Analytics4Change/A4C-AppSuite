# A4C Event Contracts

This directory contains the event schema contracts for the Analytics4Change platform's event-driven architecture.

## 📁 Directory Structure

```
contracts/
├── asyncapi/              # AsyncAPI specification files (source of truth)
│   ├── asyncapi.yaml     # Main AsyncAPI document
│   ├── domains/          # Domain-specific event definitions
│   │   ├── user.yaml
│   │   ├── organization.yaml
│   │   ├── organization-unit.yaml
│   │   ├── invitation.yaml
│   │   └── ...
│   ├── domains.archived/ # Archived domain specs (client, medication removed 2025-01-10)
│   └── components/       # Shared schemas and components
│       └── schemas.yaml
├── types/                # TypeScript type definitions
│   ├── events.ts        # Generated TypeScript types
│   └── package.json
├── package.json          # Build scripts and dependencies
└── README.md            # This file
```

## 🎯 Purpose

This directory serves as the **single source of truth** for all domain event schemas across the A4C platform. It ensures:

- **Contract-first development**: Events are defined before implementation
- **Type safety**: TypeScript definitions prevent runtime errors
- **Documentation**: AsyncAPI specs serve as living documentation
- **Consistency**: All services use the same event structure

## 📝 AsyncAPI Specifications

The `asyncapi/` directory contains the event specifications in AsyncAPI format:

- **asyncapi.yaml**: Main specification file that references domain files
- **domains/**: Event definitions organized by domain (user, organization, invitation, etc.)
- **domains.archived/**: Archived domain specs for removed features (client, medication removed 2025-01-10)
- **components/**: Shared schemas (EventMetadata, Address, etc.)

### Validation

Validate the AsyncAPI specifications:

```bash
npm run validate
```

### Bundling

The specifications use `$ref` to split files for maintainability. Bundle them into a single file:

```bash
npm run bundle
```

This creates `asyncapi-bundled.yaml` for tools that don't support `$ref` resolution.

## 📦 TypeScript Types

The `types/` directory contains **auto-generated** TypeScript types from AsyncAPI schemas using Modelina.

### Type Generation

Types are automatically generated from AsyncAPI schemas:

```bash
# Generate types from AsyncAPI
npm run generate:types

# Copy to frontend
cp types/generated-events.ts ../../../frontend/src/types/generated/
```

### How We Solved the AnonymousSchema Problem

Initial attempts at auto-generation produced `AnonymousSchema_XXX` names. We solved this by:

1. **Adding `title` property to ALL schemas** - Modelina uses `title` for type names
2. **Centralizing enums in `components/enums.yaml`** - Proper TypeScript enum generation
3. **Custom pipeline** - Scripts to handle enum replacement and deduplication

> **📖 For implementation details**: See [CONTRACT-TYPE-GENERATION.md](../../../documentation/infrastructure/guides/supabase/CONTRACT-TYPE-GENERATION.md)

### Using Types in Frontend

After generating types, copy to frontend:

```bash
cp types/generated-events.ts ../../../frontend/src/types/generated/
```

Frontend imports from `@/types/events` (which re-exports from generated).

## 🔄 Event Structure

All domain events follow this structure:

```typescript
interface DomainEvent<T> {
  id: string;                    // Unique event ID (UUID)
  stream_id: string;             // Entity/aggregate ID
  stream_type: StreamType;       // Type of entity
  stream_version: number;        // Version within stream
  event_type: string;            // Event type (e.g., "client.registered")
  event_data: T;                 // Event-specific payload
  event_metadata: EventMetadata; // WHO, WHEN, WHY metadata
  created_at: string;            // Event creation timestamp
  processed_at?: string;         // Processing completion time
  processing_error?: string;     // Error message if failed
}
```

### Event Metadata (WHO, WHEN, WHY)

Every event includes metadata capturing:

- **WHO**: `user_id`, `organization_id`
- **WHEN**: `timestamp`
- **WHY**: `reason` (required - explains why the change occurred)

Example:
```typescript
event_metadata: {
  user_id: "550e8400-e29b-41d4-a716-446655440000",
  organization_id: "660e8400-e29b-41d4-a716-446655440001",
  reason: "Updated emergency contact per client's request during intake",
  timestamp: "2024-10-02T12:34:56Z"
}
```

## 🎨 Event Domains

### User Domain

Events related to user management:

- `user.synced_from_auth` - User synchronized from Supabase Auth
- `user.organization_switched` - User switched active organization

### Organization Domain

Events related to organization lifecycle:

- `organization.bootstrap_initiated` - Organization onboarding started
- `organization.bootstrap_completed` - Organization onboarding completed
- `organization.bootstrap_failed` - Organization onboarding failed
- `organization.bootstrap_cancelled` - Organization onboarding cancelled

### Organization Unit Domain

Events related to sub-organizations (locations, departments):

- `organization_unit.created` - Sub-organization created
- `organization_unit.updated` - Sub-organization metadata updated
- `organization_unit.deactivated` - Sub-organization deactivated
- `organization_unit.reactivated` - Sub-organization reactivated

### Invitation Domain

Events related to user invitations:

- `invitation.created` - User invited to organization
- `invitation.revoked` - Invitation cancelled
- `invitation.accepted` - Invitation accepted
- `invitation.expired` - Invitation expired

### Archived Domains

The following domains were removed (2025-01-10) and archived in `domains.archived/`:

- **Client Domain** - Will be redefined with proper event-driven architecture
- **Medication Domain** - Will be redefined with proper event-driven architecture

## 🛠️ Development Workflow

### Adding a New Event

1. **Define in AsyncAPI** (`asyncapi/domains/*.yaml`):
   ```yaml
   ClientRegistered:
     name: client.registered
     payload:
       $ref: '#/components/schemas/ClientRegisteredEvent'

   # In components/schemas section - MUST include title!
   ClientRegisteredEvent:
     title: ClientRegisteredEvent
     type: object
     properties:
       event_type:
         type: string
         const: client.registered
       event_data:
         $ref: '#/components/schemas/ClientRegisteredData'
   ```

2. **Generate TypeScript types**:
   ```bash
   npm run generate:types
   ```

3. **Verify output** (no AnonymousSchema):
   ```bash
   grep "ClientRegisteredEvent" types/generated-events.ts
   ```

4. **Copy to frontend**:
   ```bash
   cp types/generated-events.ts ../../../frontend/src/types/generated/
   ```

5. **Commit all changes** (AsyncAPI + generated types)

### Modifying Existing Events

1. Update AsyncAPI specification
2. Run `npm run generate:types`
3. Check diff in `types/generated-events.ts`
4. Copy to frontend
5. Update version in `package.json` if breaking change
6. Document breaking changes in PR description

## 📚 Additional Resources

- [AsyncAPI Documentation](https://www.asyncapi.com/docs)
- [Event Sourcing Pattern](https://martinfowler.com/eaaDev/EventSourcing.html)
- [Domain Events Pattern](https://docs.microsoft.com/en-us/dotnet/architecture/microservices/microservice-ddd-cqrs-patterns/domain-events-design-implementation)

## 🤝 Contributing

1. All event changes require review
2. Breaking changes must be discussed with team
3. Keep AsyncAPI specs and TypeScript types in sync
4. Always include `reason` in event metadata
5. Follow naming convention: `<domain>.<action>` (e.g., `client.registered`)

## 📄 License

Private - Analytics4Change Platform
