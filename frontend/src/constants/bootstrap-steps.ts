/**
 * Bootstrap workflow step manifest for mock mode.
 *
 * Cross-reference: This list must match the step manifest CTE in
 * public.get_bootstrap_status() — see the migration that defines it.
 * In production, the RPC returns stages dynamically; this constant
 * is only used by MockWorkflowClient.
 */
export const BOOTSTRAP_STEPS = [
  { key: 'create_organization', label: 'Create Organization' },
  { key: 'grant_permissions', label: 'Grant Admin Permissions' },
  { key: 'seed_field_definitions', label: 'Seed Field Definitions' },
  { key: 'configure_dns', label: 'Configure DNS' },
  { key: 'generate_invitations', label: 'Generate Invitations' },
  { key: 'send_invitation_emails', label: 'Send Invitation Emails' },
  { key: 'activate_organization', label: 'Activate Organization' },
] as const;
