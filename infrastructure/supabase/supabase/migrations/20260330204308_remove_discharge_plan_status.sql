-- Migration: remove_discharge_plan_status
--
-- Removes the discharge_plan_status field. The full client lifecycle
-- (treatment plan with goals/milestones/success tracking) IS the discharge
-- plan. A static enum field misrepresents a dynamic clinical process.
-- Discharge readiness is captured by future care planning applets and
-- existing Discharge fields (discharge_outcome, discharge_reason, discharge_placement).

-- Drop column from clients_projection
ALTER TABLE public.clients_projection DROP COLUMN IF EXISTS discharge_plan_status;

-- Deactivate template (soft-delete for audit trail)
UPDATE public.client_field_definition_templates
SET is_active = false
WHERE field_key = 'discharge_plan_status';

-- Deactivate existing field definitions for all orgs
UPDATE public.client_field_definitions_projection
SET is_active = false, updated_at = now()
WHERE field_key = 'discharge_plan_status';
