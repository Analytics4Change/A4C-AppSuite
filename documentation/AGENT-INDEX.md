---
status: current
last_updated: 2026-02-11
purpose: agent-navigation
---

# Agent Navigation Index

> **For AI Agents**: This index is optimized for rapid navigation. Use keyword matching to find relevant documents. Each entry includes summary, keywords, and approximate token count to help with context window planning.

## Quick Decision Tree

### By Task Type

| Task | Start Here | Then Read |
|------|-----------|-----------|
| Add database table | [SQL_IDEMPOTENCY_AUDIT.md](infrastructure/guides/supabase/SQL_IDEMPOTENCY_AUDIT.md) | [table-template.md](infrastructure/reference/database/table-template.md) |
| Add domain event type | [CONTRACT-TYPE-GENERATION.md](infrastructure/guides/supabase/CONTRACT-TYPE-GENERATION.md) | [event-sourcing-overview.md](architecture/data/event-sourcing-overview.md) |
| Add event handler | [event-handler-pattern.md](infrastructure/patterns/event-handler-pattern.md) | [event-sourcing-overview.md](architecture/data/event-sourcing-overview.md) |
| Choose event processing pattern | [event-processing-patterns.md](infrastructure/patterns/event-processing-patterns.md) | [event-handler-pattern.md](infrastructure/patterns/event-handler-pattern.md) |
| Add Temporal workflow | [workflows/CLAUDE.md](../workflows/CLAUDE.md) | [temporal-overview.md](architecture/workflows/temporal-overview.md) |
| Add frontend component | [frontend/CLAUDE.md](../frontend/CLAUDE.md) | [DESIGN_PATTERNS_MIGRATION_GUIDE.md](frontend/guides/DESIGN_PATTERNS_MIGRATION_GUIDE.md) |
| Consolidate Day Zero baseline | [DAY0-MIGRATION-GUIDE.md](infrastructure/guides/supabase/DAY0-MIGRATION-GUIDE.md) | [handlers/README.md](../infrastructure/supabase/handlers/README.md) |
| Configure authentication | [frontend-auth-architecture.md](architecture/authentication/frontend-auth-architecture.md) | [JWT-CLAIMS-SETUP.md](infrastructure/guides/supabase/JWT-CLAIMS-SETUP.md) |
| Deploy database changes | [DEPLOYMENT_INSTRUCTIONS.md](infrastructure/guides/supabase/DEPLOYMENT_INSTRUCTIONS.md) | [infrastructure/CLAUDE.md](../infrastructure/CLAUDE.md) |
| Understand CQRS/events | [event-sourcing-overview.md](architecture/data/event-sourcing-overview.md) | [EVENT-DRIVEN-GUIDE.md](frontend/guides/EVENT-DRIVEN-GUIDE.md) |
| Test OAuth flow | [OAUTH-TESTING.md](infrastructure/guides/supabase/OAUTH-TESTING.md) | [supabase-auth-overview.md](architecture/authentication/supabase-auth-overview.md) |
| Add RBAC permissions | [rbac-architecture.md](architecture/authorization/rbac-architecture.md) | [scoping-architecture.md](architecture/authorization/scoping-architecture.md) |
| Create documentation | [AGENT-GUIDELINES.md](./AGENT-GUIDELINES.md) | [templates/](./templates/) |

## By Keyword

<!-- Agent: Use Ctrl+F or grep on this section -->

