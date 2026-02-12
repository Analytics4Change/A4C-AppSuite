# Handler Reference Files

Canonical SQL source for every event handler, router, and trigger function in the A4C event processing chain. These files exist so AI agents (and humans) can **copy existing implementations** instead of rewriting from memory.

## Purpose

All handlers originate from the 14,648-line baseline migration and subsequent post-baseline migrations. Searching a file that large is error-prone — agents skip to "what they remember" and introduce column name drift. These reference files solve that by providing one function per file, ready to copy-paste into a new migration.

### Primary Use Case: Day Zero Migration Resets

When consolidating migrations into a new baseline ("Day Zero reset"), function definitions for unchanged handlers, routers, and triggers must be **copy/pasted verbatim** from these reference files — never rewritten from memory.

**Day Zero workflow**:
1. Identify which functions have NOT changed since the last baseline
2. Copy their definitions from `handlers/<domain>/<function>.sql` into the new baseline
3. Only rewrite functions that have actually been modified in post-baseline migrations

This prevents column name drift, type mismatches, and logic errors during baseline consolidation. See the [Day 0 Migration Guide](../../../documentation/infrastructure/guides/supabase/DAY0-MIGRATION-GUIDE.md) for the full baseline consolidation workflow.

## Directory Structure

```
handlers/
├── README.md                    # This file
├── trigger/                     # Trigger functions on domain_events (5)
│   ├── process_domain_event.sql # Main dispatcher (BEFORE INSERT/UPDATE)
│   └── ...                      # Bootstrap, workflow queue, pg_notify
├── routers/                     # Router functions dispatched by stream_type (12)
│   ├── process_user_event.sql
│   └── ...
├── user/                        # User domain handlers (16)
├── organization/                # Organization domain handlers (11)
├── organization_unit/           # Org unit domain handlers (5)
├── rbac/                        # Role/permission handlers (10)
├── bootstrap/                   # Bootstrap lifecycle handlers (3)
└── invitation/                  # Invitation handlers (1)
```

## Usage Rules

### Before Modifying a Handler
1. **Read the reference file first** — `handlers/<domain>/<handler>.sql`
2. **Copy the existing implementation** into your migration
3. **Modify the copy** — don't rewrite from scratch

### After Creating a Migration That Changes a Handler
1. **Update the reference file** to match the new version
2. The reference file should always reflect the **latest deployed version**

### Adding a New Handler
1. Create the handler function in your migration
2. Add a CASE branch in the appropriate router
3. Create a new reference file: `handlers/<domain>/<handler_name>.sql`
4. Update the router reference file: `handlers/routers/<router>.sql`

### Adding a New Domain (Stream Type)
1. Create the router function and handler(s) in your migration
2. Add the stream_type CASE branch to `process_domain_event()` **in the same migration**
3. Create reference files for router + handlers
4. Update `handlers/trigger/process_domain_event.sql`

## Event Processing Chain

```
domain_events INSERT
  → process_domain_event_trigger (BEFORE INSERT/UPDATE)
    → process_domain_event()           [trigger/]
      → routes by stream_type
        → process_*_event()            [routers/]
          → routes by event_type
            → handle_*()               [<domain>/]
              → updates projection tables
```

## Sync Protocol

These files are **documentation**, not deployment artifacts. They are never executed directly. The source of truth is always the deployed database (via migrations).

- **Authoritative source**: `pg_get_functiondef()` from the live Supabase database
- **Extraction method**: `SELECT pg_get_functiondef(p.oid) FROM pg_proc p WHERE p.proname = '<function_name>'`
- **Last synced**: 2026-02-11

## File Format

Each `.sql` file contains exactly one `CREATE OR REPLACE FUNCTION` statement with a trailing semicolon. No headers, no comments, no transaction wrappers — just the canonical SQL.
