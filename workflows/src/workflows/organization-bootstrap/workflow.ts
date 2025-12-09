/**
 * OrganizationBootstrapWorkflow
 *
 * Orchestrates organization provisioning with contacts/addresses/phones, DNS, and user invitations.
 *
 * Flow:
 * 1. Create organization record with contacts, addresses, phones (emits domain events)
 * 2. Configure DNS (conditional - only if subdomain provided, with 7 retry attempts)
 * 3. Generate user invitations
 * 4. Send invitation emails
 * 5. Activate organization
 *
 * Compensation (Saga Pattern - reverse order):
 * - If any step fails after invitations, revoke invitations
 * - If any step fails after DNS creation, remove DNS record
 * - If any step fails after organization creation:
 *   - Delete phones (emit phone.deleted events)
 *   - Delete addresses (emit address.deleted events)
 *   - Delete contacts (emit contact.deleted events)
 *   - Deactivate organization (soft delete)
 *
 * Idempotency:
 * - Workflow ID should be unique per organization (e.g., org-bootstrap-{subdomain} or org-bootstrap-{name})
 * - Activities check-then-act for idempotency
 * - Events use unique event_id for deduplication
 *
 * DNS Retry Strategy:
 * - ConfigureDNS is idempotent (returns existing record if found)
 * - 7 retry attempts with exponential backoff
 * - Initial delay: 10 seconds
 * - Backoff: 2x each retry
 * - Max delay: 5 minutes
 * - Total max time: ~20 minutes
 *
 * Conditional DNS Provisioning:
 * - Subdomain required for: providers, VAR partners
 * - Subdomain skipped for: stakeholder partners (family, court), platform owner
 */

import { proxyActivities, sleep, log } from '@temporalio/workflow';
import type * as activities from '@activities/organization-bootstrap';
import type {
  OrganizationBootstrapParams,
  OrganizationBootstrapResult,
  WorkflowState
} from '@shared/types';

// Configure activity options
const {
  createOrganization,
  configureDNS,
  verifyDNS,
  generateInvitations,
  sendInvitationEmails,
  activateOrganization,
  removeDNS,
  deactivateOrganization,
  revokeInvitations,
  deleteContacts,
  deleteAddresses,
  deletePhones
} = proxyActivities<typeof activities>({
  startToCloseTimeout: '10 minutes',
  retry: {
    maximumAttempts: 3,
    initialInterval: '1s',
    backoffCoefficient: 2,
    maximumInterval: '30s'
  }
});