| Keyword | Primary Document | Related |
|---------|-----------------|---------|
| `accessibility` | [frontend/CLAUDE.md](../frontend/CLAUDE.md) | TESTING.md, component docs |
| `activities-reference` | [activities-reference.md](workflows/reference/activities-reference.md) | error-handling-and-compensation.md |
| `assignment` | [user_client_assignments_projection.md](infrastructure/reference/database/tables/user_client_assignments_projection.md) | user_schedule_policies_projection.md, organizations_projection.md |
| `activity` | [workflows/CLAUDE.md](../workflows/CLAUDE.md) | activities-reference.md |
| `automatic-tracing` | [event-observability.md](infrastructure/guides/event-observability.md) | event-metadata-schema.md |
| `addresses` | [addresses_projection.md](infrastructure/reference/database/tables/addresses_projection.md) | phones_projection.md |
| `adr` | [adr-multi-role-effective-permissions.md](architecture/authorization/adr-multi-role-effective-permissions.md) | rbac-architecture.md, scoping-architecture.md |
| `apm-integration` | [observability-operations.md](infrastructure/guides/observability-operations.md) | event-observability.md |
| `apiRpc` | [frontend/CLAUDE.md](../frontend/CLAUDE.md) | supabase.service.ts |
| `applet-action` | [permissions_projection.md](infrastructure/reference/database/tables/permissions_projection.md) | rbac-architecture.md |
| `asyncapi` | [CONTRACT-TYPE-GENERATION.md](infrastructure/guides/supabase/CONTRACT-TYPE-GENERATION.md) | asyncapi-contracts.md, event-sourcing-overview.md |
| `audit-trail` | [impersonation-architecture.md](architecture/authentication/impersonation-architecture.md) | impersonation-event-schema.md |
| `baseline` | [DAY0-MIGRATION-GUIDE.md](infrastructure/guides/supabase/DAY0-MIGRATION-GUIDE.md) | handlers/README.md, SQL_IDEMPOTENCY_AUDIT.md |
| `baseline-consolidation` | [DAY0-MIGRATION-GUIDE.md](infrastructure/guides/supabase/DAY0-MIGRATION-GUIDE.md) | handlers/README.md |
| `authentication` | [frontend-auth-architecture.md](architecture/authentication/frontend-auth-architecture.md) | supabase-auth-overview.md, custom-claims-setup.md |
| `bootstrap` | [organization-onboarding-workflow.md](architecture/workflows/organization-onboarding-workflow.md) | provider-onboarding-quickstart.md |
| `bootstrap-handlers` | [event-handler-pattern.md](infrastructure/patterns/event-handler-pattern.md) | activities-reference.md, event-processing-patterns.md |
| `bootstrap-workflow-design` | [organization-bootstrap-workflow-design.md](workflows/architecture/organization-bootstrap-workflow-design.md) | activities-reference.md |
| `business-profile` | [organization_business_profiles_projection.md](infrastructure/reference/database/tables/organization_business_profiles_projection.md) | organizations_projection.md |
| `cascade-deactivation` | [organization_units_projection.md](infrastructure/reference/database/tables/organization_units_projection.md) | user_roles_projection.md |
| `caseload` | [user_client_assignments_projection.md](infrastructure/reference/database/tables/user_client_assignments_projection.md) | user_schedule_policies_projection.md |
| `client-assignment` | [user_client_assignments_projection.md](infrastructure/reference/database/tables/user_client_assignments_projection.md) | organizations_projection.md |
| `clients` | [clients.md](infrastructure/reference/database/tables/clients.md) | medication_history.md |
| `compensation` | [workflows/CLAUDE.md](../workflows/CLAUDE.md) | error-handling-and-compensation.md |
| `compliance` | [medication_history.md](infrastructure/reference/database/tables/medication_history.md) | dosage_info.md |
| `contact-addresses` | [contact_addresses.md](infrastructure/reference/database/tables/contact_addresses.md) | contacts_projection.md |
| `contact-phones` | [contact_phones.md](infrastructure/reference/database/tables/contact_phones.md) | contacts_projection.md |
| `contacts` | [contacts_projection.md](infrastructure/reference/database/tables/contacts_projection.md) | provider-partners-architecture.md |
| `contract-drift` | [CONTRACT-TYPE-GENERATION.md](infrastructure/guides/supabase/CONTRACT-TYPE-GENERATION.md) | asyncapi-contracts.md, workflows/CLAUDE.md |
| `controlled-substances` | [medications.md](infrastructure/reference/database/tables/medications.md) | dosage_info.md |
| `cqrs` | [event-sourcing-overview.md](architecture/data/event-sourcing-overview.md) | EVENT-DRIVEN-GUIDE.md, MIGRATION-FROM-CRUD.md |
| `cqrs-compliance` | [cqrs-dual-write-audit.md](../dev/archived/cqrs-dual-write-audit/cqrs-dual-write-audit-context.md) | event-handler-pattern.md, event-processing-patterns.md |
| `correlation-id` | [event-observability.md](infrastructure/guides/event-observability.md) | event-metadata-schema.md, triggering-workflows.md |
| `cross-tenant` | [cross_tenant_access_grants_projection.md](infrastructure/reference/database/tables/cross_tenant_access_grants_projection.md) | var-partnerships.md |
| `custom-claims` | [JWT-CLAIMS-SETUP.md](infrastructure/guides/supabase/JWT-CLAIMS-SETUP.md) | frontend-auth-architecture.md, custom-claims-setup.md |
| `day0-migration` | [DAY0-MIGRATION-GUIDE.md](infrastructure/guides/supabase/DAY0-MIGRATION-GUIDE.md) | handlers/README.md, DEPLOYMENT_INSTRUCTIONS.md |
| `database-hook` | [JWT-CLAIMS-SETUP.md](infrastructure/guides/supabase/JWT-CLAIMS-SETUP.md) | custom-claims-setup.md |
| `deployment` | [DEPLOYMENT_INSTRUCTIONS.md](infrastructure/guides/supabase/DEPLOYMENT_INSTRUCTIONS.md) | infrastructure/CLAUDE.md |
| `determinism` | [workflows/CLAUDE.md](../workflows/CLAUDE.md) | temporal-overview.md |
| `development` | [DEVELOPMENT.md](frontend/guides/DEVELOPMENT.md) | frontend/CLAUDE.md |
| `direct-care-settings` | [organizations_projection.md](infrastructure/reference/database/tables/organizations_projection.md) | user_client_assignments_projection.md |
| `dns-provisioning` | [organization-onboarding-workflow.md](architecture/workflows/organization-onboarding-workflow.md) | event-driven-workflow-triggering.md |
| `dns-verification` | [activities-reference.md](workflows/reference/activities-reference.md) | organization-bootstrap-workflow-design.md |
| `domain-events` | [triggering-workflows.md](workflows/guides/triggering-workflows.md) | event-metadata-schema.md |
| `dosage-info` | [dosage_info.md](infrastructure/reference/database/tables/dosage_info.md) | medication_history.md |
| `dual-write` | [cqrs-dual-write-audit.md](../dev/archived/cqrs-dual-write-audit/cqrs-dual-write-audit-context.md) | event-handler-pattern.md, event-processing-patterns.md |
| `duration-ms` | [event-observability.md](infrastructure/guides/event-observability.md) | event-metadata-schema.md |
| `edge-function` | [EDGE_FUNCTION_TESTS.md](infrastructure/guides/supabase/EDGE_FUNCTION_TESTS.md) | DEPLOYMENT_INSTRUCTIONS.md |
| `edge-function-jwt` | [JWT-CLAIMS-SETUP.md](infrastructure/guides/supabase/JWT-CLAIMS-SETUP.md) | EDGE_FUNCTION_TESTS.md |
| `email` | [infrastructure/CLAUDE.md](../infrastructure/CLAUDE.md) | resend-email-provider.md |
| `event-archival` | [observability-operations.md](infrastructure/guides/observability-operations.md) | event-observability.md |
| `event-errors` | [event-observability.md](infrastructure/guides/event-observability.md) | event-sourcing-overview.md, triggering-workflows.md |
| `event-metadata` | [event-metadata-schema.md](workflows/reference/event-metadata-schema.md) | triggering-workflows.md |
| `event-processing` | [event-observability.md](infrastructure/guides/event-observability.md) | event-sourcing-overview.md, DEPLOYMENT_INSTRUCTIONS.md |
| `event-processing-patterns` | [event-processing-patterns.md](infrastructure/patterns/event-processing-patterns.md) | event-handler-pattern.md, event-driven-workflow-triggering.md |
| `event-types` | [event_types.md](infrastructure/reference/database/tables/event_types.md) | event-sourcing-overview.md |
| `enterprise-sso` | [enterprise-sso-guide.md](architecture/authentication/enterprise-sso-guide.md) | supabase-auth-overview.md |
| `event-handler` | [event-handler-pattern.md](infrastructure/patterns/event-handler-pattern.md) | event-sourcing-overview.md |
| `event-type-naming` | [event-handler-pattern.md](infrastructure/patterns/event-handler-pattern.md) | cqrs-dual-write-audit.md, event-sourcing-overview.md |
| `events` | [event-sourcing-overview.md](architecture/data/event-sourcing-overview.md) | EVENT-DRIVEN-GUIDE.md |
| `failed-events` | [event-observability.md](infrastructure/guides/event-observability.md) | event-sourcing-overview.md |
| `hipaa` | [enterprise-sso-guide.md](architecture/authentication/enterprise-sso-guide.md) | impersonation-security-controls.md |
| `feature-flag` | [organizations_projection.md](infrastructure/reference/database/tables/organizations_projection.md) | user_client_assignments_projection.md |
| `formulary` | [medications.md](infrastructure/reference/database/tables/medications.md) | medication_history.md |
| `generated-events` | [CONTRACT-TYPE-GENERATION.md](infrastructure/guides/supabase/CONTRACT-TYPE-GENERATION.md) | workflows/CLAUDE.md, event-sourcing-overview.md |
| `handler` | [event-handler-pattern.md](infrastructure/patterns/event-handler-pattern.md) | event-sourcing-overview.md |
| `handler-reference` | [handlers/README.md](../infrastructure/supabase/handlers/README.md) | event-handler-pattern.md, infrastructure/CLAUDE.md, DAY0-MIGRATION-GUIDE.md |
| `hierarchy` | [organization_units_projection.md](infrastructure/reference/database/tables/organization_units_projection.md) | scoping-architecture.md |
| `idempotency` | [SQL_IDEMPOTENCY_AUDIT.md](infrastructure/guides/supabase/SQL_IDEMPOTENCY_AUDIT.md) | organization-bootstrap-workflow-design.md |
| `impersonation` | [impersonation-architecture.md](architecture/authentication/impersonation-architecture.md) | impersonation-security-controls.md |
| `impersonation-sessions` | [impersonation_sessions_projection.md](infrastructure/reference/database/tables/impersonation_sessions_projection.md) | impersonation-architecture.md |
| `integration-testing` | [integration-testing.md](workflows/guides/integration-testing.md) | triggering-workflows.md |
| `invitation` | [invitations_projection.md](infrastructure/reference/database/tables/invitations_projection.md) | organizations_projection.md |
| `invitation-emails` | [resend-email-provider.md](workflows/guides/resend-email-provider.md) | activities-reference.md |
| `invitation-oauth` | [oauth-invitation-acceptance.md](architecture/authentication/oauth-invitation-acceptance.md) | invitations_projection.md, frontend-auth-architecture.md |
| `jwt` | [custom-claims-setup.md](architecture/authentication/custom-claims-setup.md) | frontend-auth-architecture.md, supabase-auth-overview.md |
| `jwt-claims` | [JWT-CLAIMS-SETUP.md](infrastructure/guides/supabase/JWT-CLAIMS-SETUP.md) | frontend-auth-architecture.md, infrastructure/CLAUDE.md |
| `kubernetes` | [infrastructure/CLAUDE.md](../infrastructure/CLAUDE.md) | KUBECONFIG_UPDATE_GUIDE.md |
| `logging` | [logging-standards.md](architecture/logging-standards.md) | frontend/CLAUDE.md, workflows/CLAUDE.md |
| `ltree` | [scoping-architecture.md](architecture/authorization/scoping-architecture.md) | organization_units_projection.md |
| `manage-user` | [manage-user.md](infrastructure/reference/edge-functions/manage-user.md) | edge-functions-deployment.md, rbac-architecture.md |
| `mar` | [dosage_info.md](infrastructure/reference/database/tables/dosage_info.md) | medication_history.md |
| `medication` | [medications.md](infrastructure/reference/database/tables/medications.md) | medication-search-implementation.md |
| `medication-administration` | [dosage_info.md](infrastructure/reference/database/tables/dosage_info.md) | medications.md |
| `medication-history` | [medication_history.md](infrastructure/reference/database/tables/medication_history.md) | medications.md |
| `mfa` | [impersonation-security-controls.md](architecture/authentication/impersonation-security-controls.md) | enterprise-sso-guide.md |
| `migration` | [SQL_IDEMPOTENCY_AUDIT.md](infrastructure/guides/supabase/SQL_IDEMPOTENCY_AUDIT.md) | DEPLOYMENT_INSTRUCTIONS.md, table-template.md |
| `migration-tracking` | [DAY0-MIGRATION-GUIDE.md](infrastructure/guides/supabase/DAY0-MIGRATION-GUIDE.md) | _migrations_applied.md, DEPLOYMENT_INSTRUCTIONS.md |
| `modelina` | [CONTRACT-TYPE-GENERATION.md](infrastructure/guides/supabase/CONTRACT-TYPE-GENERATION.md) | asyncapi-contracts.md, infrastructure/CLAUDE.md |
| `migrations-applied` | [_migrations_applied.md](infrastructure/reference/database/tables/_migrations_applied.md) | DEPLOYMENT_INSTRUCTIONS.md |
| `mobx` | [viewmodels.md](frontend/architecture/viewmodels.md) | frontend/CLAUDE.md, mobx-optimization.md |
| `naming-convention` | [event-handler-pattern.md](infrastructure/patterns/event-handler-pattern.md) | event-sourcing-overview.md |
| `multi-role` | [adr-multi-role-effective-permissions.md](architecture/authorization/adr-multi-role-effective-permissions.md) | rbac-architecture.md, scoping-architecture.md |
| `multi-role-invitation` | [invitations_projection.md](infrastructure/reference/database/tables/invitations_projection.md) | user_roles_projection.md |
| `multi-tenancy` | [multi-tenancy-architecture.md](architecture/data/multi-tenancy-architecture.md) | tenants-as-organizations.md |
| `notification-preferences` | [manage-user.md](infrastructure/reference/edge-functions/manage-user.md) | users.md, event-sourcing-overview.md |
| `oauth` | [OAUTH-TESTING.md](infrastructure/guides/supabase/OAUTH-TESTING.md) | supabase-auth-overview.md, oauth-invitation-acceptance.md |
| `observability` | [event-observability.md](infrastructure/guides/event-observability.md) | logging-standards.md, infrastructure/CLAUDE.md |
| `okta` | [enterprise-sso-guide.md](architecture/authentication/enterprise-sso-guide.md) | supabase-auth-overview.md |
| `otlp-export` | [observability-operations.md](infrastructure/guides/observability-operations.md) | event-observability.md |
| `organization` | [organizations_projection.md](infrastructure/reference/database/tables/organizations_projection.md) | organization-management-architecture.md |
| `organization-addresses` | [organization_addresses.md](infrastructure/reference/database/tables/organization_addresses.md) | addresses_projection.md |
| `organization-contacts` | [organization_contacts.md](infrastructure/reference/database/tables/organization_contacts.md) | contacts_projection.md |
| `organization-phones` | [organization_phones.md](infrastructure/reference/database/tables/organization_phones.md) | phones_projection.md |
| `organization-bootstrap` | [provider-onboarding-quickstart.md](workflows/guides/provider-onboarding-quickstart.md) | organization-bootstrap-workflow-design.md |
| `organization-management` | [organization-management-architecture.md](architecture/data/organization-management-architecture.md) | tenants-as-organizations.md |
| `organization-units` | [organization_units_projection.md](infrastructure/reference/database/tables/organization_units_projection.md) | scoping-architecture.md |
| `parent-span-id` | [event-observability.md](infrastructure/guides/event-observability.md) | event-metadata-schema.md |
| `pattern-selection` | [event-processing-patterns.md](infrastructure/patterns/event-processing-patterns.md) | event-handler-pattern.md, SKILL.md |
| `pre-request-hook` | [event-observability.md](infrastructure/guides/event-observability.md) | event-metadata-schema.md |
| `permissions` | [rbac-architecture.md](architecture/authorization/rbac-architecture.md) | permissions_projection.md |
| `permission-grants` | [role_permissions_projection.md](infrastructure/reference/database/tables/role_permissions_projection.md) | rbac-architecture.md |
| `pg-notify` | [event-driven-workflow-triggering.md](architecture/workflows/event-driven-workflow-triggering.md) | triggering-workflows.md |
| `pg-notify-pattern` | [event-driven-workflow-triggering.md](architecture/workflows/event-driven-workflow-triggering.md) | event-processing-patterns.md |
| `phi` | [clients.md](infrastructure/reference/database/tables/clients.md) | dosage_info.md |
| `phone-addresses` | [phone_addresses.md](infrastructure/reference/database/tables/phone_addresses.md) | phones_projection.md |
| `phones` | [phones_projection.md](infrastructure/reference/database/tables/phones_projection.md) | addresses_projection.md |
| `polling` | [triggering-workflows.md](workflows/guides/triggering-workflows.md) | integration-testing.md |
| `postgres-notify` | [triggering-workflows.md](workflows/guides/triggering-workflows.md) | event-driven-workflow-triggering.md |
| `prescriptions` | [medication_history.md](infrastructure/reference/database/tables/medication_history.md) | dosage_info.md |
| `process_event` | [event-handler-pattern.md](infrastructure/patterns/event-handler-pattern.md) | event-sourcing-overview.md |
| `projection` | [event-sourcing-overview.md](architecture/data/event-sourcing-overview.md) | organizations_projection.md, table-template.md |
| `provider-admin` | [provider-admin-permissions-architecture.md](architecture/authorization/provider-admin-permissions-architecture.md) | role_permission_templates.md |
| `provider-onboarding` | [provider-onboarding-quickstart.md](workflows/guides/provider-onboarding-quickstart.md) | organization-bootstrap-workflow-design.md |
| `provider-partners` | [provider-partners-architecture.md](architecture/data/provider-partners-architecture.md) | var-partnerships.md |
| `rbac` | [rbac-architecture.md](architecture/authorization/rbac-architecture.md) | rbac-implementation-guide.md, scoping-architecture.md |
| `resend` | [resend-email-provider.md](workflows/guides/resend-email-provider.md) | activities-reference.md |
| `retention-policy` | [observability-operations.md](infrastructure/guides/observability-operations.md) | event-observability.md |
| `retry-policies` | [error-handling-and-compensation.md](workflows/guides/error-handling-and-compensation.md) | activities-reference.md |
| `rls` | [multi-tenancy-architecture.md](architecture/data/multi-tenancy-architecture.md) | table-template.md, SQL_IDEMPOTENCY_AUDIT.md |
| `rls-gap` | [clients.md](infrastructure/reference/database/tables/clients.md) | medications.md |
| `rollback` | [DAY0-MIGRATION-GUIDE.md](infrastructure/guides/supabase/DAY0-MIGRATION-GUIDE.md) | DEPLOYMENT_INSTRUCTIONS.md |
| `role-access-dates` | [user_roles_projection.md](infrastructure/reference/database/tables/user_roles_projection.md) | rbac-architecture.md |
| `role-modification` | [manage-user.md](infrastructure/reference/edge-functions/manage-user.md) | user_roles_projection.md, rbac-architecture.md |
| `role-permissions` | [role_permissions_projection.md](infrastructure/reference/database/tables/role_permissions_projection.md) | roles_projection.md |
| `role-templates` | [role_permission_templates.md](infrastructure/reference/database/tables/role_permission_templates.md) | provider-admin-permissions-architecture.md |
| `role-validity` | [user_roles_projection.md](infrastructure/reference/database/tables/user_roles_projection.md) | rbac-architecture.md |
| `role-assignment` | [rbac-architecture.md](architecture/authorization/rbac-architecture.md) | manage-user.md, user_roles_projection.md |
| `bulk-assignment` | [rbac-architecture.md](architecture/authorization/rbac-architecture.md) | user_roles_projection.md |
| `sync-role-assignments` | [rbac-architecture.md](architecture/authorization/rbac-architecture.md) | manage-user.md |
| `roles` | [rbac-architecture.md](architecture/authorization/rbac-architecture.md) | roles_projection.md |
| `router` | [event-handler-pattern.md](infrastructure/patterns/event-handler-pattern.md) | event-sourcing-overview.md |
| `rxnorm` | [medications.md](infrastructure/reference/database/tables/medications.md) | rxnorm-medication-autocomplete.md |
| `saga` | [workflows/CLAUDE.md](../workflows/CLAUDE.md) | error-handling-and-compensation.md |
| `schedule` | [user_schedule_policies_projection.md](infrastructure/reference/database/tables/user_schedule_policies_projection.md) | schedule-management.md, user_client_assignments_projection.md, organizations_projection.md |
| `schedule-crud` | [schedule-management.md](frontend/reference/schedule-management.md) | user_schedule_policies_projection.md |
| `schedule-form` | [schedule-management.md](frontend/reference/schedule-management.md) | user_schedule_policies_projection.md |
| `schedule-management` | [schedule-management.md](frontend/reference/schedule-management.md) | user_schedule_policies_projection.md |
| `staff-schedule` | [user_schedule_policies_projection.md](infrastructure/reference/database/tables/user_schedule_policies_projection.md) | schedule-management.md, organization_units_projection.md |
| `weekly-grid` | [schedule-management.md](frontend/reference/schedule-management.md) | user_schedule_policies_projection.md |
| `weekly-schedule` | [user_schedule_policies_projection.md](infrastructure/reference/database/tables/user_schedule_policies_projection.md) | schedule-management.md, schedule, organizations_projection.md |
| `saga-pattern` | [error-handling-and-compensation.md](workflows/guides/error-handling-and-compensation.md) | organization-bootstrap-workflow-design.md |
| `schema-registry` | [event_types.md](infrastructure/reference/database/tables/event_types.md) | event-sourcing-overview.md |
| `saml` | [enterprise-sso-guide.md](architecture/authentication/enterprise-sso-guide.md) | supabase-auth-overview.md |
| `session-id` | [event-observability.md](infrastructure/guides/event-observability.md) | event-metadata-schema.md |
| `session-variable` | [event-observability.md](infrastructure/guides/event-observability.md) | event-metadata-schema.md |
| `scope_path` | [scoping-architecture.md](architecture/authorization/scoping-architecture.md) | organization_units_projection.md, JWT-CLAIMS-SETUP.md |
| `effective_permissions` | [JWT-CLAIMS-SETUP.md](infrastructure/guides/supabase/JWT-CLAIMS-SETUP.md) | rbac-architecture.md, frontend-auth-architecture.md |
| `scoping` | [scoping-architecture.md](architecture/authorization/scoping-architecture.md) | organization_units_projection.md |
| `session-management` | [frontend-auth-architecture.md](architecture/authentication/frontend-auth-architecture.md) | auth-provider-architecture.md, frontend/CLAUDE.md |
| `getSession` | [frontend-auth-architecture.md](architecture/authentication/frontend-auth-architecture.md) | auth-provider-architecture.md |
| `span-id` | [event-observability.md](infrastructure/guides/event-observability.md) | event-metadata-schema.md |
| `split-handlers` | [event-handler-pattern.md](infrastructure/patterns/event-handler-pattern.md) | event-sourcing-overview.md |
| `social-login` | [supabase-auth-overview.md](architecture/authentication/supabase-auth-overview.md) | OAUTH-TESTING.md |
| `soft-delete` | [addresses_projection.md](infrastructure/reference/database/tables/addresses_projection.md) | clients.md |
| `supabase` | [infrastructure/CLAUDE.md](../infrastructure/CLAUDE.md) | DEPLOYMENT_INSTRUCTIONS.md, SUPABASE-AUTH-SETUP.md |
| `supabase-auth` | [supabase-auth-overview.md](architecture/authentication/supabase-auth-overview.md) | frontend-auth-architecture.md |
| `supabase-cli` | [DAY0-MIGRATION-GUIDE.md](infrastructure/guides/supabase/DAY0-MIGRATION-GUIDE.md) | DEPLOYMENT_INSTRUCTIONS.md, infrastructure/CLAUDE.md |
| `temporal` | [temporal-overview.md](architecture/workflows/temporal-overview.md) | workflows/CLAUDE.md, activities-reference.md |
| `temporal-roles` | [user_roles_projection.md](infrastructure/reference/database/tables/user_roles_projection.md) | rbac-architecture.md |
| `testing` | [TESTING.md](frontend/testing/TESTING.md) | integration-testing.md |
| `three-layer-idempotency` | [organization-bootstrap-workflow-design.md](workflows/architecture/organization-bootstrap-workflow-design.md) | activities-reference.md |
| `tracing` | [event-observability.md](infrastructure/guides/event-observability.md) | event-metadata-schema.md, logging-standards.md |
| `trace-id` | [event-observability.md](infrastructure/guides/event-observability.md) | event-metadata-schema.md |
| `traceparent` | [event-observability.md](infrastructure/guides/event-observability.md) | event-metadata-schema.md |
| `trace-sampling` | [observability-operations.md](infrastructure/guides/observability-operations.md) | event-observability.md |
| `troubleshooting` | [infrastructure/CLAUDE.md](../infrastructure/CLAUDE.md) | resend-email-provider.md |
| `type-generation` | [CONTRACT-TYPE-GENERATION.md](infrastructure/guides/supabase/CONTRACT-TYPE-GENERATION.md) | modelina, asyncapi, generated-events |
| `user-aggregate` | [invitations_projection.md](infrastructure/reference/database/tables/invitations_projection.md) | event-sourcing-overview.md |
| `user-deactivation` | [manage-user.md](infrastructure/reference/edge-functions/manage-user.md) | users.md, event-sourcing-overview.md |
| `user-lifecycle` | [manage-user.md](infrastructure/reference/edge-functions/manage-user.md) | users.md, rbac-architecture.md |
| `var` | [var-partnerships.md](architecture/data/var-partnerships.md) | provider-partners-architecture.md |
| `viewmodel` | [viewmodels.md](frontend/architecture/viewmodels.md) | viewmodel-testing.md, mobx-patterns.md |
| `vite` | [DEVELOPMENT.md](frontend/guides/DEVELOPMENT.md) | frontend/CLAUDE.md |
| `w3c-trace-context` | [event-observability.md](infrastructure/guides/event-observability.md) | event-metadata-schema.md |
| `wcag` | [frontend/CLAUDE.md](../frontend/CLAUDE.md) | TESTING.md |
| `var-contracts` | [cross_tenant_access_grants_projection.md](infrastructure/reference/database/tables/cross_tenant_access_grants_projection.md) | var-partnerships.md |
| `workflow` | [workflows/CLAUDE.md](../workflows/CLAUDE.md) | temporal-overview.md, implementation.md |
| `workflow-queue` | [workflow_queue_projection.md](infrastructure/reference/database/tables/workflow_queue_projection.md) | organization-bootstrap-workflow-design.md |
| `workflow-status` | [provider-onboarding-quickstart.md](workflows/guides/provider-onboarding-quickstart.md) | triggering-workflows.md |
| `workflow-testing` | [integration-testing.md](workflows/guides/integration-testing.md) | triggering-workflows.md |
| `workflow-trigger` | [triggering-workflows.md](workflows/guides/triggering-workflows.md) | event-driven-workflow-triggering.md |
| `workflow-traceability` | [event-metadata-schema.md](workflows/reference/event-metadata-schema.md) | integration-testing.md |

