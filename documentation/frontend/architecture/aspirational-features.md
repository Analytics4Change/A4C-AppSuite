# Aspirational Features

This document tracks frontend features that have partial implementation but are not yet complete or fully specified.

**Last Updated**: 2024-12-20

## Medication Templates

**Status**: Aspirational (No UI, No Database Table)

### What Exists

| Component | Location | Status |
|-----------|----------|--------|
| Service | `frontend/src/services/medications/template.service.ts` | Implemented |
| Types | `frontend/src/types/medication-template.types.ts` | Defined |
| Permission | `medication.create_template` in `permissions-reference.md` | Defined |
| Database Table | `medication_templates` | **Does not exist** |
| UI Components | None | **Not implemented** |
| Routes | None | **Not implemented** |

### Description

The medication templates feature would allow clinicians to:
1. Create reusable medication configuration templates from existing prescriptions
2. Apply templates to quickly configure new medications for clients
3. Track template usage statistics
4. Strip PII (client-specific data) when creating templates

### Service Capabilities (Implemented but Unused)

The `MedicationTemplateService` provides:
- `createTemplate()` - Create template from existing medication
- `getTemplates()` - List templates with filtering/sorting
- `getTemplate()` - Get single template by ID
- `applyTemplate()` - Apply template to pre-fill medication form
- `updateTemplate()` - Update template properties
- `deleteTemplate()` - Soft-delete template
- `getTemplateStats()` - Get usage statistics

### Missing Requirements

Before implementation can proceed:

1. **Database Schema**: Define `medication_templates` table structure
2. **Event Types**: Define domain events for template CRUD operations
3. **RLS Policies**: Define row-level security for multi-tenant isolation
4. **UI/UX Specification**: Design the template management interface
5. **Integration Points**: Define where templates appear in medication workflow

### Related Files

- Service: `frontend/src/services/medications/template.service.ts`
- Types: `frontend/src/types/medication-template.types.ts`
- Permissions: `documentation/architecture/authorization/permissions-reference.md`

### Notes

This feature was partially implemented but never connected to the UI or database. The service file references a `medication_templates` table that does not exist in Supabase. The permission `medication.create_template` is defined but not assigned to any role (including `provider_admin`).

**Recommendation**: Either complete the specification and implementation, or remove the orphan code to reduce maintenance burden.
