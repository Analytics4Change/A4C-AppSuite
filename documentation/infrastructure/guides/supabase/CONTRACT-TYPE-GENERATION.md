---
status: current
last_updated: 2026-01-11
---

<!-- TL;DR-START -->
## TL;DR

**Summary**: Guide for generating TypeScript types from AsyncAPI schemas using Modelina. Covers the complete pipeline, critical configuration to prevent AnonymousSchema issues, enum centralization strategy, and developer workflow.

**When to read**:
- Adding new domain events to the system
- Troubleshooting type generation issues
- Understanding the AsyncAPI → TypeScript pipeline
- Setting up type generation in a new environment

**Prerequisites**:
- [event-sourcing-overview.md](../../../architecture/data/event-sourcing-overview.md) - Understanding of domain events

**Key topics**: `asyncapi`, `modelina`, `type-generation`, `typescript`, `domain-events`, `contracts`

**Estimated read time**: 15 minutes
<!-- TL;DR-END -->

# AsyncAPI Contract Type Generation

## Overview

The A4C platform uses **Modelina** to automatically generate TypeScript types from AsyncAPI schemas. Generated types are the **single source of truth** for domain event structures across frontend and workflows.

**Location**: `infrastructure/supabase/contracts/`

**Key Principle**: Contract-first development - define event schemas in AsyncAPI YAML, then generate TypeScript types.

## Pipeline Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Type Generation Pipeline                      │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  asyncapi/domains/*.yaml                                             │
│           │                                                          │
│           ▼                                                          │
│  ┌─────────────────────┐                                             │
│  │ replace-inline-enums│  Converts single-value enums to const       │
│  └─────────────────────┘                                             │
│           │                                                          │
│           ▼                                                          │
│  ┌─────────────────────┐                                             │
│  │   asyncapi bundle   │  Bundles $ref files into single YAML        │
│  └─────────────────────┘                                             │
│           │                                                          │
│           ▼                                                          │
│  ┌─────────────────────┐                                             │
│  │  generate-types.js  │  Modelina generates TypeScript interfaces   │
│  └─────────────────────┘                                             │
│           │                                                          │
│           ▼                                                          │
│  ┌─────────────────────┐                                             │
│  │   dedupe-enums.js   │  Deduplicates enum definitions              │
│  └─────────────────────┘                                             │
│           │                                                          │
│           ▼                                                          │
│  types/generated-events.ts  (665+ lines of TypeScript)               │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

## Quick Start

### Generate Types

```bash
cd infrastructure/supabase/contracts
npm run generate:types
```

### Copy to Frontend

```bash
cp types/generated-events.ts ../../../frontend/src/types/generated/
```

### Run All Checks

```bash
npm run check  # validate + generate:types
```

## Critical Configuration

### The `title` Property Requirement

**Problem**: Schemas without a `title` property generate as `AnonymousSchema_XXX`.

**Solution**: Every schema MUST have a `title` property matching its name.

```yaml
# GOOD - Has title, generates as UserCreatedData
UserCreatedData:
  title: UserCreatedData
  type: object
  properties:
    email: { type: string, format: email }

# BAD - No title, generates as AnonymousSchema_123
UserCreatedData:
  type: object
  properties:
    email: { type: string, format: email }
```

### Modelina Configuration

The generator uses these settings (in `scripts/generate-types.js`):

```javascript
const generator = new TypeScriptGenerator({
  modelType: 'interface',    // Generate interfaces, not classes
  enumType: 'enum',          // Use TypeScript enums
  rawPropertyNames: true,    // CRITICAL: Preserve snake_case property names
});
```

**Important**: `rawPropertyNames: true` ensures property names match the database schema (snake_case).

## Enum Strategy

### Centralized Enums

All reusable enums are defined in `asyncapi/components/enums.yaml`:

```yaml
components:
  schemas:
    ScopeType:
      type: string
      title: ScopeType
      enum: [global, org]
      description: Permission scope type

    GrantScope:
      type: string
      title: GrantScope
      enum: [organization_unit, client_specific]
```

### Referencing Enums in Domain Files

Use `$ref` to reference centralized enums:

```yaml
# In asyncapi/domains/rbac.yaml
RoleCreatedData:
  title: RoleCreatedData
  type: object
  properties:
    scope_type:
      $ref: '../components/enums.yaml#/components/schemas/ScopeType'
```

### Why Centralize?

1. **Prevents duplication** - Same enum defined once, used everywhere
2. **Enables proper TypeScript enums** - Modelina generates real enums
3. **Avoids anonymous types** - Referenced enums get semantic names

## Developer Workflow

### Adding a New Event

1. **Define event in AsyncAPI**:

```yaml
# asyncapi/domains/organization.yaml
OrganizationArchivedEvent:
  title: OrganizationArchivedEvent
  type: object
  required: [event_type, aggregate_type, aggregate_id, event_data]
  properties:
    event_type:
      type: string
      const: organization.archived
    event_data:
      $ref: '#/components/schemas/OrganizationArchivedData'

OrganizationArchivedData:
  title: OrganizationArchivedData
  type: object
  required: [org_id, archived_by, reason]
  properties:
    org_id:
      type: string
      format: uuid
    archived_by:
      type: string
      format: uuid
    reason:
      type: string
```

2. **Add message to channel** (if new event type):

```yaml
# asyncapi/asyncapi.yaml channels section
channels:
  OrganizationArchived:
    address: domain_events.organization.archived
    messages:
      OrganizationArchived:
        $ref: 'domains/organization.yaml#/components/messages/OrganizationArchived'
```

3. **Generate types**:

```bash
npm run generate:types
```

4. **Verify output**:

```bash
grep "OrganizationArchivedData" types/generated-events.ts
# Should show the new interface
```

5. **Copy to frontend**:

```bash
cp types/generated-events.ts ../../../frontend/src/types/generated/
```

6. **Commit all changes**:

```bash
git add asyncapi/ types/
git commit -m "feat: Add organization.archived event"
```

### Modifying Existing Events

1. Update the AsyncAPI schema
2. Run `npm run generate:types`
3. Check diff in `types/generated-events.ts`
4. Copy to frontend
5. Update consuming code if needed

## CI Validation

The `.github/workflows/contracts-validation.yml` workflow:

1. **Triggers on**: Changes to `infrastructure/supabase/contracts/**`
2. **Validates**: AsyncAPI schema syntax
3. **Generates**: TypeScript types
4. **Checks**: No uncommitted changes to `types/`

```yaml
- name: Check for uncommitted changes
  run: |
    if [ -n "$(git status --porcelain types/)" ]; then
      echo "::error::Generated types are out of sync with AsyncAPI spec"
      exit 1
    fi
```

**If CI fails**: Run `npm run generate:types` locally and commit the changes.

## Troubleshooting

### AnonymousSchema in Output

**Symptom**: `types/generated-events.ts` contains `AnonymousSchema_123`

**Cause**: Schema missing `title` property

**Fix**: Add `title` to the schema matching its name

```yaml
# Before (bad)
MyData:
  type: object
  properties: ...

# After (good)
MyData:
  title: MyData
  type: object
  properties: ...
```

### Enum Not Generated as TypeScript Enum

**Symptom**: Enum appears as string union instead of `enum`

**Cause**: Enum defined inline instead of in `components/enums.yaml`

**Fix**: Move enum to `components/enums.yaml` and use `$ref`

### Property Names Converted to camelCase

**Symptom**: `snake_case` properties become `snakeCase`

**Cause**: `rawPropertyNames` not set in generator config

**Fix**: Ensure generator config includes `rawPropertyNames: true`

### Types Not Updating

**Symptom**: Changes to YAML not reflected in TypeScript

**Cause**: Stale bundled file or cached output

**Fix**:
```bash
npm run clean
npm run generate:types
```

### Import Errors in Frontend

**Symptom**: Frontend can't find generated types

**Cause**: Types not copied to frontend after regeneration

**Fix**:
```bash
cp types/generated-events.ts ../../../frontend/src/types/generated/
```

## File Organization

```
infrastructure/supabase/contracts/
├── asyncapi/
│   ├── asyncapi.yaml          # Main spec (references domains)
│   ├── components/
│   │   ├── schemas.yaml       # Base types (EventMetadata, etc.)
│   │   └── enums.yaml         # Centralized enum definitions
│   ├── domains/
│   │   ├── organization.yaml
│   │   ├── user.yaml
│   │   ├── invitation.yaml
│   │   └── ...
│   └── domains.archived/      # Removed domain specs
├── scripts/
│   ├── generate-types.js      # Modelina generation script
│   ├── replace-inline-enums.js
│   └── dedupe-enums.js
├── types/
│   ├── generated-events.ts    # OUTPUT: Generated TypeScript
│   └── events.ts              # Re-exports from generated
├── package.json               # Scripts and dependencies
└── asyncapi-bundled.yaml      # OUTPUT: Bundled spec
```

## Package.json Scripts

| Script | Purpose |
|--------|---------|
| `bundle` | Bundle AsyncAPI files into single YAML |
| `validate` | Validate AsyncAPI schema syntax |
| `generate:types` | Full pipeline: replace-enums → bundle → generate → dedupe |
| `check` | Run validate + generate:types |
| `clean` | Remove generated files |

## Related Documentation

- [Event Sourcing Overview](../../../architecture/data/event-sourcing-overview.md) - CQRS and domain events architecture
- [Event Metadata Schema](../../../workflows/reference/event-metadata-schema.md) - Metadata field requirements
- [Infrastructure CLAUDE.md](../../../../infrastructure/CLAUDE.md) - Quick reference for type generation commands
- [AsyncAPI Contracts Skill](.claude/skills/infrastructure-guidelines/resources/asyncapi-contracts.md) - Detailed Modelina patterns