## Document Catalog

### Entry Points (Read These First)

| Document | Summary | Keywords | ~Tokens |
|----------|---------|----------|---------|
| [CLAUDE.md](../CLAUDE.md) | Repository overview, quick start commands, key links | `monorepo`, `overview`, `quickstart`, `cross-component` | 3600 |
| [frontend/CLAUDE.md](../frontend/CLAUDE.md) | React/TypeScript development guide with accessibility | `react`, `mobx`, `accessibility` | 5200 |
| [workflows/CLAUDE.md](../workflows/CLAUDE.md) | Temporal workflow development guide | `temporal`, `activities`, `saga` | 4800 |
| [infrastructure/CLAUDE.md](../infrastructure/CLAUDE.md) | Infrastructure guide with deployment runbook | `supabase`, `kubernetes`, `deployment` | 6100 |
| [README.md](./README.md) | Documentation table of contents | `navigation`, `index` | 2200 |

### Architecture (Cross-Cutting)

| Document | Summary | Keywords | ~Tokens |
|----------|---------|----------|---------|
| [frontend-auth-architecture.md](architecture/authentication/frontend-auth-architecture.md) | Smart detection auth system (credentials = real, missing = mock) with IAuthProvider | `auth`, `oauth`, `jwt`, `mock-auth`, `smart-detection` | 4500 |
| [supabase-auth-overview.md](architecture/authentication/supabase-auth-overview.md) | OAuth2 PKCE flow, social login, enterprise SSO | `oauth`, `supabase`, `pkce`, `sso` | 2200 |
| [custom-claims-setup.md](architecture/authentication/custom-claims-setup.md) | JWT custom claims via database hook | `jwt`, `claims`, `database-hook` | 1500 |
| [rbac-architecture.md](architecture/authorization/rbac-architecture.md) | Permission-based RBAC with event sourcing | `rbac`, `permissions`, `roles` | 3100 |
| [scoping-architecture.md](architecture/authorization/scoping-architecture.md) | Hierarchical permission scoping with ltree | `scoping`, `ltree`, `permissions` | 2800 |
| [adr-multi-role-effective-permissions.md](architecture/authorization/adr-multi-role-effective-permissions.md) | ADR: RBAC + Effective Permissions over ReBAC | `adr`, `multi-role`, `effective-permissions`, `capability-accountability` | 2500 |
| [adr-cqrs-dual-write-remediation.md](architecture/decisions/adr-cqrs-dual-write-remediation.md) | ADR: CQRS dual-write audit and remediation | `adr`, `cqrs-compliance`, `dual-write`, `event-type-naming`, `remediation` | 1500 |
| [multi-tenancy-architecture.md](architecture/data/multi-tenancy-architecture.md) | Organization isolation via RLS and JWT claims | `rls`, `multi-tenant`, `org_id` | 2800 |
| [event-sourcing-overview.md](architecture/data/event-sourcing-overview.md) | CQRS pattern, domain events, projections | `cqrs`, `events`, `projections` | 2500 |
| [temporal-overview.md](architecture/workflows/temporal-overview.md) | Workflow orchestration concepts and patterns | `temporal`, `workflow`, `saga` | 3200 |

