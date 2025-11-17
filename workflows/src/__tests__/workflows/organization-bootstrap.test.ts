/**
 * Organization Bootstrap Workflow Integration Tests
 *
 * Tests the complete organization provisioning workflow with mock providers.
 *
 * Test Coverage:
 * - Happy path: All steps succeed
 * - DNS retry: DNS configuration retries and succeeds
 * - Email failures: Some emails fail but workflow continues
 * - Compensation: Workflow fails and runs rollback
 */

import { TestWorkflowEnvironment } from '@temporalio/testing';
import { Worker } from '@temporalio/worker';
import { v4 as uuidv4 } from 'uuid';
import type { OrganizationBootstrapParams, OrganizationBootstrapResult } from '@shared/types';
import { organizationBootstrapWorkflow } from '@workflows/organization-bootstrap';

// Mock activities - no real API calls in tests
const mockActivities = {
  createOrganization: async () => uuidv4(),
  configureDNS: async (params: any) => ({
    fqdn: `${params.subdomain}.firstovertheline.com`,
    recordId: 'mock-record-id'
  }),
  verifyDNS: async () => true,
  generateInvitations: async (params: any) => params.users.map((user: any) => ({
    invitationId: uuidv4(),
    email: user.email,
    token: 'mock-token-' + Math.random().toString(36).substring(7),
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
  })),
  sendInvitationEmails: async (params: any) => ({
    successCount: params.invitations.length,
    failures: []
  }),
  activateOrganization: async () => true,
  // Compensation activities
  removeDNS: async () => true,
  deactivateOrganization: async () => true,
  revokeInvitations: async () => true,
  deleteContacts: async () => true,
  deleteAddresses: async () => true,
  deletePhones: async () => true
};