/**
 * Organization Bootstrap Workflow
 *
 * Orchestrates the complete provisioning of a new organization including
 * database records, DNS configuration, user invitations, and activation.
 * Implements the Saga pattern for automatic compensation (rollback) on failure.
 *
 * @param params - Organization bootstrap parameters
 * @param params.subdomain - Optional subdomain for DNS (required for providers/VAR partners)
 * @param params.orgData - Organization details (name, type, contacts, addresses, phones)
 * @param params.orgData.name - Organization display name
 * @param params.orgData.type - Organization type: 'provider' | 'provider_partner' | 'platform_owner'
 * @param params.orgData.contacts - Array of contact records (at least one required)
 * @param params.orgData.addresses - Array of address records
 * @param params.orgData.phones - Array of phone records
 * @param params.users - Array of users to invite with email, name, and role
 * @param params.frontendUrl - Frontend URL for invitation links (passed from caller)
 * @param params.retryConfig - Optional DNS retry configuration for testing
 *
 * @returns Promise<OrganizationBootstrapResult> - Bootstrap result
 * @returns {string} result.orgId - Created organization UUID
 * @returns {string} result.domain - Full domain name (e.g., 'subdomain.firstovertheline.com')
 * @returns {boolean} result.dnsConfigured - Whether DNS was successfully configured
 * @returns {number} result.invitationsSent - Count of successfully sent invitation emails
 * @returns {string[]} result.errors - Non-fatal errors (email failures, compensation errors)
 *
 * @precondition Workflow ID must be unique (e.g., `org-bootstrap-{subdomain}`)
 * @precondition params.orgData.contacts must contain at least one contact
 * @precondition params.users must contain at least one user to invite
 * @precondition For providers/VAR partners: params.subdomain must be unique and available
 *
 * @postcondition On success: Organization record exists with status='active'
 * @postcondition On success: All contacts, addresses, phones linked to organization
 * @postcondition On success: DNS CNAME record exists (if subdomain provided)
 * @postcondition On success: Invitation emails sent to all users
 * @postcondition On failure: Compensation runs in reverse order (Saga pattern)
 * @postcondition On failure: Organization status='inactive', DNS removed, invitations revoked
 *
 * @sideeffect Emits domain events: organization.created, contact.created, address.created,
 *             phone.created, invitation.generated, invitation.sent, organization.activated
 * @sideeffect Creates Cloudflare DNS CNAME record (if subdomain provided)
 * @sideeffect Sends invitation emails via configured email provider
 * @sideeffect On compensation: Emits *.deleted events and removes external resources
 *
 * @throws {Error} DNS configuration failed after max retries (triggers compensation)
 * @throws {Error} Activity execution timeout (10 minutes per activity)
 *
 * @example
 * // Start workflow with unique ID
 * const handle = await client.workflow.start(organizationBootstrapWorkflow, {
 *   workflowId: `org-bootstrap-${subdomain}`,
 *   taskQueue: 'bootstrap',
 *   args: [{
 *     subdomain: 'acme-health',
 *     orgData: {
 *       name: 'ACME Health Services',
 *       type: 'provider',
 *       contacts: [{ firstName: 'John', lastName: 'Doe', email: 'john@acme.com', type: 'a4c_admin', label: 'Primary' }],
 *       addresses: [{ street1: '123 Main St', city: 'Austin', state: 'TX', zipCode: '78701', type: 'physical', label: 'HQ' }],
 *       phones: [{ number: '512-555-1234', type: 'office', label: 'Main' }]
 *     },
 *     users: [{ email: 'john@acme.com', firstName: 'John', lastName: 'Doe', role: 'org_admin' }],
 *     frontendUrl: 'https://a4c.firstovertheline.com'
 *   }]
 * });
 * const result = await handle.result();
 */
