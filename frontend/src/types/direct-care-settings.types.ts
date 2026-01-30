/**
 * Direct Care Settings Types
 *
 * Feature flags for direct care workflow routing per organization.
 * Controls how medication alerts and time-sensitive notifications
 * are routed to staff members.
 *
 * @see infrastructure/supabase/contracts/asyncapi/domains/organization.yaml
 */

export interface DirectCareSettings {
  enable_staff_client_mapping: boolean;
  enable_schedule_enforcement: boolean;
}