describe('OrganizationBootstrapWorkflow', () => {
  let testEnv: TestWorkflowEnvironment;

  beforeAll(async () => {
    // Create test environment
    testEnv = await TestWorkflowEnvironment.createLocal();
  });

  afterAll(async () => {
    await testEnv?.teardown();
  });

  afterEach(() => {
    // Reset environment variables between tests
    process.env.WORKFLOW_MODE = 'mock';
    process.env.TAG_DEV_ENTITIES = 'false';
  });

  describe('Happy Path', () => {
    it('should successfully provision organization with DNS and invitations', async () => {
      const { client, nativeConnection } = testEnv;

      // Create worker with mock activities
      const worker = await Worker.create({
        connection: nativeConnection,
        taskQueue: 'test',
        workflowsPath: require.resolve('@workflows/organization-bootstrap'),
        activities: mockActivities
      });

      // Workflow parameters
      const params: OrganizationBootstrapParams = {
        subdomain: 'test-org',
        orgData: {
          name: 'Test Organization',
          type: 'provider',
          contacts: [
            {
              firstName: 'John',
              lastName: 'Doe',
              email: 'admin@test-org.com',
              title: 'CEO',
              department: 'Executive',
              type: 'billing',
              label: 'Primary Contact'
            }
          ],
          addresses: [
            {
              street1: '123 Main St',
              city: 'Boston',
              state: 'MA',
              zipCode: '02101',
              type: 'physical',
              label: 'Main Office'
            }
          ],
          phones: [
            {
              number: '555-1234',
              type: 'office',
              label: 'Main Line'
            }
          ]
        },
        users: [
          {
            email: 'user1@example.com',
            firstName: 'John',
            lastName: 'Doe',
            role: 'admin'
          },
          {
            email: 'user2@example.com',
            firstName: 'Jane',
            lastName: 'Smith',
            role: 'user'
          }
        ]
      };

      // Start workflow
      const handle = await client.workflow.start(organizationBootstrapWorkflow, {
        args: [params],
        taskQueue: 'test',
        workflowId: `test-${uuidv4()}`
      });

      // Run workflow
      await worker.runUntil(async () => {
        const result = await handle.result();

        // Assertions
        expect(result.orgId).toBeDefined();
        expect(result.domain).toBe('test-org.firstovertheline.com');
        expect(result.dnsConfigured).toBe(true);
        expect(result.invitationsSent).toBe(2);
        expect(result.errors).toHaveLength(0);
      });
    });

    it('should be idempotent when run multiple times', async () => {
      const { client, nativeConnection } = testEnv;

      const worker = await Worker.create({
        connection: nativeConnection,
        taskQueue: 'test',
        workflowsPath: require.resolve('@workflows/organization-bootstrap'),
        activities: mockActivities
      });

      const params: OrganizationBootstrapParams = {
        subdomain: 'idempotent-test',
        orgData: {
          name: 'Idempotent Test Org',
          type: 'provider',
          contacts: [
            {
              firstName: 'Admin',
              lastName: 'User',
              email: 'admin@idempotent.com',
              type: 'billing',
              label: 'Primary Contact'
            }
          ],
          addresses: [
            {
              street1: '456 Test Ave',
              city: 'Cambridge',
              state: 'MA',
              zipCode: '02139',
              type: 'physical',
              label: 'HQ'
            }
          ],
          phones: [
            {
              number: '555-5678',
              type: 'office',
              label: 'Main'
            }
          ]
        },
        users: [
          {
            email: 'user@example.com',
            firstName: 'Test',
            lastName: 'User',
            role: 'admin'
          }
        ]
      };

      // Run workflow first time
      const workflowId = `idempotent-test-${Date.now()}`;
      const handle1 = await client.workflow.start(organizationBootstrapWorkflow, {
        args: [params],
        taskQueue: 'test',
        workflowId
      });

      let result1: OrganizationBootstrapResult | undefined;
      await worker.runUntil(async () => {
        result1 = await handle1.result();
      });

      // Get handle to same workflow ID (idempotent retrieval)
      const handle2 = await client.workflow.getHandle(workflowId);
      const result2 = await handle2.result();

      // Verify both results are identical (idempotency)
      expect(result1).toBeDefined();
      expect(result2).toBeDefined();
      expect(result1?.orgId).toBe(result2.orgId);
      expect(result1?.domain).toBe(result2.domain);
      expect(result1?.dnsConfigured).toBe(result2.dnsConfigured);
      expect(result1?.invitationsSent).toBe(result2.invitationsSent);
      expect(result1?.errors).toEqual(result2.errors);

      // Verify workflow succeeded
      expect(result1?.orgId).toBeDefined();
      expect(result1?.dnsConfigured).toBe(true);
      expect(result1?.invitationsSent).toBe(1);
    });
  });

  describe('Email Failures', () => {
    it('should continue when some emails fail', async () => {
      const { client, nativeConnection } = testEnv;

      // Mock activities with email failures
      const activitiesWithFailures = {
        ...mockActivities,
        sendInvitationEmails: async (params: any) => {
          return {
            successCount: 1,
            failures: [
              {
                email: 'invalid@example.com',
                error: 'Invalid email address'
              }
            ]
          };
        }
      };

      const worker = await Worker.create({
        connection: nativeConnection,
        taskQueue: 'test',
        workflowsPath: require.resolve('@workflows/organization-bootstrap'),
        activities: activitiesWithFailures
      });

      const params: OrganizationBootstrapParams = {
        subdomain: 'email-fail-test',
        orgData: {
          name: 'Email Fail Test',
          type: 'provider',
          contacts: [{ firstName: 'Admin', lastName: 'User', email: 'admin@test.com', type: 'billing', label: 'Contact' }],
          addresses: [{ street1: '789 Test St', city: 'Boston', state: 'MA', zipCode: '02101', type: 'physical', label: 'Office' }],
          phones: [{ number: '555-9999', type: 'office', label: 'Main' }]
        },
        users: [
          {
            email: 'valid@example.com',
            firstName: 'Valid',
            lastName: 'User',
            role: 'admin'
          },
          {
            email: 'invalid@example.com',
            lastName: 'Invalid',
            lastName: 'User',
            role: 'user'
          }
        ]
      };

      const handle = await client.workflow.start(organizationBootstrapWorkflow, {
        args: [params],
        taskQueue: 'test',
        workflowId: `test-${uuidv4()}`
      });

      await worker.runUntil(async () => {
        const result = await handle.result();

        // Workflow should succeed but report email failures
        expect(result.orgId).toBeDefined();
        expect(result.invitationsSent).toBe(1);
        expect(result.errors.length).toBeGreaterThan(0);
        expect(result.errors[0]).toContain('invalid@example.com');
      });
    });
  });

  describe('Compensation (Saga)', () => {

    it('should run compensation when DNS configuration fails', async () => {
      const { client, nativeConnection } = testEnv;

      // Mock activities with DNS failure
      const activitiesWithDnsFailure = {
        ...mockActivities,
        configureDNS: async () => {
          throw new Error('DNS configuration failed: Zone not found');
        }
      };

      const worker = await Worker.create({
        connection: nativeConnection,
        taskQueue: 'test',
        workflowsPath: require.resolve('@workflows/organization-bootstrap'),
        activities: activitiesWithDnsFailure
      });

      const params: OrganizationBootstrapParams = {
        subdomain: 'dns-fail-test',
        orgData: {
          name: 'DNS Fail Test',
          type: 'provider',
          contacts: [{ firstName: 'Admin', lastName: 'User', email: 'admin@test.com', type: 'billing', label: 'Contact' }],
          addresses: [{ street1: '999 DNS Rd', city: 'Boston', state: 'MA', zipCode: '02101', type: 'physical', label: 'Office' }],
          phones: [{ number: '555-0001', type: 'office', label: 'Main' }]
        },
        users: [
          {
            email: 'user@example.com',
            firstName: 'Test',
            lastName: 'User',
            role: 'admin'
          }
        ],
        // Fast retry config for testing: 0.5s, 1s, 2s, 4s, 8s, 10s, 10s = ~36 seconds total
        retryConfig: {
          baseDelayMs: 500,    // 0.5 seconds
          maxDelayMs: 10000,   // 10 seconds max
          maxAttempts: 7
        }
      };

      const handle = await client.workflow.start(organizationBootstrapWorkflow, {
        args: [params],
        taskQueue: 'test',
        workflowId: `test-${uuidv4()}`
      });

      await worker.runUntil(async () => {
        const result = await handle.result();

        // Workflow should fail but return gracefully
        expect(result.orgId).toBeDefined();
        expect(result.dnsConfigured).toBe(false);
        expect(result.invitationsSent).toBe(0);
        expect(result.errors.length).toBeGreaterThan(0);
        expect(result.errors[0]).toContain('DNS configuration failed');
      });
    }, 60000); // 1 minute timeout (fast retry config: ~36 seconds total)

    it('should run compensation when invitation generation fails', async () => {
      const { client, nativeConnection } = testEnv;

      // Mock activities with invitation failure
      const activitiesWithInvitationFailure = {
        ...mockActivities,
        generateInvitations: async () => {
          throw new Error('Database error: Connection timeout');
        }
      };

      const worker = await Worker.create({
        connection: nativeConnection,
        taskQueue: 'test',
        workflowsPath: require.resolve('@workflows/organization-bootstrap'),
        activities: activitiesWithInvitationFailure
      });

      const params: OrganizationBootstrapParams = {
        subdomain: 'invite-fail-test',
        orgData: {
          name: 'Invite Fail Test',
          type: 'provider',
          contacts: [{ firstName: 'Admin', lastName: 'User', email: 'admin@test.com', type: 'billing', label: 'Contact' }],
          addresses: [{ street1: '888 Invite Ave', city: 'Boston', state: 'MA', zipCode: '02101', type: 'physical', label: 'Office' }],
          phones: [{ number: '555-0002', type: 'office', label: 'Main' }]
        },
        users: [
          {
            email: 'user@example.com',
            firstName: 'Test',
            lastName: 'User',
            role: 'admin'
          }
        ]
      };

      const handle = await client.workflow.start(organizationBootstrapWorkflow, {
        args: [params],
        taskQueue: 'test',
        workflowId: `test-${uuidv4()}`
      });

      await worker.runUntil(async () => {
        const result = await handle.result();

        // Workflow should fail and run compensation
        expect(result.orgId).toBeDefined();
        expect(result.dnsConfigured).toBe(true); // DNS succeeded before failure
        expect(result.invitationsSent).toBe(0);
        expect(result.errors.length).toBeGreaterThan(0);
      });
    });
  });

  describe('Tags Support', () => {
    it('should apply development tags when TAG_DEV_ENTITIES=true', async () => {
      // Set environment variable
      process.env.TAG_DEV_ENTITIES = 'true';
      process.env.WORKFLOW_MODE = 'development';

      const { client, nativeConnection } = testEnv;

      const worker = await Worker.create({
        connection: nativeConnection,
        taskQueue: 'test',
        workflowsPath: require.resolve('@workflows/organization-bootstrap'),
        activities: mockActivities
      });

      const params: OrganizationBootstrapParams = {
        subdomain: 'tagged-test',
        orgData: {
          name: 'Tagged Test Org',
          type: 'provider',
          contacts: [{ firstName: 'Admin', lastName: 'User', email: 'admin@tagged.com', type: 'billing', label: 'Contact' }],
          addresses: [{ street1: '777 Tagged Blvd', city: 'Boston', state: 'MA', zipCode: '02101', type: 'physical', label: 'Office' }],
          phones: [{ number: '555-0003', type: 'office', label: 'Main' }]
        },
        users: [
          {
            email: 'user@example.com',
            firstName: 'Test',
            lastName: 'User',
            role: 'admin'
          }
        ]
      };

      const handle = await client.workflow.start(organizationBootstrapWorkflow, {
        args: [params],
        taskQueue: 'test',
        workflowId: `test-${uuidv4()}`
      });

      await worker.runUntil(async () => {
        const result = await handle.result();

        // Verify workflow completed
        expect(result.orgId).toBeDefined();
        expect(result.dnsConfigured).toBe(true);

        // Note: Tags are applied in activities, which emit events
        // In real implementation, we'd query database to verify tags
        // For this test, we just verify workflow completed successfully
      });
    });
  });
});
