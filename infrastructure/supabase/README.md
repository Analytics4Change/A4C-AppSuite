# Supabase Infrastructure

This directory contains the SQL schema and deployment scripts for the A4C Supabase database.

## Architecture: Event-First with CQRS

This system uses an **Event-First Architecture** where:
1. **All writes go through events** - Applications only emit events to `domain_events` table
2. **Automatic projections** - Triggers automatically project events to normalized tables
3. **Fast reads** - Applications read from 3NF tables for optimal query performance
4. **Complete audit trail** - Every change includes WHO, WHAT, WHEN, and most importantly WHY

## Structure

```
supabase/
├── sql/
│   ├── 00-extensions/       # PostgreSQL extensions (uuid-ossp, pgcrypto)
│   ├── 01-events/           # Event infrastructure (domain_events table)
│   ├── 02-tables/           # Table definitions with nested structure:
│   │   └── [table_name]/
│   │       ├── table.sql    # CREATE TABLE statement
│   │       ├── indexes/     # Individual index definitions
│   │       └── policies/    # RLS policies for the table
│   ├── 03-functions/
│   │   ├── event-processing/# Event projection functions
│   │   └── *.sql           # Other stored procedures
│   ├── 04-triggers/         # Event processing triggers
│   ├── 05-views/            # Database views (including event views)
│   ├── 06-rls/             # Row Level Security enablement
│   └── 07-seed/            # Seed data for development
├── edge-functions/          # Supabase Edge Functions (TypeScript)
├── storage/                 # Storage bucket configurations
├── scripts/                 # Deployment and utility scripts
└── config/                  # Configuration files
```

## Deployment

### Prerequisites

1. Access to Supabase Dashboard SQL Editor
2. Supabase project credentials (URL, anon key, service role key)
3. Git-crypt key for decrypting sensitive files

### Manual Deployment (via SQL Editor)

1. Open your Supabase Dashboard
2. Navigate to SQL Editor
3. Execute files in dependency order:
   - Extensions (00-extensions/*.sql)
   - Functions (03-functions/*.sql)
   - Tables (02-tables/*/table.sql)
   - Indexes (02-tables/*/indexes/*.sql)
   - Triggers (02-tables/*/triggers/*.sql)
   - RLS enablement (05-rls/*.sql)
   - Policies (02-tables/*/policies/*.sql)

### Scripted Deployment

```bash
cd supabase

# Review what will be deployed
./scripts/deploy.sh --dry-run

# Deploy to Supabase
export SUPABASE_DB_URL="postgresql://postgres:[password]@[project-ref].supabase.co:5432/postgres"
./scripts/deploy.sh
```

## Event-First Architecture

### How It Works

1. **Application writes events only**:
```javascript
// Instead of complex UPDATE logic:
await supabase.from('domain_events').insert({
  stream_id: medicationId,
  stream_type: 'medication',
  event_type: 'medication.discontinued',
  event_data: { discontinue_date, client_id },
  event_metadata: {
    user_id: currentUser.id,
    reason: 'Adverse reaction observed', // The WHY!
    approval_chain: [...approvers]
  }
});
```

2. **Database automatically projects to 3NF tables** via triggers
3. **Application reads from normal tables** for fast queries

### Benefits

- **Never lose data** - Events are immutable
- **Complete audit trail** - Every change has context and reason
- **Time travel** - Query state at any point in history
- **Simpler code** - Just emit events, no complex UPDATE logic
- **Event replay** - Can rebuild state from events

## Tables

### Event Store

1. **domain_events** - Single source of truth for all changes (append-only)
2. **event_types** - Catalog of valid events with schemas

### Core Tables (Projected from events)

3. **organizations** - Multi-tenant organizations (synced with Zitadel)
4. **users** - Shadow table for Zitadel users (for RLS and auditing)
5. **clients** - Patient/client records
6. **medications** - Medication catalog with drug information
7. **medication_history** - Prescription and administration history
8. **dosage_info** - Actual medication administration events

### Audit Tables

9. **audit_log** - General system audit trail (populated from events)
10. **api_audit_log** - REST API specific logging

## Key Design Principles

1. **One File Per Object**: Each database object (table, index, trigger, policy) has its own SQL file
2. **Dependency Order**: Numbered prefixes ensure correct execution order
3. **Table-Centric Organization**: Related objects are grouped under their table directory
4. **Version Control Friendly**: Small, focused files make changes easy to track
5. **Scriptable Deployment**: Can be deployed via scripts or CI/CD

## Development Workflow

1. Make changes to individual SQL files
2. Test locally if you have a local Supabase instance
3. Deploy to development project first
4. Verify changes in Supabase Dashboard
5. Commit changes to git (files are encrypted via git-crypt)

## Adding New Objects

### New Table
1. Create directory: `sql/02-tables/[table_name]/`
2. Create subdirectories: `indexes/`, `triggers/`, `policies/`
3. Add `table.sql` with CREATE TABLE statement
4. Add individual files for indexes, triggers, and policies
5. Update deployment script if needed

### New Index
Create file: `sql/02-tables/[table_name]/indexes/idx_[name].sql`

### New Function
Create file: `sql/03-functions/[function_name].sql`

### New Policy
Create file: `sql/02-tables/[table_name]/policies/[policy_name].sql`

## Security

- All tables have Row Level Security (RLS) enabled
- Policies enforce organization-based multi-tenancy
- Audit tables track all data changes
- Service role key is encrypted in repository

## Troubleshooting

### Common Issues

1. **Dependency Errors**: Ensure objects are created in correct order
2. **RLS Blocking Access**: Check that appropriate policies exist
3. **Missing Extensions**: Run extension SQL files first
4. **Foreign Key Violations**: Create referenced tables before dependent ones

### Rollback

If deployment fails:
1. Check error messages in Supabase Dashboard logs
2. Use `./scripts/rollback.sh` if available
3. Or manually drop objects in reverse order

## Integration with Frontend

The A4C-Frontend application expects:
- All tables to exist with correct schema
- RLS policies to be in place
- Zitadel user synchronization to populate users table
- Organization context to be set for multi-tenancy