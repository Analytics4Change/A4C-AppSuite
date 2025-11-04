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

  // Workflow parameters
  const params: OrganizationBootstrapParams = {
    subdomain: 'acme',
    orgData: {
      name: 'Acme Corporation',
      type: 'provider',
      contactEmail: 'admin@acme.com'
    },
    users: [
      {
        email: 'john.doe@acme.com',
        firstName: 'John',
        lastName: 'Doe',
        role: 'super_admin'
      },
      {
        email: 'jane.smith@acme.com',
        firstName: 'Jane',
        lastName: 'Smith',
        role: 'provider_admin'
      }
    ]
  };

  // Start workflow
  // Workflow ID should be unique per organization
  const workflowId = `org-bootstrap-${params.subdomain}-${Date.now()}`;

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
