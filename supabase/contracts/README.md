# A4C Event Contracts

This directory contains the event schema contracts for the Analytics4Change platform's event-driven architecture.

## 📁 Directory Structure

```
contracts/
├── asyncapi/              # AsyncAPI specification files (source of truth)
│   ├── asyncapi.yaml     # Main AsyncAPI document
│   ├── domains/          # Domain-specific event definitions
│   │   ├── client.yaml
│   │   ├── medication.yaml
│   │   └── user.yaml
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
- **domains/**: Event definitions organized by domain (client, medication, user)
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

The `types/` directory contains hand-crafted TypeScript type definitions based on the AsyncAPI specs.

### Why Hand-Crafted?

We initially attempted to use AsyncAPI code generation templates, but:
- The `@asyncapi/ts-nats-template` generates NATS client code, not clean types
- Generated types had anonymous schema names (e.g., `AnonymousSchema_561`)
- The output was too coupled to NATS messaging infrastructure

**Solution**: Manually maintain TypeScript types based on AsyncAPI specs. The AsyncAPI YAML remains the source of truth, and types are kept in sync during development.

### Using Types in Frontend

The Frontend repository will sync these types at build time:

```bash
# In Frontend repo
npm run sync-schemas
```

This copies `types/events.ts` to `src/types/events.ts` in the Frontend.

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

### Client Domain

Events related to client lifecycle:

- `client.registered` - New client registration
- `client.admitted` - Client admitted to facility
- `client.information_updated` - Client data changes
- `client.discharged` - Client discharge from facility

### Medication Domain

Events related to medication management:

- `medication.added_to_formulary` - Medication added to system
- `medication.prescribed` - Medication prescribed to client
- `medication.administered` - Medication given to client
- `medication.skipped` - Scheduled dose skipped
- `medication.refused` - Client refused medication
- `medication.discontinued` - Medication discontinued

### User Domain

Events related to user management:

- `user.synced_from_zitadel` - User synchronized from Zitadel
- `user.organization_switched` - User switched active organization

## 🛠️ Development Workflow

### Adding a New Event

1. **Define in AsyncAPI** (`asyncapi/domains/*.yaml`):
   ```yaml
   ClientRegistered:
     name: client.registered
     payload:
       $ref: '#/components/schemas/ClientRegisteredEvent'
   ```

2. **Add TypeScript Definition** (`types/events.ts`):
   ```typescript
   export interface ClientRegisteredEvent extends DomainEvent<ClientRegistrationData> {
     stream_type: 'client';
     event_type: 'client.registered';
   }
   ```

3. **Validate**:
   ```bash
   npm run validate
   ```

4. **Commit and Push** to trigger Frontend schema sync

### Modifying Existing Events

1. Update AsyncAPI specification
2. Update TypeScript types to match
3. Validate changes
4. Update version in `package.json` if breaking change
5. Document breaking changes in PR description

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
