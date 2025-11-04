/**
 * Temporal Worker Entry Point
 *
 * Initializes and runs the Temporal worker for organization bootstrap workflows.
 *
 * Features:
 * - Configuration validation on startup
 * - Graceful shutdown handling
 * - Health check server for Kubernetes probes
 * - Automatic reconnection on Temporal disconnection
 *
 * Usage:
 *   NODE_ENV=production node dist/worker/index.js
 */

import { NativeConnection, Worker } from '@temporalio/worker';
import { logConfigurationStatus } from '../shared/config';
import { HealthCheckServer } from './health';
import * as activities from '../activities/organization-bootstrap';

// Load environment variables in development
if (process.env.NODE_ENV !== 'production') {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  require('dotenv').config({ path: '.env.local' });
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  require('dotenv').config();
}

/**
 * Main worker initialization
 */
async function run() {
  console.log('='.repeat(60));
  console.log('🚀 Starting Temporal Worker');
  console.log('='.repeat(60));
  console.log('');

  // Validate configuration
  try {
    logConfigurationStatus();
  } catch (error) {
    console.error('\n❌ Configuration validation failed');
    console.error('   Fix the configuration errors above and restart the worker.\n');
    process.exit(1);
  }

  // Start health check server
  const healthCheck = new HealthCheckServer(
    parseInt(process.env.HEALTH_CHECK_PORT || '9090', 10)
  );

  try {
    await healthCheck.start();
  } catch (error) {
    console.error('❌ Failed to start health check server:', error);
    process.exit(1);
  }

  // Connect to Temporal
  console.log('Connecting to Temporal...');
  console.log(`  Address: ${process.env.TEMPORAL_ADDRESS}`);
  console.log(`  Namespace: ${process.env.TEMPORAL_NAMESPACE}`);
  console.log('');

  let connection: NativeConnection;
  try {
    connection = await NativeConnection.connect({
      address: process.env.TEMPORAL_ADDRESS || 'localhost:7233'
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
  console.log(`  Task Queue: ${process.env.TEMPORAL_TASK_QUEUE}`);
  console.log(`  Workflows: organization-bootstrap`);
  console.log(`  Activities: 9 activities (6 forward, 3 compensation)`);
  console.log('');

  let worker: Worker;
  try {
    worker = await Worker.create({
      connection,
      namespace: process.env.TEMPORAL_NAMESPACE || 'default',
      taskQueue: process.env.TEMPORAL_TASK_QUEUE || 'bootstrap',
      workflowsPath: require.resolve('../workflows/organization-bootstrap'),
      activities,
      // Worker options
      maxConcurrentActivityTaskExecutions: 10,
      maxConcurrentWorkflowTaskExecutions: 10,
      // Enable verbose logging in development
      enableSDKTracing: process.env.NODE_ENV !== 'production'
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
      await worker.shutdown();
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
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  // Log startup complete
  console.log('='.repeat(60));
  console.log('✅ Worker is running and ready to process workflows');
  console.log('='.repeat(60));
  console.log('');
  console.log('Configuration:');
  console.log(`  Temporal Address: ${process.env.TEMPORAL_ADDRESS}`);
  console.log(`  Temporal Namespace: ${process.env.TEMPORAL_NAMESPACE}`);
  console.log(`  Task Queue: ${process.env.TEMPORAL_TASK_QUEUE}`);
  console.log(`  Workflow Mode: ${process.env.WORKFLOW_MODE || 'development'}`);
  console.log(`  Health Check Port: ${process.env.HEALTH_CHECK_PORT || '9090'}`);
  console.log('');
  console.log('Health Endpoints:');
  console.log(`  Liveness:  http://localhost:${process.env.HEALTH_CHECK_PORT || '9090'}/health`);
  console.log(`  Readiness: http://localhost:${process.env.HEALTH_CHECK_PORT || '9090'}/ready`);
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
