# Implementation Plan: Client Management Applet

## Executive Summary

The client management applet is the core data-entry surface for A4C-AppSuite. It captures intake data for at-risk youth placed in habilitative care across ~300 provider organizations. The applet must support org-configurable intake fields while producing conforming dimensional attributes that feed a Cube.js semantic layer for self-service BI analytics.

No legacy `clients` table exists in the v4 baseline — this is greenfield. The implementation creates `clients_projection` as a full CQRS projection table with event-sourced field definitions, value set reference tables, 11 event handlers, 20 API functions, and comprehensive event type registration.

## Detailed Plan Location

**The authoritative implementation plan is at**: `.claude/plans/spicy-bubbling-quail.md`

This ~1,150-line plan file contains:
- Complete SQL schemas for all 5 migrations
- Full cross-correlation audit of all 110 event types (routers vs AsyncAPI)
- Handler specifications for 11 new handlers + 9 router ELSE fixes
- API function signatures for 20 functions
- AsyncAPI contract creation and fix specifications
- Handler reference file creation plan (13 new + 11 updated)
- Verification plan with SQL test queries
- Complete file creation/modification manifest

## Phase Summary

### Phase 1: Research & Discovery ✅ COMPLETE
- All intake fields cataloged and classified
- `clients_projection` as full CQRS projection (stream_type: `client`)
- Cross-correlation audit complete: 93 existing + 17 new = 110 total events
- Found: 2 AsyncAPI naming mismatches, 3 missing contracts, 9 RAISE WARNING fixes
- Plan written and ready for approval

### Phase 2: Schema Foundation ⏸️ PENDING
5 migrations planned:
1. `clients_projection` + indexes + RLS + FK + junction tables + junction RLS
2. `client_field_definitions_projection` + `client_reference_values` + seeds + RLS
3. Dispatcher update + 2 routers + 11 handlers + 6 junction CASE lines + 9 RAISE WARNING fixes
4. 20 API functions (10 client CRUD + 6 junction link/unlink + 4 field definition)
5. `event_types` seed (110 events) + AsyncAPI contracts + TypeScript types

### Phase 3: Event Integration ⏸️ PENDING
Covered by migrations 3-5 above. Also includes:
- Handler reference files (13 new, 11 updated)
- AsyncAPI contract creation + fixes
- Verification and testing

### Phase 4: Analytics Foundation ⏸️ PENDING
- Cube.js PatientDimension cube design
- Dynamic schema generation from field registry
- Computed dimensions (age_group, length_of_stay, admission_cohort)
- Pre-aggregation strategy

### Phase 5: Frontend Intake Form (Future)
_Deferred — this plan covers foundation only._

## Plan Updates (2026-02-12)

### Scope Expansion: Cross-Correlation Audit
Original plan only covered new client events. Expanded to audit ALL existing events across 12 routers vs 14 AsyncAPI domain files. This surfaced:
- 2 naming mismatches (AsyncAPI wrong vs deployed router)
- 3 missing AsyncAPI contracts for deployed handlers
- 9 routers with RAISE WARNING instead of RAISE EXCEPTION
- 3 intentional dual-routed events
These fixes are now included in Migration 3 and Migration 5.

### Scope Expansion: Comprehensive event_types Seed
Originally planned to seed only 17 new client event types. Expanded to seed ALL 110 event types (93 existing + 17 new) since `event_types` table had zero seed data.

### Stream Type Change
Changed from `clinical` (too broad) to `client` (entity-specific). Added separate `client_field_definition` stream type for field registry events.

### Table Name Change
Changed from `clients` (direct table) to `clients_projection` (full CQRS projection). No legacy table exists in v4 baseline — greenfield creation.

## Success Metrics

### Immediate (Phase 2-3)
- [ ] Expanded `clients_projection` schema deployed with all universal fields
- [ ] `client_field_definitions_projection` table created
- [ ] RLS policies implemented and tested
- [ ] Value set tables seeded with OMB/ISO standards
- [ ] `client.*` event stream functional
- [ ] Client CRUD via `api.*` RPC functions (CQRS compliant)
- [ ] `user_client_assignments_projection` has FK to `clients_projection`
- [ ] All 110 event types registered in `event_types` table
- [ ] All 9 RAISE WARNING fixes applied

### Long-Term (Phase 4-5)
- [ ] Cube.js schema generates dimensions from field registry
- [ ] Self-service BI can slice by client demographics
- [ ] Intake form is org-configurable

## Risk Mitigation

| Risk | Impact | Mitigation |
|------|--------|------------|
| CQRS conversion complexity | Migration complexity | Greenfield — no legacy table to convert |
| Field registry complexity | Over-engineering | Start with core fields only; field registry can be deferred if premature |
| Conforming dimension mapping overhead | Operational burden on orgs | Push app-owner value sets; mapping table is opt-in for edge cases |
| RAISE WARNING fixes break existing events | Unhandled event types would fail loudly | These are coding convention fixes — unhandled types were silently dropped before, now they'll be caught and recorded in `processing_error` |

## Next Steps After Completion

1. **Frontend intake form** — Configurable form driven by field registry
2. **Behavioral incidents domain** — Second fact table for analytics correlation
3. **Cube.js integration** — Semantic layer connecting client dimensions to fact tables
4. **Self-service BI** — Query builder with conforming dimension enforcement
