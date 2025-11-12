# Architecture Documentation

Cross-cutting architectural documentation that spans multiple components of the A4C-AppSuite.

## Directory Structure

- **[authentication/](./authentication/)** - Authentication architecture and patterns
  - OAuth2/OIDC implementation
  - Supabase Auth integration
  - Session management
  - JWT custom claims

- **[authorization/](./authorization/)** - Authorization architecture and patterns
  - Role-based access control (RBAC)
  - Row-level security (RLS)
  - Permission models
  - Multi-tenancy

- **[data/](./data/)** - Data architecture and patterns
  - Event-driven architecture
  - CQRS (Command Query Responsibility Segregation)
  - Event sourcing
  - Database design patterns

- **[workflows/](./workflows/)** - Workflow architecture and patterns
  - Temporal.io integration
  - Workflow orchestration patterns
  - Saga pattern for distributed transactions
  - Event emission from activities

## Purpose

This directory contains architectural documentation that:
- Describes system-wide patterns and decisions
- Crosses component boundaries
- Provides context for implementation choices
- Documents both current and planned (aspirational) architecture

## Documentation Status

Many documents in this directory may be marked as **aspirational** (not yet implemented). Always check the YAML frontmatter for the current status:

```yaml
---
status: current|aspirational|archived
last_updated: YYYY-MM-DD
applies_to_version: vX.Y.Z
---
```

Look for inline markers like `> [!NOTE] This feature is not yet implemented` for aspirational content.

## See Also

- [Frontend Architecture](../frontend/architecture/) - Component-specific frontend architecture
- [Workflows Architecture](../workflows/architecture/) - Component-specific workflow architecture
- [Infrastructure Architecture](../infrastructure/architecture/) - Component-specific infrastructure architecture
