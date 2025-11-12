# Subdomain Provisioning Project

**Status**: Phase 0-2 Complete, Parked
**Date Parked**: 2025-01-12
**Original Location**: Repository root

## Overview

This project implements subdomain creation and provisioning as part of the provider/provider-partner bootstrap workflow, using Temporal for orchestration and PostgreSQL for event sourcing/CQRS projections.

## Architecture

- **Temporal-first approach**: All orchestration in Temporal workflows
- **Non-blocking provisioning**: Bootstrap completes immediately, subdomain provisions in background
- **Environment-aware base domains**:
  - Development: `{slug}.firstovertheline.com`
  - Production: `{slug}.analytics4change.com`

## Files

- **implementation-tracking.md** - Implementation progress tracking document

## Current Status

- ✅ Phase 0: Cleanup (Complete)
- ✅ Phase 1: Database schema (Complete)
- ✅ Phase 2: Temporal workflows (Complete)
- ⏸️ Phase 3+: Paused pending priority reassessment

## Why Parked

This implementation tracking document was moved from the repository root to `dev/parked/` as part of the documentation consolidation project. The project reached a stable checkpoint (Phase 0-2 complete) and was paused to focus on higher-priority work.

## Related Documentation

- For active subdomain provisioning documentation, see: `documentation/workflows/` (when migrated)
- For architecture decisions, see: `documentation/architecture/workflows/` (when migrated)

## Resuming Work

To resume this project:

1. Review implementation-tracking.md for current status
2. Check for any changes to Temporal workflows or database schema since last update
3. Validate Phase 0-2 work still functions as expected
4. Continue with Phase 3 as outlined in tracking document
