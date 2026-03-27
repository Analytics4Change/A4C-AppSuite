-- Migration: client_field_event_types_seed
-- Seeds event_types registry with 5 new event types for client field configuration:
--   3 client_field_definition events + 2 client_field_category events
-- Also adds the 2 new stream_types to the registry.
-- event_types is a documentation/admin registry — NOT used for runtime validation.

INSERT INTO "public"."event_types" (
    "event_type", "stream_type", "event_schema", "description",
    "projection_function", "projection_tables", "is_active"
)
VALUES
    -- Client Field Definition events (stream_type: client_field_definition)
    (
        'client_field_definition.created',
        'client_field_definition',
        '{"type": "object", "required": ["field_id", "organization_id", "category_id", "field_key", "display_name"]}'::jsonb,
        'A field definition has been created for an organization (via bootstrap seed or manual creation). Configures field visibility, required flags, labels, and analytics exposure.',
        'handle_client_field_definition_created',
        ARRAY['client_field_definitions_projection'],
        true
    ),
    (
        'client_field_definition.updated',
        'client_field_definition',
        '{"type": "object", "required": ["field_id", "organization_id"]}'::jsonb,
        'A field definition''s visibility, required flag, label, or other properties have been modified. Partial update — only changed fields included in event_data.',
        'handle_client_field_definition_updated',
        ARRAY['client_field_definitions_projection'],
        true
    ),
    (
        'client_field_definition.deactivated',
        'client_field_definition',
        '{"type": "object", "required": ["field_id", "organization_id"]}'::jsonb,
        'A field definition has been deactivated. One-way operation — deactivated fields are hidden from configuration UI.',
        'handle_client_field_definition_deactivated',
        ARRAY['client_field_definitions_projection'],
        true
    ),

    -- Client Field Category events (stream_type: client_field_category)
    (
        'client_field_category.created',
        'client_field_category',
        '{"type": "object", "required": ["category_id", "organization_id", "name", "slug"]}'::jsonb,
        'An org-defined field category has been created for grouping field definitions in the configuration UI. System categories (org_id NULL) are seeded, not event-sourced.',
        'handle_client_field_category_created',
        ARRAY['client_field_categories'],
        true
    ),
    (
        'client_field_category.deactivated',
        'client_field_category',
        '{"type": "object", "required": ["category_id", "organization_id"]}'::jsonb,
        'An org-defined field category has been deactivated. System categories cannot be deactivated.',
        'handle_client_field_category_deactivated',
        ARRAY['client_field_categories'],
        true
    )
ON CONFLICT ("event_type") DO NOTHING;
