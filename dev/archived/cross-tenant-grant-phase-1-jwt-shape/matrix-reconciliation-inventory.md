---
status: draft
last_updated: 2026-05-29
generated_by: read-only-reconciliation
source: Management API SQL endpoint against dev (project ref tmrjlswbsxmbglmaclxu)
---

# Matrix-reconciliation inventory (Stage R-1)

**Purpose**: scratch artifact for Stage R of the Phase 1 card. Captures (1) the authoritative live `api.*` pg_proc inventory, (2) the set diff against the matrix doc's master table, (3) the per-RPC bucket classification work-product (filled in during R-2).

**Generation**:
```bash
curl -s -X POST "https://api.supabase.com/v1/projects/tmrjlswbsxmbglmaclxu/database/query" \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"query": "SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args,
                        obj_description(p.oid, '\''pg_proc'\'') AS comment
                 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                 WHERE n.nspname = '\''api'\'' AND p.prokind = '\''f'\''
                 ORDER BY p.proname, args;"}'
```

## R-1 Verification gates

| Gate | Expected | Observed | Status |
|---|---|---|---|
| Live pg_proc row count | 172 total / 170 distinct | 172 total / 170 distinct | ✅ matches Stage B probe 5 |
| `|MATCHES| + |MISSING-FROM-MATRIX| = |LIVE|` | sum = 170 | 98 + 72 = 170 | ✅ |
| `|MISSING-FROM-DB|` | 0 expected | **7 stale matrix entries** | ⚠ DRIFT: 7 user_schedule RPCs dropped by `20260217211231_schedule_template_refactor.sql` (2026-02-17) but still listed in matrix doc hand-curated 2026-05-26 |
| Live-vs-local divergence (R-1.2) | names match | committed `frontend/src/services/api/rpc-registry.generated.ts` (last regen 2026-05-13) emits **170 distinct names** (89 EnvelopeRpcs + 81 ReadRpcs); `UncategorizedRpcs = never` (100% M3 `@a4c-rpc-shape` tag coverage) | ✅ Risk #7 CLOSED — local container post-migration-apply sees identical 170-name surface as live; codegen at step 12 will see the same shape; gen-rpc-reachability-matrix.cjs starts from a 100%-M3-tagged baseline |

## R-1.3 Set diff summary

- **MATCHES** (in live pg_proc AND in matrix doc): **98**
- **MISSING-FROM-MATRIX** (in live, NOT in matrix — needs classification in R-2): **72**
- **MISSING-FROM-DB** (in matrix, NOT in live — STALE; remove in R-4): **7**

### Missing-from-DB (stale entries to REMOVE during R-4)

These 7 names appear in the matrix doc but were dropped from live dev by migration `20260217211231_schedule_template_refactor.sql` (2026-02-17), which replaced the user_schedule CRUD surface with the schedule_template + assignment model. The matrix doc's hand-curation on 2026-05-26 missed this 3-month-old refactor.

```
create_user_schedule
deactivate_user_schedule
delete_user_schedule
get_schedule_by_id
list_user_schedules
reactivate_user_schedule
update_user_schedule
```

**Replacement surface (already in live pg_proc)**: `create_schedule_template`, `deactivate_schedule_template`, `delete_schedule_template`, `get_schedule_template`, `list_schedule_templates`, `reactivate_schedule_template`, `update_schedule_template`, `assign_user_to_schedule`, `unassign_user_from_schedule`, `sync_schedule_assignments`, `list_users_for_schedule_management`. The first 7 of these are in the MISSING-FROM-MATRIX set below; the last 4 may already be in the matrix (verify during R-3).

### Missing-from-matrix (72 — to CLASSIFY in R-2)

```
add_client_address
add_client_email
add_client_funding_source
add_client_insurance
add_client_phone
admit_client
assign_client_contact
assign_user_to_schedule
batch_update_field_definitions
change_client_placement
check_field_definitions_exist
create_field_category
create_field_definition
create_organization_address
create_organization_contact
create_organization_phone
create_schedule_template
deactivate_all_field_definitions
deactivate_field_category
deactivate_field_definition
deactivate_organization
deactivate_schedule_template
deactivate_user
delete_field_category
delete_field_definition
delete_organization
delete_organization_address
delete_organization_contact
delete_organization_phone
delete_schedule_template
discharge_client
end_client_placement
get_category_field_count
get_client
get_failed_events_with_detail
get_field_usage_count
get_organization_details
get_orphaned_deletions
get_schedule_template
list_clients
list_field_categories
list_field_definitions
list_field_definition_templates
list_schedule_templates
list_system_field_categories
reactivate_field_category
reactivate_field_definition
reactivate_organization
reactivate_schedule_template
register_client
remove_client_address
remove_client_email
remove_client_funding_source
remove_client_insurance
remove_client_phone
retry_deletion_workflow
safety_net_deactivate_organization
unassign_client_contact
unassign_user_from_schedule
update_client
update_client_address
update_client_email
update_client_funding_source
update_client_insurance
update_client_phone
update_field_category
update_field_definition
update_organization
update_organization_address
update_organization_contact
update_organization_phone
update_schedule_template
```

## Live pg_proc full inventory (172 rows, sorted by proname, args)

