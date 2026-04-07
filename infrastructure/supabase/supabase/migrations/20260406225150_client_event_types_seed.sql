-- Migration: client_event_types_seed
-- Seeds event_types registry with 25 new event types:
--   23 client events (lifecycle, sub-entity CRUD, placement, contact assignment)
--   2 contact designation events
-- Also adds the 'client' stream_type to the registry.
-- event_types is a documentation/admin registry — NOT used for runtime validation.

INSERT INTO "public"."event_types" (
    "event_type", "stream_type", "event_schema", "description",
    "projection_function", "projection_tables", "is_active"
)
VALUES
    -- =========================================================================
    -- Client Lifecycle Events (4)
    -- =========================================================================
    (
        'client.registered',
        'client',
        '{"type": "object", "required": ["organization_id", "first_name", "last_name", "date_of_birth", "gender", "race", "ethnicity", "primary_language"]}'::jsonb,
        'A new client has been registered via intake form (JSONB payload with mandatory + org-configurable fields).',
        'handle_client_registered',
        ARRAY['clients_projection'],
        true
    ),
    (
        'client.information_updated',
        'client',
        '{"type": "object", "required": ["organization_id", "changes"]}'::jsonb,
        'Client record fields have been modified (partial update via changes JSONB). Only changed fields included.',
        'handle_client_information_updated',
        ARRAY['clients_projection'],
        true
    ),
    (
        'client.admitted',
        'client',
        '{"type": "object", "required": ["organization_id"]}'::jsonb,
        'A client has been admitted (sets status=active, updates admission fields).',
        'handle_client_admitted',
        ARRAY['clients_projection'],
        true
    ),
    (
        'client.discharged',
        'client',
        '{"type": "object", "required": ["organization_id", "discharge_date", "discharge_outcome", "discharge_reason"]}'::jsonb,
        'A client has been discharged (Decision 78 three-field decomposition).',
        'handle_client_discharged',
        ARRAY['clients_projection'],
        true
    ),

    -- =========================================================================
    -- Phone Sub-Entity Events (3)
    -- =========================================================================
    (
        'client.phone.added',
        'client',
        '{"type": "object", "required": ["organization_id", "phone_id", "phone_number"]}'::jsonb,
        'A phone number has been added to a client record.',
        'handle_client_phone_added',
        ARRAY['client_phones_projection'],
        true
    ),
    (
        'client.phone.updated',
        'client',
        '{"type": "object", "required": ["organization_id", "phone_id"]}'::jsonb,
        'A client phone number has been updated (partial update).',
        'handle_client_phone_updated',
        ARRAY['client_phones_projection'],
        true
    ),
    (
        'client.phone.removed',
        'client',
        '{"type": "object", "required": ["organization_id"]}'::jsonb,
        'A client phone number has been soft-deleted (is_active=false).',
        'handle_client_phone_removed',
        ARRAY['client_phones_projection'],
        true
    ),

    -- =========================================================================
    -- Email Sub-Entity Events (3)
    -- =========================================================================
    (
        'client.email.added',
        'client',
        '{"type": "object", "required": ["organization_id", "email_id", "email"]}'::jsonb,
        'An email address has been added to a client record.',
        'handle_client_email_added',
        ARRAY['client_emails_projection'],
        true
    ),
    (
        'client.email.updated',
        'client',
        '{"type": "object", "required": ["organization_id", "email_id"]}'::jsonb,
        'A client email address has been updated (partial update).',
        'handle_client_email_updated',
        ARRAY['client_emails_projection'],
        true
    ),
    (
        'client.email.removed',
        'client',
        '{"type": "object", "required": ["organization_id"]}'::jsonb,
        'A client email has been soft-deleted (is_active=false).',
        'handle_client_email_removed',
        ARRAY['client_emails_projection'],
        true
    ),

    -- =========================================================================
    -- Address Sub-Entity Events (3)
    -- =========================================================================
    (
        'client.address.added',
        'client',
        '{"type": "object", "required": ["organization_id", "address_id", "street1", "city", "state", "zip"]}'::jsonb,
        'An address has been added to a client record.',
        'handle_client_address_added',
        ARRAY['client_addresses_projection'],
        true
    ),
    (
        'client.address.updated',
        'client',
        '{"type": "object", "required": ["organization_id", "address_id"]}'::jsonb,
        'A client address has been updated (partial update).',
        'handle_client_address_updated',
        ARRAY['client_addresses_projection'],
        true
    ),
    (
        'client.address.removed',
        'client',
        '{"type": "object", "required": ["organization_id"]}'::jsonb,
        'A client address has been soft-deleted (is_active=false).',
        'handle_client_address_removed',
        ARRAY['client_addresses_projection'],
        true
    ),

    -- =========================================================================
    -- Insurance Sub-Entity Events (3)
    -- =========================================================================
    (
        'client.insurance.added',
        'client',
        '{"type": "object", "required": ["organization_id", "policy_id", "policy_type", "payer_name"]}'::jsonb,
        'An insurance policy has been added to a client record.',
        'handle_client_insurance_added',
        ARRAY['client_insurance_policies_projection'],
        true
    ),
    (
        'client.insurance.updated',
        'client',
        '{"type": "object", "required": ["organization_id", "policy_id"]}'::jsonb,
        'A client insurance policy has been updated (partial update).',
        'handle_client_insurance_updated',
        ARRAY['client_insurance_policies_projection'],
        true
    ),
    (
        'client.insurance.removed',
        'client',
        '{"type": "object", "required": ["organization_id"]}'::jsonb,
        'A client insurance policy has been soft-deleted (is_active=false).',
        'handle_client_insurance_removed',
        ARRAY['client_insurance_policies_projection'],
        true
    ),

    -- =========================================================================
    -- Placement Sub-Entity Events (2)
    -- =========================================================================
    (
        'client.placement.changed',
        'client',
        '{"type": "object", "required": ["organization_id", "placement_id", "placement_arrangement", "start_date"]}'::jsonb,
        'Client placement arrangement has changed (closes previous, inserts new, denormalizes to clients_projection).',
        'handle_client_placement_changed',
        ARRAY['client_placement_history_projection', 'clients_projection'],
        true
    ),
    (
        'client.placement.ended',
        'client',
        '{"type": "object", "required": ["organization_id"]}'::jsonb,
        'Current client placement has ended (is_current=false, clears denormalized field).',
        'handle_client_placement_ended',
        ARRAY['client_placement_history_projection', 'clients_projection'],
        true
    ),

    -- =========================================================================
    -- Funding Source Sub-Entity Events (3)
    -- =========================================================================
    (
        'client.funding_source.added',
        'client',
        '{"type": "object", "required": ["organization_id", "funding_source_id", "source_type", "source_name"]}'::jsonb,
        'A funding source has been added to a client record.',
        'handle_client_funding_source_added',
        ARRAY['client_funding_sources_projection'],
        true
    ),
    (
        'client.funding_source.updated',
        'client',
        '{"type": "object", "required": ["organization_id", "funding_source_id"]}'::jsonb,
        'A client funding source has been updated (partial update).',
        'handle_client_funding_source_updated',
        ARRAY['client_funding_sources_projection'],
        true
    ),
    (
        'client.funding_source.removed',
        'client',
        '{"type": "object", "required": ["organization_id"]}'::jsonb,
        'A client funding source has been soft-deleted (is_active=false).',
        'handle_client_funding_source_removed',
        ARRAY['client_funding_sources_projection'],
        true
    ),

    -- =========================================================================
    -- Contact Assignment Events (2)
    -- =========================================================================
    (
        'client.contact.assigned',
        'client',
        '{"type": "object", "required": ["organization_id", "assignment_id", "contact_id", "designation"]}'::jsonb,
        'A contact has been assigned to a client with a designation (4NF model).',
        'handle_client_contact_assigned',
        ARRAY['client_contact_assignments_projection'],
        true
    ),
    (
        'client.contact.unassigned',
        'client',
        '{"type": "object", "required": ["organization_id", "contact_id", "designation"]}'::jsonb,
        'A contact has been unassigned from a client (is_active=false).',
        'handle_client_contact_unassigned',
        ARRAY['client_contact_assignments_projection'],
        true
    ),

    -- =========================================================================
    -- Contact Designation Events (2) — routed via process_contact_event()
    -- =========================================================================
    (
        'contact.designation.created',
        'contact',
        '{"type": "object", "required": ["designation_id", "designation", "organization_id"]}'::jsonb,
        'A clinical designation has been assigned to a contact for an organization.',
        'handle_contact_designation_created',
        ARRAY['contact_designations_projection'],
        true
    ),
    (
        'contact.designation.deactivated',
        'contact',
        '{"type": "object", "required": ["designation", "organization_id"]}'::jsonb,
        'A clinical designation has been deactivated for a contact.',
        'handle_contact_designation_deactivated',
        ARRAY['contact_designations_projection'],
        true
    )
ON CONFLICT ("event_type") DO NOTHING;