### Frontend

| Document | Summary | Keywords | ~Tokens |
|----------|---------|----------|---------|
| [viewmodels.md](frontend/architecture/viewmodels.md) | MobX state management with ViewModel pattern | `mobx`, `viewmodel`, `state` | 1800 |
| [auth-provider-architecture.md](frontend/architecture/auth-provider-architecture.md) | IAuthProvider interface, dependency injection | `auth`, `di`, `provider` | 1600 |
| [overview.md](frontend/architecture/overview.md) | High-level frontend architecture | `architecture`, `react`, `structure` | 1200 |
| [DEVELOPMENT.md](frontend/guides/DEVELOPMENT.md) | Local development setup, dev server | `development`, `setup`, `vite` | 2100 |
| [DESIGN_PATTERNS_MIGRATION_GUIDE.md](frontend/guides/DESIGN_PATTERNS_MIGRATION_GUIDE.md) | Component patterns and best practices | `patterns`, `components`, `migration` | 3200 |
| [EVENT-DRIVEN-GUIDE.md](frontend/guides/EVENT-DRIVEN-GUIDE.md) | CQRS patterns in React components | `events`, `cqrs`, `react` | 4200 |
| [TESTING.md](frontend/testing/TESTING.md) | Unit and E2E testing strategies | `testing`, `vitest`, `playwright` | 2100 |
| [ui-patterns.md](frontend/patterns/ui-patterns.md) | Modal architecture, dropdown patterns | `modal`, `ui`, `patterns` | 1800 |

