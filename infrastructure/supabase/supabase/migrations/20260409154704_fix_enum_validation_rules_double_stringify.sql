-- Fix: Unwrap double-stringified validation_rules in enum/multi_enum fields
--
-- Root cause: SupabaseClientFieldService.createFieldDefinition() and
-- updateFieldDefinition() called JSON.stringify() on validation_rules before
-- passing to an RPC with a jsonb parameter. The Supabase SDK already serializes
-- the body, so this wrapped the object in an extra layer of quotes — storing a
-- jsonb STRING instead of a jsonb OBJECT.
--
-- Same bug class as commit 4849122b (batch_update_field_definitions fix).
-- Frontend fix removes JSON.stringify(); this migration repairs existing data.

UPDATE client_field_definitions_projection
SET validation_rules = (validation_rules #>> '{}')::jsonb,
    updated_at = now()
WHERE field_type IN ('enum', 'multi_enum')
  AND validation_rules IS NOT NULL
  AND jsonb_typeof(validation_rules) = 'string';
