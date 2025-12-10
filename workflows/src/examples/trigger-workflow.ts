/**
 * Example: Triggering Organization Bootstrap Workflow
 *
 * This example shows how to trigger the organization bootstrap workflow
 * from a Temporal client (e.g., from an API endpoint or admin script).
 *
 * Usage:
 *   ts-node src/examples/trigger-workflow.ts
 */

import { Connection, Client } from '@temporalio/client';
import type { OrganizationBootstrapParams } from '@shared/types';

async function main() {
  // Connect to Temporal server
  const connection = await Connection.connect({
    address: process.env.TEMPORAL_ADDRESS || 'localhost:7233'
  });

  const client = new Client({
    connection,
    namespace: process.env.TEMPORAL_NAMESPACE || 'default'
  });

  // Generate organization ID (in production, the API generates this)
  const organizationId = crypto.randomUUID();

  // Workflow parameters - Test Case C: VAR Partner Organization
  const params: OrganizationBootstrapParams = {
    organizationId,
    subdomain: 'var-partner-001',
    orgData: {
      name: 'Value Added Reseller Corp',
      type: 'provider_partner',
      partnerType: 'var',
      contacts: [
        {
          firstName: 'Alice',
          lastName: 'Manager',
          email: 'alice@var-partner.com',
          title: 'Account Manager',
          department: 'Sales',
          type: 'a4c_admin',
          label: 'Primary Contact'
        }
      ],
      addresses: [
        {
          street1: '500 Tech Drive',
          city: 'San Jose',
          state: 'CA',
          zipCode: '95110',
          type: 'physical',
          label: 'Office'
        },
        {
          street1: '501 Tech Drive',
          city: 'San Jose',
          state: 'CA',
          zipCode: '95110',
          type: 'mailing',
          label: 'Mailing'
        }
      ],
      phones: [
        {
          number: '408-555-0100',
          type: 'office',
          label: 'Main Line'
        },
        {
          number: '408-555-0200',
          type: 'mobile',
          label: 'Mobile'
        }
      ]
    },
    users: [
      {
        email: 'var.admin@var-partner.com',
        firstName: 'VAR',
        lastName: 'Admin',
        role: 'partner_admin'
      }
    ]
  };

  // Start workflow
  // Workflow ID uses organizationId for unified ID system
  const workflowId = `org-bootstrap-${organizationId}`;

  console.log('Starting OrganizationBootstrapWorkflow...');
  console.log(`Workflow ID: ${workflowId}`);
  console.log(`Subdomain: ${params.subdomain}`);
  console.log(`Users: ${params.users.length}`);

  const handle = await client.workflow.start('organizationBootstrapWorkflow', {
    args: [params],
    taskQueue: process.env.TEMPORAL_TASK_QUEUE || 'bootstrap',
    workflowId,
    // Workflow execution timeout (max time for entire workflow)
    workflowExecutionTimeout: '30 minutes'
  });

  console.log(`\nWorkflow started: ${handle.workflowId}`);
  console.log(`Run ID: ${handle.firstExecutionRunId}`);
  console.log('\nWaiting for result...\n');

  // Wait for workflow to complete
  const result = await handle.result();

  // Display results
  console.log('✅ Workflow completed successfully!');
  console.log('\nResults:');
  console.log(`  Organization ID: ${result.orgId}`);
  console.log(`  Domain: ${result.domain}`);
  console.log(`  DNS Configured: ${result.dnsConfigured}`);
  console.log(`  Invitations Sent: ${result.invitationsSent}`);

  if (result.errors && result.errors.length > 0) {
    console.log('\n⚠️  Non-fatal errors:');
    result.errors.forEach((error: string, i: number) => {
      console.log(`  ${i + 1}. ${error}`);
    });
  }

  // Close connection
  await connection.close();
}

// Run if executed directly
if (require.main === module) {
  main()
    .then(() => {
      console.log('\n✅ Done!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n❌ Error:', error);
      process.exit(1);
    });
}

export { main };