### Infrastructure

| Document | Summary | Keywords | ~Tokens |
|----------|---------|----------|---------|
| [DAY0-MIGRATION-GUIDE.md](infrastructure/guides/supabase/DAY0-MIGRATION-GUIDE.md) | Day Zero baseline consolidation, handler reference files for resets | `day0-migration`, `baseline`, `migration-tracking`, `rollback`, `supabase-cli` | 3800 |
| [SQL_IDEMPOTENCY_AUDIT.md](infrastructure/guides/supabase/SQL_IDEMPOTENCY_AUDIT.md) | Idempotent SQL migration patterns | `migration`, `sql`, `idempotent` | 2400 |
| [DEPLOYMENT_INSTRUCTIONS.md](infrastructure/guides/supabase/DEPLOYMENT_INSTRUCTIONS.md) | Step-by-step deployment procedures | `deployment`, `supabase`, `edge-functions` | 2100 |
| [OAUTH-TESTING.md](infrastructure/guides/supabase/OAUTH-TESTING.md) | Google OAuth testing guide | `oauth`, `testing`, `google` | 1400 |
| [SUPABASE-AUTH-SETUP.md](infrastructure/guides/supabase/SUPABASE-AUTH-SETUP.md) | Auth provider configuration | `supabase`, `auth`, `setup` | 1600 |
| [EDGE_FUNCTION_TESTS.md](infrastructure/guides/supabase/EDGE_FUNCTION_TESTS.md) | Edge function testing guide | `edge-function`, `testing`, `deno` | 1200 |
| [manage-user.md](infrastructure/reference/edge-functions/manage-user.md) | User lifecycle Edge Function API (deactivate, roles, notification prefs) | `manage-user`, `user-lifecycle`, `notification-preferences`, `role-modification` | 1000 |
| [CONTRACT-TYPE-GENERATION.md](infrastructure/guides/supabase/CONTRACT-TYPE-GENERATION.md) | AsyncAPI → TypeScript type generation with Modelina | `asyncapi`, `modelina`, `type-generation`, `contract-drift`, `generated-events` | 3700 |
| [event-observability.md](infrastructure/guides/event-observability.md) | Event processing observability, W3C Trace Context, span timing | `observability`, `tracing`, `failed-events`, `correlation-id`, `trace-id`, `span-id`, `session-id`, `w3c-trace-context` | 3200 |
| [event-processing-patterns.md](infrastructure/patterns/event-processing-patterns.md) | Decision guide: sync trigger handlers vs async pg_notify + Temporal | `event-processing-patterns`, `pattern-selection`, `pg-notify-pattern`, `dual-write`, `synchronous-handler`, `async-workflow` | 2800 |
| [event-handler-pattern.md](infrastructure/patterns/event-handler-pattern.md) | Split handler architecture: routers, handlers, adding new event types | `event-handler`, `handler`, `router`, `process_event`, `split-handlers` | 3500 |
| [observability-operations.md](infrastructure/guides/observability-operations.md) | **[Aspirational]** Production-scale: retention, sampling, APM integration | `retention-policy`, `trace-sampling`, `apm-integration`, `otlp-export`, `event-archival` | 2000 |
| [table-template.md](infrastructure/reference/database/table-template.md) | Database table documentation template | `template`, `database`, `schema` | 800 |

