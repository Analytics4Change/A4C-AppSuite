-- Fix: Use correct column names matching table schema
-- Note: This migration has a bug (organization_type cast) fixed in v2
CREATE OR REPLACE FUNCTION handle_organization_created(p_event record)
RETURNS void
LANGUAGE plpgsql
SET search_path = public, extensions, pg_temp
AS $$
BEGIN
  INSERT INTO organizations_projection (
    id, name, slug, subdomain_status, is_active, path, parent_path,
    type, partner_type, referring_partner_id, metadata, tags, created_at, updated_at
  ) VALUES (
    p_event.stream_id,
    safe_jsonb_extract_text(p_event.event_data, 'name'),
    safe_jsonb_extract_text(p_event.event_data, 'slug'),
    COALESCE(safe_jsonb_extract_text(p_event.event_data, 'subdomain_status'), 'pending')::subdomain_status,
    true,
    COALESCE(
      safe_jsonb_extract_text(p_event.event_data, 'path')::ltree,
      p_event.stream_id::text::ltree
    ),
    COALESCE(
      safe_jsonb_extract_text(p_event.event_data, 'parent_path')::ltree,
      p_event.stream_id::text::ltree
    ),
    COALESCE(safe_jsonb_extract_text(p_event.event_data, 'type'), 'provider')::organization_type,
    (p_event.event_data->>'partner_type')::partner_type,
    (p_event.event_data->>'referring_partner_id')::UUID,
    COALESCE(p_event.event_data->'metadata', '{}'::jsonb),
    COALESCE(
      ARRAY(SELECT jsonb_array_elements_text(p_event.event_data->'tags')),
      '{}'::TEXT[]
    ),
    p_event.created_at,
    p_event.created_at
  )
  ON CONFLICT (id) DO NOTHING;
END;
$$;