| proname | args (truncated to 80 char) | comment |
|---|---|---|
| `add_client_address` | `p_client_id uuid, p_street1 text, p_city text, p_state text, p_zip text, p_ad...` | @a4c-rpc-shape: envelope |
| `add_client_email` | `p_client_id uuid, p_email text, p_email_type text, p_is_primary boolean, p_re...` | @a4c-rpc-shape: envelope |
| `add_client_funding_source` | `p_client_id uuid, p_source_type text, p_source_name text, p_reference_number ...` | @a4c-rpc-shape: envelope |
| `add_client_insurance` | `p_client_id uuid, p_policy_type text, p_payer_name text, p_policy_number text...` | @a4c-rpc-shape: envelope |
| `add_client_phone` | `p_client_id uuid, p_phone_number text, p_phone_type text, p_is_primary boolea...` | @a4c-rpc-shape: envelope |
| `add_user_phone` | `p_user_id uuid, p_label text, p_type text, p_number text, p_extension text, p...` | Add a new phone for a user. p_org_id=NULL creates global phone, set creates o... |
| `admit_client` | `p_client_id uuid, p_admission_data jsonb, p_reason text, p_event_metadata jso...` | @a4c-rpc-shape: envelope |
| `assign_client_contact` | `p_client_id uuid, p_contact_id uuid, p_designation text, p_reason text, p_eve...` | @a4c-rpc-shape: envelope |
| `assign_client_to_user` | `p_user_id uuid, p_client_id uuid, p_assigned_until timestamp with time zone, ...` | @a4c-rpc-shape: envelope |
| `assign_user_to_schedule` | `p_template_id uuid, p_user_id uuid, p_effective_from date, p_effective_until ...` | @a4c-rpc-shape: envelope |
| `batch_update_field_definitions` | `p_changes jsonb, p_reason text, p_correlation_id uuid` | @a4c-rpc-shape: envelope |
| `bulk_assign_role` | `p_role_id uuid, p_user_ids uuid[], p_scope_path ltree, p_correlation_id uuid,...` | Assign multiple users to a role in a single operation. · Requires user.role_a... |
| `change_client_placement` | `p_client_id uuid, p_placement_arrangement text, p_start_date date, p_reason_t...` | @a4c-rpc-shape: envelope |
| `check_field_definitions_exist` | `p_org_id uuid` | @a4c-rpc-shape: read |
| `check_invitation_acceptance_eligibility` | `p_invitee_user_id uuid, p_target_org_id uuid` | Check whether an invitee may accept (or be issued) an invitation to a target ... |
| `check_organization_by_name` | `p_name text` | Check if organization exists by name (for orgs without subdomains). Used by T... |
| `check_organization_by_slug` | `p_slug text` | Check if organization exists by slug. Used by Temporal workflow activities fo... |
| `check_pending_invitation` | `p_email text, p_org_id uuid` | Check if there is a pending invitation for the given email in the specified o... |
| `check_user_exists` | `p_email text` | Check if a user with the given email exists anywhere in the system. ·  · Filt... |
| `check_user_invitation_existence` | `p_user_id uuid` | Check whether a user is "existing" (has >=1 role in any org) versus new for ·... |
| `check_user_org_membership` | `p_email text, p_org_id uuid` | Check if a user with given email has membership (active or deactivated) in th... |
| `create_field_category` | `p_name text, p_slug text, p_sort_order integer, p_correlation_id uuid` | @a4c-rpc-shape: envelope |
| `create_field_definition` | `p_field_key text, p_display_name text, p_category_id uuid, p_field_type text,...` | @a4c-rpc-shape: envelope |
| `create_organization_address` | `p_org_id uuid, p_data jsonb` | @a4c-rpc-shape: envelope |
| `create_organization_contact` | `p_org_id uuid, p_data jsonb` | @a4c-rpc-shape: envelope |
| `create_organization_phone` | `p_org_id uuid, p_data jsonb` | @a4c-rpc-shape: envelope |
| `create_organization_unit` | `p_parent_id uuid, p_name text, p_display_name text, p_timezone text` | Create a new organization unit (CQRS via domain events). · Uses get_permissio... |
| `create_role` | `p_name text, p_description text, p_org_hierarchy_scope text, p_permission_ids...` | Create a new role with permissions. Uses helper functions for subset-only del... |
| `create_schedule_template` | `p_name text, p_schedule jsonb, p_org_unit_id uuid, p_user_ids uuid[]` | @a4c-rpc-shape: envelope |
| `deactivate_all_field_definitions` | `p_org_id uuid` | @a4c-rpc-shape: read |
| `deactivate_field_category` | `p_category_id uuid, p_reason text, p_correlation_id uuid` | @a4c-rpc-shape: envelope |
| `deactivate_field_definition` | `p_field_id uuid, p_reason text, p_correlation_id uuid` | @a4c-rpc-shape: envelope |
| `deactivate_organization` | `p_org_id uuid, p_reason text` | @a4c-rpc-shape: envelope |
| `deactivate_organization_unit` | `p_unit_id uuid` | Deactivate an organization unit with cascade to descendants (CQRS via domain ... |
| `deactivate_role` | `p_role_id uuid` | Deactivate a role (soft freeze). Users with this role retain it but it cannot... |
| `deactivate_schedule_template` | `p_template_id uuid, p_reason text` | @a4c-rpc-shape: envelope |
| `deactivate_user` | `p_user_id uuid, p_reason text` | Deactivates a user by emitting user.deactivated; handle_user_deactivated sets... |
| `delete_field_category` | `p_category_id uuid, p_reason text, p_correlation_id uuid` | @a4c-rpc-shape: envelope |
| `delete_field_definition` | `p_field_id uuid, p_reason text, p_correlation_id uuid` | @a4c-rpc-shape: envelope |
| `delete_organization` | `p_org_id uuid, p_reason text` | @a4c-rpc-shape: envelope |
| `delete_organization_address` | `p_address_id uuid, p_reason text` | @a4c-rpc-shape: envelope |
| `delete_organization_contact` | `p_contact_id uuid, p_reason text` | @a4c-rpc-shape: envelope |
| `delete_organization_phone` | `p_phone_id uuid, p_reason text` | @a4c-rpc-shape: envelope |
| `delete_organization_unit` | `p_unit_id uuid` | Soft-delete an organization unit (CQRS via domain events). · Uses get_permiss... |
| `delete_role` | `p_role_id uuid` | Soft delete a role. Requires deactivation first and no user assignments. ·  ·... |
| `delete_schedule_template` | `p_template_id uuid, p_reason text` | @a4c-rpc-shape: envelope |
| `delete_user` | `p_user_id uuid, p_reason text` | Soft-deletes a user by emitting user.deleted; handle_user_deleted updates · u... |
| `discharge_client` | `p_client_id uuid, p_discharge_data jsonb, p_reason text, p_event_metadata jso...` | @a4c-rpc-shape: envelope |
| `dismiss_failed_event` | `p_event_id uuid, p_reason text` | Dismisses a failed domain event (marks as acknowledged). · Requires platform.... |
| `emit_domain_event` | `p_stream_id uuid, p_stream_type text, p_event_type text, p_event_data jsonb, ...` | Emit domain event with auto-calculated stream_version, tracing support, and a... |
| `emit_workflow_started_event` | `p_stream_id uuid, p_bootstrap_event_id uuid, p_workflow_id text, p_workflow_r...` | Emits organization.bootstrap.workflow_started event after event listener star... |
| `end_client_placement` | `p_client_id uuid, p_end_date date, p_reason_text text, p_reason text, p_event...` | @a4c-rpc-shape: envelope |
| `find_contacts_by_phone` | `p_organization_id uuid, p_phone_number text` | Find contacts by phone number. Used when admin enters a phone for a user to s... |
| `get_addresses_by_org` | `p_org_id uuid` | Get addresses for an organization. SECURITY INVOKER - respects RLS. ·  · @a4c... |
| `get_assignable_roles` | `p_org_id uuid` | Returns roles in the organization with assignability status based on inviter ... |
| `get_bootstrap_status` | `p_bootstrap_id uuid` | Get bootstrap workflow status for an organization. · Authorization: · - Platf... |
| `get_category_field_count` | `p_category_id uuid, p_include_inactive boolean` | @a4c-rpc-shape: envelope |
| `get_child_organizations` | `p_parent_org_id uuid` | Frontend RPC: Get child organizations by parent org UUID using ltree hierarch... |
| `get_client` | `p_client_id uuid` | @a4c-rpc-shape: envelope |
| `get_contacts_by_org` | `p_org_id uuid` | Get contacts for an organization. SECURITY INVOKER - respects RLS. ·  · @a4c-... |
| `get_current_org_unit` | `` | Get the current user's selected org unit context. ·  · Returns: · - Single ro... |
| `get_emails_by_org` | `p_org_id uuid` | Get emails for an organization. SECURITY INVOKER - respects RLS. ·  · @a4c-rp... |
| `get_event_processing_stats` | `` | Returns event processing statistics for platform observability. · Requires pl... |
| `get_events_by_correlation` | `p_correlation_id uuid, p_limit integer` | @a4c-rpc-shape: read |
| `get_events_by_session` | `p_session_id uuid, p_limit integer` | @a4c-rpc-shape: read |
| `get_failed_events` | `p_limit integer, p_event_type text, p_stream_type text, p_since timestamp wit...` | Returns failed domain events for platform observability. · Requires platform.... |
| `get_failed_events` | `p_limit integer, p_offset integer, p_event_type text, p_stream_type text, p_s...` | Returns failed domain events with pagination, sorting, and dismiss filtering.... |
| `get_failed_events_with_detail` | `p_limit integer, p_offset integer` | Admin RPC for failed-event forensic detail. Gated by platform.view_event_deta... |
| `get_field_usage_count` | `p_field_key text` | @a4c-rpc-shape: envelope |
| `get_invitation_by_id` | `p_invitation_id uuid` | @a4c-rpc-shape: read |
| `get_invitation_by_org_and_email` | `p_org_id uuid, p_email text` | Get invitation by org and email. SECURITY INVOKER - respects RLS. ·  · @a4c-r... |
| `get_invitation_by_token` | `p_token text` | Get invitation details by token for validation. Returns correlation_id for li... |
| `get_invitation_for_resend` | `p_invitation_id uuid, p_org_id uuid` | Get invitation details for resend operation. Returns both id and invitation_i... |
| `get_organization_by_id` | `p_org_id uuid` | Frontend RPC: Get single organization by UUID. Includes subdomain_status for ... |
| `get_organization_details` | `p_org_id uuid` | @a4c-rpc-shape: envelope |
| `get_organization_direct_care_settings` | `p_org_id uuid` | Get direct care feature flags for an organization. ·  · Parameters: · - p_org... |
| `get_organization_name` | `p_org_id uuid` | @a4c-rpc-shape: read |
| `get_organization_unit_by_id` | `p_unit_id uuid` | Get a single organization unit by ID. · Uses get_permission_scope(organizatio... |
| `get_organization_unit_descendants` | `p_unit_id uuid` | Get all descendants of an organizational unit. · Uses get_permission_scope(or... |
| `get_organization_units` | `p_status text, p_search_term text` | List all organization units within user scope. · Uses get_permission_scope(or... |
| `get_organizations` | `p_type text, p_is_active boolean, p_search_term text` | @a4c-rpc-shape: read |
| `get_organizations_paginated` | `p_type text, p_is_active boolean, p_search_term text, p_page integer, p_page_...` | @a4c-rpc-shape: read |
| `get_orphaned_deletions` | `p_hours_threshold integer` | @a4c-rpc-shape: read |
| `get_pending_invitations_by_org` | `p_org_id uuid` | Get pending invitations for an organization. SECURITY INVOKER - respects RLS.... |
| `get_permission_ids_by_names` | `p_names text[]` | Get permission IDs by names array. Called by Temporal activities for role.per... |
| `get_permissions` | `` | List available permissions filtered by org_type. Non-platform_owner users onl... |
| `get_person_phones` | `p_contact_id uuid` | Get all phones for a person (contact + user if linked). Returns source to dis... |
| `get_phones_by_org` | `p_org_id uuid` | Get phones for an organization. SECURITY INVOKER - respects RLS. ·  · @a4c-rp... |
| `get_role_by_id` | `p_role_id uuid` | Get a single role with its associated permissions including display names. Ac... |
| `get_role_by_name` | `p_org_id uuid, p_role_name text` | Look up role by name, preferring org-specific role over system role. Used by ... |
| `get_role_by_name_and_org` | `p_role_name text, p_organization_id uuid` | Get role ID by name and organization. Returns NULL if not found. Called by Te... |
| `get_role_permission_names` | `p_role_id uuid` | Get array of permission names granted to a role. Returns empty array if none.... |
| `get_role_permission_templates` | `p_role_name text` | Get canonical permission names for a role type. Used during org bootstrap to ... |
| `get_roles` | `p_status text, p_search_term text` | List roles visible to current user. · - Tier 3: Users see their organization'... |
| `get_schedule_template` | `p_template_id uuid` | @a4c-rpc-shape: envelope |
| `get_trace_timeline` | `p_trace_id text` | @a4c-rpc-shape: read |
| `get_user_addresses` | `p_user_id uuid` | Get addresses for a user (CQRS-compliant). · Authorization: · - Platform admi... |
| `get_user_addresses_for_org` | `p_user_id uuid, p_org_id uuid` | Gets addresses for a user within an organization context. Platform admins see... |
| `get_user_by_id` | `p_user_id uuid, p_org_id uuid` | Get a single user with their roles for a given organization. · This RPC funct... |
| `get_user_notification_preferences` | `p_user_id uuid, p_organization_id uuid` | Read user notification preferences for an organization from the normalized pr... |
| `get_user_org_access` | `p_user_id uuid, p_org_id uuid` | Get user organization access details. · Authorization: · - Platform admins ca... |
| `get_user_org_details` | `p_user_id uuid, p_org_id uuid` | Get user details including active status for a specific user in an organizati... |
| `get_user_permissions` | `` | Get permission IDs the current user possesses. Uses SECURITY DEFINER for perf... |
| `get_user_phones` | `p_user_id uuid, p_organization_id uuid` | Get user phones for notification settings. Returns global phones + org-specif... |
| `get_user_phones_for_org` | `p_user_id uuid, p_org_id uuid` | Gets phones for a user within an organization context. Platform admins see al... |
| `get_user_sms_phones` | `p_user_id uuid, p_organization_id uuid` | Get SMS-capable phones for notification preferences dropdown. · Returns only ... |
| `list_clients` | `p_status text, p_search_term text` | @a4c-rpc-shape: envelope |
| `list_field_categories` | `p_include_inactive boolean` | @a4c-rpc-shape: read |
| `list_field_definition_templates` | `` | @a4c-rpc-shape: read |
| `list_field_definitions` | `p_include_inactive boolean` | @a4c-rpc-shape: read |
| `list_invitations` | `p_org_id uuid, p_status text[], p_search_term text` | @a4c-rpc-shape: read |
| `list_roles_for_user` | `p_user_id uuid, p_status text` | Lists roles, optionally filtered by user assignment. · Platform admins can se... |
| `list_schedule_templates` | `p_org_id uuid, p_status text, p_search text` | @a4c-rpc-shape: envelope |
| `list_system_field_categories` | `` | @a4c-rpc-shape: read |
| `list_user_client_assignments` | `p_org_id uuid, p_user_id uuid, p_client_id uuid, p_active_only boolean` | @a4c-rpc-shape: envelope |
| `list_user_org_access` | `p_user_id uuid` | List all organization memberships for a user, including org type. · Authoriza... |
| `list_user_organizations` | `p_user_id uuid, p_org_id uuid` | Lists user-organization memberships. Platform admins see all, org admins see ... |
| `list_users` | `p_org_id uuid, p_status text, p_search_term text, p_sort_by text, p_sort_desc...` | List users in an organization with pagination and filtering. Membership gated... |
| `list_users_for_bulk_assignment` | `p_role_id uuid, p_scope_path ltree, p_search_term text, p_limit integer, p_of...` | List users in an organization eligible for bulk role assignment to a specific... |
| `list_users_for_role_management` | `p_role_id uuid, p_scope_path ltree, p_search_term text, p_limit integer, p_of...` | List users in an organization with their assignment status for a specific rol... |
| `list_users_for_schedule_management` | `p_template_id uuid, p_search_term text, p_limit integer, p_offset integer` | List users in an organization with their assignment status for a specific sch... |
| `modify_user_roles` | `p_user_id uuid, p_role_ids_to_add uuid[], p_role_ids_to_remove uuid[], p_reas...` | Modify a user's role assignments by emitting user.role.revoked then user.role... |
| `reactivate_field_category` | `p_category_id uuid, p_reason text, p_correlation_id uuid` | @a4c-rpc-shape: envelope |
| `reactivate_field_definition` | `p_field_id uuid, p_reason text, p_correlation_id uuid` | @a4c-rpc-shape: envelope |
| `reactivate_organization` | `p_org_id uuid` | @a4c-rpc-shape: envelope |
| `reactivate_organization_unit` | `p_unit_id uuid` | Reactivate an organization unit with cascade to descendants (CQRS via domain ... |
| `reactivate_role` | `p_role_id uuid` | Reactivate a previously deactivated role. ·  · @a4c-rpc-shape: envelope |
| `reactivate_schedule_template` | `p_template_id uuid` | @a4c-rpc-shape: envelope |
| `register_client` | `p_client_data jsonb, p_reason text, p_event_metadata jsonb, p_correlation_id ...` | @a4c-rpc-shape: envelope |
| `remove_client_address` | `p_client_id uuid, p_address_id uuid, p_reason text, p_event_metadata jsonb, p...` | @a4c-rpc-shape: envelope |
| `remove_client_email` | `p_client_id uuid, p_email_id uuid, p_reason text, p_event_metadata jsonb, p_c...` | @a4c-rpc-shape: envelope |
| `remove_client_funding_source` | `p_client_id uuid, p_funding_source_id uuid, p_reason text, p_event_metadata j...` | @a4c-rpc-shape: envelope |
| `remove_client_insurance` | `p_client_id uuid, p_policy_id uuid, p_reason text, p_event_metadata jsonb, p_...` | @a4c-rpc-shape: envelope |
| `remove_client_phone` | `p_client_id uuid, p_phone_id uuid, p_reason text, p_event_metadata jsonb, p_c...` | @a4c-rpc-shape: envelope |
| `remove_user_phone` | `p_phone_id uuid, p_org_id uuid, p_hard_delete boolean, p_reason text` | Remove (soft delete) or permanently delete a user phone. p_hard_delete=true f... |
| `resend_invitation` | `p_invitation_id uuid, p_new_token text, p_new_expires_at timestamp with time ...` | Update an invitation with a new token and expiry date for resending ·  · @a4c... |
| `retry_deletion_workflow` | `p_org_id uuid` | @a4c-rpc-shape: envelope |
| `retry_failed_event` | `p_event_id uuid` | Retries processing a failed domain event. · Requires platform.admin permissio... |
| `revoke_invitation` | `p_invitation_id uuid, p_reason text` | Revokes a pending invitation for the caller's JWT org context. ·  · Precondit... |
| `safety_net_deactivate_organization` | `p_org_id uuid` | @a4c-rpc-shape: read |
| `soft_delete_organization_addresses` | `p_org_id uuid, p_deleted_at timestamp with time zone` | Soft-delete all organization-address junctions for workflow compensation. Ret... |
| `soft_delete_organization_contacts` | `p_org_id uuid, p_deleted_at timestamp with time zone` | Soft-delete all organization-contact junctions for workflow compensation. Ret... |
| `soft_delete_organization_phones` | `p_org_id uuid, p_deleted_at timestamp with time zone` | Soft-delete all organization-phone junctions for workflow compensation. Retur... |
| `switch_org_unit` | `p_org_unit_id uuid` | Switch the current user's working org unit context. ·  · Parameters: · - p_or... |
| `sync_role_assignments` | `p_role_id uuid, p_user_ids_to_add uuid[], p_user_ids_to_remove uuid[], p_scop...` | @a4c-rpc-shape: read |
| `sync_schedule_assignments` | `p_template_id uuid, p_user_ids_to_add uuid[], p_user_ids_to_remove uuid[], p_...` | @a4c-rpc-shape: read |
| `unassign_client_contact` | `p_client_id uuid, p_contact_id uuid, p_designation text, p_reason text, p_eve...` | @a4c-rpc-shape: envelope |
| `unassign_client_from_user` | `p_user_id uuid, p_client_id uuid, p_reason text` | @a4c-rpc-shape: envelope |
| `unassign_user_from_schedule` | `p_template_id uuid, p_user_id uuid, p_reason text` | @a4c-rpc-shape: envelope |
| `undismiss_failed_event` | `p_event_id uuid` | Reverses dismissal of a failed domain event. · Requires platform.admin permis... |
| `update_client` | `p_client_id uuid, p_changes jsonb, p_reason text, p_event_metadata jsonb, p_c...` | @a4c-rpc-shape: envelope |
| `update_client_address` | `p_client_id uuid, p_address_id uuid, p_address_type text, p_street1 text, p_s...` | @a4c-rpc-shape: envelope |
| `update_client_email` | `p_client_id uuid, p_email_id uuid, p_email text, p_email_type text, p_is_prim...` | @a4c-rpc-shape: envelope |
| `update_client_funding_source` | `p_client_id uuid, p_funding_source_id uuid, p_source_type text, p_source_name...` | @a4c-rpc-shape: envelope |
| `update_client_insurance` | `p_client_id uuid, p_policy_id uuid, p_payer_name text, p_policy_number text, ...` | @a4c-rpc-shape: envelope |
| `update_client_phone` | `p_client_id uuid, p_phone_id uuid, p_phone_number text, p_phone_type text, p_...` | @a4c-rpc-shape: envelope |
| `update_field_category` | `p_category_id uuid, p_name text, p_sort_order integer, p_reason text, p_corre...` | @a4c-rpc-shape: envelope |
| `update_field_definition` | `p_field_id uuid, p_display_name text, p_category_id uuid, p_field_type text, ...` | @a4c-rpc-shape: envelope |
| `update_organization` | `p_org_id uuid, p_data jsonb, p_reason text` | @a4c-rpc-shape: envelope |
| `update_organization_address` | `p_address_id uuid, p_data jsonb` | @a4c-rpc-shape: envelope |
| `update_organization_contact` | `p_contact_id uuid, p_data jsonb` | @a4c-rpc-shape: envelope |
| `update_organization_direct_care_settings` | `p_org_id uuid, p_enable_staff_client_mapping boolean, p_enable_schedule_enfor...` | Update direct care feature flags for an organization. ·  · Parameters: · - p_... |
| `update_organization_direct_care_settings` | `p_org_id uuid, p_enable_staff_client_mapping boolean, p_enable_schedule_enfor...` | Update direct care feature flags for an organization. ·  · Parameters: · - p_... |
| `update_organization_phone` | `p_phone_id uuid, p_data jsonb` | @a4c-rpc-shape: envelope |
| `update_organization_unit` | `p_unit_id uuid, p_name text, p_display_name text, p_timezone text` | Update an organization unit (CQRS via domain events). · Uses get_permission_s... |
| `update_role` | `p_role_id uuid, p_name text, p_description text, p_permission_ids uuid[]` | Update role name/description and permissions. Uses helper functions for subse... |
| `update_schedule_template` | `p_template_id uuid, p_name text, p_schedule jsonb, p_org_unit_id uuid` | @a4c-rpc-shape: envelope |
| `update_user` | `p_user_id uuid, p_org_id uuid, p_first_name text, p_last_name text` | Update user profile (first_name, last_name) via domain event ·  · @a4c-rpc-sh... |
| `update_user_access_dates` | `p_user_id uuid, p_org_id uuid, p_access_start_date date, p_access_expiration_...` | Update user access dates in an organization. · Authorization: · - Platform ad... |
| `update_user_notification_preferences` | `p_user_id uuid, p_notification_preferences jsonb, p_reason text` | Updates a user's notification preferences for the caller's JWT org context. ·... |
| `update_user_phone` | `p_phone_id uuid, p_label text, p_type text, p_number text, p_extension text, ...` | Update an existing user phone. p_reason provides optional audit context. · Au... |
| `validate_role_assignment` | `p_role_ids uuid[]` | Validates role assignment against inviter constraints. Returns violations for... |

---

## R-2 Classification (v4 — final auto-pass + manual overrides)

### Methodology

A `bash` classifier scanned each of the 72 missing-from-matrix RPCs:
1. Located each RPC's **latest canonical body** (highest-timestamp `CREATE OR REPLACE FUNCTION` across all migration files).
2. Extracted the function body bounded by `^CREATE OR REPLACE FUNCTION` ... `^$$;` / `^$function$;` markers.
3. Applied the bucket decision tree from plan.md § Stage R-2 with the **B-vs-C path-source discriminator**:
   - **Bucket B**: body has `FROM organizations_projection WHERE id = v_org_id` AND `v_org_id := get_current_org_id()` (scope path is JWT-derived).
   - **Bucket C**: body has `FROM organizations_projection WHERE id = (p_org_id|v_<rec>.organization_id)` (scope path is entity-derived from caller-supplied id).
4. Classifier iterations v1 → v4 caught two false positives (`update_organization`, `update_organization_phone` — both have vestigial `v_user_id := get_current_user_id()` declarations that confused v1–v3). v4 uses the path-source discriminator and is verified against three spot-checks (`admit_client` → B; `delete_organization_address` → C; `update_organization` → C).

### Auto-classified distribution (v4)

| Bucket | Count | Family lean |
|---|---:|---|
| B | 48 | Client lifecycle (16) + field categories/definitions (~14) + most org-CRUD + schedule mgmt |
| C | 10 | Org address/contact/phone CRUD (8) + update_organization + update_organization_phone |
| D | 6 | Field-list helpers + admin lookups + safety_net + get_organization_details + check_field_definitions_exist + list_schedule_templates |
| E | 4 | get_failed_events_with_detail, get_orphaned_deletions, list_field_definition_templates, list_system_field_categories |
| D-variant | 4 | deactivate_organization, delete_organization, reactivate_organization, retry_deletion_workflow (entity-id + has_platform_privilege) |
| **Total** | **72** | |

**Critical zero-cases**:
- **C-legacy: 0** ✅ — no new operational tripwires; step 7 scope confirmed at exactly the 10 known RPCs (per Stage B probe 3)
- **A / A-variant: 0** ✅ — no new Phase 3 refactor targets surfaced from the missing 72

### Manual overrides applied (verified via body inspection)

The auto-classifier v4 output (preserved in § Auto-classification table v4 below) was overridden in 9 cases — 1 D→E (`deactivate_user`) and 8 B→C (`safety_net_deactivate_organization` D→E and 7 schedule template family B→C). Final matrix doc reflects post-override classifications; the table here is the audit trail for the post-R-2 fold-in (F5 fold-in 2026-05-29).

| RPC | Auto | Override | Reason |
|---|---|---|---|
| `deactivate_user` | D | **E** | Uses unscoped `has_permission('user.update')` + manual tenancy guard `v_target_org_id IS DISTINCT FROM v_org_id`; structurally identical to existing matrix entry `delete_user` (Bucket E). Matrix's note on `delete_user` ("users-as-identity; user-as-resource model") applies here too. Body: `20260512194836_*.sql:52`, perm gate at ~L110. |
| `safety_net_deactivate_organization` | D | **E** | Override + `[service-role-only]` annotation. No inline tenancy gate; `GRANT EXECUTE ... TO service_role` only (NOT `authenticated`); Temporal compensation lever for `emitBootstrapFailed → handler` failure path. Body: `20260330170946_*.sql:128`. |
| `create_schedule_template` | B | **C** | COALESCE hybrid scope-source: `has_effective_permission('user.schedule_manage', COALESCE((SELECT path FROM organization_units_projection WHERE id = p_org_unit_id), (SELECT path FROM organizations_projection WHERE id = v_org_id)))`. When `p_org_unit_id` is supplied, scope is entity-derived (canonical C). When NULL, scope falls back to JWT-org (B-like degenerate). Classified C since entity-derived is the principal case. Body: `20260217231405_*.sql:12`. |
| `deactivate_schedule_template` | B | **C** | Same COALESCE hybrid pattern via `p_template_id` → `v_template.org_unit_id`. Body: `20260217231405_*.sql:181`. |
| `delete_schedule_template` | B | **C** | Same COALESCE hybrid pattern. Body: `20260217231405_*.sql:305`. |
| `reactivate_schedule_template` | B | **C** | Same COALESCE hybrid pattern. Body: `20260217231405_*.sql:245`. |
| `update_schedule_template` | B | **C** | Same COALESCE hybrid pattern. Body: `20260423065747_*.sql:896` (re-issued post-R-4 readback). |
| `assign_user_to_schedule` | B | **C** | Same COALESCE hybrid pattern (template lookup → OU-id → path). Body: `20260217231405_*.sql:387`. |
| `unassign_user_from_schedule` | B | **C** | Same COALESCE hybrid pattern. Body: `20260217231405_*.sql:460`. |

Post-override bucket distribution: **B=41 / C=17 / D=4 / D-variant=4 / E=6** (sum=72, matches missing-from-matrix). This is the distribution applied to the matrix doc's master table.

### Stage R-6 architect re-review fold-in 2026-05-30 — F1+F2 reclassification

The R-6 architect re-review on 2026-05-30 (verdict APPROVE WITH IN-PR FIXES; full text in tasks.md § Stage R-6) raised two must-fix reclassification findings on the missing-72 bucketing. Both folded into the matrix doc same-day on this branch. The post-fold-in re-distribution of the missing-72:

- **F1**: `check_field_definitions_exist` + `deactivate_all_field_definitions` moved D→E `[service-role-only]`. Their only enforcement is `GRANT EXECUTE ... TO service_role` (no `authenticated` grant); RLS is not load-bearing. Structurally identical to `safety_net_deactivate_organization` which the earlier override correctly classified E.
- **F2**: 4 organization-lifecycle RPCs (`deactivate_organization`, `delete_organization`, `reactivate_organization`, `retry_deletion_workflow`) moved D-variant→E `[admin-only]`. Their `has_platform_privilege()` early-return is the ONLY enforcement; RLS contributes nothing. Structurally identical to existing `retry_failed_event` / `dismiss_failed_event` which the original matrix correctly classified E.

**Post-R-6 missing-72 distribution**: **B=41 / C=17 / D=2 / D-variant=0 / E=12** (sum=72, unchanged).

The matrix doc's per-bucket count table reflects the corresponding overall shifts: D reads 34→32 (F1 −2); D-variant total 5→1 (F2 −4 writes; only `get_user_addresses_for_org` remains); E reads 22→24 (F1 +2), E writes 15→19 (F2 +4); E total 37→43. Phase 4 RLS audit target list shrinks from 43 → 37 RPCs.

The R-2 override table above is preserved verbatim as the original audit trail of the missing-72 first-pass classification work. The R-6 fold-in is a separate reclassification round applied on top.

### R-3 audit findings (re-audit of pre-existing 104 entries against current canonical bodies)

R-3 ran 2026-05-29; methodology: re-grep `get_permission_scope` across all migrations + cross-reference matrix's existing C-legacy entries against actual canonical bodies + verify no new migrations post-2026-05-26 modified pre-existing matrix entries.

**Findings**: ZERO drift. All 27 `get_permission_scope` hits across migrations map to the 10 known C-legacy RPCs at expected line numbers (`bulk_assign_role`, `sync_role_assignments`, `create/update/delete/deactivate/reactivate_organization_unit`, `get_organization_unit_by_id/descendants`, `get_organization_units`). Per-RPC body file citations in the matrix doc's Phase 1 must-pair section verified against current code state. No new migrations since 2026-05-26 (matches Stage B probe 5 outcome). The pre-reconciliation matrix's 105 actual rows (104 stated) correctly preserved — no entries had bucket-changing body drift since 2026-05-26 hand-curation.

One R-3 nit folded into matrix doc same-day during R-6 architect re-review (F6): citation `20260221173821_*.sql:605` for `reactivate_organization_unit` was incorrect (L605 is `update_organization_unit`'s `get_permission_scope` line; reactivate's is at L440 within the function starting at L425). Corrected to `:440` in both matrix L208 and Phase 1 must-pair section L285.

### N1 resolution 2026-05-30 — REJECTED

The R-6 architect review on 2026-05-29 flagged `safety_net_deactivate_organization`'s `@a4c-rpc-shape: read` tag as an M3 bug (N1: "should be `envelope` per state-mutation semantics"). On 2026-05-30 a dbc-architect re-evaluation against five specific questions produced a unanimous **REJECT** verdict — the original N1 finding misapplied a state-mutation interpretation to a wire-shape contract.

**Architect verdict** (2026-05-30): the M3 `@a4c-rpc-shape` tag is a **wire-shape contract** for compile-time frontend helper narrowing (`apiRpcEnvelope<T>` when returned body has `{success, ...}` discriminator; `apiRpc<T>` otherwise). It is NOT a state-mutation marker. The backfill migration `20260430172625_backfill_rpc_shape_comments.sql:77-83` codifies this as a deterministic body-introspection rule:

```sql
IF v_rpc.returns IN ('jsonb', 'json')
   AND v_rpc.body ~ '''success'',\s*(true|false)'
THEN v_shape := 'envelope';
ELSE v_shape := 'read';
END IF;
```

`safety_net_deactivate_organization`'s body returns `jsonb_build_object('found', ..., 'deactivated', ..., 'deactivated_at', ...)` — no `'success', true|false` literal — so the classifier deterministically labels it `read`. This is the documented intent of the M3 contract, not a bug.

**Five-question evaluation outcomes** (all REJECT):

| Q | Concern | Verdict |
|---|---|---|
| 1 | Backfill body-introspection rule paraphrase + exclusion intent | Rule is deterministic; no allowlist; safety_net's exclusion is the design |
| 2 | Frontend-callability | Zero frontend reach; service-role-only; Temporal worker bypasses typed helpers entirely |
| 3 | Custom-shape jsonb policy scope (sibling class) | 5 state-mutating-but-custom-shape RPCs in class; 3 actively consumed by frontend via `apiRpc<T>`; N1-uniform would force 3-service refactor outside Phase 1 scope; N1-inconsistent unprincipled |
| 4 | Architectural intent reconciliation | ADR §"Type-level enforcement (M3)" + both SKILLs unambiguous: tag is wire-shape, not r/w. Original N1 finding has no precedent citation |
| 5 | Precedent risk | Override unstable (backfill idempotency reverts on rerun); creates migration-history drift; sets precedent for post-hoc re-litigation of M3 tag classifications |

**5-RPC class inventory** (`api.*` RPCs where state-mutating BUT body lacks `{success, ...}` discriminator → backfill rule tags as `read`):

| RPC | r/w | Tag | Frontend caller | Helper |
|---|---|---|---|---|
| `bulk_assign_role` | W | read | `SupabaseRoleService.ts:710` | `apiRpc<T>` |
| `sync_role_assignments` | W | read | `SupabaseRoleService.ts:831` | `apiRpc<T>` |
| `sync_schedule_assignments` | W | read | `SupabaseScheduleService.ts:318` | `apiRpc<T>` |
| `deactivate_all_field_definitions` | W | read | (admin path) | — |
| `safety_net_deactivate_organization` | W | read | NONE (service-role only) | n/a (worker uses inline cast) |

`validate_role_assignment` returns custom-shape jsonb too (`{valid, violations[]}`) but is structurally a read; it correctly stays `read` regardless of which interpretation governs.

**Resolution applied**:
1. Stage D N1 line in tasks.md marked `[x] RESOLVED — REJECTED 2026-05-30` with full reasoning.
2. Stage C step 8 line in tasks.md given positive-guard sub-bullet: retain `read` for all 5 RPCs on M3 re-tag; do NOT promote to `envelope`.
3. Matrix doc § Structural classification notes given one-sentence acknowledgment of wire-shape vs r/w distinction with the 5-RPC list.
4. No migration content for N1.

**Deferred work** (separate parked card, NOT this PR): if future code-comprehension argues for a state-mutation marker, propose a NEW orthogonal annotation (e.g., `@a4c-rpc-rw: r|w`) layered alongside `@a4c-rpc-shape`. Do NOT couple it into the wire-shape tag. Also separately deferrable: worker at `workflows/src/activities/organization-bootstrap/deactivate-organization.ts:53-57` uses anonymous response type with `as any` cast for `safety_net_deactivate_organization` return; promote to named type if a broader type-cleanup pass is undertaken.

### Edge cases flagged for matrix § Edge cases

1. **`create_schedule_template`** has a HYBRID scope-source pattern: `has_effective_permission('user.schedule_manage', COALESCE((SELECT path FROM organization_units_projection WHERE id = p_org_unit_id), (SELECT path FROM organizations_projection WHERE id = v_org_id)))`. When `p_org_unit_id` is supplied, scope is **entity-derived** (C-like); when NULL, scope **falls back to JWT-derived org** (B-like). Net classification: **B (default behavior; needs ADR review for consultant-callability under a grant carrying OU-targeted role)**. Edge Cases note needed.

2. **`update_organization` declares `v_org_id := get_current_org_id();` but never uses it for the perm-check path** — the path comes from `SELECT * FROM organizations_projection WHERE id = p_org_id`. This is the canonical C pattern despite the JWT-org variable presence. Edge Cases note useful for future code reviewers.

3. **Schedule template family (7 RPCs)** — auto-classifier flagged "no clear path source" for several because the path is sourced from `organization_units_projection` (not `organizations_projection`). These are structurally B with OU-scope, not org-scope. Pending verification (defer to manual review batch).

4. **`list_field_categories`, `list_field_definitions`, `list_system_field_categories`, `list_field_definition_templates`** — three of four use `get_current_org_id()` without a `has_effective_permission` check (tenancy-only B); `list_system_field_categories` is reference data (no tenancy at all → E). Verify the first three are B under the matrix's existing B definition (which allows tenancy-only with no perm check).

### Decision gates still requiring user input

Per plan.md § Stage R-2 decision gates 1-9; the auto-pass narrowed to these specific user-decisions:

1. **`safety_net_deactivate_organization`** auto-classified D. Body uses entity-id and relies on RLS; no `has_platform_privilege()` gate. But name strongly implies admin-only. **Verify body has the appropriate gate; if not, consider whether this is a security gap or a deliberately RLS-only emergency lever.** Sub-classification: `[admin-only]` recommended.

2. **Admin dashboard sub-classification**: confirm `get_failed_events_with_detail`, `get_orphaned_deletions`, `retry_deletion_workflow` all get `[admin-only]` annotation in summary column. Auto-classified as E and D-variant.

3. **`create_schedule_template` hybrid pattern** — should this be B (default behavior; consultant cannot target an OU in a grant org because the JWT-fallback returns home-org path) or should it be a new variant? Recommendation: stay B with Edge Cases note; revisit during Phase 2 grant-write RPC design when OU-scoped grants become relevant.

### Auto-classification table (v4 — **pre-override**)

> [!NOTE]
> This is the auto-classifier output PRIOR to the 9 manual overrides documented above. For the FINAL (post-override) classification of the 72 missing-from-matrix RPCs, refer to the matrix doc's master per-RPC table (`documentation/architecture/authorization/cross-tenant-access-grant-rpc-reachability-matrix.md` § The matrix). Pre-override distribution: B=48 / C=10 / D=6 / D-variant=4 / E=4 (sum=72). Post-override distribution (after applying overrides above): B=41 / C=17 / D=4 / D-variant=4 / E=6 (sum=72).

| RPC | Bucket | r/w | Latest migration | Line | Pattern matched |
|---|---|---|---|---|---|
| `add_client_address` | B | W | `20260408000351_fix_client_api_architecture_review.sql` | 627 | B: JWT-org path-source (FROM orgs_proj WHERE id = v_org_id) |
| `add_client_email` | B | W | `20260408000351_fix_client_api_architecture_review.sql` | 602 | B: JWT-org path-source (FROM orgs_proj WHERE id = v_org_id) |
| `add_client_funding_source` | B | W | `20260408000351_fix_client_api_architecture_review.sql` | 681 | B: JWT-org path-source (FROM orgs_proj WHERE id = v_org_id) |
| `add_client_insurance` | B | W | `20260408000351_fix_client_api_architecture_review.sql` | 653 | B: JWT-org path-source (FROM orgs_proj WHERE id = v_org_id) |
| `add_client_phone` | B | W | `20260408000351_fix_client_api_architecture_review.sql` | 576 | B: JWT-org path-source (FROM orgs_proj WHERE id = v_org_id) |
| `admit_client` | B | W | `20260408000351_fix_client_api_architecture_review.sql` | 411 | B: JWT-org path-source (FROM orgs_proj WHERE id = v_org_id) |
| `assign_client_contact` | B | W | `20260408000351_fix_client_api_architecture_review.sql` | 734 | B: JWT-org path-source (FROM orgs_proj WHERE id = v_org_id) |
| `assign_user_to_schedule` | B | W | `20260217231405_add_event_metadata_to_schedule_rpcs.sql` | 387 | B: get_current_org_id() (no clear path source) |
| `batch_update_field_definitions` | B | W | `20260408012329_fix_batch_update_jsonb_scalar.sql` | 12 | B: JWT-org path-source (FROM orgs_proj WHERE id = v_org_id) |
| `change_client_placement` | B | W | `20260423065747_api_rpc_readback_v2_event_id_check.sql` | 1076 | B: JWT-org path-source (FROM orgs_proj WHERE id = v_org_id) |
| `check_field_definitions_exist` | D | R | `20260330191322_fix_seed_field_definitions_idempotency_check.sql` | 9 | D: entity-id, RLS-relying |
| `create_field_category` | B | W | `20260408023403_client_field_config_enhancements.sql` | 239 | B: JWT-org path-source (FROM orgs_proj WHERE id = v_org_id) |
| `create_field_definition` | B | W | `20260415003931_fix_create_field_readback_guard.sql` | 10 | B: JWT-org path-source (FROM orgs_proj WHERE id = v_org_id) |
| `create_organization_address` | C | W | `20260226002002_organization_manage_page_phase1.sql` | 732 | C: entity-derived path-source (FROM orgs_proj WHERE id = p_org_id or v_<rec>.org_id) |
| `create_organization_contact` | C | W | `20260226002002_organization_manage_page_phase1.sql` | 610 | C: entity-derived path-source (FROM orgs_proj WHERE id = p_org_id or v_<rec>.org_id) |
| `create_organization_phone` | C | W | `20260226002002_organization_manage_page_phase1.sql` | 854 | C: entity-derived path-source (FROM orgs_proj WHERE id = p_org_id or v_<rec>.org_id) |
| `create_schedule_template` | B | W | `20260217231405_add_event_metadata_to_schedule_rpcs.sql` | 12 | B: get_current_org_id() (no clear path source) |
| `deactivate_all_field_definitions` | D | R | `20260330170946_fix_seed_field_definitions_schema_access.sql` | 94 | D: entity-id, RLS-relying |
| `deactivate_field_category` | B | W | `20260415022432_field_deactivation_confirmation.sql` | 80 | B: JWT-org path-source (FROM orgs_proj WHERE id = v_org_id) |
| `deactivate_field_definition` | B | W | `20260327212247_client_field_api_functions.sql` | 195 | B: JWT-org path-source (FROM orgs_proj WHERE id = v_org_id) |
| `deactivate_organization` | D-variant | W | `20260226002002_organization_manage_page_phase1.sql` | 390 | D-variant: entity-id + has_platform_privilege |
| `deactivate_schedule_template` | B | W | `20260217231405_add_event_metadata_to_schedule_rpcs.sql` | 181 | B: get_current_org_id() (no clear path source) |
| `deactivate_user` | **E** (manual override; was D) | W | `20260512194836_deactivate_user_rpc_and_check_user_invitation_existence.sql` | 52 | Manual override — unscoped has_permission + manual tenancy guard; mirrors delete_user precedent |
| `delete_field_category` | B | W | `20260420160421_field_category_reactivate_delete.sql` | 281 | B: JWT-org path-source (FROM orgs_proj WHERE id = v_org_id) |
| `delete_field_definition` | B | W | `20260420160421_field_category_reactivate_delete.sql` | 101 | B: JWT-org path-source (FROM orgs_proj WHERE id = v_org_id) |
| `delete_organization` | D-variant | W | `20260226002002_organization_manage_page_phase1.sql` | 534 | D-variant: entity-id + has_platform_privilege |
| `delete_organization_address` | C | W | `20260226002002_organization_manage_page_phase1.sql` | 813 | C: entity-derived path-source (FROM orgs_proj WHERE id = p_org_id or v_<rec>.org_id) |
| `delete_organization_contact` | C | W | `20260226002002_organization_manage_page_phase1.sql` | 691 | C: entity-derived path-source (FROM orgs_proj WHERE id = p_org_id or v_<rec>.org_id) |
| `delete_organization_phone` | C | W | `20260226002002_organization_manage_page_phase1.sql` | 934 | C: entity-derived path-source (FROM orgs_proj WHERE id = p_org_id or v_<rec>.org_id) |
| `delete_schedule_template` | B | W | `20260217231405_add_event_metadata_to_schedule_rpcs.sql` | 305 | B: get_current_org_id() (no clear path source) |
| `discharge_client` | B | W | `20260408000351_fix_client_api_architecture_review.sql` | 457 | B: JWT-org path-source (FROM orgs_proj WHERE id = v_org_id) |
| `end_client_placement` | B | W | `20260406222857_client_api_functions.sql` | 812 | B: JWT-org path-source (FROM orgs_proj WHERE id = v_org_id) |
| `get_category_field_count` | B | W | `20260420160421_field_category_reactivate_delete.sql` | 555 | B: JWT-org path-source (FROM orgs_proj WHERE id = v_org_id) |
| `get_client` | B | W | `20260423013804_client_get_client_ou_state_fields.sql` | 25 | B: JWT-org path-source (FROM orgs_proj WHERE id = v_org_id) |
| `get_failed_events_with_detail` | E | W | `20260506012315_fix_get_failed_events_with_detail_security_definer.sql` | 73 | E: no tenancy gate detected |
| `get_field_usage_count` | B | W | `20260415022432_field_deactivation_confirmation.sql` | 5 | B: JWT-org path-source (FROM orgs_proj WHERE id = v_org_id) |
| `get_organization_details` | D | W | `20260226002002_organization_manage_page_phase1.sql` | 214 | D: entity-id, RLS-relying |
| `get_orphaned_deletions` | E | R | `20260310004215_orphaned_deletion_monitoring.sql` | 15 | E: has_platform_privilege only |
| `get_schedule_template` | B | W | `20260424182345_add_missing_user_lifecycle_handlers_and_orphan_filters.sql` | 339 | B: get_current_org_id() (no perm check; tenancy-only) |
| `list_clients` | B | W | `20260406222857_client_api_functions.sql` | 318 | B: JWT-org path-source (FROM orgs_proj WHERE id = v_org_id) |
| `list_field_categories` | B | R | `20260420160421_field_category_reactivate_delete.sql` | 506 | B: get_current_org_id() (no perm check; tenancy-only) |
| `list_field_definitions` | B | R | `20260327212247_client_field_api_functions.sql` | 252 | B: get_current_org_id() (no perm check; tenancy-only) |
| `list_field_definition_templates` | E | R | `20260330170946_fix_seed_field_definitions_schema_access.sql` | 18 | E: no tenancy gate detected |
| `list_schedule_templates` | D | W | `20260218001058_denormalize_schedule_assigned_user_count.sql` | 164 | D: entity-id, RLS-relying |
| `list_system_field_categories` | E | R | `20260330170946_fix_seed_field_definitions_schema_access.sql` | 65 | E: no tenancy gate detected |
| `reactivate_field_category` | B | W | `20260420160421_field_category_reactivate_delete.sql` | 203 | B: JWT-org path-source (FROM orgs_proj WHERE id = v_org_id) |
| `reactivate_field_definition` | B | W | `20260420160421_field_category_reactivate_delete.sql` | 26 | B: JWT-org path-source (FROM orgs_proj WHERE id = v_org_id) |
| `reactivate_organization` | D-variant | W | `20260226002002_organization_manage_page_phase1.sql` | 466 | D-variant: entity-id + has_platform_privilege |
| `reactivate_schedule_template` | B | W | `20260217231405_add_event_metadata_to_schedule_rpcs.sql` | 245 | B: get_current_org_id() (no clear path source) |
| `register_client` | B | W | `20260406222857_client_api_functions.sql` | 49 | B: JWT-org path-source (FROM orgs_proj WHERE id = v_org_id) |
| `remove_client_address` | B | W | `20260406222857_client_api_functions.sql` | 684 | B: JWT-org path-source (FROM orgs_proj WHERE id = v_org_id) |
| `remove_client_email` | B | W | `20260406222857_client_api_functions.sql` | 604 | B: JWT-org path-source (FROM orgs_proj WHERE id = v_org_id) |
| `remove_client_funding_source` | B | W | `20260406222857_client_api_functions.sql` | 891 | B: JWT-org path-source (FROM orgs_proj WHERE id = v_org_id) |
| `remove_client_insurance` | B | W | `20260406222857_client_api_functions.sql` | 766 | B: JWT-org path-source (FROM orgs_proj WHERE id = v_org_id) |
| `remove_client_phone` | B | W | `20260406222857_client_api_functions.sql` | 530 | B: JWT-org path-source (FROM orgs_proj WHERE id = v_org_id) |
| `retry_deletion_workflow` | D-variant | W | `20260310004215_orphaned_deletion_monitoring.sql` | 76 | D-variant: entity-id + has_platform_privilege |
| `safety_net_deactivate_organization` | D | W | `20260330170946_fix_seed_field_definitions_schema_access.sql` | 128 | D: entity-id, RLS-relying |
| `unassign_client_contact` | B | W | `20260406222857_client_api_functions.sql` | 937 | B: JWT-org path-source (FROM orgs_proj WHERE id = v_org_id) |
| `unassign_user_from_schedule` | B | W | `20260217231405_add_event_metadata_to_schedule_rpcs.sql` | 460 | B: get_current_org_id() (no clear path source) |
| `update_client` | B | W | `20260423074238_api_rpc_readback_v2_m1_m2_fix.sql` | 420 | B: JWT-org path-source (FROM orgs_proj WHERE id = v_org_id) |
| `update_client_address` | B | W | `20260423074238_api_rpc_readback_v2_m1_m2_fix.sql` | 47 | B: JWT-org path-source (FROM orgs_proj WHERE id = v_org_id) |
| `update_client_email` | B | W | `20260423074238_api_rpc_readback_v2_m1_m2_fix.sql` | 128 | B: JWT-org path-source (FROM orgs_proj WHERE id = v_org_id) |
| `update_client_funding_source` | B | W | `20260423074238_api_rpc_readback_v2_m1_m2_fix.sql` | 196 | B: JWT-org path-source (FROM orgs_proj WHERE id = v_org_id) |
| `update_client_insurance` | B | W | `20260423074238_api_rpc_readback_v2_m1_m2_fix.sql` | 273 | B: JWT-org path-source (FROM orgs_proj WHERE id = v_org_id) |
| `update_client_phone` | B | W | `20260423074238_api_rpc_readback_v2_m1_m2_fix.sql` | 352 | B: JWT-org path-source (FROM orgs_proj WHERE id = v_org_id) |
| `update_field_category` | B | W | `20260423154534_client_field_rpc_return_entities.sql` | 155 | B: JWT-org path-source (FROM orgs_proj WHERE id = v_org_id) |
| `update_field_definition` | B | W | `20260423154534_client_field_rpc_return_entities.sql` | 30 | B: JWT-org path-source (FROM orgs_proj WHERE id = v_org_id) |
| `update_organization` | C | W | `20260423065747_api_rpc_readback_v2_event_id_check.sql` | 1353 | C: entity-derived path-source (FROM orgs_proj WHERE id = p_org_id or v_<rec>.org_id) |
| `update_organization_address` | C | W | `20260423065747_api_rpc_readback_v2_event_id_check.sql` | 1439 | C: entity-derived path-source (FROM orgs_proj WHERE id = p_org_id or v_<rec>.org_id) |
| `update_organization_contact` | C | W | `20260423065747_api_rpc_readback_v2_event_id_check.sql` | 1489 | C: entity-derived path-source (FROM orgs_proj WHERE id = p_org_id or v_<rec>.org_id) |
| `update_organization_phone` | C | W | `20260423065747_api_rpc_readback_v2_event_id_check.sql` | 1539 | C: entity-derived path-source (FROM orgs_proj WHERE id = p_org_id or v_<rec>.org_id) |
| `update_schedule_template` | B | W | `20260423065747_api_rpc_readback_v2_event_id_check.sql` | 896 | B: get_current_org_id() (no clear path source) |