### Workflows

| Document | Summary | Keywords | ~Tokens |
|----------|---------|----------|---------|
| [implementation.md](workflows/guides/implementation.md) | Complete workflow implementation summary | `workflow`, `file-structure`, `deployment` | 2200 |
| [error-handling-and-compensation.md](workflows/guides/error-handling-and-compensation.md) | Saga pattern for workflow rollback | `saga-pattern`, `compensation`, `retry-policies` | 1900 |
| [triggering-workflows.md](workflows/guides/triggering-workflows.md) | Event-driven workflow triggering | `domain-events`, `postgres-notify`, `polling` | 1800 |
| [integration-testing.md](workflows/guides/integration-testing.md) | Integration testing with local services | `jest`, `workflow-testing`, `local-supabase` | 2500 |
| [provider-onboarding-quickstart.md](workflows/guides/provider-onboarding-quickstart.md) | Provider org creation via UI | `provider-onboarding`, `organization-form`, `troubleshooting` | 1500 |
| [resend-email-provider.md](workflows/guides/resend-email-provider.md) | Resend email provider config | `resend`, `email-provider`, `kubernetes-secrets` | 1200 |
| [event-metadata-schema.md](workflows/reference/event-metadata-schema.md) | Event metadata JSONB schema, W3C Trace Context fields | `event-metadata`, `workflow-traceability`, `jsonb-indexes`, `trace-id`, `span-id`, `duration-ms` | 3500 |
| [activities-reference.md](workflows/reference/activities-reference.md) | All Temporal activity signatures | `activities-reference`, `dns-verification`, `compensation-activities` | 3200 |
| [organization-bootstrap-workflow-design.md](workflows/architecture/organization-bootstrap-workflow-design.md) | Complete bootstrap workflow spec | `bootstrap-workflow-design`, `three-layer-idempotency`, `saga-compensation` | 5500 |

