---
status: archived
last_updated: 2026-03-28
---

<!-- TL;DR-START -->
## TL;DR

**Summary**: Legacy `clients` table from the pre-CQRS schema. Superseded by `clients_projection` (created 2026-03-27) which is a full CQRS projection with ~50 typed columns, event-sourced via `client.*` stream.

**When to read**: Never — use [clients_projection.md](./clients_projection.md) instead.

**Key topics**: `deprecated`, `legacy`

**Estimated read time**: 1 minute
<!-- TL;DR-END -->

# clients (ARCHIVED)

> **This table is superseded by `clients_projection`.** See [clients_projection.md](./clients_projection.md) for the current client data model.

The legacy `clients` table was a direct CRUD table with ~20 columns, no event sourcing, and incomplete RLS policies. It has been replaced by `clients_projection`, a full CQRS projection with:

- ~50 typed columns (demographics, referral, admission, clinical, medical, legal, discharge, education)
- `custom_fields` JSONB for org-defined fields
- Org-configurable field visibility via `client_field_definitions_projection`
- Three-field discharge decomposition (Decision 78)
- 9 indexes including GIN on custom_fields
- Proper RLS policies (org-scoped SELECT + platform admin override)
- Event-sourced via `client.*` stream type

## Related Documentation

- [clients_projection](./clients_projection.md) — Current client table
- [Client Data Model](../../../../documentation/architecture/data/client-data-model.md) — Architecture overview
