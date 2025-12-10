---
status: current
last_updated: 2025-12-09
---

# Operational Utilities

Ad-hoc scripts, cleanup tools, and manual testing utilities for A4C-AppSuite operations.

## Overview

This section documents command-line utilities available for:
- **Cleanup**: Removing test data, development entities, and orphaned records
- **Manual Testing**: Scripts for testing workflows, APIs, and integrations
- **Diagnostics**: Tools for debugging and system analysis
- **Data Migration**: One-time scripts for data transformations

## Available Scripts

### Cleanup Utilities

| Script | Location | Purpose |
|--------|----------|---------|
| [cleanup-org.ts](./cleanup-org.md) | `workflows/src/scripts/` | Hard delete an organization by slug |
| cleanup-dev.ts | `workflows/src/scripts/` | Soft delete tagged development entities |
| cleanup-test-artifacts.sql | `infrastructure/supabase/scripts/` | Hard delete test artifacts from validation |

### Query & Audit Utilities

| Script | Location | Purpose |
|--------|----------|---------|
| query-dev.ts | `workflows/src/scripts/` | Query development entities without deletion |
| validate-system.ts | `workflows/src/scripts/` | System health check and validation |

### Manual Testing

| Script | Location | Purpose |
|--------|----------|---------|
| test-organization-bootstrap.sh | `/scripts/` | UAT testing for organization bootstrap workflow |
| test-config.ts | `workflows/src/scripts/` | Validate workflow configuration |

## Quick Reference

### Run a Cleanup Script

```bash
cd workflows

# Preview what would be deleted (dry-run)
npm run cleanup:org -- --slug=my-org-slug --dry-run

# Execute cleanup
npm run cleanup:org -- --slug=my-org-slug

# Query development entities
npm run query:dev -- --tag=development
```

### Run System Validation

```bash
cd workflows
npm run validate
```

## Environment Requirements

Most scripts require:
- Node.js 20+
- npm dependencies installed (`npm install` in the relevant directory)

Some scripts require additional configuration:
- **Supabase scripts**: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`
- **Cloudflare scripts**: `CLOUDFLARE_API_TOKEN` (in `frontend/.env.local`)
- **Temporal scripts**: `TEMPORAL_ADDRESS`, port-forwarding to Temporal cluster

## Adding New Utilities

When creating new ad-hoc scripts:

1. **Location**: Place in `{component}/src/scripts/` directory
2. **npm script**: Add to `package.json` for easy execution
3. **Documentation**: Create a markdown file in this directory
4. **Dry-run mode**: Always support `--dry-run` for preview
5. **Error handling**: Exit with code 1 on failure, 0 on success

## See Also

- [Environment Variables Reference](../configuration/ENVIRONMENT_VARIABLES.md)
- [Deployment Checklist](../deployment/DEPLOYMENT_CHECKLIST.md)
- [Workflows CLAUDE.md](../../../../workflows/CLAUDE.md) - Script patterns and conventions