export async function organizationBootstrapWorkflow(
  params: OrganizationBootstrapParams
): Promise<OrganizationBootstrapResult> {
  log.info('Starting OrganizationBootstrapWorkflow', { subdomain: params.subdomain });

  // Initialize workflow state for compensation tracking
  const state: WorkflowState = {
    orgCreated: false,
    dnsConfigured: false,
    dnsSkipped: false,
    invitationsSent: false,
    errors: [],
    compensationErrors: []
  };

  try {
    // ========================================
    // Step 1: Create Organization
    // ========================================
    log.info('Step 1: Creating organization', { subdomain: params.subdomain });

    state.orgId = await createOrganization({
      name: params.orgData.name,
      type: params.orgData.type,
      parentOrgId: params.orgData.parentOrgId,
      subdomain: params.subdomain,
      contacts: params.orgData.contacts,
      addresses: params.orgData.addresses,
      phones: params.orgData.phones,
      partnerType: params.orgData.partnerType,
      referringPartnerId: params.orgData.referringPartnerId
    });

    state.orgCreated = true;
    log.info('Organization created', {
      orgId: state.orgId,
      contactCount: params.orgData.contacts.length,
      addressCount: params.orgData.addresses.length,
      phoneCount: params.orgData.phones.length
    });

    // ========================================
    // Step 2: Configure DNS (conditional, only if subdomain provided)
    // ========================================
    if (params.subdomain) {
      log.info('Step 2: Configuring DNS', { subdomain: params.subdomain });

      // DNS retry configuration with defaults
      const dnsRetryBaseMs = params.retryConfig?.baseDelayMs ?? 10000;
      const dnsRetryMaxMs = params.retryConfig?.maxDelayMs ?? 300000;
      const maxDnsRetries = params.retryConfig?.maxAttempts ?? 7;

      let dnsRetryCount = 0;
      let dnsSuccess = false;

      while (dnsRetryCount < maxDnsRetries && !dnsSuccess) {
        try {
          const dnsResult = await configureDNS({
            orgId: state.orgId!,
            subdomain: params.subdomain
            // targetDomain defaults to PLATFORM_BASE_DOMAIN from env config
          });

          state.domain = dnsResult.fqdn;
          state.dnsRecordId = dnsResult.recordId;
          state.dnsConfigured = true;
          dnsSuccess = true;

          log.info('DNS configured successfully', {
            fqdn: dnsResult.fqdn,
            recordId: dnsResult.recordId,
            attempts: dnsRetryCount + 1
          });

          // Verify DNS propagation (optional, for production mode)
          try {
            await verifyDNS({ orgId: state.orgId!, domain: dnsResult.fqdn });
            log.info('DNS verified successfully', { fqdn: dnsResult.fqdn });
          } catch (verifyError) {
            // DNS verification failed, but we'll continue
            // DNS may not be propagated yet, but record is created
            log.warn('DNS verification failed (non-fatal)', {
              error: verifyError instanceof Error ? verifyError.message : 'Unknown error'
            });
          }

        } catch (error) {
          dnsRetryCount++;
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';

          log.warn('DNS configuration attempt failed', {
            attempt: dnsRetryCount,
            maxAttempts: maxDnsRetries,
            error: errorMessage
          });

          if (dnsRetryCount >= maxDnsRetries) {
            throw new Error(
              `DNS configuration failed after ${maxDnsRetries} attempts. Last error: ${errorMessage}`
            );
          }

          // Exponential backoff using configured delays
          const delayMs = Math.min(
            dnsRetryBaseMs * Math.pow(2, dnsRetryCount - 1),
            dnsRetryMaxMs
          );
          const delaySeconds = Math.floor(delayMs / 1000);

          log.info('Retrying DNS configuration', {
            delaySeconds,
            nextAttempt: dnsRetryCount + 1
          });

          await sleep(`${delaySeconds}s`);
        }
      }
    } else {
      // No subdomain provided, skip DNS provisioning
      state.dnsSkipped = true;
      log.info('Step 2: Skipping DNS configuration (no subdomain required)');
    }

    // ========================================
    // Step 3: Generate Invitations
    // ========================================
    log.info('Step 3: Generating invitations', {
      userCount: params.users.length
    });

    state.invitations = await generateInvitations({
      orgId: state.orgId!,
      users: params.users
    });

    log.info('Invitations generated', {
      count: state.invitations.length
    });

    // ========================================
    // Step 4: Send Invitation Emails
    // ========================================
    log.info('Step 4: Sending invitation emails', {
      count: state.invitations.length
    });

    const emailResult = await sendInvitationEmails({
      orgId: state.orgId!,
      invitations: state.invitations,
      domain: state.domain!,
      // frontendUrl passed from params if provided, otherwise activity uses FRONTEND_URL from env
      frontendUrl: params.frontendUrl
    });

    state.invitationsSent = true;

    log.info('Invitation emails sent', {
      successCount: emailResult.successCount,
      failureCount: emailResult.failures.length
    });

    // Record email failures as non-fatal errors
    if (emailResult.failures.length > 0) {
      for (const failure of emailResult.failures) {
        state.errors.push(`Email failed for ${failure.email}: ${failure.error}`);
      }
    }

    // ========================================
    // Step 5: Activate Organization
    // ========================================
    log.info('Step 5: Activating organization', { orgId: state.orgId });

    await activateOrganization({ orgId: state.orgId! });

    log.info('Organization activated', { orgId: state.orgId });

    // ========================================
    // Success!
    // ========================================
    log.info('OrganizationBootstrapWorkflow completed successfully', {
      orgId: state.orgId,
      domain: state.domain,
      invitationsSent: emailResult.successCount
    });

    return {
      orgId: state.orgId!,
      domain: state.domain!,
      dnsConfigured: state.dnsConfigured,
      invitationsSent: emailResult.successCount,
      errors: state.errors
    };

  } catch (error) {
    // ========================================
    // Failure - Run Compensation (Saga)
    // ========================================
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    log.error('OrganizationBootstrapWorkflow failed, running compensation', {
      error: errorMessage,
      state
    });

    state.errors.push(`Workflow failed: ${errorMessage}`);

    // Compensation: Revoke invitations if any were generated
    if (state.invitations && state.invitations.length > 0) {
      try {
        log.info('Compensation: Revoking invitations', { orgId: state.orgId });
        const revokedCount = await revokeInvitations({ orgId: state.orgId! });
        log.info('Invitations revoked', { count: revokedCount });
      } catch (compError) {
        const compErrorMsg = compError instanceof Error ? compError.message : 'Unknown error';
        log.error('Compensation failed: revoke invitations', { error: compErrorMsg });
        state.compensationErrors.push(`Failed to revoke invitations: ${compErrorMsg}`);
      }
    }

    // Compensation: Remove DNS if configured
    if (state.dnsConfigured && params.subdomain) {
      try {
        log.info('Compensation: Removing DNS', { subdomain: params.subdomain });
        await removeDNS({ orgId: state.orgId!, subdomain: params.subdomain });
        log.info('DNS removed', { subdomain: params.subdomain });
      } catch (compError) {
        const compErrorMsg = compError instanceof Error ? compError.message : 'Unknown error';
        log.error('Compensation failed: remove DNS', { error: compErrorMsg });
        state.compensationErrors.push(`Failed to remove DNS: ${compErrorMsg}`);
      }
    }

    // Compensation: Delete phones, addresses, contacts (cascade deletion in reverse order)
    if (state.orgCreated && state.orgId) {
      // Delete phones
      try {
        log.info('Compensation: Deleting phones', { orgId: state.orgId });
        await deletePhones({ orgId: state.orgId });
        log.info('Phones deleted', { orgId: state.orgId });
      } catch (compError) {
        const compErrorMsg = compError instanceof Error ? compError.message : 'Unknown error';
        log.error('Compensation failed: delete phones', { error: compErrorMsg });
        state.compensationErrors.push(`Failed to delete phones: ${compErrorMsg}`);
      }

      // Delete addresses
      try {
        log.info('Compensation: Deleting addresses', { orgId: state.orgId });
        await deleteAddresses({ orgId: state.orgId });
        log.info('Addresses deleted', { orgId: state.orgId });
      } catch (compError) {
        const compErrorMsg = compError instanceof Error ? compError.message : 'Unknown error';
        log.error('Compensation failed: delete addresses', { error: compErrorMsg });
        state.compensationErrors.push(`Failed to delete addresses: ${compErrorMsg}`);
      }

      // Delete contacts
      try {
        log.info('Compensation: Deleting contacts', { orgId: state.orgId });
        await deleteContacts({ orgId: state.orgId });
        log.info('Contacts deleted', { orgId: state.orgId });
      } catch (compError) {
        const compErrorMsg = compError instanceof Error ? compError.message : 'Unknown error';
        log.error('Compensation failed: delete contacts', { error: compErrorMsg });
        state.compensationErrors.push(`Failed to delete contacts: ${compErrorMsg}`);
      }

      // Deactivate organization (final step)
      try {
        log.info('Compensation: Deactivating organization', { orgId: state.orgId });
        await deactivateOrganization({ orgId: state.orgId });
        log.info('Organization deactivated', { orgId: state.orgId });
      } catch (compError) {
        const compErrorMsg = compError instanceof Error ? compError.message : 'Unknown error';
        log.error('Compensation failed: deactivate organization', { error: compErrorMsg });
        state.compensationErrors.push(`Failed to deactivate organization: ${compErrorMsg}`);
      }
    }

    // Return failure result
    return {
      orgId: state.orgId || '',
      domain: state.domain || '',
      dnsConfigured: state.dnsConfigured,
      invitationsSent: 0,
      errors: [...state.errors, ...state.compensationErrors]
    };
  }
}