### Database Tables Reference

| Table | Purpose | Keywords | ~Tokens |
|-------|---------|----------|---------|
| [organizations_projection.md](infrastructure/reference/database/tables/organizations_projection.md) | Multi-tenant organization hierarchy | `organization`, `tenant`, `rls` | 760 |
| [organization_units_projection.md](infrastructure/reference/database/tables/organization_units_projection.md) | Sub-org hierarchy with ltree | `organization-units`, `ltree`, `cascade-deactivation` | 900 |
| [invitations_projection.md](infrastructure/reference/database/tables/invitations_projection.md) | Organization invitation tracking with multi-role | `invitation`, `token`, `multi-role-invitation`, `user-aggregate` | 910 |
| [user_roles_projection.md](infrastructure/reference/database/tables/user_roles_projection.md) | User role assignments | `roles`, `scope_path`, `rbac` | 700 |
| [roles_projection.md](infrastructure/reference/database/tables/roles_projection.md) | RBAC role definitions | `roles`, `system-role`, `organization-id` | 680 |
| [role_permissions_projection.md](infrastructure/reference/database/tables/role_permissions_projection.md) | Role-permission junction | `permission-grants`, `junction-table`, `rbac` | 650 |
| [permissions_projection.md](infrastructure/reference/database/tables/permissions_projection.md) | Atomic RBAC permissions | `permissions`, `applet-action`, `scope-type` | 750 |
| [role_permission_templates.md](infrastructure/reference/database/tables/role_permission_templates.md) | Bootstrap permission templates | `role-templates`, `bootstrap`, `provider-admin` | 500 |
| [contacts_projection.md](infrastructure/reference/database/tables/contacts_projection.md) | Organization contacts | `contacts`, `billing-contact`, `pii` | 750 |
| [addresses_projection.md](infrastructure/reference/database/tables/addresses_projection.md) | Organization addresses | `addresses`, `headquarters`, `soft-delete` | 750 |
| [phones_projection.md](infrastructure/reference/database/tables/phones_projection.md) | Organization phones | `phones`, `office-phone`, `fax` | 700 |
| [cross_tenant_access_grants_projection.md](infrastructure/reference/database/tables/cross_tenant_access_grants_projection.md) | VAR cross-org access | `cross-tenant`, `var-contracts`, `authorization` | 650 |
| [medications.md](infrastructure/reference/database/tables/medications.md) | Medication catalog | `medication`, `formulary`, `rxnorm` | 600 |
| [medication_history.md](infrastructure/reference/database/tables/medication_history.md) | Prescription records | `prescriptions`, `compliance`, `controlled-substances` | 720 |
| [dosage_info.md](infrastructure/reference/database/tables/dosage_info.md) | MAR tracking | `dosage-info`, `mar`, `medication-administration` | 800 |
| [clients.md](infrastructure/reference/database/tables/clients.md) | Client/patient records | `clients`, `phi`, `hipaa` | 550 |
| [user_schedule_policies_projection.md](infrastructure/reference/database/tables/user_schedule_policies_projection.md) | Staff weekly schedule policies | `schedule`, `staff-schedule`, `weekly-schedule` | 450 |
| [schedule-management.md](frontend/reference/schedule-management.md) | Schedule management frontend reference | `schedule-crud`, `schedule-form`, `weekly-grid`, `schedule-management` | 300 |
| [user_client_assignments_projection.md](infrastructure/reference/database/tables/user_client_assignments_projection.md) | Client-staff assignment mappings | `assignment`, `client-assignment`, `caseload`, `feature-flag` | 450 |
| [event_types.md](infrastructure/reference/database/tables/event_types.md) | Event schema registry | `event-types`, `schema-registry`, `json-schema` | 500 |

## Sync Instructions

This index should be updated when:
1. New documentation files are added
2. Existing documents are renamed or moved
3. TL;DR sections are added/updated (extract keywords)
4. Major content changes affect the summary

**Validation checklist**:
- [ ] All links resolve to existing files
- [ ] Keywords match document content
- [ ] Token estimates are approximately correct (~10 tokens/line)
- [ ] New documents added to appropriate catalog section

## Token Estimation Guide

| Lines of Markdown | Approximate Tokens |
|-------------------|-------------------|
| 50 lines | ~500 tokens |
| 100 lines | ~1000 tokens |
| 200 lines | ~2000 tokens |
| 500 lines | ~5000 tokens |

Estimate: ~10 tokens per line of typical markdown content.

## See Also

- [AGENT-GUIDELINES.md](./AGENT-GUIDELINES.md) - How to create/update documentation
- [README.md](./README.md) - Full documentation table of contents
- [Root CLAUDE.md](../CLAUDE.md) - Repository overview
