/**
 * Temporal Worker Entry Point
 *
 * Initializes and runs the Temporal worker for organization bootstrap workflows.
 *
 * Features:
 * - Zod environment validation on startup (fail-fast)
 * - Configuration validation with business logic
 * - Graceful shutdown handling
 * - Health check server for Kubernetes probes
 * - Automatic reconnection on Temporal disconnection
 *
 * Usage:
 *   NODE_ENV=production node dist/worker/index.js
 */

// =============================================================================
// ENVIRONMENT LOADING - MUST BE FIRST
// Load dotenv before any other code runs (development only)
// =============================================================================
if (process.env.NODE_ENV !== 'production') {
  // eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
  require('dotenv').config({ path: '.env.local' });
  // eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
  require('dotenv').config();
}

import { NativeConnection, Worker } from '@temporalio/worker';
import { logConfigurationStatus, getWorkflowsEnv } from '../shared/config';
import { HealthCheckServer } from './health';
import * as activities from '../activities/organization-bootstrap';

/**
 * Main worker initialization
 */
async function run() {
  console.log('='.repeat(60));
  console.log('🚀 Starting Temporal Worker');
  console.log('='.repeat(60));
  console.log('');

  // ==========================================================================
  // CONFIGURATION VALIDATION - FAIL FAST
  // Zod validates required env vars, then business logic checks provider combos
  // ==========================================================================
  try {
    logConfigurationStatus();
  } catch (error) {
    console.error('\n❌ Configuration validation failed');
    console.error('   Fix the configuration errors above and restart the worker.\n');
    process.exit(1);
  }

  // Get validated environment (safe to use after validation)
  const env = getWorkflowsEnv();

  // Start health check server
  const healthCheck = new HealthCheckServer(env.HEALTH_CHECK_PORT);

  try {
    await healthCheck.start();
  } catch (error) {
    console.error('❌ Failed to start health check server:', error);
    process.exit(1);
  }

  // Connect to Temporal
  console.log('Connecting to Temporal...');
  console.log(`  Address: ${env.TEMPORAL_ADDRESS}`);
  console.log(`  Namespace: ${env.TEMPORAL_NAMESPACE}`);
  console.log('');

  let connection: NativeConnection;
  try {
    connection = await NativeConnection.connect({
      address: env.TEMPORAL_ADDRESS
    });
    healthCheck.setTemporalConnected(true);
    console.log('✅ Connected to Temporal\n');
  } catch (error) {
    console.error('❌ Failed to connect to Temporal:', error);
    healthCheck.setTemporalConnected(false);
    await healthCheck.close();
    process.exit(1);
  }

  // Create worker
  console.log('Creating worker...');
  console.log(`  Task Queue: ${env.TEMPORAL_TASK_QUEUE}`);
  console.log(`  Workflows: organization-bootstrap`);
  console.log(`  Activities: 9 activities (6 forward, 3 compensation)`);
  console.log('');

  let worker: Worker;
  try {
    worker = await Worker.create({
      connection,
      namespace: env.TEMPORAL_NAMESPACE,
      taskQueue: env.TEMPORAL_TASK_QUEUE,
      workflowsPath: require.resolve('../workflows/organization-bootstrap'),
      activities,
      // Worker options
      maxConcurrentActivityTaskExecutions: 10,
      maxConcurrentWorkflowTaskExecutions: 10,
      // Enable verbose logging in development
      enableSDKTracing: env.NODE_ENV !== 'production'
    });

    healthCheck.setWorkerRunning(true);
    console.log('✅ Worker created successfully\n');
  } catch (error) {
    console.error('❌ Failed to create worker:', error);
    healthCheck.setWorkerRunning(false);
    await connection.close();
    await healthCheck.close();
    process.exit(1);
  }

  // Graceful shutdown handling
  const shutdown = async (signal: string) => {
    console.log(`\n📡 Received ${signal}, starting graceful shutdown...`);

    healthCheck.setWorkerRunning(false);

    try {
      console.log('  Shutting down worker...');
      worker.shutdown();
      console.log('  ✅ Worker shutdown complete');

      console.log('  Closing Temporal connection...');
      await connection.close();
      healthCheck.setTemporalConnected(false);
      console.log('  ✅ Temporal connection closed');

      console.log('  Closing health check server...');
      await healthCheck.close();
      console.log('  ✅ Health check server closed');

      console.log('\n👋 Graceful shutdown complete\n');
      process.exit(0);
    } catch (error) {
      console.error('❌ Error during shutdown:', error);
      process.exit(1);
    }
  };

  // Register shutdown handlers
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  // Log startup complete
  console.log('='.repeat(60));
  console.log('✅ Worker is running and ready to process workflows');
  console.log('='.repeat(60));
  console.log('');
  console.log('Configuration:');
  console.log(`  Temporal Address: ${env.TEMPORAL_ADDRESS}`);
  console.log(`  Temporal Namespace: ${env.TEMPORAL_NAMESPACE}`);
  console.log(`  Task Queue: ${env.TEMPORAL_TASK_QUEUE}`);
  console.log(`  Workflow Mode: ${env.WORKFLOW_MODE}`);
  console.log(`  Health Check Port: ${env.HEALTH_CHECK_PORT}`);
  console.log(`  Supabase URL: ${env.SUPABASE_URL}`);
  console.log(`  Supabase Key: ${env.SUPABASE_SERVICE_ROLE_KEY.substring(0, 20)}...`);
  console.log('');
  console.log('Health Endpoints:');
  console.log(`  Liveness:  http://localhost:${env.HEALTH_CHECK_PORT}/health`);
  console.log(`  Readiness: http://localhost:${env.HEALTH_CHECK_PORT}/ready`);
  console.log('');
  console.log('Press Ctrl+C to stop');
  console.log('');

  // Run worker (this blocks until shutdown)
  try {
    await worker.run();
  } catch (error) {
    console.error('❌ Worker error:', error);
    healthCheck.setWorkerRunning(false);
    await shutdown('ERROR');
  }
}

// Run if executed directly
if (require.main === module) {
  run().catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

export { run };
